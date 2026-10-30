/**
 * The delivery engine. It is the reason this project exists.
 *
 * It runs as the LAST job of the tick (see src/scheduler/jobs/index.ts): by the
 * time it starts, everything that happened in the tick is already queued, and
 * the events go out together and in the order they happened.
 *
 * The rules here are the REAL Asaas rules, and two of them are counterintuitive
 * enough to burn an integration in production — which is why the simulator
 * reproduces them instead of being "gentle":
 *
 *   1. ONLY HTTP 200 IS SUCCESS. 201, 204, 3xx, 4xx, 5xx: everything is a
 *      FAILURE and enters the backoff. An endpoint that answers with
 *      `res.sendStatus(201)` looks fine in your test and redelivers 15 times
 *      in the real Asaas.
 *
 *   2. SEQUENTIALLY does REAL HEAD-OF-LINE BLOCKING. If the delivery with the
 *      lowest `sequence` fails, NOTHING of that webhook moves until it is
 *      delivered or the 15 attempts run out. It is an Asaas contract — and it
 *      is the scenario where the developer finds out, too late, that a bug in a
 *      route froze the whole queue.
 */
import { and, asc, eq, gt, lte } from 'drizzle-orm'
import type { AppContext } from '../core/context.ts'
import { webhookDeliveries, webhookEvents, webhooks } from '../db/schema/index.ts'
import type { TickReport } from '../scheduler/scheduler.ts'
import { nextAttemptAt } from './backoff.ts'
import { rewriteForContainer } from './rewrite.ts'

/** NON_SEQUENTIALLY delivers in parallel — but not without a limit. */
const CONCURRENCY = 8

interface DueDelivery {
  id: string
  attempt: number
  sequence: number
  nextAttemptAtMs: number | null
  expiresAtMs: number
  event: string
  payload: Record<string, unknown>
}

type WebhookRow = typeof webhooks.$inferSelect

const dueColumns = {
  id: webhookDeliveries.id,
  attempt: webhookDeliveries.attempt,
  sequence: webhookDeliveries.sequence,
  nextAttemptAtMs: webhookDeliveries.nextAttemptAtMs,
  expiresAtMs: webhookDeliveries.expiresAtMs,
  event: webhookEvents.event,
  payload: webhookEvents.payload,
}

/**
 * Pulls back the deliveries that were scheduled in the future. Called when the
 * clock moves BACKWARD (POST /_admin/clock/reset).
 *
 * The BUG THIS STOPS FROM COMING BACK: a delivery fails during a time travel,
 * the backoff reschedules it for an hour from now — but "an hour from now" is
 * three months ahead of real time. Turning the clock back to the present does
 * NOT undo that schedule: the delivery becomes unreachable, and since the
 * default `sendType` of Asaas is SEQUENTIALLY, it freezes the WHOLE queue
 * behind it. No webhook ever arrives again, forever, and the symptom shows up
 * on the other end as "the payment shows RECEIVED but my order is still
 * pending".
 *
 * It returns how many were rescheduled — the panel says that out loud, because
 * a queue that starts moving again on its own is exactly the kind of thing the
 * person needs to know happened.
 */
export async function pullBackFutureDeliveries(ctx: AppContext, nowMs: number): Promise<number> {
  const stuck = await ctx.db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, 'PENDING'),
        gt(webhookDeliveries.nextAttemptAtMs, nowMs),
      ),
    )

  if (stuck.length === 0) return 0

  await ctx.db
    .update(webhookDeliveries)
    .set({ nextAttemptAtMs: nowMs })
    .where(
      and(
        eq(webhookDeliveries.status, 'PENDING'),
        gt(webhookDeliveries.nextAttemptAtMs, nowMs),
      ),
    )

  return stuck.length
}

export interface QueueHealth {
  webhookId: string
  /**
   * The account that OWNS the webhook. Without this the panel lies by
   * omission: each subaccount has its own webhooks (an event of account X only
   * goes to the webhooks of X), and a list without an owner becomes "why do I
   * have 8 webhooks?" — besides making the "Reactivate queue" button call /v3
   * with the wrong key and get a 404.
   */
  accountId: string
  accountName: string
  name: string
  url: string
  sendType: string
  enabled: boolean
  interrupted: boolean
  pending: number
  /** Why the queue is not moving. `null` = it is moving. */
  blocked: null | {
    reason: 'INTERRUPTED' | 'DISABLED' | 'HEAD_FAILING' | 'HEAD_IN_BACKOFF'
    event: string
    attempt: number
    lastStatusCode: number | null
    lastError: string | null
    nextAttemptAtMs: number | null
    /** How many deliveries are stuck BEHIND this one. It only makes sense in SEQUENTIALLY. */
    behind: number
  }
}

/**
 * Why each webhook queue is not moving.
 *
 * It exists because the engine is too faithful to be opaque: in SEQUENTIALLY,
 * ONE failed delivery freezes all the following ones, and nothing — neither in
 * Asaas nor here — shouts about it. The developer sees "the payment shows
 * RECEIVED but my order did not update" and goes looking for the bug in their
 * status route, which is correct.
 *
 * The blocking rule is READ from the same queue head that `dispatchSequentially`
 * consults, and not reimplemented: if the two could disagree, the panel would
 * lie.
 */
export async function queueHealth(ctx: AppContext): Promise<QueueHealth[]> {
  const now = ctx.clock.nowMs()
  const { accounts } = await import('../db/schema/index.ts')

  const configs = await ctx.db.select().from(webhooks)
  const accountRows = await ctx.db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
  const nameOf = new Map(accountRows.map((a) => [a.id, a.name]))

  const out: QueueHealth[] = []

  for (const cfg of configs) {
    const pending = await ctx.db
      .select(dueColumns)
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
      .where(
        and(eq(webhookDeliveries.webhookId, cfg.id), eq(webhookDeliveries.status, 'PENDING')),
      )
      .orderBy(asc(webhookDeliveries.sequence))

    const head = pending[0]
    const base = {
      webhookId: cfg.id,
      accountId: cfg.accountId,
      accountName: nameOf.get(cfg.accountId) ?? cfg.accountId,
      name: cfg.name,
      url: cfg.url,
      sendType: cfg.sendType,
      enabled: cfg.enabled,
      interrupted: cfg.interrupted,
      pending: pending.length,
    }

    // `interrupted` and `enabled` drop the delivery BEFORE the head of the queue
    // matters — it is the filter of `dispatchDue`. That is why they come first
    // here too.
    let blocked: QueueHealth['blocked'] = null

    if (head) {
      const inBackoff = head.nextAttemptAtMs === null || head.nextAttemptAtMs > now
      const why = cfg.interrupted
        ? 'INTERRUPTED'
        : !cfg.enabled
          ? 'DISABLED'
          : cfg.sendType !== 'SEQUENTIALLY'
            ? null // no head-of-line: one bad delivery does not hold the others
            : head.attempt > 0
              ? 'HEAD_FAILING'
              : inBackoff
                ? 'HEAD_IN_BACKOFF'
                : null

      if (why) {
        const [row] = await ctx.db
          .select({
            lastStatusCode: webhookDeliveries.lastStatusCode,
            lastError: webhookDeliveries.lastError,
          })
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, head.id))
          .limit(1)

        blocked = {
          reason: why,
          event: head.event,
          attempt: head.attempt,
          lastStatusCode: row?.lastStatusCode ?? null,
          lastError: row?.lastError ?? null,
          nextAttemptAtMs: head.nextAttemptAtMs,
          behind: pending.length - 1,
        }
      }
    } else if (cfg.interrupted || !cfg.enabled) {
      // No queue is blocked, but no delivery will happen from here on. The warning still matters.
      blocked = {
        reason: cfg.interrupted ? 'INTERRUPTED' : 'DISABLED',
        event: '—',
        attempt: 0,
        lastStatusCode: null,
        lastError: null,
        nextAttemptAtMs: null,
        behind: 0,
      }
    }

    out.push({ ...base, blocked })
  }

  return out
}

/**
 * Delivers everything that is due.
 *
 * `paused` comes from the scheduler (POST /_admin/webhooks/pause). Pausing is
 * needed to travel through time for another reason: an advance of 40 days,
 * with the dispatcher on and an endpoint down, would use up the 15 backoff
 * attempts and mark the webhook as `interrupted` — for free, without anyone
 * asking.
 */
export async function dispatchDue(
  ctx: AppContext,
  report: TickReport,
  paused = false,
): Promise<void> {
  if (paused) return

  const now = ctx.clock.nowMs()

  const configs = await ctx.db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.enabled, true), eq(webhooks.interrupted, false)))

  for (const cfg of configs) {
    if (cfg.sendType === 'SEQUENTIALLY') {
      await dispatchSequentially(ctx, report, cfg, now)
    } else {
      await dispatchConcurrently(ctx, report, cfg, now)
    }
  }
}

/**
 * One delivery at a time, in strict `sequence` order, and it STOPS at the
 * first one that fails. It is the head-of-line blocking of Asaas.
 *
 * The loop drains the queue while it goes well: three events emitted in the
 * same tick, with the endpoint up, all three arrive — in order. The moment the
 * first one fails, the other two stay where they are, even already overdue.
 */
async function dispatchSequentially(
  ctx: AppContext,
  report: TickReport,
  cfg: WebhookRow,
  now: number,
): Promise<void> {
  const seen = new Set<string>()

  for (;;) {
    const [head] = await ctx.db
      .select(dueColumns)
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
      .where(
        and(
          eq(webhookDeliveries.webhookId, cfg.id),
          eq(webhookDeliveries.status, 'PENDING'),
        ),
      )
      .orderBy(asc(webhookDeliveries.sequence))
      .limit(1)

    if (!head) return
    // The head of the queue is still in backoff → the WHOLE queue waits with it.
    if (head.nextAttemptAtMs === null || head.nextAttemptAtMs > now) return
    // Past the retention: the retention-purge (the next job) marks it EXPIRED.
    if (head.expiresAtMs <= now) return
    // Safety belt: if a CAS does not take, we do not spin forever.
    if (seen.has(head.id)) return
    seen.add(head.id)

    const delivered = await attemptDelivery(ctx, report, cfg, head as DueDelivery, now)
    if (!delivered) return // Head-of-line blocking: the queue stops here.
  }
}

/** All the due ones, in parallel, with limited concurrency. */
async function dispatchConcurrently(
  ctx: AppContext,
  report: TickReport,
  cfg: WebhookRow,
  now: number,
): Promise<void> {
  const due = (await ctx.db
    .select(dueColumns)
    .from(webhookDeliveries)
    .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
    .where(
      and(
        eq(webhookDeliveries.webhookId, cfg.id),
        eq(webhookDeliveries.status, 'PENDING'),
        lte(webhookDeliveries.nextAttemptAtMs, now),
        gt(webhookDeliveries.expiresAtMs, now),
      ),
    )
    .orderBy(asc(webhookDeliveries.sequence))) as DueDelivery[]

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < due.length) {
      const delivery = due[cursor++]!
      await attemptDelivery(ctx, report, cfg, delivery, now)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, due.length) }, () => worker()),
  )
}

/**
 * One attempt. It returns `true` only if the endpoint answered HTTP 200.
 *
 * The body sent is `webhook_events.payload` — FROZEN at the emit. The resource
 * is not re-serialized: a retry three hours later resends the fact as it was,
 * not a query of the current state.
 */
async function attemptDelivery(
  ctx: AppContext,
  report: TickReport,
  cfg: WebhookRow,
  delivery: DueDelivery,
  now: number,
): Promise<boolean> {
  const { config, clock, db } = ctx
  const url = rewriteForContainer(cfg.url, config.webhook.localhostRewrite, ctx.log)

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // Asaas only sends the header if the webhook has a token configured.
  if (cfg.authToken) headers['asaas-access-token'] = cfg.authToken

  let statusCode: number | null = null
  let error: string | null = null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(delivery.payload),
      signal: AbortSignal.timeout(config.webhook.timeoutMs),
    })
    statusCode = res.status
    await res.text().catch(() => undefined) // drena o corpo, libera o socket

    // HERE. Only 200. 201 and 204 are failures — it is the real rule, and the one that burns.
    if (statusCode !== 200) {
      error = `HTTP ${statusCode}: Asaas only considers it delivered with HTTP 200.`
    }
  } catch (err) {
    const e = err as { name?: string; message?: string }
    error =
      e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? `Timeout after ${config.webhook.timeoutMs}ms.`
        : `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`
  }

  const attempt = delivery.attempt + 1
  const timestamp = clock.timestamp()

  // Compare-and-swap: the update only takes if the delivery is still PENDING and
  // on the same attempt number. A duplicated run of the job changes zero rows.
  const cas = and(
    eq(webhookDeliveries.id, delivery.id),
    eq(webhookDeliveries.status, 'PENDING'),
    eq(webhookDeliveries.attempt, delivery.attempt),
  )

  if (error === null) {
    await db
      .update(webhookDeliveries)
      .set({
        status: 'DELIVERED',
        attempt,
        nextAttemptAtMs: null,
        lastStatusCode: statusCode,
        lastError: null,
        lastAttemptAt: timestamp,
      })
      .where(cas)

    report.webhooks.delivered.push({
      deliveryId: delivery.id,
      event: delivery.event,
      statusCode: statusCode as number,
    })
    return true
  }

  const next = nextAttemptAt(attempt, now, config.webhook.maxAttempts)
  const exhausted = next === null

  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? 'INTERRUPTED' : 'PENDING',
      attempt,
      nextAttemptAtMs: next,
      lastStatusCode: statusCode,
      lastError: error,
      lastAttemptAt: timestamp,
    })
    .where(cas)

  if (exhausted) {
    // Exhausted: the WHOLE queue of this webhook freezes until a removeBackoff.
    await db
      .update(webhooks)
      .set({ interrupted: true })
      .where(and(eq(webhooks.id, cfg.id), eq(webhooks.interrupted, false)))

    ctx.log(
      'warn',
      `Webhook "${cfg.name}" interrupted after ${attempt} attempts without HTTP 200. ` +
        `The queue is frozen — call POST /v3/webhooks/${cfg.id}/removeBackoff.`,
      { webhookId: cfg.id, url: cfg.url, lastError: error },
    )
  }

  report.webhooks.failed.push({
    deliveryId: delivery.id,
    event: delivery.event,
    error,
    attempt,
  })
  return false
}
