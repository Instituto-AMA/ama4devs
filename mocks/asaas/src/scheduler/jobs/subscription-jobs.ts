/**
 * Job 1 — the generation of the subscription charges, from the SECOND one on. (Track E)
 *
 * The first charge is NOT born here: it is born in the `POST /v3/subscriptions`,
 * together with the subscription. (We used to believe the opposite — that no
 * charge existed until the due date was 40 days away — and the capture against
 * the real sandbox proved we were wrong. See the header of
 * `modules/subscriptions/handlers.ts`.)
 *
 * What this job does is keep the assembly line moving: when the `nextDueDate`
 * enters the LOOKAHEAD window (40 days, `SUBSCRIPTION_LOOKAHEAD_DAYS`), the next
 * charge is generated and the cycle moves forward again.
 *
 * It runs FIRST on the tick: the charge generated today has to be able to fall
 * due today, and the jobs after it (overdue, credit-settlement) need to see it.
 *
 * The generation itself lives in `modules/subscriptions/service.ts` (`generateOne`)
 * — because it has two callers, and a second implementation here would diverge
 * from the POST one the day one of them was fixed.
 *
 * IDEMPOTENCY — the layer that really saves is the COMPARE-AND-SWAP, inside
 * `generateOne`: the subscription row is CLAIMED (next_due_date advanced) before
 * the charge is born. A repeated tick finds the due date already consumed,
 * changes zero rows and generates nothing. Two charges for the same due date are
 * impossible by construction, not by convention.
 */
import { and, eq, lte } from 'drizzle-orm'
import { subscriptions } from '../../db/schema/index.ts'
import { addDays } from '../../domain/calendar.ts'
import { generateOne, type SubscriptionRow } from '../../modules/subscriptions/service.ts'
import type { Job } from '../scheduler.ts'

export const subscriptionGeneration: Job = {
  name: 'subscription-generation',

  async run({ ctx, report }) {
    const today = ctx.clock.today()

    /**
     * THE WINDOW. A charge is born when `lookaheadDays` (40) or fewer are left
     * until the due date — not a day earlier. On the 41st day, nothing happens.
     */
    const horizon = addDays(today, ctx.config.rules.subscriptionLookaheadDays)

    const due = await ctx.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, 'ACTIVE'),
          eq(subscriptions.deleted, false),
          lte(subscriptions.nextDueDate, horizon),
        ),
      )

    for (const sub of due) {
      /**
       * A short cycle has SEVERAL due dates inside the window — in a weekly
       * subscription, 40 days of lookahead cover ~6 charges, and Asaas creates
       * them all. That is why the loop: we generate while the next due date
       * stays inside the horizon.
       */
      let current: SubscriptionRow | null = sub

      while (current && current.status === 'ACTIVE' && current.nextDueDate <= horizon) {
        try {
          current = await generateOne(ctx, current, report)
        } catch (err) {
          ctx.log('error', `subscription-generation: ${sub.id} falhou`, {
            error: String(err),
          })
          break
        }
      }
    }
  },
}
