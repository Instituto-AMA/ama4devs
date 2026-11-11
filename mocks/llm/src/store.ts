import { validateModel } from './catalog.ts'
import type { Config } from './config.ts'
import type {
  CatalogModel,
  EngineState,
  LoggedRequest,
  Reply,
  Rule,
  RuleInput,
  RuleMatch,
  ScriptedCall,
  Settings,
} from './types.ts'

/**
 * The state of the mock: the settings, the rules, the catalog and the log of
 * the requests it answered. Every change the operator makes goes through it.
 */
export interface Store {
  /** The live state the engine reads. */
  engineState(): EngineState
  /** The settings as they are now. */
  settings(): Settings
  /** Applies a patch of settings; [] when it was applied, the errors otherwise. */
  updateSettings(patch: unknown): string[]
  /** The rules as they are now, in the order they are tried. */
  rules(): Rule[]
  /** Adds one rule or a list of rules; all or nothing. */
  addRules(input: unknown, position: 'first' | 'last'): { rules: Rule[]; errors: string[] }
  /** Removes a rule; false when there was no rule with that id. */
  removeRule(id: string): boolean
  /** Removes every rule. */
  clearRules(): void
  /** Counts one use of a rule; the rule is removed when its times run out. */
  consume(ruleId: string | undefined): void
  /** The models of the catalog as they are now. */
  catalog(): CatalogModel[]
  /** Replaces the catalog; all or nothing. */
  replaceCatalog(input: unknown): string[]
  /** Adds a model or replaces the one with the same id; all or nothing. */
  upsertModel(input: unknown): string[]
  /** Removes a model; false when there was no model with that id. */
  removeModel(id: string): boolean
  /** Keeps a request in the log and drops the oldest beyond the limit. */
  log(entry: Omit<LoggedRequest, 'id' | 'at'>): LoggedRequest
  /** The requests of the log, newest first. */
  requests(limit: number): LoggedRequest[]
  /** One request of the log. */
  request(id: string): LoggedRequest | undefined
  /** Empties the log. */
  clearRequests(): void
  /** How many requests the log keeps. */
  requestCount(): number
  /** Goes back to the settings, the rules and the catalog of the boot. */
  reset(): void
}

/** The settings the operator may change, with the rule of each one. */
const SETTING_RULES: Record<string, (value: unknown) => boolean> = {
  latencyMs: (value) => isIntegerBetween(value, 0, 120_000),
  streamChunkDelayMs: (value) => isIntegerBetween(value, 0, 120_000),
  streamChunkChars: (value) => isIntegerBetween(value, 1, Number.MAX_SAFE_INTEGER),
  requireAuth: (value) => typeof value === 'boolean',
  unknownModels: (value) => value === 'accept' || value === 'reject',
  toolStrategy: (value) => value === 'match' || value === 'first' || value === 'none',
  maxToolRounds: (value) => isIntegerBetween(value, 0, 20),
  answerTemplate: (value) => typeof value === 'string',
  reportCost: (value) => typeof value === 'boolean',
}

/** The fields a rule may look at, with the rule of each one. */
const MATCH_RULES: Record<string, (value: unknown) => boolean> = {
  model: (value) => typeof value === 'string',
  gateway: (value) => value === 'vercel' || value === 'openrouter',
  lastUser: (value) => typeof value === 'string' && compiles(value),
  system: (value) => typeof value === 'string' && compiles(value),
  hasTools: (value) => typeof value === 'boolean',
  afterTool: (value) => typeof value === 'boolean',
  toolOffered: (value) => typeof value === 'string',
}

/**
 * The errors of a patch of settings; [] when the patch is good.
 * @param patch The patch the operator sent.
 */
export function validateSettings(patch: unknown): string[] {
  if (!isPlainObject(patch)) return ['settings must be an object']

  const errors: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const rule = SETTING_RULES[key]
    if (!rule) {
      errors.push(`unknown setting: ${key}`)
      continue
    }
    if (!rule(value)) errors.push(`${key} has an invalid value`)
  }
  return errors
}

/**
 * The errors of a rule; [] when the rule is good.
 * @param input The rule as the operator sent it.
 */
export function validateRule(input: unknown): string[] {
  if (!isPlainObject(input)) return ['rule must be an object']

  const errors: string[] = []

  if (input.id !== undefined && typeof input.id !== 'string') errors.push('id must be a string')

  const match = input.match
  if (!isPlainObject(match)) errors.push('match must be an object')
  else {
    for (const [key, value] of Object.entries(match)) {
      const rule = MATCH_RULES[key]
      if (!rule) {
        errors.push(`unknown match field: ${key}`)
        continue
      }
      if (!rule(value)) errors.push(`match.${key} has an invalid value`)
    }
  }

  const reply = input.reply
  if (!isPlainObject(reply)) errors.push('reply must be an object')
  else errors.push(...validateReply(reply))

  if (input.latencyMs !== undefined && !isIntegerBetween(input.latencyMs, 0, 120_000)) {
    errors.push('latencyMs has an invalid value')
  }

  if (input.times !== undefined && !(Number.isInteger(input.times) && (input.times as number) > 0)) {
    errors.push('times has an invalid value')
  }

  const usage = input.usage
  if (usage !== undefined) {
    if (!isPlainObject(usage)) errors.push('usage must be an object')
    else errors.push(...validateUsage(usage))
  }

  return errors
}

/**
 * The errors of the reply of a rule.
 * @param reply The reply as the operator sent it.
 */
function validateReply(reply: Record<string, unknown>): string[] {
  const errors: string[] = []
  const kind = reply.kind

  if (kind === 'text') {
    if (typeof reply.text !== 'string') errors.push('reply.text must be a string')
    return errors
  }

  if (kind === 'tool_calls') {
    if (reply.text !== undefined && typeof reply.text !== 'string') {
      errors.push('reply.text must be a string')
    }
    if (!Array.isArray(reply.calls) || reply.calls.length === 0) {
      errors.push('reply.calls must be a non-empty array')
      return errors
    }
    reply.calls.forEach((call, index) => {
      if (!isPlainObject(call)) {
        errors.push(`reply.calls[${index}] must be an object`)
        return
      }
      if (typeof call.name !== 'string') errors.push(`reply.calls[${index}].name must be a string`)
      if (!isPlainObject(call.arguments)) {
        errors.push(`reply.calls[${index}].arguments must be an object`)
      }
    })
    return errors
  }

  if (kind === 'error') {
    if (!Number.isInteger(reply.status) || (reply.status as number) < 400 || (reply.status as number) > 599) {
      errors.push('reply.status must be an integer between 400 and 599')
    }
    if (typeof reply.message !== 'string') errors.push('reply.message must be a string')
    if (reply.code !== undefined && typeof reply.code !== 'string') {
      errors.push('reply.code must be a string')
    }
    return errors
  }

  if (kind === 'auto') return errors

  errors.push('reply.kind must be text, tool_calls, error or auto')
  return errors
}

/**
 * The errors of the usage a rule pins.
 * @param usage The usage as the operator sent it.
 */
function validateUsage(usage: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (usage.inputTokens !== undefined && !isIntegerBetween(usage.inputTokens, 0, Number.MAX_SAFE_INTEGER)) {
    errors.push('usage.inputTokens has an invalid value')
  }
  if (usage.outputTokens !== undefined && !isIntegerBetween(usage.outputTokens, 0, Number.MAX_SAFE_INTEGER)) {
    errors.push('usage.outputTokens has an invalid value')
  }
  if (usage.costUsd !== undefined && usage.costUsd !== null && typeof usage.costUsd !== 'string') {
    errors.push('usage.costUsd must be a string or null')
  }
  return errors
}

/**
 * The store of the mock: the live state, the boot state it goes back to and
 * the log of the requests it answered.
 * @param config The configuration the store boots with.
 * @param deps The clock and the ids.
 */
export function createStore(config: Config, deps: { now: () => Date; newId: () => string }): Store {
  const now = deps.now
  const newId = deps.newId

  let settings: Settings = { ...config.settings }
  let rules: Rule[] = []
  let catalog: CatalogModel[] = config.catalog.map((model) => ({ ...model }))
  const requests: LoggedRequest[] = []

  const usedIds = new Set<string>()
  rules = config.rules.map((input) => toRule(input, usedIds, newId))

  const bootSettings: Settings = { ...settings }
  const bootRules: Rule[] = rules.map((rule) => cloneRule(rule))
  const bootCatalog: CatalogModel[] = catalog.map((model) => ({ ...model }))

  /**
   * The state the engine reads: a copy, so a change of the store never
   * changes an answer that is already on its way.
   */
  const engineState = (): EngineState => ({
    settings: { ...settings },
    rules: rules.map((rule) => cloneRule(rule)),
    catalog: catalog.map((model) => ({ ...model })),
  })

  return {
    engineState,

    settings: () => ({ ...settings }),

    updateSettings(patch: unknown): string[] {
      const errors = validateSettings(patch)
      if (errors.length) return errors
      settings = { ...settings, ...(patch as Partial<Settings>) }
      return []
    },

    rules: () => rules.map((rule) => cloneRule(rule)),

    addRules(input: unknown, position: 'first' | 'last'): { rules: Rule[]; errors: string[] } {
      const list = Array.isArray(input) ? input : [input]
      if (list.length === 0) return { rules: [], errors: ['no rule was sent'] }

      const errors: string[] = []
      const accepted: RuleInput[] = []
      list.forEach((item, index) => {
        const itemErrors = validateRule(item)
        if (itemErrors.length) {
          errors.push(...itemErrors.map((error) => `rules[${index}]: ${error}`))
          return
        }
        accepted.push(item as RuleInput)
      })

      if (errors.length) return { rules: [], errors }

      const prepared = accepted.map((item) => toRule(item, usedIds, newId))

      if (position === 'first') rules = [...prepared, ...rules]
      else rules = [...rules, ...prepared]

      return { rules: prepared.map((rule) => cloneRule(rule)), errors: [] }
    },

    removeRule(id: string): boolean {
      const before = rules.length
      rules = rules.filter((rule) => rule.id !== id)
      return rules.length !== before
    },

    clearRules(): void {
      rules = []
    },

    consume(ruleId: string | undefined): void {
      if (!ruleId) return
      const rule = rules.find((item) => item.id === ruleId)
      if (!rule || rule.times === undefined) return
      const times = rule.times - 1
      if (times <= 0) {
        rules = rules.filter((item) => item.id !== ruleId)
        return
      }
      rule.times = times
    },

    catalog: () => catalog.map((model) => ({ ...model })),

    replaceCatalog(input: unknown): string[] {
      if (!Array.isArray(input)) return ['catalog must be an array']
      const errors: string[] = []
      input.forEach((model, index) => {
        errors.push(...validateModel(model).map((error) => `catalog[${index}]: ${error}`))
      })
      if (errors.length) return errors
      catalog = input.map((model) => ({ ...(model as CatalogModel) }))
      return []
    },

    upsertModel(input: unknown): string[] {
      const errors = validateModel(input)
      if (errors.length) return errors
      const model = { ...(input as CatalogModel) }
      const index = catalog.findIndex((item) => item.id === model.id)
      if (index === -1) catalog = [...catalog, model]
      else catalog = catalog.map((item, position) => (position === index ? model : item))
      return []
    },

    removeModel(id: string): boolean {
      const before = catalog.length
      catalog = catalog.filter((model) => model.id !== id)
      return catalog.length !== before
    },

    log(entry: Omit<LoggedRequest, 'id' | 'at'>): LoggedRequest {
      const logged: LoggedRequest = { ...entry, id: newId(), at: now().toISOString() }
      requests.push(logged)
      while (requests.length > config.maxRequests) requests.shift()
      return logged
    },

    requests(limit: number): LoggedRequest[] {
      if (limit <= 0) return []
      return requests.slice(-limit).reverse()
    },

    request(id: string): LoggedRequest | undefined {
      return requests.find((entry) => entry.id === id)
    },

    clearRequests(): void {
      requests.length = 0
    },

    requestCount(): number {
      return requests.length
    },

    reset(): void {
      settings = { ...bootSettings }
      rules = bootRules.map((rule) => cloneRule(rule))
      catalog = bootCatalog.map((model) => ({ ...model }))
      requests.length = 0
    },
  }
}

/**
 * A rule with its id: the id of the operator is kept when it is free, a new
 * one is made otherwise.
 * @param input The rule as the operator sent it.
 * @param usedIds The ids already taken.
 * @param newId How a new id is made.
 */
function toRule(input: RuleInput, usedIds: Set<string>, newId: () => string): Rule {
  const wanted = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim() : undefined
  let id = wanted ?? ''
  if (!id || usedIds.has(id)) {
    id = `rule_${newId()}`
    while (usedIds.has(id)) id = `rule_${newId()}`
  }
  usedIds.add(id)

  const rule: Rule = {
    id,
    match: cloneMatch(input.match ?? {}),
    reply: cloneReply(input.reply ?? { kind: 'auto' }),
  }
  if (input.latencyMs !== undefined) rule.latencyMs = input.latencyMs
  if (input.times !== undefined) rule.times = input.times
  if (input.usage !== undefined) rule.usage = { ...input.usage }
  return rule
}

/**
 * A copy of a rule, so a caller never holds the store's own object.
 * @param rule The rule to copy.
 */
function cloneRule(rule: Rule): Rule {
  const copy: Rule = { id: rule.id, match: cloneMatch(rule.match), reply: cloneReply(rule.reply) }
  if (rule.latencyMs !== undefined) copy.latencyMs = rule.latencyMs
  if (rule.times !== undefined) copy.times = rule.times
  if (rule.usage !== undefined) copy.usage = { ...rule.usage }
  return copy
}

/**
 * A copy of the match of a rule.
 * @param match The match of the rule.
 */
function cloneMatch(match: RuleMatch): RuleMatch {
  return { ...match }
}

/**
 * A copy of the reply of a rule.
 * @param reply The reply of the rule.
 */
function cloneReply(reply: Reply): Reply {
  if (reply.kind === 'tool_calls') {
    const calls: ScriptedCall[] = reply.calls.map((call) => ({
      name: call.name,
      arguments: { ...call.arguments },
    }))
    return reply.text === undefined ? { kind: 'tool_calls', calls } : { kind: 'tool_calls', calls, text: reply.text }
  }
  if (reply.kind === 'error') {
    return reply.code === undefined
      ? { kind: 'error', status: reply.status, message: reply.message }
      : { kind: 'error', status: reply.status, message: reply.message, code: reply.code }
  }
  if (reply.kind === 'text') return { kind: 'text', text: reply.text }
  return { kind: 'auto' }
}

/**
 * Whether a value is a plain object.
 * @param value The value to check.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a value is an integer between two bounds.
 * @param value The value to check.
 * @param min The lowest value accepted.
 * @param max The highest value accepted.
 */
function isIntegerBetween(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Whether a regular expression compiles.
 * @param value The raw expression.
 */
function compiles(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}
