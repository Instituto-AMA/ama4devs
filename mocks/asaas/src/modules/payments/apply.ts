/**
 * `applyTransition` — the ONLY place where a charge's status changes.
 *
 * Sandbox action, scheduler, capture, receiveInCash, refund: they all go through
 * here. Since the webhook and the ledger entry are EFFECTS of the transition (and
 * not something each handler remembers to do), it is impossible for a path to
 * forget to emit the PAYMENT_RECEIVED or to debit the fee. That whole class of bug
 * does not exist in this design.
 *
 * If you are writing `UPDATE payments SET status = …` in another file, stop: that
 * is exactly what this rule exists to prevent.
 */
import { and, eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import { postEntries, type FinancialTransactionType } from '../../core/ledger.ts'
import type { DB } from '../../db/client.ts'
import { payments, paymentSplits } from '../../db/schema/index.ts'
import {
  plan,
  TransitionError,
  type PaymentState,
  type PaymentStatus,
  type Trigger,
} from '../../domain/payment-machine.ts'
import { cents } from '../../domain/money.ts'
import { serializePayment, type PaymentRow } from './serializer.ts'

/** Converts the database row into the state the pure machine understands. */
function toState(
  row: PaymentRow,
  installmentCount: number,
  installmentTotalCents: number | null,
): PaymentState {
  return {
    id: row.id,
    status: row.status as PaymentStatus,
    billingType: row.billingType as PaymentState['billingType'],
    valueCents: cents(row.valueCents),
    originalValueCents: row.originalValueCents === null ? null : cents(row.originalValueCents),
    netValueCents: cents(row.netValueCents),
    feeCents: cents(row.feeCents),
    dueDate: row.dueDate,
    confirmedDate: row.confirmedDate,
    creditDate: row.creditDate,
    discount: row.discount,
    fine: row.fine,
    interest: row.interest,
    installmentCount,
    installmentTotalCents: installmentTotalCents === null ? null : cents(installmentTotalCents),
    // The column stores TEXT (that is what Asaas returns). Here it becomes a number: it is
    // the day multiplier in D+32×n, and a "2" as a string would concatenate.
    installmentNumber: Number(row.installmentNumber ?? 1) || 1,
    deleted: row.deleted,
  }
}

export interface TransitionResult {
  payment: PaymentRow
  from: PaymentStatus
  to: PaymentStatus
  events: string[]
}

/**
 * Applies a trigger to a charge, in a transaction.
 *
 * `tx` is optional: when the caller is already in a transaction (the scheduler,
 * for instance), it passes its own; otherwise we open one.
 */
export async function applyTransition(
  ctx: AppContext,
  paymentId: string,
  trigger: Trigger,
  tx?: DB,
): Promise<TransitionResult> {
  const run = async (db: DB): Promise<TransitionResult> => {
    const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
    if (!row) throw notFound('Cobrança')

    /**
     * The plan this charge came from. We need TWO things from it:
     *   - installmentCount → chooses the card fee's PERCENTAGE bracket
     *   - totalValueCents  → is the fee's BASE (Asaas charges over the total and
     *                        divides it among the installments; not over the installment)
     */
    let installmentCount = 1
    let installmentTotalCents: number | null = null
    if (row.installmentId) {
      const { installments } = await import('../../db/schema/index.ts')
      const [inst] = await db
        .select({
          count: installments.installmentCount,
          total: installments.totalValueCents,
        })
        .from(installments)
        .where(eq(installments.id, row.installmentId))
        .limit(1)
      installmentCount = inst?.count ?? 1
      installmentTotalCents = inst?.total ?? null
    }

    const state = toState(row as PaymentRow, installmentCount, installmentTotalCents)

    let planned
    try {
      planned = plan(state, trigger, { fees: ctx.config.fees, rules: ctx.config.rules })
    } catch (err) {
      if (err instanceof TransitionError) throw badRequest(err.code, err.description)
      throw err
    }

    const patch: Record<string, unknown> = { status: planned.to }
    for (const [k, v] of Object.entries(planned.patch)) patch[k] = v

    /**
     * The receipt is born when the money comes in — the real Asaas returns a URL
     * of a receipt on every paid charge, and `null` while it is PENDING.
     * We used to always return `null`.
     *
     * It stays here, and not in the handler, because it is a consequence of the
     * TRANSITION: any path that pays the charge (sandbox action, card, scheduler, cash)
     * goes through `applyTransition` — and none of them needs to remember this.
     */
    const PAGO = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']
    if (PAGO.includes(planned.to) && !row.transactionReceiptUrl) {
      patch.transactionReceiptUrl = `${ctx.config.publicBaseUrl}/comprovantes/${paymentId.replace('pay_', '')}`
    }

    /**
     * COMPARE-AND-SWAP: it only updates if the status is still what the machine saw.
     * A duplicated job run alters zero rows and is detected here.
     */
    const updated = await db
      .update(payments)
      .set(patch)
      .where(and(eq(payments.id, paymentId), eq(payments.status, row.status)))
      .returning()

    if (!updated.length) {
      throw badRequest(
        'conflict',
        'A cobrança mudou de status durante a operação. Tente novamente.',
      )
    }

    const after = updated[0] as PaymentRow
    const events: string[] = []

    for (const effect of planned.effects) {
      switch (effect.t) {
        case 'LEDGER': {
          await postEntries(
            db,
            { clock: ctx.clock, rng: ctx.rng },
            effect.entries.map((e) => ({
              accountId: row.accountId,
              type: e.type as FinancialTransactionType,
              valueCents: e.valueCents,
              description: e.description,
              paymentId,
            })),
          )
          break
        }

        case 'WEBHOOK': {
          events.push(effect.event)
          await ctx.emit(db, {
            accountId: row.accountId,
            event: effect.event,
            resourceType: 'payment',
            resourceId: paymentId,
            // Frozen NOW: a retry 3h from now resends this payload,
            // not the resource's future state.
            resource: await serializePayment(db, after),
          })
          break
        }

        case 'SPLIT': {
          const splits = await db
            .select()
            .from(paymentSplits)
            .where(eq(paymentSplits.paymentId, paymentId))

          /**
           * Who moves, and who does NOT move:
           *
           * - AWAITING_CREDIT only comes from PENDING. A split BLOCKED by a value
           *   divergence does NOT become credit just because the charge was
           *   paid — it has a clock of its own of 2 business days, and overwriting it
           *   here would erase the block in silence.
           * - CANCELLED and REFUNDED are terminal: you do not cancel twice.
           */
          const targets = splits.filter((s) =>
            effect.to === 'AWAITING_CREDIT'
              ? s.status === 'PENDING'
              : s.status !== 'CANCELLED' && s.status !== 'REFUNDED',
          )

          for (const s of targets) {
            // CAS, like everywhere else.
            await db
              .update(paymentSplits)
              .set({
                status: effect.to,
                ...(effect.reason ? { cancellationReason: effect.reason } : {}),
                ...(effect.to === 'DONE' ? { creditDate: ctx.clock.today() } : {}),
              })
              .where(and(eq(paymentSplits.id, s.id), eq(paymentSplits.status, s.status)))
          }

          /**
           * REVERSAL: the split that ALREADY CREDITED has to be undone, otherwise
           * the money stays in the destination account and the charge disappears —
           * the recipient would profit from the reversal. It reverts in both
           * statements, in the same transaction.
           */
          if (effect.to === 'REFUNDED') {
            const reversals = targets.filter(
              (s) => s.status === 'DONE' && s.recipientAccountId !== null,
            )
            for (const s of reversals) {
              const total = cents(s.totalValueCents ?? 0)
              if (total <= 0) continue

              await postEntries(db, { clock: ctx.clock, rng: ctx.rng }, [
                {
                  accountId: s.recipientAccountId!,
                  type: 'INTERNAL_TRANSFER_REVERSAL',
                  valueCents: cents(-total),
                  description: `Estorno de split da cobrança ${paymentId}`,
                  paymentId,
                  splitId: s.id,
                },
                {
                  accountId: row.accountId,
                  type: 'INTERNAL_TRANSFER_REVERSAL',
                  valueCents: total,
                  description: `Estorno de split da cobrança ${paymentId}`,
                  paymentId,
                  splitId: s.id,
                },
              ])
            }
          }

          // The cancelled split is an event the integrator needs to see: someone
          // who expected to receive will not anymore.
          if (effect.to === 'CANCELLED' && targets.length) {
            events.push('PAYMENT_SPLIT_CANCELLED')
            await ctx.emit(db, {
              accountId: row.accountId,
              event: 'PAYMENT_SPLIT_CANCELLED',
              resourceType: 'payment',
              resourceId: paymentId,
              resource: await serializePayment(db, after),
            })
          }
          break
        }
      }
    }

    return {
      payment: after,
      from: row.status as PaymentStatus,
      to: planned.to,
      events,
    }
  }

  return tx ? run(tx) : ctx.db.transaction(async (t) => run(t as unknown as DB))
}
