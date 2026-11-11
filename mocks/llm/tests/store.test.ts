import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config.ts'
import { createStore, validateRule, validateSettings, type Store } from '../src/store.ts'
import type { LoggedRequest } from '../src/types.ts'

/**
 * A store over the real modules, with a fixed clock and counter ids.
 * @param env The environment it boots with.
 * @param readFile How a boot file is read.
 */
function makeStore(
  env: Record<string, string | undefined> = {},
  readFile?: (path: string) => string,
): { store: Store; config: ReturnType<typeof loadConfig> } {
  const config = loadConfig(env, readFile)
  let counter = 0
  const newId = (): string => (++counter).toString(16).padStart(24, '0')
  const store = createStore(config, { now: () => new Date(Date.UTC(2026, 0, 1)), newId })
  return { store, config }
}

/**
 * One entry of the log.
 * @param index The number of the request.
 */
function entry(index: number): Omit<LoggedRequest, 'id' | 'at'> {
  return {
    gateway: 'vercel',
    model: 'mock-model',
    stream: false,
    messageCount: index,
    toolNames: [],
    lastUser: '',
    status: 200,
    replyKind: 'text',
    calledTools: [],
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
  }
}

describe('the validation', () => {
  test('the settings of a patch are checked', () => {
    expect(validateSettings({ latencyMs: -1 }).length).toBe(1)
    expect(validateSettings({ latencyMs: 1.5 }).length).toBe(1)
    expect(validateSettings({ streamChunkChars: 0 }).length).toBe(1)
    expect(validateSettings({ maxToolRounds: 21 }).length).toBe(1)
    expect(validateSettings({ unknownModels: 'maybe' }).length).toBe(1)
    expect(validateSettings({ toolStrategy: 'other' }).length).toBe(1)
    expect(validateSettings({ reportCost: 'yes' }).length).toBe(1)
    expect(validateSettings({ answerTemplate: 42 }).length).toBe(1)
    expect(validateSettings({ nope: 1 }).length).toBe(1)
    expect(validateSettings({ latencyMs: 10, reportCost: false })).toEqual([])
  })

  test('a rule is checked', () => {
    expect(validateRule({ match: { gateway: 'nope' }, reply: { kind: 'text', text: 'x' } }).length).toBe(1)
    expect(validateRule({ match: { lastUser: '[' }, reply: { kind: 'text', text: 'x' } }).length).toBe(1)
    expect(validateRule({ match: {}, reply: { kind: 'text', text: 5 } }).length).toBe(1)
    expect(validateRule({ match: {}, reply: { kind: 'tool_calls', calls: [] } }).length).toBe(1)
    expect(validateRule({ match: {}, reply: { kind: 'error', status: 200, message: 'x' } }).length).toBe(1)
    expect(validateRule({ match: {}, reply: { kind: 'auto' }, times: 0 }).length).toBe(1)
    expect(validateRule({ match: {}, reply: { kind: 'text', text: 'x' } })).toEqual([])
  })
})

describe('the store', () => {
  test('a patch with an error changes nothing', () => {
    const { store } = makeStore()
    const errors = store.updateSettings({ latencyMs: 100, unknownModels: 'maybe' })

    expect(errors.length).toBe(1)
    expect(store.settings().latencyMs).toBe(0)
  })

  test('a good patch changes the settings', () => {
    const { store } = makeStore()
    const errors = store.updateSettings({ latencyMs: 100, reportCost: false })

    expect(errors).toEqual([])
    expect(store.settings().latencyMs).toBe(100)
    expect(store.settings().reportCost).toBe(false)
  })

  test('a bad rule keeps every rule out', () => {
    const { store } = makeStore()
    const result = store.addRules(
      [
        { match: {}, reply: { kind: 'text', text: 'ok' } },
        { match: {}, reply: { kind: 'text', text: 5 } },
      ],
      'last',
    )

    expect(result.errors.length).toBeGreaterThan(0)
    expect(store.rules().length).toBe(0)
  })

  test('a rule with times is removed when they run out', () => {
    const { store } = makeStore()
    const added = store.addRules(
      { match: {}, reply: { kind: 'text', text: 'ok' }, times: 2 },
      'last',
    )
    const id = added.rules[0]?.id
    expect(store.rules().length).toBe(1)

    store.consume(id)
    expect(store.rules().length).toBe(1)
    store.consume(id)
    expect(store.rules().length).toBe(0)

    // An unknown rule changes nothing.
    store.consume('rule_nope')
    expect(store.rules().length).toBe(0)
  })

  test('the log keeps the newest requests', () => {
    const { store } = makeStore({ LLM_MAX_REQUESTS: '2' })
    store.log(entry(1))
    store.log(entry(2))
    store.log(entry(3))

    expect(store.requestCount()).toBe(2)
    const requests = store.requests(10)
    expect(requests.length).toBe(2)
    expect(requests[0]?.messageCount).toBe(3)
    expect(requests[1]?.messageCount).toBe(2)
  })

  test('the catalog is replaced or kept as it was', () => {
    const { store } = makeStore()
    const before = store.catalog().length

    expect(store.replaceCatalog([42]).length).toBeGreaterThan(0)
    expect(store.catalog().length).toBe(before)

    expect(store.upsertModel(42).length).toBeGreaterThan(0)
    expect(store.catalog().length).toBe(before)
  })
})

describe('the boot files', () => {
  test('the boot file merges over the environment', () => {
    const config = loadConfig(
      { LLM_LATENCY_MS: '10', LLM_CONFIG_FILE: 'boot.json' },
      () =>
        JSON.stringify({
          settings: { latencyMs: 20 },
          rules: [{ match: {}, reply: { kind: 'text', text: 'boot' } }],
        }),
    )

    expect(config.bootErrors).toEqual([])
    expect(config.settings.latencyMs).toBe(20)
    expect(config.rules.length).toBe(1)
  })

  test('a boot file that cannot be read is told and skipped', () => {
    const config = loadConfig(
      {
        LLM_CONFIG_FILE: 'boot.json',
        LLM_CONFIG_JSON: JSON.stringify({ settings: { latencyMs: 5 } }),
      },
      () => '{ not json',
    )

    expect(config.bootErrors.length).toBe(1)
    expect(config.settings.latencyMs).toBe(5)
  })

  test('a boot file with a bad rule is told and skipped', () => {
    const config = loadConfig(
      { LLM_CONFIG_FILE: 'boot.json' },
      () => JSON.stringify({ rules: [{ match: {}, reply: { kind: 'text', text: 5 } }] }),
    )

    expect(config.bootErrors.length).toBe(1)
    expect(config.rules.length).toBe(0)
  })
})
