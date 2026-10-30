/**
 * Job 8 — the retention of the webhook queue.
 *
 * Asaas keeps the queue for a finite time: what was not delivered within the
 * retention window (WEBHOOK_RETENTION_DAYS, default 14 SIMULATED DAYS) is never
 * delivered again. Without this, an `advance({ days: 400 })` would pile up
 * PENDING deliveries forever and the queue would become a graveyard the
 * dispatcher sweeps on every tick.
 *
 *   PENDING  past the retention → EXPIRED  (it is not delivered, no late)
 *   DELIVERED past the retention → gone    (the delivery log is a log, not an archive)
 *   Request log entries past the last REQUEST_LOG_LIMIT of the account → gone
 *
 * INTERRUPTED is NOT purged: it is exactly the state the developer needs to see
 * while investigating why the queue froze — and it is what removeBackoff unlocks.
 *
 * It runs AFTER the dispatcher: a delivery that falls due and expires in the
 * same tick still had its chance.
 */
import { and, eq, lt, sql } from 'drizzle-orm'
import { webhookDeliveries } from '../../db/schema/index.ts'
import { REQUEST_LOG_LIMIT } from '../../http/request-log.ts'
import type { Job } from '../scheduler.ts'

export const retentionPurge: Job = {
  name: 'retention-purge',
  async run({ ctx }) {
    const now = ctx.clock.nowMs()

    // Compare-and-swap on the status: running twice at the same instant changes
    // zero rows the second time.
    await ctx.db
      .update(webhookDeliveries)
      .set({ status: 'EXPIRED', nextAttemptAtMs: null })
      .where(
        and(
          eq(webhookDeliveries.status, 'PENDING'),
          lt(webhookDeliveries.expiresAtMs, now),
        ),
      )

    await ctx.db
      .delete(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, 'DELIVERED'),
          lt(webhookDeliveries.expiresAtMs, now),
        ),
      )

    // Request logs: the newest REQUEST_LOG_LIMIT calls of each account. A
    // count, not a window of simulated days: a jump of the clock must not wipe
    // the calls the developer is looking at.
    await ctx.db.run(sql`
      delete from request_logs where id in (
        select id from (
          select id, row_number() over (partition by account_id order by id desc) as position
          from request_logs
        ) where position > ${REQUEST_LOG_LIMIT}
      )`)
  },
}
