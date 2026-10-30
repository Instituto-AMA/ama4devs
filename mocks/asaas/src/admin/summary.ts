/**
 * The aggregate the panel home shows: the charge status card.
 *
 * The four groups are the ones of the Asaas panel, not the 15 statuses of the
 * machine. It is a deliberate TRANSLATION: `RECEIVED` and `RECEIVED_IN_CASH`
 * are the same news for whoever looks ("the money came in"), and
 * `AWAITING_RISK_ANALYSIS` is still "waiting for payment" for the merchant,
 * however much the machine tells them apart.
 *
 * The map lives HERE, in one place only. If each screen translated statuses on
 * its own, two screens would end up disagreeing about what a "received" charge
 * is — and the number that does not match is always what erodes the trust in
 * the whole simulator.
 */
import { and, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context.ts'
import { payments } from '../db/schema/index.ts'

export type SummaryGroup = 'RECEIVED' | 'CONFIRMED' | 'AWAITING' | 'OVERDUE'

/** Status → group. The ones that fit none (REFUNDED, CHARGEBACK…) stay out. */
const GROUP_OF: Record<string, SummaryGroup> = {
  RECEIVED: 'RECEIVED',
  RECEIVED_IN_CASH: 'RECEIVED',
  DUNNING_RECEIVED: 'RECEIVED',

  CONFIRMED: 'CONFIRMED',
  AWAITING_CREDIT: 'CONFIRMED',

  PENDING: 'AWAITING',
  AUTHORIZED: 'AWAITING',
  AWAITING_RISK_ANALYSIS: 'AWAITING',

  OVERDUE: 'OVERDUE',
  DUNNING_REQUESTED: 'OVERDUE',
}

export interface GroupSummary {
  group: SummaryGroup
  /** In REAIS — like every outbound boundary of this project. */
  value: number
  netValue: number
  count: number
  customers: number
  /** The segmented bar of the card: how much of each payment method. */
  byBillingType: Array<{ billingType: string; value: number; count: number }>
}

const EMPTY = (group: SummaryGroup): GroupSummary => ({
  group,
  value: 0,
  netValue: 0,
  count: 0,
  customers: 0,
  byBillingType: [],
})

export async function paymentsSummary(
  ctx: AppContext,
  accountId: string,
): Promise<GroupSummary[]> {
  const rows = await ctx.db
    .select({
      status: payments.status,
      billingType: payments.billingType,
      customerId: payments.customerId,
      valueCents: payments.valueCents,
      netValueCents: payments.netValueCents,
    })
    .from(payments)
    // A deleted charge is gone from the API's list (and from "Cobranças"): counting
    // it here made the cards show charges and customers nobody could find.
    .where(and(eq(payments.accountId, accountId), eq(payments.deleted, false)))

  const groups = new Map<SummaryGroup, GroupSummary>()
  const customers = new Map<SummaryGroup, Set<string>>()
  const types = new Map<SummaryGroup, Map<string, { cents: number; count: number }>>()

  for (const r of rows) {
    const g = GROUP_OF[r.status]
    if (!g) continue

    const acc = groups.get(g) ?? EMPTY(g)
    // We add in CENTS and divide at the end: adding reais would accumulate
    // floating point error, and the total of the card would stop matching the list.
    acc.value += r.valueCents
    acc.netValue += r.netValueCents ?? r.valueCents
    acc.count += 1
    groups.set(g, acc)

    const cs = customers.get(g) ?? new Set()
    cs.add(r.customerId)
    customers.set(g, cs)

    const tm = types.get(g) ?? new Map()
    const t = tm.get(r.billingType) ?? { cents: 0, count: 0 }
    t.cents += r.valueCents
    t.count += 1
    tm.set(r.billingType, t)
    types.set(g, tm)
  }

  const order: SummaryGroup[] = ['RECEIVED', 'CONFIRMED', 'AWAITING', 'OVERDUE']

  return order.map((g) => {
    const acc = groups.get(g) ?? EMPTY(g)
    return {
      ...acc,
      value: acc.value / 100,
      netValue: acc.netValue / 100,
      customers: customers.get(g)?.size ?? 0,
      byBillingType: [...(types.get(g) ?? new Map())]
        .map(([billingType, t]) => ({ billingType, value: t.cents / 100, count: t.count }))
        .sort((a, b) => b.value - a.value),
    }
  })
}
