/**
 * The composition of the application. One place where the impure pieces come
 * together.
 *
 * Both the server (src/index.ts) and the test harness
 * (tests/helpers/harness.ts) go through here — it is what guarantees that the
 * test exercises the SAME server that runs in production, and not a parallel
 * assembly that drifts over time.
 */
import { eq } from 'drizzle-orm'
import type { Elysia } from 'elysia'
import { seedExtraAccounts, seedMasterAccount, type SeedResult } from './admin/seed.ts'
import { createClock, type Clock } from './core/clock.ts'
import { loadConfig, type Config } from './core/config.ts'
import type { AppContext } from './core/context.ts'
import { createEmitter } from './core/events.ts'
import { createRng } from './core/rng.ts'
import { createDb, type DB } from './db/client.ts'
import { migrate } from './db/migrate.ts'
import { clockState } from './db/schema/index.ts'
import { createApp } from './http/app.ts'
import type { HandlerMap, RegisterResult } from './http/register.ts'
import { HANDLERS } from './modules/index.ts'
import { JOBS } from './scheduler/jobs/index.ts'
import { Scheduler, type Job } from './scheduler/scheduler.ts'

export interface App {
  app: Elysia
  ctx: AppContext
  scheduler: Scheduler
  config: Config
  db: DB
  seed: SeedResult
  coverage: RegisterResult
  close(): void
}

/**
 * Partial at two levels — it is exactly what `mergeConfig` knows how to merge.
 * That way `{ webhook: { timeoutMs: 500 } }` compiles and keeps the siblings,
 * instead of requiring whoever changes ONE rate to redeclare the whole table.
 */
export type ConfigOverrides = {
  [K in keyof Config]?: Config[K] extends object
    ? Config[K] extends readonly unknown[]
      ? Config[K]
      : Partial<Config[K]>
    : Config[K]
}

export interface BootstrapOptions {
  config?: ConfigOverrides
  handlers?: HandlerMap
  /**
   * Same reason as the `handlers`: a track that runs in PARALLEL injects its jobs
   * here and exercises the real scheduler, before `scheduler/jobs/index.ts` is
   * stitched together. Once it is integrated, the parameter becomes redundant.
   */
  jobs?: Job[]
}

/**
 * The clock is NOT persisted, and that is a choice — not an oversight.
 *
 * The `clock_state` table exists and is READ here, but nothing ever writes to
 * it: a comment in this function once claimed that "the clock survives the
 * restart", and it was false. The read stays because `CLOCK_START` and a
 * possible seed go through it; the claim does not.
 *
 * Why not persist it: the clock is GLOBAL to the container and moves forward
 * with one click in the panel. Persisting it would turn a distracted `+32` into
 * a permanent state — and the symptom does not look like a clock, it looks like
 * "the Pix is born OVERDUE" in the application integrating on the other side.
 * It happened, and it took an afternoon to diagnose.
 *
 * Without persistence, `docker restart` is the obvious way out; with the "Back
 * to the present" button in the panel (POST /_admin/clock/reset), even that is
 * not needed. The price is that a charge created "in the future" survives a
 * restart that brings the clock back — visible, and far less harmful than the
 * opposite.
 */
async function buildClock(db: DB, config: Config): Promise<Clock> {
  const [saved] = await db.select().from(clockState).where(eq(clockState.id, 1)).limit(1)

  return createClock({
    mode: config.clock.mode,
    start: config.clock.start,
    savedEpochMs: saved?.virtualEpochMs ?? null,
  })
}

/**
 * Merges the overrides one level below the root.
 *
 * A shallow spread here is a trap: `{ webhook: { timeoutMs: 500 } }` would erase
 * `retentionDays` and `maxAttempts` along with it, silently. The symptom does
 * not show up in the config — it shows up three layers deeper, as `NOT NULL
 * constraint failed: webhook_deliveries.expires_at_ms`, because `now +
 * undefined * DAY_MS` is NaN. It happened. That is why the merge is deep for
 * the nested objects.
 */
function mergeConfig(base: Config, overrides: ConfigOverrides = {}): Config {
  const out = { ...base } as Record<string, unknown>

  for (const [key, value] of Object.entries(overrides)) {
    const current = out[key]
    const bothPlainObjects =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)

    out[key] = bothPlainObjects ? { ...(current as object), ...(value as object) } : value
  }

  return out as unknown as Config
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<App> {
  const config: Config = mergeConfig(loadConfig(), opts.config)

  const { db, sqlite } = createDb(config.databasePath)
  migrate(db)

  const clock = await buildClock(db, config)
  const rng = createRng(config.seed)

  const emit = createEmitter({ clock, rng, config })

  const ctx: AppContext = {
    config,
    db,
    clock,
    rng,
    emit,
    log(level, msg, data) {
      if (config.logLevel === 'silent') return
      const line = `[${clock.timestamp()}] ${level.toUpperCase()} ${msg}`
      if (data !== undefined) console.log(line, data)
      else console.log(line)
    },
  }

  const seed = await seedMasterAccount({ db, config, clock, rng })
  await seedExtraAccounts({ db, config, clock, rng })

  const scheduler = new Scheduler(ctx, opts.jobs ?? JOBS)
  const { app, coverage } = createApp({
    ctx,
    handlers: opts.handlers ?? HANDLERS,
    scheduler,
  })

  return {
    app,
    ctx,
    scheduler,
    config,
    db,
    seed,
    coverage,
    close() {
      scheduler.stop()
      sqlite.close()
    },
  }
}
