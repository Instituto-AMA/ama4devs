/**
 * Chargeback — the dispute the cardholder opens at the issuing bank.
 *
 * PAY ATTENTION TO ONE THING THE SPEC DOES NOT SETTLE: there is no operation to
 * CREATE a chargeback. It makes sense in the real world (the issuer opens it,
 * not the merchant), but it leaves the whole flow — including `list-chargebacks`
 * and the CHARGEBACK trigger of the state machine — without any entry door. A
 * simulator in which the developer cannot provoke a chargeback is a simulator
 * that does not serve to test chargebacks.
 *
 * That is why the door is `POST /_admin/payments/{id}/chargeback` — the same
 * place where time travel happens. It is control of the SIMULATOR, not of the
 * Asaas API: it lives outside /v3, exactly like the clock.
 */
import { and, eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { chargebacks, payments } from '../../db/schema/index.ts'
import { addDays } from '../../domain/calendar.ts'
import * as ids from '../../domain/ids.ts'
import { applyTransition } from '../payments/apply.ts'

export type ChargebackRow = typeof chargebacks.$inferSelect

/**
 * TODO(rule): the docs do not publish the deadline to send the documents of the
 * dispute. 20 calendar days from the opening is the number that shows up in the
 * examples of the spec (disputeStartDate 2024-11-10 → deadline 2024-12-10 are
 * 30; the field is nullable). We leave 20 and record it in progress.md — when
 * someone proves the real value against Asaas, it changes here.
 */
const DISPUTE_DEADLINE_DAYS = 20

/**
 * Opens a chargeback on a PAID charge (CONFIRMED or RECEIVED).
 *
 * The status goes to CHARGEBACK_REQUESTED through `applyTransition` — which also
 * emits the PAYMENT_CHARGEBACK_REQUESTED and DEBITS the value from the balance,
 * if it had already been credited. None of that is remembered by this file:
 * they are effects of the transition.
 */
export async function openChargeback(
  ctx: AppContext,
  paymentId: string,
  reason: string,
): Promise<ChargebackRow> {
  const [payment] = await ctx.db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1)

  if (!payment) throw notFound('Cobrança')

  const [existing] = await ctx.db
    .select()
    .from(chargebacks)
    .where(eq(chargebacks.paymentId, paymentId))
    .limit(1)

  if (existing) {
    throw badRequest('invalid_action', 'Esta cobrança já possui um chargeback.')
  }

  const today = ctx.clock.today()

  return ctx.db.transaction(async (t) => {
    const tx = t as unknown as DB

    await applyTransition(ctx, paymentId, { kind: 'CHARGEBACK' }, tx)

    const row: ChargebackRow = {
      id: ids.genericId(ctx.rng),
      accountId: payment.accountId,
      paymentId,
      installmentId: payment.installmentId,
      customerAccount: payment.customerId,
      status: 'REQUESTED',
      reason,
      disputeStatus: null,
      valueCents: payment.valueCents,
      paymentDate: payment.paymentDate,
      disputeStartDate: today,
      deadlineToSendDisputeDocuments: addDays(today, DISPUTE_DEADLINE_DAYS),
      dateCreated: ctx.clock.timestamp(),
    }

    await tx.insert(chargebacks).values(row)
    return row
  })
}

/** The chargeback of this charge, if there is one. Account scope is mandatory. */
export async function chargebackOfPayment(
  db: DB,
  accountId: string,
  paymentId: string,
): Promise<ChargebackRow | null> {
  const [row] = await db
    .select()
    .from(chargebacks)
    .where(and(eq(chargebacks.paymentId, paymentId), eq(chargebacks.accountId, accountId)))
    .limit(1)
  return row ?? null
}
