/**
 * Subscription — what the creation and the generation job share. (Track E)
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { invalid } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { accounts, payments, subscriptions, subscriptionSplits } from '../../db/schema/index.ts'
import { advanceCycle, type Cycle } from '../../domain/calendar.ts'
import type { BillingType } from '../../domain/fees.ts'
import { brlToCents, cents, percentE4, type Cents, type PercentE4 } from '../../domain/money.ts'
import type { SplitSpec } from '../../domain/split.ts'
import type { TickReport } from '../../scheduler/scheduler.ts'
import { applyTransition } from '../payments/apply.ts'
import { createPayment } from '../payments/service.ts'
import { serializeSubscription } from './serializer.ts'

export type SubscriptionRow = typeof subscriptions.$inferSelect

export interface SubscriptionSplitInput {
  walletId: string
  fixedValueCents: Cents | null
  percentualValueE4: PercentE4 | null
  externalReference: string | null
  description: string | null
}

/**
 * The split of the subscription does NOT have `totalFixedValue` — there is no
 * "total" to share, because the subscription has no known end. Only `fixedValue`
 * (per charge) and `percentualValue`.
 */
export function parseSubscriptionSplits(raw: unknown): SubscriptionSplitInput[] {
  if (!Array.isArray(raw)) return []

  return raw.map((s: any) => {
    const walletId = String(s.walletId ?? '')
    if (!walletId) throw invalid('split', 'O walletId é obrigatório para cada split.')

    return {
      walletId,
      fixedValueCents:
        s.fixedValue !== undefined && s.fixedValue !== null
          ? brlToCents(Number(s.fixedValue))
          : null,
      // 4 decimal places → 1e4 scale. 92.3444% → 923444.
      percentualValueE4:
        s.percentualValue !== undefined && s.percentualValue !== null
          ? percentE4(Math.round(Number(s.percentualValue) * 10_000))
          : null,
      externalReference: s.externalReference ?? null,
      description: s.description ?? null,
    }
  })
}

/**
 * The split TEMPLATE of the subscription, read in the format `createPayment`
 * expects.
 *
 * It is copied to EACH generated charge. Changing the template does not change
 * the charges already created — it is what the "template" design means: the
 * subscription describes the future, the charge freezes the past.
 */
export async function splitTemplateOf(db: DB, subscriptionId: string): Promise<SplitSpec[]> {
  const rows = await db
    .select()
    .from(subscriptionSplits)
    .where(
      and(
        eq(subscriptionSplits.subscriptionId, subscriptionId),
        eq(subscriptionSplits.status, 'ACTIVE'),
      ),
    )

  return rows.map((s) => ({
    walletId: s.walletId,
    fixedValueCents: (s.fixedValueCents ?? null) as Cents | null,
    percentualValueE4: (s.percentualValueE4 ?? null) as PercentE4 | null,
    externalReference: s.externalReference,
    description: s.description,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARGE GENERATION
//
// It lives here, and not in the job, because it has TWO callers — and finding
// that out cost a lot: we believed Asaas only generated the charge when the due
// date entered the 40-day window. Wrong. Proven against the real sandbox:
//
//   POST /v3/subscriptions with nextDueDate = today+60
//     → returns nextDueDate = today+90  (it ALREADY moved one cycle)
//     → and the charge of today+60 ALREADY EXISTS, created on the spot.
//
// That is: the FIRST charge is born at the creation, always, no matter how far
// away the due date is. The lookahead window governs the FOLLOWING ones.
//
// Our simulator created ZERO charges. A subscription that charges nothing is a
// broken subscription — and the test that "proved" it only proved our wrong
// reading of the documentation.
// ─────────────────────────────────────────────────────────────────────────────

/** Did it hit the ceiling of charges? */
function reachedMaxPayments(sub: SubscriptionRow): boolean {
  return sub.maxPayments !== null && sub.paymentsGenerated >= sub.maxPayments
}

/** Has the next due date passed the contracted end? */
function pastEndDate(sub: SubscriptionRow, dueDate: string): boolean {
  return sub.endDate !== null && dueDate > sub.endDate
}

/** ACTIVE → EXPIRED, with CAS. No new charge. */
async function expire(ctx: AppContext, sub: SubscriptionRow): Promise<void> {
  await ctx.db
    .update(subscriptions)
    .set({ status: 'EXPIRED' })
    .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.status, 'ACTIVE')))
}

/**
 * Generates ONE charge and moves the cycle forward. It returns the subscription
 * already updated, or `null` when there is nothing left to do (it expired, or
 * another tick got there first).
 */
export async function generateOne(
  ctx: AppContext,
  sub: SubscriptionRow,
  report?: TickReport,
): Promise<SubscriptionRow | null> {
  const dueDate = sub.nextDueDate

  // Ceiling of charges or end of the contract: it expires BEFORE generating.
  if (reachedMaxPayments(sub) || pastEndDate(sub, dueDate)) {
    await expire(ctx, sub)
    return null
  }

  const nextDueDate = advanceCycle(dueDate, sub.cycle as Cycle)
  const generated = sub.paymentsGenerated + 1

  /**
   * Is this charge the last one? Two possible reasons: it hit `maxPayments`, or
   * the NEXT due date would fall after the `endDate`. In both cases the
   * subscription ends in EXPIRED — and the client finds that out in the same
   * answer.
   */
  const willExpire =
    (sub.maxPayments !== null && generated >= sub.maxPayments) ||
    (sub.endDate !== null && nextDueDate > sub.endDate)

  const walletId = await ownWalletId(ctx, sub.accountId)

  return ctx.db.transaction(async (tx) => {
    // ── COMPARE-AND-SWAP: claims the due date before spending anything.
    const claimed = await tx
      .update(subscriptions)
      .set({
        nextDueDate,
        paymentsGenerated: generated,
        status: willExpire ? 'EXPIRED' : 'ACTIVE',
      })
      .where(
        and(
          eq(subscriptions.id, sub.id),
          eq(subscriptions.status, 'ACTIVE'),
          eq(subscriptions.nextDueDate, dueDate),
        ),
      )
      .returning()

    // Zero rows: someone already generated the charge of this due date. It is
    // not an error — it is the protection working.
    if (!claimed.length) return null

    const payment = await createPayment(ctx, tx as never, sub.accountId, walletId, {
      customerId: sub.customerId,
      billingType: sub.billingType as BillingType,
      valueCents: cents(sub.valueCents),
      dueDate,
      description: sub.description,
      externalReference: sub.externalReference,
      discount: sub.discount,
      fine: sub.fine,
      interest: sub.interest,
      // The split template is COPIED into the charge. From here on the two live
      // separate lives.
      splits: await splitTemplateOf(tx as never, sub.id),
      subscriptionId: sub.id,
      creditCardId: sub.creditCardId,
    })

    report?.created.push({
      resource: 'payment',
      id: payment.id,
      job: 'subscription-generation',
    })

    return claimed[0] as SubscriptionRow
  })
}

/**
 * Removes the subscription. The charges already generated and still OPEN go with
 * it — Asaas does not leave an orphan charge of a removed subscription waiting
 * for payment. The ones already paid stay.
 *
 * Shared by `DELETE /v3/subscriptions/{id}` and the profile reset, so a reset
 * that cancels first sends the same SUBSCRIPTION_DELETED the API does.
 * Returns how many open charges went with it.
 */
export async function removeSubscription(ctx: AppContext, sub: SubscriptionRow): Promise<number> {
  const open = await ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.subscriptionId, sub.id),
        eq(payments.deleted, false),
        inArray(payments.status, ['PENDING', 'OVERDUE']),
      ),
    )

  for (const p of open) {
    await applyTransition(ctx, p.id, { kind: 'DELETE' })
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ deleted: true })
      .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.deleted, false)))

    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, sub.id))
      .limit(1)

    await ctx.emit(tx as never, {
      accountId: sub.accountId,
      event: 'SUBSCRIPTION_DELETED',
      resourceType: 'subscription',
      resourceId: sub.id,
      resource: await serializeSubscription(tx as never, row as SubscriptionRow),
    })
  })
  return open.length
}

/** The wallet of the issuing account — the split cannot point to itself. */
async function ownWalletId(ctx: AppContext, accountId: string): Promise<string> {
  const [row] = await ctx.db
    .select({ walletId: accounts.walletId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
  return row?.walletId ?? ''
}

