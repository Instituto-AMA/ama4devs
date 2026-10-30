/**
 * The scheduler. It is where time actually happens.
 *
 * THE ORDER OF THE JOBS IS PART OF THE SEMANTICS — it is not incidental. A
 * subscription charge generated today has to be able to fall due today; a split
 * can only be released after the charge settled; and the webhook dispatcher runs
 * LAST, so that the events of everything that happened in the tick go out
 * together and in the right order.
 *
 * IDEMPOTENCY in three layers, because the cost is low and the damage is high:
 *   1. In-process mutex — one Bun process + SQLite is serial by construction; the
 *      timer tick and the admin tick never cross.
 *   2. `job_runs(jobName, tickKey)` UNIQUE — the daily jobs run once per
 *      SIMULATED day, even if you tick ten times on the same day.
 *   3. Compare-and-swap on every mutation (UPDATE … WHERE status = <expected>) —
 *      this is the one that really saves: a duplicated run changes zero rows.
 */
import { sql } from 'drizzle-orm'
import { DAY_MS } from '../core/clock.ts'
import type { AppContext } from '../core/context.ts'
import { dispatchNotifications } from '../notify/dispatcher.ts'
import { dispatchDue } from '../webhooks/dispatcher.ts'

export interface TickReport {
  /** The simulated day of this tick: '2026-02-14'. */
  tickKey: string
  now: string
  transitions: {
    resource: string
    id: string
    from: string
    to: string
    job: string
  }[]
  created: { resource: string; id: string; job: string }[]
  webhooks: {
    delivered: { deliveryId: string; event: string; statusCode: number }[]
    failed: { deliveryId: string; event: string; error: string; attempt: number }[]
  }
  ledgerEntries: number
}

export interface JobContext {
  ctx: AppContext
  report: TickReport
  /** Daily job: skip it if it already ran on this simulated day. */
  once(jobName: string): Promise<boolean>
  /**
   * The webhook dispatcher is frozen (POST /_admin/webhooks/pause). Without
   * this, traveling 40 days to test a subscription would use up, for free, the
   * 15 backoff attempts of any pending delivery.
   */
  paused: boolean
}

export interface Job {
  name: string
  run(jc: JobContext): Promise<void>
}

function emptyReport(tickKey: string, now: string): TickReport {
  return {
    tickKey,
    now,
    transitions: [],
    created: [],
    webhooks: { delivered: [], failed: [] },
    ledgerEntries: 0,
  }
}

export class Scheduler {
  #ctx: AppContext
  #jobs: Job[]
  #running: Promise<unknown> | null = null
  #timer: ReturnType<typeof setInterval> | null = null
  /** The one extra dispatch pass waiting for the mutex, if any. */
  #queuedDispatch: Promise<void> | null = null
  /** Every dispatch pass not yet finished (running or queued), for `idle()`. */
  #dispatches = new Set<Promise<void>>()
  /** Freezes the webhook dispatcher — see POST /_admin/webhooks/pause. */
  paused = false

  constructor(ctx: AppContext, jobs: Job[]) {
    this.#ctx = ctx
    this.#jobs = jobs
  }

  get jobNames(): string[] {
    return this.#jobs.map((j) => j.name)
  }

  /** A tick = a simulated instant. Serialized by the mutex. */
  async tick(): Promise<TickReport> {
    // Mutex: if a tick is already running, wait for it. Without this, the timer
    // could come in the middle of an advance() and duplicate transitions.
    while (this.#running) await this.#running.catch(() => {})

    const run = this.#runTick()
    this.#running = run
    try {
      return await run
    } finally {
      this.#running = null
    }
  }

  /**
   * Sends the deliveries already due, outside the tick. A change commits its deliveries in the same
   * transaction as the change, so the HTTP layer calls this after the handler: the queue is the signal.
   * Shares the tick's mutex, so it never interleaves with a tick or an advance; calls that arrive while
   * one runs coalesce into one more pass.
   */
  dispatchNow(): Promise<void> {
    if (this.#queuedDispatch) return this.#queuedDispatch

    const pass = (async () => {
      // Lets the assignment below happen before the pass can start, so same-tick calls coalesce.
      await null
      while (this.#running) await this.#running.catch(() => {})
      this.#queuedDispatch = null // from here on, a new call queues the next pass

      const run = this.#runDispatch()
      this.#running = run
      try {
        await run
      } finally {
        this.#running = null
      }
    })()

    this.#queuedDispatch = pass
    this.#dispatches.add(pass)
    const forget = () => void this.#dispatches.delete(pass)
    pass.then(forget, forget)
    return pass
  }

  /** Resolves when no dispatch pass is running or queued. For tests. */
  async idle(): Promise<void> {
    while (this.#dispatches.size > 0) await Promise.allSettled([...this.#dispatches])
  }

  async #runDispatch(): Promise<void> {
    const ctx = this.#ctx
    await dispatchDue(ctx, emptyReport(ctx.clock.today(), ctx.clock.timestamp()), this.paused)
    await dispatchNotifications(ctx)
  }

  async #runTick(): Promise<TickReport> {
    const ctx = this.#ctx
    const tickKey = ctx.clock.today()
    const report = emptyReport(tickKey, ctx.clock.timestamp())

    // INSERT OR IGNORE + RETURNING: if the job already ran on this simulated
    // day, the insert is ignored, nothing comes back, and the job skips itself.
    const once = async (jobName: string): Promise<boolean> => {
      const rows = await ctx.db.all<{ n: number }>(sql`
        INSERT OR IGNORE INTO job_runs (job_name, tick_key, ran_at)
        VALUES (${jobName}, ${tickKey}, ${ctx.clock.timestamp()})
        RETURNING 1 AS n
      `)
      return rows.length > 0
    }

    for (const job of this.#jobs) {
      try {
        await job.run({ ctx, report, once, paused: this.paused })
      } catch (err) {
        ctx.log('error', `Job "${job.name}" falhou`, { error: String(err) })
      }
    }

    return report
  }

  /**
   * Advances the virtual clock giving ONE FULL TICK PER SIMULATED DAY.
   *
   * This is essential and not a detail: a single tick at T+40 would generate ONE
   * subscription charge instead of several, and would stamp OVERDUE with the
   * wrong date. The time has to be walked through, not skipped.
   */
  async advanceDays(days: number): Promise<TickReport[]> {
    const clock = this.#ctx.clock
    if (!('advance' in clock)) {
      throw new Error('advanceDays requires a virtual clock (CLOCK_MODE=VIRTUAL_*)')
    }
    const reports: TickReport[] = []
    for (let i = 0; i < days; i++) {
      ;(clock as { advance(ms: number): void }).advance(DAY_MS)
      reports.push(await this.tick())
    }
    return reports
  }

  async advanceMs(ms: number): Promise<TickReport> {
    const clock = this.#ctx.clock
    if (!('advance' in clock)) {
      throw new Error('advanceMs requires a virtual clock (CLOCK_MODE=VIRTUAL_*)')
    }
    ;(clock as { advance(ms: number): void }).advance(ms)
    return this.tick()
  }

  start(intervalMs: number): void {
    if (intervalMs <= 0) return // 0 = off (it is the mode of the tests)
    this.#timer = setInterval(() => {
      void this.tick().catch((err) =>
        this.#ctx.log('error', 'The timer tick failed', { error: String(err) }),
      )
    }, intervalMs)
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }
}
