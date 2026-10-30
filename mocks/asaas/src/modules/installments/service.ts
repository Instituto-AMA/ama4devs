/**
 * Installment plans — the creation. (Track E)
 *
 * The difference that defines the resource: **the installment plan creates the N
 * charges RIGHT AWAY**. The subscription does not — it generates on demand, 40
 * days before each due date. They are two opposite models, and it is easy to
 * confuse them.
 *
 * Each installment is born from the SAME `createPayment()` of a one-off charge.
 * It is what guarantees that the 7th of 12 installments has exactly the same
 * shape, the same webhooks and the same settlement path of any other charge —
 * and that a fix in the charge lifecycle is worth the three origins at once.
 *
 * THE RULE OF THE REMAINDER: the rounding remainder goes in the LAST
 * installment.
 *   R$ 350.00 in 12x → 11 × R$ 29.16 + 1 × R$ 29.24  (exact sum: R$ 350.00)
 */
import { asc, eq } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { invalid } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { installments, payments } from '../../db/schema/index.ts'
import type {
  DiscountConfig,
  FineConfig,
  InterestConfig,
} from '../../db/schema/payments.ts'
import { isValidIsoDate, type IsoDate } from '../../domain/calendar.ts'
import type { BillingType } from '../../domain/fees.ts'
import * as ids from '../../domain/ids.ts'
import { installmentDueDates, splitTotal } from '../../domain/installments.ts'
import { brlToCents, cents, percentE4, sumCents, type Cents, type PercentE4 } from '../../domain/money.ts'
import { distributeTotalFixedValue, type SplitSpec } from '../../domain/split.ts'
import { declinesOnCharge } from '../../domain/credit-card.ts'
import {
  assertInstallmentsAllowed,
  DECLINED,
  hasCreditCard,
  persistCard,
  requireRemoteIp,
  resolveCard,
} from '../credit-cards/service.ts'
import { applyTransition } from '../payments/apply.ts'
import type { PaymentRow } from '../payments/serializer.ts'
import { createPayment } from '../payments/service.ts'

export type InstallmentRow = typeof installments.$inferSelect

/**
 * The split of an installment plan has TWO fixed value fields, and the difference
 * between them is the trap of the resource:
 *
 *   fixedValue       → applied TO EACH installment.   R$ 10 in 4x = R$ 40 in total.
 *   totalFixedValue  → divided BETWEEN the installments, with the remainder in
 *                      the last one (the same rule as the value of the
 *                      installments).
 *                      R$ 100 in 3x = 33.33 | 33.33 | 33.34.
 *
 * The naming helps nobody at all and it is where integrations burn.
 */
export interface InstallmentSplitInput {
  walletId: string
  fixedValueCents: Cents | null
  percentualValueE4: PercentE4 | null
  totalFixedValueCents: Cents | null
  /** Links the split to ONE installment only. Incompatible with totalFixedValue. */
  installmentNumber: number | null
  externalReference: string | null
  description: string | null
}

export interface CreateInstallmentInput {
  customerId: string
  billingType: BillingType
  installmentCount: number
  /** The total of the installment plan, already resolved (from `totalValue` or from `value × N`). */
  totalValueCents: Cents
  dueDate: IsoDate
  description?: string | null
  paymentExternalReference?: string | null
  discount?: DiscountConfig | null
  fine?: FineConfig | null
  interest?: InterestConfig | null
  postalService?: boolean
  daysAfterDueDateToRegistrationCancellation?: number | null
  splits: InstallmentSplitInput[]
  creditCardId?: string | null
}

export function parseInstallmentSplits(raw: unknown): InstallmentSplitInput[] {
  if (!Array.isArray(raw)) return []

  return raw.map((s: any) => {
    const hasTotalFixed = s.totalFixedValue !== undefined && s.totalFixedValue !== null
    const hasInstallmentNumber =
      s.installmentNumber !== undefined && s.installmentNumber !== null

    // The spec itself says: "Cannot be provided along with the 'totalFixedValue'".
    if (hasTotalFixed && hasInstallmentNumber) {
      throw invalid(
        'split',
        'totalFixedValue não pode ser informado junto com installmentNumber.',
      )
    }

    return {
      walletId: String(s.walletId ?? ''),
      fixedValueCents:
        s.fixedValue !== undefined && s.fixedValue !== null
          ? brlToCents(Number(s.fixedValue))
          : null,
      // 4 decimal places → 1e4 scale. 92.3444% → 923444.
      percentualValueE4:
        s.percentualValue !== undefined && s.percentualValue !== null
          ? percentE4(Math.round(Number(s.percentualValue) * 10_000))
          : null,
      totalFixedValueCents: hasTotalFixed ? brlToCents(Number(s.totalFixedValue)) : null,
      installmentNumber: hasInstallmentNumber ? Number(s.installmentNumber) : null,
      externalReference: s.externalReference ?? null,
      description: s.description ?? null,
    }
  })
}

/**
 * The splits that hold for ONE installment (0-based), already with the
 * `totalFixedValue` distributed. It is here that the difference between
 * `fixedValue` and `totalFixedValue` becomes arithmetic.
 */
export function splitsForInstallment(
  specs: readonly InstallmentSplitInput[],
  index: number,
  count: number,
): SplitSpec[] {
  const out: SplitSpec[] = []

  for (const spec of specs) {
    // A split tied to a specific installment does not hold for the others.
    if (spec.installmentNumber !== null && spec.installmentNumber !== index + 1) continue

    const fixed =
      spec.totalFixedValueCents !== null
        ? distributeTotalFixedValue(spec.totalFixedValueCents, count)[index]!
        : spec.fixedValueCents

    out.push({
      walletId: spec.walletId,
      fixedValueCents: fixed ?? null,
      percentualValueE4: spec.percentualValueE4 ?? null,
      externalReference: spec.externalReference,
      description: spec.description,
    })
  }

  return out
}

/**
 * Translates the body of **POST /v3/payments** (with `installmentCount`) into the
 * same installment plan input.
 *
 * There are two doors to the same resource, and the field names DIVERGE between
 * them — that is exactly where the integration burns:
 *
 *   POST /v3/installments   `value` (value of the installment) · `splits` · `paymentExternalReference`
 *   POST /v3/payments       `installmentValue`                · `split`  · `externalReference`
 *
 * And in POST /v3/payments the `value` is NOT the value of the installment: what
 * carries it is `installmentValue`. Using `value` here would multiply the total
 * by N.
 */
export function installmentInputFromPaymentBody(b: Record<string, any>): CreateInstallmentInput {
  const installmentCount = Number(b.installmentCount)
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw invalid('installmentCount', 'O número de parcelas deve ser um inteiro maior que zero.')
  }

  if (!isValidIsoDate(String(b.dueDate ?? ''))) {
    throw invalid('dueDate', 'A data de vencimento informada é inválida.')
  }

  let totalValueCents: Cents
  if (b.totalValue !== undefined && b.totalValue !== null) {
    totalValueCents = brlToCents(Number(b.totalValue))
  } else if (b.installmentValue !== undefined && b.installmentValue !== null) {
    totalValueCents = cents(brlToCents(Number(b.installmentValue)) * installmentCount)
  } else {
    throw invalid(
      'value',
      'Informe totalValue (o total a ser dividido) ou installmentValue (o valor de cada parcela).',
    )
  }

  if (totalValueCents <= 0) {
    throw invalid('value', 'O valor do parcelamento deve ser maior que zero.')
  }

  return {
    customerId: String(b.customer ?? ''),
    billingType: String(b.billingType ?? 'UNDEFINED') as BillingType,
    installmentCount,
    totalValueCents,
    dueDate: String(b.dueDate),
    description: b.description ?? null,
    paymentExternalReference: b.externalReference ?? null,
    discount: b.discount ?? null,
    fine: b.fine ?? null,
    interest: b.interest ?? null,
    postalService: b.postalService ?? false,
    daysAfterDueDateToRegistrationCancellation:
      b.daysAfterDueDateToRegistrationCancellation ?? null,
    splits: parseInstallmentSplits(b.split),
  }
}

/** Translates the body of POST /v3/installments. */
export function parseCreateInstallmentBody(b: Record<string, any>): CreateInstallmentInput {
  const installmentCount = Number(b.installmentCount)
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw invalid('installmentCount', 'O número de parcelas deve ser um inteiro maior que zero.')
  }

  if (!isValidIsoDate(String(b.dueDate ?? ''))) {
    throw invalid('dueDate', 'A data de vencimento informada é inválida.')
  }

  /**
   * `value` is the value OF EACH INSTALLMENT; `totalValue` is the total to
   * divide. One or the other is given. When both come, `totalValue` wins — it is
   * what carries the intention of "split this", and it is the only one that
   * expresses R$ 350 in 12x.
   */
  let totalValueCents: Cents
  if (b.totalValue !== undefined && b.totalValue !== null) {
    totalValueCents = brlToCents(Number(b.totalValue))
  } else if (b.value !== undefined && b.value !== null) {
    totalValueCents = cents(brlToCents(Number(b.value)) * installmentCount)
  } else {
    throw invalid(
      'value',
      'Informe value (o valor de cada parcela) ou totalValue (o total a ser dividido).',
    )
  }

  if (totalValueCents <= 0) {
    throw invalid('value', 'O valor do parcelamento deve ser maior que zero.')
  }

  return {
    customerId: String(b.customer ?? ''),
    billingType: String(b.billingType ?? 'UNDEFINED') as BillingType,
    installmentCount,
    totalValueCents,
    dueDate: String(b.dueDate),
    description: b.description ?? null,
    paymentExternalReference: b.paymentExternalReference ?? null,
    discount: b.discount ?? null,
    fine: b.fine ?? null,
    interest: b.interest ?? null,
    postalService: b.postalService ?? false,
    daysAfterDueDateToRegistrationCancellation:
      b.daysAfterDueDateToRegistrationCancellation ?? null,
    splits: parseInstallmentSplits(b.splits),
  }
}

/**
 * Creates the installment plan and ALL of its charges, in one single
 * transaction.
 *
 * `installmentCount` is passed to each `createPayment` because the card fee
 * range depends on the TOTAL number of installments (1x: 2.99% · 2–6x: 3.49% ·
 * 7–12x: 3.99% · 13–21x: 4.29%) — and not on the number of the installment.
 */
export async function createInstallment(
  ctx: AppContext,
  db: DB,
  accountId: string,
  ownWalletId: string,
  input: CreateInstallmentInput,
): Promise<{ installment: InstallmentRow; payments: PaymentRow[] }> {
  const count = input.installmentCount
  const parts = splitTotal(input.totalValueCents, count)
  const dueDates = installmentDueDates(input.dueDate, count)

  const id = ids.installmentId(ctx.rng) // A plain UUID — it has NO prefix. On purpose.

  /*
   * The plan is written before its charges: the creation event of each charge
   * finds the plan it belongs to (the payer is told about the plan once, on the
   * first installment). The net value is the sum of the charges, set after them.
   */
  const plan: InstallmentRow = {
    id,
    accountId,
    customerId: input.customerId,
    billingType: input.billingType,
    installmentCount: count,
    // The "installment" value is the one of the first N−1; the last one carries
    // the remainder.
    /**
     * The real Asaas reports in `paymentValue` the value of the LAST installment —
     * the one that carries the rounding remainder —, not the one of the other
     * eleven.
     *
     * R$ 350 in 12x → 11 × R$ 29.16 + R$ 29.24, and `paymentValue` = **29.24**.
     * Proven against the sandbox; it is counterintuitive, and we would not have
     * guessed it.
     */
    installmentValueCents: parts[parts.length - 1]!,
    totalValueCents: input.totalValueCents,
    netValueCents: 0,
    expirationDay: Number(input.dueDate.slice(8, 10)),
    description: input.description ?? null,
    paymentLinkId: null,
    checkoutSession: null,
    transactionReceiptUrl: null,
    deleted: false,
    dateCreated: ctx.clock.today(),
  }
  await db.insert(installments).values(plan)

  const created: PaymentRow[] = []
  for (let i = 0; i < count; i++) {
    const row = await createPayment(ctx, db, accountId, ownWalletId, {
      customerId: input.customerId,
      billingType: input.billingType,
      valueCents: parts[i]!,
      // The fee of the installment card comes from the TOTAL, not from the
      // installment. See calcInstallmentFee — proven against the real sandbox.
      installmentTotalCents: input.totalValueCents,
      /**
       * Without a description, Asaas GENERATES one: "Parcela 3 de 12." — we used
       * to return null. Proven against the real sandbox.
       *
       * TODO(rule): we do not know what it does when the description IS given
       * (replaces? concatenates?). Here the given one wins. A parity script with
       * a description settles it.
       */
      description: input.description ?? `Parcela ${i + 1} de ${count}.`,
      dueDate: dueDates[i]!,
      externalReference: input.paymentExternalReference ?? null,
      discount: input.discount ?? null,
      fine: input.fine ?? null,
      interest: input.interest ?? null,
      splits: splitsForInstallment(input.splits, i, count),
      postalService: input.postalService ?? false,
      daysAfterDueDateToRegistrationCancellation:
        input.daysAfterDueDateToRegistrationCancellation ?? null,
      installmentId: id,
      installmentNumber: i + 1,
      installmentCount: count,
      creditCardId: input.creditCardId ?? null,
    })
    created.push(row)
  }

  plan.netValueCents = sumCents(created.map((p) => cents(p.netValueCents)))
  await db.update(installments).set({ netValueCents: plan.netValueCents }).where(eq(installments.id, id))

  return { installment: plan, payments: created }
}

/**
 * The complete creation flow of an installment plan: validates the card, creates
 * the N charges and — with a card — confirms all of them.
 *
 * It lives here, and not in the handler, because it has TWO entry doors:
 *
 *   POST /v3/installments  → returns the installment plan object
 *   POST /v3/payments      → returns the FIRST INSTALLMENT (with `installment` filled in)
 *
 * Proven against the real sandbox: both create the same installment plan; only
 * what comes out in the response changes. Duplicating the flow would make the
 * two doors diverge on the first fix someone forgot to apply to both.
 */
export async function createInstallmentFlow(
  ctx: AppContext,
  auth: AuthContext,
  body: Record<string, any>,
  input: CreateInstallmentInput,
): Promise<{ installment: InstallmentRow; payments: PaymentRow[] }> {
  // Resolves and VALIDATES the card before writing anything: a refused card
  // must not leave an orphan installment plan behind.
  const card = hasCreditCard(body)
    ? await resolveCard(ctx, ctx.db, auth.accountId, body, input.customerId)
    : null
  if (card) {
    if (input.billingType !== 'CREDIT_CARD') {
      throw invalid(
        'billingType',
        'Para pagar com cartão de crédito, billingType deve ser CREDIT_CARD.',
      )
    }
    requireRemoteIp(body)
    assertInstallmentsAllowed(card.info.brand, input.installmentCount)
    if (declinesOnCharge(card.info.outcome)) throw DECLINED
  }

  return ctx.db.transaction(async (t) => {
    const tx = t as unknown as DB
    const result = await createInstallment(ctx, tx, auth.accountId, auth.walletId, input)

    if (card) {
      const saved = await persistCard(ctx, tx, auth.accountId, input.customerId, card)
      const on = ctx.clock.today()

      for (const p of result.payments) {
        await tx.update(payments).set({ creditCardId: saved.id }).where(eq(payments.id, p.id))
        // The status ALWAYS moves through here — never UPDATE payments SET status.
        await applyTransition(ctx, p.id, { kind: 'CONFIRM', on }, tx)
      }

      // The rows in memory are older than the CONFIRM; reading them again is what
      // makes POST /v3/payments return the installment already CONFIRMED, and not
      // PENDING.
      const fresh = await tx
        .select()
        .from(payments)
        .where(eq(payments.installmentId, result.installment.id))
        .orderBy(asc(payments.dueDate), asc(payments.createdAtMs))
      return { installment: result.installment, payments: fresh as PaymentRow[] }
    }

    return result
  })
}
