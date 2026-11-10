/**
 * The refund lifecycle at the module level: the row in `payment_refunds`, the
 * request, the settlement and the refusal.
 *
 * The charge's status does NOT move here — it moves through `applyTransition`
 * (the only place that changes a status), and the row moves through a
 * compare-and-swap. Both happen in the SAME transaction: a refund that is
 * announced is a refund that exists.
 */
import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import { paymentRefunds } from '../../db/schema/index.ts'
import * as ids from '../../domain/ids.ts'
import { cents } from '../../domain/money.ts'
import { refundKindFor, type RefundKind } from '../../domain/refund.ts'
import { applyTransition, type TransitionResult } from './apply.ts'
import type { PaymentRow } from './serializer.ts'

export interface RefundRequest {
  payment: PaymentRow
  valueCents: number
  description?: string | null
  /** Defaults to the charge's billing type: the boleto is a registration. */
  kind?: RefundKind
}

export interface RefundOutcome {
  refundId: string
  transition: TransitionResult
}

/**
 * ASKS FOR THE REFUND.
 *
 * The row is born `PENDING` and the charge does NOT move: the money only comes
 * back when the refund is settled. The automatic refund (card and Pix) settles
 * on the next tick; the boleto is a registration and waits for the payer.
 */
export async function requestRefund(ctx: AppContext, req: RefundRequest): Promise<RefundOutcome> {
  const kind = req.kind ?? refundKindFor(req.payment.billingType)
  const id = ids.genericId(ctx.rng)

  const transition = await ctx.db.transaction(async (tx) => {
    /**
     * The row comes FIRST: the webhook that announces the request must carry a
     * payload that already shows the pending refund.
     */
    await tx.insert(paymentRefunds).values({
      id,
      paymentId: req.payment.id,
      status: 'PENDING',
      valueCents: req.valueCents,
      description: req.description ?? null,
      // The fees are NOT refunded — Asaas keeps them.
      refundedFeeCents: 0,
      effectiveDate: null,
      transactionReceiptUrl: null,
      dateCreated: ctx.clock.timestamp(),
    })

    return await applyTransition(
      ctx,
      req.payment.id,
      {
        kind: 'REFUND_REQUEST',
        on: ctx.clock.today(),
        value: cents(req.valueCents),
        refund: kind,
      },
      tx as never,
    )
  })

  return { refundId: id, transition }
}

/**
 * SETTLES THE REFUND: the money went back.
 *
 * The row becomes `DONE` and the charge moves — `REFUNDED` for the whole money,
 * or it stays paid when only a part of it is refunded. The statement entry is
 * posted by the transition, the same one a direct refund used to post.
 */
export async function settleRefund(ctx: AppContext, refundId: string): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const [refund] = await tx
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.id, refundId))
      .limit(1)
    if (!refund) throw notFound('Estorno')

    // COMPARE-AND-SWAP: only a PENDING refund settles.
    const settled = await tx
      .update(paymentRefunds)
      .set({ status: 'DONE', effectiveDate: ctx.clock.today() })
      .where(and(eq(paymentRefunds.id, refundId), eq(paymentRefunds.status, 'PENDING')))
      .returning()
    if (!settled.length) {
      throw badRequest('conflict', 'O estorno já foi resolvido.')
    }

    return await applyTransition(
      ctx,
      refund.paymentId,
      { kind: 'REFUND', on: ctx.clock.today(), value: cents(refund.valueCents) },
      tx as never,
    )
  })
}

/**
 * REFUSES THE REFUND: the provider did not accept it and nothing goes back.
 *
 * The row becomes `CANCELLED`, the charge keeps its status and the statement is
 * untouched.
 */
export async function denyRefund(ctx: AppContext, refundId: string): Promise<TransitionResult> {
  return ctx.db.transaction(async (tx) => {
    const [refund] = await tx
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.id, refundId))
      .limit(1)
    if (!refund) throw notFound('Estorno')

    const cancelled = await tx
      .update(paymentRefunds)
      .set({ status: 'CANCELLED' })
      .where(and(eq(paymentRefunds.id, refundId), eq(paymentRefunds.status, 'PENDING')))
      .returning()
    if (!cancelled.length) {
      throw badRequest('conflict', 'O estorno já foi resolvido.')
    }

    return await applyTransition(
      ctx,
      refund.paymentId,
      { kind: 'REFUND_DENY', on: ctx.clock.today() },
      tx as never,
    )
  })
}

/** The pending refund of a charge — the newest one, when there is more than one. */
export async function pendingRefundOf(
  ctx: AppContext,
  paymentId: string,
): Promise<typeof paymentRefunds.$inferSelect | null> {
  const [row] = await ctx.db
    .select()
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.paymentId, paymentId), eq(paymentRefunds.status, 'PENDING')))
    .orderBy(desc(paymentRefunds.dateCreated))
    .limit(1)
  return row ?? null
}
