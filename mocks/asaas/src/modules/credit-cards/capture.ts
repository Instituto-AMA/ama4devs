/**
 * Automatic capture of a saved card on the due date of a recurring charge, with
 * Asaas's retries (src/domain/card-capture.ts has the schedule and its sources).
 *
 * The scheduler calls `captureDue` on every tick. Each attempt claims its slot
 * with a compare-and-swap on `capture_attempts`, so a repeated tick or two
 * overlapping ones try the card once per slot, never twice.
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { creditCards, customers, payments, settings } from '../../db/schema/index.ts'
import {
  CaptureScheduleError,
  formatCaptureSchedule,
  nextCaptureAt,
  normalizeCaptureSchedule,
  parseCaptureSchedule,
  type CaptureSlot,
} from '../../domain/card-capture.ts'
import { applyTransition } from '../payments/apply.ts'
import { serializePayment, type PaymentRow } from '../payments/serializer.ts'
import type { TickReport } from '../../scheduler/scheduler.ts'

const SCHEDULE_KEY = 'credit_card.capture.schedule'

/** The schedule in force: the panel's, else CARD_CAPTURE_SCHEDULE, else Asaas's default. */
export async function captureSchedule(ctx: AppContext): Promise<CaptureSlot[]> {
  const [row] = await ctx.db.select().from(settings).where(eq(settings.key, SCHEDULE_KEY)).limit(1)
  const stored = row?.value as CaptureSlot[] | undefined
  if (stored?.length) return normalizeCaptureSchedule(stored)
  return ctx.config.rules.cardCaptureSchedule.map((s) => ({ ...s }))
}

/** Sets the schedule ("0@08:00,0@14:00,1@08:00"); an empty string goes back to the default. */
export async function setCaptureSchedule(ctx: AppContext, raw: string): Promise<CaptureSlot[]> {
  if (!raw.trim()) {
    await ctx.db.delete(settings).where(eq(settings.key, SCHEDULE_KEY))
    return captureSchedule(ctx)
  }
  let slots: CaptureSlot[]
  try {
    slots = parseCaptureSchedule(raw)
  } catch (err) {
    if (err instanceof CaptureScheduleError) throw badRequest('invalid_schedule', err.message)
    throw err
  }
  const updatedAt = ctx.clock.timestamp()
  await ctx.db
    .insert(settings)
    .values({ key: SCHEDULE_KEY, value: slots, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value: slots, updatedAt } })
  return slots
}

export function describeSchedule(slots: CaptureSlot[]): { schedule: string; attempts: CaptureSlot[] } {
  return { schedule: formatCaptureSchedule(slots), attempts: slots }
}

type CardRow = typeof creditCards.$inferSelect

/** Whether a saved card approves its next charge: its outcome, and approvals left. */
export function cardApproves(card: Pick<CardRow, 'simulatedOutcome' | 'approvalsLeft'>): boolean {
  if (card.simulatedOutcome !== 'APPROVE') return false
  return card.approvalsLeft === null || card.approvalsLeft > 0
}

type Outcome = 'CAPTURED' | 'REFUSED' | 'LOST'

/**
 * One attempt on the card of a charge, as of `at` (the slot's time). Claims the
 * slot first; a charge whose slot another tick already took is LOST and left alone.
 */
async function attempt(ctx: AppContext, payment: PaymentRow, done: number, report: TickReport): Promise<Outcome> {
  return ctx.db.transaction(async (t) => {
    const tx = t as unknown as DB
    const claimed = await tx
      .update(payments)
      .set({ captureAttempts: done + 1 })
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.status, 'PENDING'),
          eq(payments.captureAttempts, done),
        ),
      )
      .returning({ id: payments.id })
    if (!claimed.length) return 'LOST' as const

    const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, payment.creditCardId!)).limit(1)

    if (card && cardApproves(card)) {
      if (card.approvalsLeft !== null) {
        await tx
          .update(creditCards)
          .set({ approvalsLeft: card.approvalsLeft - 1 })
          .where(eq(creditCards.id, card.id))
      }
      const r = await applyTransition(ctx, payment.id, { kind: 'CONFIRM', on: ctx.clock.today() }, tx)
      report.transitions.push({ resource: 'payment', id: payment.id, from: r.from, to: r.to, job: 'card-capture' })
      return 'CAPTURED' as const
    }

    // Refused: the charge stays PENDING; Asaas tells the integration on every attempt.
    const [after] = await tx.select().from(payments).where(eq(payments.id, payment.id)).limit(1)
    await ctx.emit(tx, {
      accountId: payment.accountId,
      event: 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      resourceType: 'payment',
      resourceId: payment.id,
      resource: await serializePayment(tx, after as PaymentRow),
    })
    report.created.push({ resource: 'card-capture-refusal', id: payment.id, job: 'card-capture' })
    return 'REFUSED' as const
  })
}

/**
 * Tries every recurring card charge whose next slot has come, and turns the ones
 * whose schedule ran out OVERDUE (the `overdue` job leaves them to this one).
 */
export async function captureDue(ctx: AppContext, report: TickReport): Promise<void> {
  const now = ctx.clock.timestamp()
  const today = ctx.clock.today()
  const schedule = await captureSchedule(ctx)

  const due = await ctx.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.status, 'PENDING'),
        eq(payments.billingType, 'CREDIT_CARD'),
        isNotNull(payments.creditCardId),
        isNotNull(payments.subscriptionId),
        eq(payments.deleted, false),
        lte(payments.dueDate, today),
      ),
    )

  for (const row of due) {
    const payment = row as PaymentRow
    let done = payment.captureAttempts
    for (;;) {
      const at = nextCaptureAt(payment.dueDate, done, schedule)
      if (at === null) {
        try {
          const r = await applyTransition(ctx, payment.id, { kind: 'OVERDUE', on: today })
          report.transitions.push({ resource: 'payment', id: payment.id, from: r.from, to: r.to, job: 'card-capture' })
        } catch (err) {
          ctx.log('debug', `card-capture: ${payment.id} did not go overdue`, { error: String(err) })
        }
        break
      }
      if (at > now) break
      const outcome = await attempt(ctx, payment, done, report)
      if (outcome !== 'REFUSED') break
      done += 1
    }
  }
}

/** The saved cards of the simulator, for the panel. The card number is never stored. */
export async function listSavedCards(ctx: AppContext): Promise<Record<string, unknown>[]> {
  const rows = await ctx.db
    .select({
      creditCardToken: creditCards.creditCardToken,
      accountId: creditCards.accountId,
      customerId: creditCards.customerId,
      customerName: customers.name,
      last4: creditCards.last4,
      brand: creditCards.brand,
      holderName: creditCards.holderName,
      expiryMonth: creditCards.expiryMonth,
      expiryYear: creditCards.expiryYear,
      outcome: creditCards.simulatedOutcome,
      approvalsLeft: creditCards.approvalsLeft,
    })
    .from(creditCards)
    .leftJoin(customers, eq(customers.id, creditCards.customerId))
  return rows.map((r) => ({ ...r, approvesNext: cardApproves({ simulatedOutcome: r.outcome, approvalsLeft: r.approvalsLeft }) }))
}

/**
 * Changes how a saved card answers from now on: `outcome` for every charge, and
 * `approvalsLeft` to approve that many more and then decline (null clears it).
 */
export async function setSavedCardBehavior(
  ctx: AppContext,
  token: string,
  input: { outcome?: 'APPROVE' | 'DECLINE'; approvalsLeft?: number | null },
): Promise<Record<string, unknown>> {
  const patch: Partial<CardRow> = {}
  if (input.outcome) patch.simulatedOutcome = input.outcome
  if (input.approvalsLeft !== undefined) {
    if (input.approvalsLeft !== null && (!Number.isInteger(input.approvalsLeft) || input.approvalsLeft < 0)) {
      throw badRequest('invalid_approvalsLeft', 'approvalsLeft must be a whole number from 0, or null.')
    }
    patch.approvalsLeft = input.approvalsLeft
  }
  const updated = await ctx.db
    .update(creditCards)
    .set(patch)
    .where(eq(creditCards.creditCardToken, token))
    .returning()
  if (!updated.length) throw notFound('Cartão')
  const card = updated[0]!
  return {
    creditCardToken: card.creditCardToken,
    last4: card.last4,
    brand: card.brand,
    outcome: card.simulatedOutcome,
    approvalsLeft: card.approvalsLeft,
    approvesNext: cardApproves(card),
  }
}
