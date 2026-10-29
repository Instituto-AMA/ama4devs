import { loadConfig } from '../src/config.ts'
import { createLifecycle } from '../src/lifecycle.ts'
import { createSettings, createStore } from '../src/store.ts'
import type { Ctx, Settings } from '../src/types.ts'
import { createWebhooks } from '../src/webhooks.ts'

/** A request the fake fetch saw: the URL and the init the webhooks sent. */
export interface FetchCall {
  url: string
  init: RequestInit
}

/** The pieces a test drives besides the ctx itself. */
export interface Harness {
  ctx: Ctx
  fetchCalls: FetchCall[]
  /** The timers the lifecycle asked for and has not run yet. */
  scheduled: { fn: () => void; ms: number }[]
  /** Runs every scheduled timer, earliest delay first, including the ones they schedule. */
  runScheduled(): void
}

/**
 * A ctx over the real modules with a fixed clock, counter ids, a fake fetch
 * that answers 200 and a manual scheduler. The delivery delay is 0 unless the
 * test overrides it, so a message runs its whole lifecycle synchronously.
 * @param overrides Settings to start with.
 */
export function makeHarness(overrides: Partial<Settings> = {}): Harness {
  const config = loadConfig({})
  let tick = 0
  const now = () => new Date(Date.UTC(2026, 0, 1, 12, 0, tick++))
  let counter = 0
  const newId = () => `SM${(++counter).toString(16).padStart(32, '0')}`
  const settings = createSettings({ ...config.settings, deliveryDelayMs: 0, ...overrides })
  const store = createStore({ now, newId, maxMessages: config.maxMessages })
  const fetchCalls: FetchCall[] = []
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} })
    return new Response('ok', { status: 200 })
  }) as unknown as typeof fetch
  const webhooks = createWebhooks({ fetch: fakeFetch, settings, now, newId, localhostRewrite: config.localhostRewrite })
  const scheduled: Harness['scheduled'] = []
  const lifecycle = createLifecycle({ store, settings, webhooks, schedule: (fn, ms) => void scheduled.push({ fn, ms }) })
  return {
    ctx: { config, store, settings, webhooks, lifecycle, now, newId },
    fetchCalls,
    scheduled,
    runScheduled() {
      while (scheduled.length) {
        scheduled.sort((a, b) => a.ms - b.ms)
        scheduled.shift()?.fn()
      }
    },
  }
}
