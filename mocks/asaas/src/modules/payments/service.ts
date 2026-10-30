/**
 * Charge creation. Shared by: single charge, installment plan and
 * subscription — the three are born from the same function, and that is what
 * guarantees that a subscription installment has exactly the same shape as a
 * single charge.
 */
import { and, eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { invalid, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { customers, payments, paymentSplits } from '../../db/schema/index.ts'
import type {
  CallbackConfig,
  DiscountConfig,
  FineConfig,
  InterestConfig,
} from '../../db/schema/payments.ts'
import { addBusinessDays, isValidIsoDate, type IsoDate } from '../../domain/calendar.ts'
import { calcFee, calcInstallmentFee, netValue, type BillingType } from '../../domain/fees.ts'
import * as ids from '../../domain/ids.ts'
import { brlToCents, cents, percentE4, type Cents } from '../../domain/money.ts'
import { estimatedCreditDateFor } from '../../domain/settlement.ts'
import { computeSplits, validateSplits, type SplitSpec } from '../../domain/split.ts'
import { serializePayment, type PaymentRow } from './serializer.ts'

export interface CreatePaymentInput {
  customerId: string
  billingType: BillingType
  valueCents: Cents
  dueDate: IsoDate
  description?: string | null
  externalReference?: string | null
  discount?: DiscountConfig | null
  fine?: FineConfig | null
  interest?: InterestConfig | null
  callback?: CallbackConfig | null
  splits?: SplitSpec[]
  postalService?: boolean
  daysAfterDueDateToRegistrationCancellation?: number | null

  /** The links, when the charge is born from an installment plan/subscription. */
  installmentId?: string | null
  installmentNumber?: number | null
  /** The total number of installments — it defines the card's fee bracket. */
  installmentCount?: number
  /**
   * The TOTAL of the plan (the sum of the installments), when this charge is an
   * installment.
   *
   * It exists because the fee of an installment card is NOT computed over the
   * installment: Asaas charges `fixed + pct% × total` once and divides it among the
   * N installments. Without the total here, each installment would pay the fixed
   * part again and the percentage over itself — and the netValue would come out
   * wrong. Proven against the real sandbox; see `calcInstallmentFee`.
   */
  installmentTotalCents?: Cents
  subscriptionId?: string | null
  creditCardId?: string | null
}

/** Translates the API body into the service's input. It validates what Asaas validates. */
export function parseCreateBody(b: Record<string, any>): Omit<CreatePaymentInput, 'customerId'> & {
  customerId: string
} {
  /**
   * The ORDER MATTERS, and it is Asaas's order — which validates semantically and
   * STOPS at the first error, instead of returning the whole list.
   *
   * A `POST /v3/payments` with an empty body returns ONE error in the real Asaas:
   *   {"code":"invalid_customer","description":"Customer inválido ou não informado."}
   *
   * While the schema had `required`, Elysia rejected the request before here and
   * spat out 17 TypeBox errors in English ("Expected string") — that no Asaas client
   * would ever see. Overlay 004 removed the `required` precisely so that the
   * validation would come back to this place. See spec/overlays/004-payment-required.json.
   *
   * The `customer` message is PROVEN against the sandbox. The others are ours:
   * Asaas short-circuits before them, so there is no way to capture them without a
   * dedicated script per field. It is recorded in progress.md.
   */
  if (!b.customer) {
    throw invalid('customer', 'Customer inválido ou não informado.')
  }

  const billingType = String(b.billingType ?? 'UNDEFINED') as BillingType

  if (b.billingType === undefined || b.billingType === null) {
    throw invalid('billingType', 'O tipo de cobrança é obrigatório.')
  }

  if (!isValidIsoDate(String(b.dueDate ?? ''))) {
    throw invalid('dueDate', 'A data de vencimento informada é inválida.')
  }

  /**
   * A single charge uses `value`. An installment plan uses installmentCount +
   * (installmentValue OR totalValue). Mixing the two is the classic mistake, and
   * Asaas rejects it.
   */
  const hasInstallment = b.installmentCount !== undefined && Number(b.installmentCount) > 1

  let valueCents: Cents
  if (hasInstallment) {
    if (b.totalValue !== undefined) {
      valueCents = brlToCents(Number(b.totalValue))
    } else if (b.installmentValue !== undefined) {
      valueCents = cents(brlToCents(Number(b.installmentValue)) * Number(b.installmentCount))
    } else {
      throw invalid(
        'installmentValue',
        'Informe installmentValue ou totalValue para uma cobrança parcelada.',
      )
    }
  } else {
    if (b.value === undefined) throw invalid('value', 'O valor da cobrança é obrigatório.')
    valueCents = brlToCents(Number(b.value))
  }

  if (valueCents <= 0) throw invalid('value', 'O valor da cobrança deve ser maior que zero.')

  return {
    customerId: String(b.customer ?? ''),
    billingType,
    valueCents,
    dueDate: String(b.dueDate),
    description: b.description ?? null,
    externalReference: b.externalReference ?? null,
    discount: b.discount ?? null,
    fine: b.fine ?? null,
    interest: b.interest ?? null,
    callback: b.callback ?? null,
    splits: parseSplits(b.split),
    postalService: b.postalService ?? false,
    daysAfterDueDateToRegistrationCancellation:
      b.daysAfterDueDateToRegistrationCancellation ?? null,
    installmentCount: hasInstallment ? Number(b.installmentCount) : 1,
  }
}

export function parseSplits(raw: unknown): SplitSpec[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s: any) => ({
    walletId: String(s.walletId ?? ''),
    fixedValueCents: s.fixedValue !== undefined ? brlToCents(Number(s.fixedValue)) : null,
    // 4 decimal places → 1e4 scale. 92.3444% → 923444
    percentualValueE4:
      s.percentualValue !== undefined
        ? percentE4(Math.round(Number(s.percentualValue) * 10_000))
        : null,
    externalReference: s.externalReference ?? null,
    description: s.description ?? null,
  }))
}

/**
 * Creates ONE charge. It emits PAYMENT_CREATED.
 * It does not decide about installment plans — whoever splits calls this N times.
 */
export async function createPayment(
  ctx: AppContext,
  db: DB,
  accountId: string,
  ownWalletId: string,
  input: CreatePaymentInput,
): Promise<PaymentRow> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.accountId, accountId)))
    .limit(1)

  if (!customer) throw notFound('Cliente')

  const installmentCount = input.installmentCount ?? 1

  // An installment of a plan: the fee comes from the TOTAL, not from the installment's value.
  // (On the card it changes the number; on the bank slip it comes out the same — the fee is per bank slip.)
  const fee =
    input.installmentTotalCents !== undefined && installmentCount > 1
      ? calcInstallmentFee(
          ctx.config.fees,
          input.billingType,
          input.installmentTotalCents,
          installmentCount,
        )
      : calcFee(ctx.config.fees, input.billingType, input.valueCents, installmentCount)

  const net = netValue(input.valueCents, fee)

  const splits = input.splits ?? []
  const splitErrors = validateSplits(splits, ownWalletId)
  if (splitErrors.length) {
    throw invalid('split', splitErrors[0]!.description)
  }

  const id = ids.paymentId(ctx.rng)
  const today = ctx.clock.today()

  const row: PaymentRow = {
    id,
    accountId,
    customerId: input.customerId,
    subscriptionId: input.subscriptionId ?? null,
    installmentId: input.installmentId ?? null,
    installmentNumber:
      input.installmentNumber === null || input.installmentNumber === undefined
        ? null
        : String(input.installmentNumber),
    paymentLinkId: null,
    checkoutSession: null,

    billingType: input.billingType,
    status: 'PENDING',

    valueCents: input.valueCents,
    netValueCents: net,
    originalValueCents: null,
    interestValueCents: null,
    feeCents: fee,

    description: input.description ?? null,
    externalReference: input.externalReference ?? null,

    dueDate: input.dueDate,
    originalDueDate: input.dueDate,
    paymentDate: null,
    clientPaymentDate: null,
    confirmedDate: null,
    creditDate: null,
    // null while PENDING — the real Asaas does not promise a credit date for
    // money that has not come in yet. See `estimatedCreditDateFor`.
    estimatedCreditDate: estimatedCreditDateFor(),

    discount: input.discount ?? null,
    fine: input.fine ?? null,
    interest: input.interest ?? null,
    callback: input.callback ?? null,

    creditCardId: input.creditCardId ?? null,
    captureAttempts: 0,
    pixQrCodeId: null,
    pixTransactionId: null,

    // Both open on this server (src/invoice/routes.ts): the payer's page, where the charge is paid.
    invoiceUrl: `${ctx.config.invoiceBaseUrl}/i/${id.replace('pay_', '')}`,
    bankSlipUrl:
      input.billingType === 'BOLETO' || input.billingType === 'UNDEFINED'
        ? `${ctx.config.invoiceBaseUrl}/b/pdf/${id.replace('pay_', '')}`
        : null,
    transactionReceiptUrl: null,
    invoiceNumber: ids.invoiceNumber(ctx.rng),
    nossoNumero: input.billingType === 'BOLETO' ? ids.nossoNumero(ctx.rng) : null,

    daysAfterDueDateToRegistrationCancellation:
      input.daysAfterDueDateToRegistrationCancellation ?? null,
    postalService: input.postalService ?? false,
    canBePaidAfterDueDate: true,

    anticipated: false,
    anticipable: false,
    deleted: false,

    lastInvoiceViewedDate: null,
    lastBankSlipViewedDate: null,
    dateCreated: today,
    createdAtMs: ctx.clock.nowMs(),
  }

  await db.insert(payments).values(row)

  // The splits are computed over the netValue — not over the gross amount.
  let divergent = false
  if (splits.length) {
    const computed = computeSplits(net, splits)
    const timestamp = ctx.clock.timestamp()
    divergent = computed.divergent

    /**
     * Value divergence: the sum of the splits exceeds the netValue. Asaas does not
     * reject the charge — it BLOCKS the splits and gives 2 business days for the
     * integrator to adjust. Once the deadline passes, the `split-divergence-expiry`
     * job cancels them. `blockedUntil` is that deadline, and without it the job
     * would have no way to know when the clock started running.
     */
    const blockedUntil = divergent
      ? addBusinessDays(today, ctx.config.rules.splitDivergenceGraceBusinessDays)
      : null

    for (const c of computed.splits) {
      // If the destination wallet belongs to an account of this server, the split does
      // move money. If not, it is recorded but credits nobody
      // (it is an external wallet).
      const { accounts } = await import('../../db/schema/index.ts')
      const [dest] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.walletId, c.spec.walletId))
        .limit(1)

      await db.insert(paymentSplits).values({
        id: ids.splitId(ctx.rng),
        paymentId: id,
        walletId: c.spec.walletId,
        recipientAccountId: dest?.id ?? null,
        fixedValueCents: c.spec.fixedValueCents ?? null,
        percentualValueE4: c.spec.percentualValueE4 ?? null,
        totalFixedValueCents: null,
        totalValueCents: c.totalValueCents,
        status: divergent ? 'BLOCKED_BY_VALUE_DIVERGENCE' : 'PENDING',
        cancellationReason: null,
        refusalReason: null,
        blockedUntil,
        creditDate: null,
        externalReference: c.spec.externalReference ?? null,
        description: c.spec.description ?? null,
        dateCreated: timestamp,
      })
    }
  }

  await ctx.emit(db, {
    accountId,
    event: 'PAYMENT_CREATED',
    resourceType: 'payment',
    resourceId: id,
    resource: await serializePayment(db, row),
  })

  // The block by divergence is a fact the integrator NEEDS to see — it is the
  // 2-business-day clock starting to run.
  if (divergent) {
    await ctx.emit(db, {
      accountId,
      event: 'PAYMENT_SPLIT_DIVERGENCE_BLOCK',
      resourceType: 'payment',
      resourceId: id,
      resource: await serializePayment(db, row),
    })
  }

  return row
}
