/**
 * Installment plans — the 9 operations. (Track E)
 *
 * What this module does NOT do, and it is deliberate:
 *
 *   - it does not change the charge status by hand. Removing, cancelling and
 *     refunding an installment plan is applying the matching trigger to EACH
 *     installment, through `applyTransition()`. It is what guarantees that the
 *     webhook and the ledger entry are the same as the ones of a one-off charge
 *     — without anyone having to remember it.
 *   - it does not recalculate the fee or the netValue on its own: what creates
 *     the installment is the `createPayment()` of payments/service.ts, the same
 *     one of a one-off charge.
 */
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { badRequest, invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { installments, paymentRefunds, payments, paymentSplits } from '../../db/schema/index.ts'
import * as ids from '../../domain/ids.ts'
import { brlToCents, cents, centsToBrl, sumCents } from '../../domain/money.ts'
import { computeSplits, validateSplits } from '../../domain/split.ts'
import type { HandlerMap } from '../../http/register.ts'
import { bookletOrder, paymentBookResponse } from '../booklet.ts'
import { applyTransition } from '../payments/apply.ts'
import { serializePayment, type PaymentRow } from '../payments/serializer.ts'
import { serializeInstallment } from './serializer.ts'
import {
  createInstallmentFlow,
  parseCreateInstallmentBody,
  parseInstallmentSplits,
  splitsForInstallment,
  type InstallmentRow,
} from './service.ts'

/** Isolation per account: an installment plan of another account DOES NOT EXIST (404, not 403). */
async function findOwned(
  ctx: AppContext,
  auth: AuthContext,
  id: string,
): Promise<InstallmentRow> {
  const [row] = await ctx.db
    .select()
    .from(installments)
    .where(and(eq(installments.id, id), eq(installments.accountId, auth.accountId)))
    .limit(1)
  if (!row) throw notFound('Parcelamento')
  return row
}

/** The installments, in the order the customer receives them: 1, 2, 3… */
async function paymentsOf(ctx: AppContext, installmentId: string): Promise<PaymentRow[]> {
  const rows = await ctx.db
    .select()
    .from(payments)
    .where(eq(payments.installmentId, installmentId))
    .orderBy(asc(payments.dueDate), asc(payments.createdAtMs))
  return rows as PaymentRow[]
}

/** Awaiting payment: they are the only ones that can be removed or cancelled. */
const OPEN = ['PENDING', 'OVERDUE']
/** Already paid: they are the only ones that can be refunded. */
const PAID = ['CONFIRMED', 'RECEIVED']

export const installmentHandlers: HandlerMap = {
  /**
   * Serves `create-installment-with-credit-card` too — the two share
   * POST /v3/installments in the Asaas spec, and it is the body that decides.
   *
   * The N charges are born HERE, all at once. It is the difference that defines
   * the resource: the subscription creates nothing at the creation.
   *
   * With a card, the N installments are born CONFIRMED: the issuer authorizes the
   * total at once and the customer is the one who pays in N times. Ignoring the
   * card and leaving the installments PENDING would be a silent failure — the
   * charge would never happen and nobody would see any error.
   *
   * TODO(rule): the credit schedule of an installment plan on the card is not
   * documented. Here each installment credits by the normal card rule (D+32
   * from the confirmation). The parity suite is what decides this — see
   * progress.md.
   */
  'create-installment': async ({ ctx, auth, body }) => {
    const b = body as Record<string, any>
    const { installment } = await createInstallmentFlow(ctx, auth, b, parseCreateInstallmentBody(b))
    return serializeInstallment(ctx.db, installment)
  },

  'list-installments': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)

    const where = and(
      eq(installments.accountId, auth.accountId),
      eq(installments.deleted, false),
    )

    const [total] = await ctx.db.select({ n: count() }).from(installments).where(where)
    const rows = await ctx.db
      .select()
      .from(installments)
      .where(where)
      .orderBy(desc(installments.dateCreated))
      .limit(limit)
      .offset(offset)

    const data = await Promise.all(rows.map((r) => serializeInstallment(ctx.db, r)))
    return listEnvelope(data, total?.n ?? 0, limit, offset)
  },

  'retrieve-a-single-installment': async ({ ctx, auth, params }) =>
    serializeInstallment(ctx.db, await findOwned(ctx, auth, params.id!)),

  /**
   * Removes the installment plan. The installments still OPEN are removed with
   * it; the ones already paid stay (money that came in is not deleted).
   */
  'remove-installment': async ({ ctx, auth, params }) => {
    const inst = await findOwned(ctx, auth, params.id!)

    for (const p of await paymentsOf(ctx, inst.id)) {
      if (!OPEN.includes(p.status) || p.deleted) continue
      await applyTransition(ctx, p.id, { kind: 'DELETE' })
    }

    await ctx.db
      .update(installments)
      .set({ deleted: true })
      .where(and(eq(installments.id, inst.id), eq(installments.deleted, false)))

    return { deleted: true, id: inst.id }
  },

  /**
   * Cancels the CHARGES of the installment plan, but keeps the plan itself. It
   * is different from `remove-installment`, and the difference is subtle: here
   * the record of the plan stays queryable (with the paid installments intact).
   */
  'cancel-charges-of-an-installment': async ({ ctx, auth, params }) => {
    const inst = await findOwned(ctx, auth, params.id!)

    const deletedPayments: Record<string, unknown>[] = []
    for (const p of await paymentsOf(ctx, inst.id)) {
      if (!OPEN.includes(p.status) || p.deleted) continue
      await applyTransition(ctx, p.id, { kind: 'DELETE' })
      deletedPayments.push({
        id: p.id,
        installmentNumber: p.installmentNumber,
        deleted: true,
      })
    }

    return { deleted: true, id: inst.id, deletedPayments }
  },

  'list-payments-of-a-installment': async ({ ctx, auth, params, query }) => {
    const inst = await findOwned(ctx, auth, params.id!)
    const { limit, offset } = paginationParams(query)

    const filters = [eq(payments.installmentId, inst.id), eq(payments.deleted, false)]
    if (query.status) filters.push(eq(payments.status, String(query.status)))
    const where = and(...filters)

    const [total] = await ctx.db.select({ n: count() }).from(payments).where(where)
    const rows = await ctx.db
      .select()
      .from(payments)
      .where(where)
      .orderBy(asc(payments.dueDate), asc(payments.createdAtMs))
      .limit(limit)
      .offset(offset)

    const data = await Promise.all(rows.map((r) => serializePayment(ctx.db, r as PaymentRow)))
    return listEnvelope(data, total?.n ?? 0, limit, offset)
  },

  /** The booklet. It returns a real PDF — see src/modules/booklet.ts. */
  'generate-installment-booklet': async ({ ctx, auth, params, query }) => {
    const inst = await findOwned(ctx, auth, params.id!)
    const { field, desc: descending } = bookletOrder(query)

    const rows = (await paymentsOf(ctx, inst.id)).filter((p) => !p.deleted)
    rows.sort((a, b) => {
      const cmp =
        field === 'value'
          ? a.valueCents - b.valueCents
          : a.dueDate.localeCompare(b.dueDate)
      return descending ? -cmp : cmp
    })

    return paymentBookResponse(
      `Carne — parcelamento ${inst.id}`,
      rows.map(
        (p) =>
          `Parcela ${p.installmentNumber}/${inst.installmentCount}  ` +
          `Venc. ${p.dueDate}  R$ ${centsToBrl(cents(p.valueCents)).toFixed(2)}  ` +
          `[${p.status}]  ${p.id}`,
      ),
    )
  },

  /**
   * Rewrites the split of the installment plan. Only the installments NOT YET
   * PAID change — touching the split of an installment already paid would
   * rewrite money that was already shared.
   *
   * Here lives the rule nobody gets right on the first try:
   *   `fixedValue`      → applied TO EACH installment
   *   `totalFixedValue` → divided BETWEEN the installments, remainder in the last one
   */
  'update-installment-splits': async ({ ctx, auth, params, body }) => {
    const inst = await findOwned(ctx, auth, params.id!)
    const specs = parseInstallmentSplits((body as Record<string, any>)?.splits)

    const all = await paymentsOf(ctx, inst.id)
    const open = all.filter((p) => OPEN.includes(p.status) && !p.deleted)

    if (!open.length) {
      throw badRequest(
        'invalid_action',
        'Não há parcelas aguardando pagamento para alterar o split.',
      )
    }

    // The validation is the same as the creation — including the one of not
    // splitting to itself.
    const errors = validateSplits(
      specs.map((s) => ({
        walletId: s.walletId,
        fixedValueCents: s.fixedValueCents ?? s.totalFixedValueCents,
        percentualValueE4: s.percentualValueE4,
      })),
      auth.walletId,
    )
    if (errors.length) throw invalid('split', errors[0]!.description)

    const out: Record<string, unknown>[] = []

    await ctx.db.transaction(async (tx) => {
      const openIds = open.map((p) => p.id)
      await tx.delete(paymentSplits).where(inArray(paymentSplits.paymentId, openIds))

      const timestamp = ctx.clock.timestamp()

      for (const p of open) {
        const number = Number(p.installmentNumber ?? 0)
        const forThis = splitsForInstallment(specs, number - 1, inst.installmentCount)
        if (!forThis.length) continue

        const computed = computeSplits(cents(p.netValueCents), forThis)

        for (const c of computed.splits) {
          const { accounts } = await import('../../db/schema/index.ts')
          const [dest] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.walletId, c.spec.walletId))
            .limit(1)

          const id = ids.splitId(ctx.rng)

          await tx.insert(paymentSplits).values({
            id,
            paymentId: p.id,
            walletId: c.spec.walletId,
            recipientAccountId: dest?.id ?? null,
            fixedValueCents: c.spec.fixedValueCents ?? null,
            percentualValueE4: c.spec.percentualValueE4 ?? null,
            totalFixedValueCents: null,
            totalValueCents: c.totalValueCents,
            status: computed.divergent ? 'BLOCKED_BY_VALUE_DIVERGENCE' : 'PENDING',
            cancellationReason: null,
            refusalReason: null,
            blockedUntil: null,
            creditDate: null,
            externalReference: c.spec.externalReference ?? null,
            description: c.spec.description ?? null,
            dateCreated: timestamp,
          })

          out.push({
            id,
            walletId: c.spec.walletId,
            fixedValue:
              c.spec.fixedValueCents === null || c.spec.fixedValueCents === undefined
                ? null
                : centsToBrl(cents(c.spec.fixedValueCents)),
            percentualValue:
              c.spec.percentualValueE4 === null || c.spec.percentualValueE4 === undefined
                ? null
                : c.spec.percentualValueE4 / 10_000,
            totalValue: centsToBrl(c.totalValueCents),
            cancellationReason: null,
            status: computed.divergent ? 'BLOCKED_BY_VALUE_DIVERGENCE' : 'PENDING',
            externalReference: c.spec.externalReference ?? null,
            description: c.spec.description ?? null,
            installmentNumber: number,
          })
        }
      }
    })

    return { splits: out }
  },

  /**
   * Refunds the installment plan: each installment ALREADY PAID is refunded in
   * full, one by one, through the same path of `refund-payment`.
   *
   * TODO(rule): the spec accepts a `value` ("Total amount to be refunded"), but
   * does not define how that total is shared among the installments — by order?
   * pro-rata? only the last one? Inventing a rule here would produce a refund
   * that looks right and has wrong values, which is exactly what this project
   * cannot do. For now only the TOTAL refund is supported, and a diverging
   * `value` is explicitly refused instead of being silently reinterpreted.
   */
  'refund-installment': async ({ ctx, auth, params, body }) => {
    const inst = await findOwned(ctx, auth, params.id!)
    const b = (body ?? {}) as Record<string, any>

    const paid = (await paymentsOf(ctx, inst.id)).filter((p) => PAID.includes(p.status))
    if (!paid.length) {
      throw badRequest(
        'invalid_action',
        'Não é possível estornar um parcelamento sem parcelas pagas.',
      )
    }

    const total = sumCents(paid.map((p) => cents(p.valueCents)))

    if (b.value !== undefined && b.value !== null) {
      const asked = brlToCents(Number(b.value))
      if (asked !== total) {
        throw invalid(
          'value',
          'O estorno parcial de parcelamento ainda não é suportado neste simulador. ' +
            `Informe ${centsToBrl(total)} (o total já pago) ou omita o campo.`,
        )
      }
    }

    const today = ctx.clock.today()

    for (const p of paid) {
      await applyTransition(ctx, p.id, { kind: 'REFUND', on: today, value: cents(p.valueCents) })

      await ctx.db.insert(paymentRefunds).values({
        id: ids.genericId(ctx.rng),
        paymentId: p.id,
        status: 'DONE',
        valueCents: p.valueCents,
        description: b.description ?? null,
        // The fees are NOT returned — Asaas keeps them.
        refundedFeeCents: 0,
        effectiveDate: today,
        transactionReceiptUrl: null,
        dateCreated: ctx.clock.timestamp(),
      })
    }

    return serializeInstallment(ctx.db, await findOwned(ctx, auth, inst.id))
  },
}
