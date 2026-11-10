/**
 * The jobs that move the charges through time. (Track A)
 *
 * Both go through `applyTransition` — they never do a direct UPDATE. That is
 * what guarantees that a charge that falls due through the scheduler emits the
 * same webhook and the same ledger entry as one that falls due through a
 * sandbox action.
 */
import { and, eq, isNull, lt, lte, ne, or } from 'drizzle-orm'
import { paymentRefunds, payments } from '../../db/schema/index.ts'
import { captureDue } from '../../modules/credit-cards/capture.ts'
import { applyTransition } from '../../modules/payments/apply.ts'
import { settleRefund } from '../../modules/payments/refunds.ts'
import type { Job } from '../scheduler.ts'

/**
 * A recurring card charge on and after its due date: the saved card is tried on
 * Asaas's schedule, and the charge goes OVERDUE only when the schedule runs out.
 * Runs on every tick (attempts fall at hours of the day) and before `overdue`.
 */
export const cardCapture: Job = {
  name: 'card-capture',
  async run({ ctx, report }) {
    await captureDue(ctx, report)
  },
}

/**
 * PENDING with dueDate < today → OVERDUE.
 *
 * From here on, interest and fine start to run — but the value of the charge is
 * only recalculated at the moment of payment (it is what Asaas does: the `value`
 * in the database stays the original until someone pays).
 */
export const overdue: Job = {
  name: 'overdue',
  async run({ ctx, report }) {
    const today = ctx.clock.today()

    const due = await ctx.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'PENDING'),
          eq(payments.deleted, false),
          lt(payments.dueDate, today),
          // A recurring card charge is still being tried: card-capture owns it.
          or(
            ne(payments.billingType, 'CREDIT_CARD'),
            isNull(payments.creditCardId),
            isNull(payments.subscriptionId),
          ),
        ),
      )

    for (const { id } of due) {
      try {
        const r = await applyTransition(ctx, id, { kind: 'OVERDUE', on: today })
        report.transitions.push({
          resource: 'payment',
          id,
          from: r.from,
          to: r.to,
          job: 'overdue',
        })
      } catch (err) {
        // The CAS fails if something changed the status in the middle — it is not
        // an error, it is the protection working. We only log it.
        ctx.log('debug', `overdue: ${id} did not transition`, { error: String(err) })
      }
    }
  },
}

/**
 * CONFIRMED whose creditDate arrived → RECEIVED.
 *
 * It is HERE that the money becomes balance: the transition posts PAYMENT_RECEIVED
 * (+gross) and PAYMENT_FEE (−fee) in the ledger, and emits the webhook.
 *
 * The Pix never goes through here — it settles at the moment of payment. What
 * arrives here is the bank slip (D+1 business day) and the card (D+32).
 */
export const creditSettlement: Job = {
  name: 'credit-settlement',
  async run({ ctx, report }) {
    const today = ctx.clock.today()

    const ready = await ctx.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'CONFIRMED'),
          eq(payments.deleted, false),
          lte(payments.estimatedCreditDate, today),
        ),
      )

    for (const { id } of ready) {
      try {
        const r = await applyTransition(ctx, id, { kind: 'SETTLE', on: today })
        report.transitions.push({
          resource: 'payment',
          id,
          from: r.from,
          to: r.to,
          job: 'credit-settlement',
        })
        report.ledgerEntries += 2 // PAYMENT_RECEIVED + PAYMENT_FEE
      } catch (err) {
        ctx.log('debug', `credit-settlement: ${id} did not transition`, { error: String(err) })
      }
    }
  },
}

/**
 * The pending refunds settle here: the row becomes DONE, the charge becomes
 * REFUNDED (the whole money) or stays paid (a partial refund), and the money
 * goes back in the statement.
 *
 * IT IS HERE, ON THE TICK, because a refund is not a step of the charge's
 * life: the provider accepts the request first (`PAYMENT_REFUND_IN_PROGRESS`)
 * and the money comes back later — the same mechanism that moves a charge's
 * credit date.
 *
 * The boleto is NOT in this job: its refund is a REGISTRATION — the payer acts
 * and the provider answers later (`/_mock/payments/:id/refund/complete` or
 * `.../deny`). Only the automatic refunds (card and Pix) settle by themselves.
 *
 * TODO(rule): the real Asaas does not say WHEN an automatic refund settles —
 * the card issuer confirms it, and that is not a date the API publishes. The
 * next tick is the mock's answer, and nobody should read a date into it.
 */
export const refundSettlement: Job = {
  name: 'refund-settlement',
  async run({ ctx, report }) {
    const pending = await ctx.db
      .select({ id: paymentRefunds.id, paymentId: paymentRefunds.paymentId })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.status, 'PENDING'))

    for (const { id, paymentId } of pending) {
      const [payment] = await ctx.db
        .select({ billingType: payments.billingType })
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1)

      // A registration waits for the payer: only the automatic one settles here.
      if (!payment || payment.billingType === 'BOLETO') continue

      try {
        const r = await settleRefund(ctx, id)
        report.transitions.push({
          resource: 'payment',
          id: paymentId,
          from: r.from,
          to: r.to,
          job: 'refund-settlement',
        })
      } catch (err) {
        // The CAS fails if the refund was resolved in the middle — it is not an
        // error, it is the protection working. We only log it.
        ctx.log('debug', `refund-settlement: ${id} did not settle`, { error: String(err) })
      }
    }
  },
}
