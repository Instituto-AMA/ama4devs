import { createApp, type App, type AppDeps } from '../src/app.ts'
import { loadConfig, type Config } from '../src/config.ts'

/** The pieces a test drives besides the app itself. */
export interface Harness {
  app: App
  config: Config
  /** The waits the app asked for, in milliseconds, in the order they came. */
  waits: number[]
  /** The lines the app logged. */
  lines: string[]
}

/**
 * An app over the real modules with a fixed clock, counter ids and a wait
 * that records the milliseconds instead of waiting for them.
 * @param env The environment the app boots with.
 * @param deps What the test replaces.
 */
export function makeApp(
  env: Record<string, string | undefined> = {},
  deps: Partial<AppDeps> = {},
): Harness {
  const config = loadConfig(env)
  let tick = 0
  const now = deps.now ?? (() => new Date(Date.UTC(2026, 0, 1, 12, 0, tick++)))
  let counter = 0
  const newId = deps.newId ?? (() => (++counter).toString(16).padStart(24, '0'))
  const waits: number[] = []
  const wait = deps.wait ?? (async (ms: number) => void waits.push(ms))
  const lines: string[] = []
  const log = deps.log ?? ((line: string) => void lines.push(line))

  const app = createApp(config, { now, newId, wait, log })
  return { app, config, waits, lines }
}
