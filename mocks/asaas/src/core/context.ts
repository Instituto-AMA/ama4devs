/**
 * AppContext — everything impure, in a single object, injected.
 *
 * If a function needs time, randomness, the database or the configuration, it
 * receives the context. None of it is global. It is what makes the whole server
 * instantiable in memory in a test, with a frozen clock and a seeded RNG.
 *
 * `src/domain/` does NOT import this: the domain functions are pure and receive
 * `now: Date` and the values they need as arguments.
 */
import type { DB } from '../db/client.ts'
import type { Clock } from './clock.ts'
import type { Config } from './config.ts'
import type { DomainEvent } from './events.ts'
import type { Rng } from './rng.ts'

export interface AppContext {
  config: Config
  db: DB
  clock: Clock
  rng: Rng
  /**
   * Queues a webhook event. Call it INSIDE the transaction that caused the
   * event — the payload is frozen now, not at delivery time.
   */
  emit(tx: DB, event: DomainEvent): Promise<void>
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown): void

  /**
   * Filled in by the route registry. It is computed from the manifest — the
   * coverage in GET /_admin/coverage is never a number kept by hand.
   */
  coverage?: { implemented: string[]; stubbed: string[]; variants: string[] }
}

/** The account authenticated by the `access_token` header. */
export interface AuthContext {
  accountId: string
  walletId: string
  apiKeyId: string
}
