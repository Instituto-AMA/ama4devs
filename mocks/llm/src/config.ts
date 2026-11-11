import { readFileSync } from 'node:fs'
import pkg from '../package.json' with { type: 'json' }
import { defaultCatalog, validateModel } from './catalog.ts'
import { DEFAULT_ANSWER_TEMPLATE } from './engine.ts'
import { validateRule, validateSettings } from './store.ts'
import type {
  CatalogModel,
  RuleInput,
  Settings,
  ToolStrategy,
  UnknownModelPolicy,
} from './types.ts'

/**
 * The boot file of the mock: the settings, the rules and the catalog it
 * starts with. Every field is optional; a field that is absent keeps the
 * value the environment gave.
 */
export interface BootFile {
  settings?: Partial<Settings>
  rules?: RuleInput[]
  catalog?: CatalogModel[]
}

/**
 * Everything the server needs to boot: the port, the starting settings, the
 * rules, the catalog, the hosts the local guard admits and where the files
 * live.
 */
export interface Config {
  port: number
  version: string
  /** The settings the store starts with; the panel changes them at runtime. */
  settings: Settings
  /** The rules the store starts with; the panel changes them at runtime. */
  rules: RuleInput[]
  /** The models the store starts with; the panel changes them at runtime. */
  catalog: CatalogModel[]
  /** Requests kept in memory; the oldest are dropped beyond it. */
  maxRequests: number
  /** Whether the request body is kept in the log. */
  logBodies: boolean
  allowedHosts: string[]
  publicDir: string
  /** What the boot files said that could not be read; the server logs them. */
  bootErrors: string[]
}

/**
 * The hosts the guard admits without any configuration: the local names, the
 * Docker host and the names of this service in a compose.
 */
const DEFAULT_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'llm',
  'llm-mock',
]

/** The port of the service, as the compose file and the docs say. */
const DEFAULT_PORT = 45470

/**
 * The configuration of the server, read from the environment and the boot
 * files.
 * @param env The environment to read: `process.env` in the server, a plain
 * object in the tests.
 * @param readFile How a boot file is read; the tests give a fake one.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): Config {
  const bootErrors: string[] = []
  const boot = readBootFiles(env, readFile, bootErrors)

  const settings: Settings = {
    latencyMs: nonNegativeInt(env.LLM_LATENCY_MS, 0),
    streamChunkDelayMs: nonNegativeInt(env.LLM_STREAM_CHUNK_DELAY_MS, 15),
    streamChunkChars: positiveInt(env.LLM_STREAM_CHUNK_CHARS, 24),
    requireAuth: env.LLM_REQUIRE_AUTH?.trim() !== '0',
    unknownModels: enumOf<UnknownModelPolicy>(env.LLM_UNKNOWN_MODELS, ['accept', 'reject'], 'accept'),
    toolStrategy: enumOf<ToolStrategy>(env.LLM_TOOL_STRATEGY, ['match', 'first', 'none'], 'match'),
    maxToolRounds: boundedInt(env.LLM_MAX_TOOL_ROUNDS, 0, 20, 1),
    answerTemplate: env.LLM_ANSWER_TEMPLATE ?? DEFAULT_ANSWER_TEMPLATE,
    reportCost: env.LLM_REPORT_COST?.trim() !== '0',
  }

  return {
    port: positiveInt(env.PORT, DEFAULT_PORT),
    version: String(pkg.version),
    settings: { ...settings, ...boot.settings },
    rules: boot.rules,
    catalog: boot.catalog ?? defaultCatalog(),
    maxRequests: positiveInt(env.LLM_MAX_REQUESTS, 1000),
    logBodies: env.LLM_LOG_BODIES?.trim() === '1',
    allowedHosts: allowedHostsOf(env.MOCK_ALLOWED_HOSTS),
    publicDir: new URL('../public', import.meta.url).pathname,
    bootErrors,
  }
}

/**
 * The boot files of the mock: the file first, the inline JSON after it. The
 * later one overrides the fields of the earlier one.
 * @param env The environment to read.
 * @param readFile How a boot file is read.
 * @param bootErrors The list the read errors are pushed to.
 */
function readBootFiles(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string,
  bootErrors: string[],
): { settings: Partial<Settings>; rules: RuleInput[]; catalog?: CatalogModel[] } {
  let settings: Partial<Settings> = {}
  let rules: RuleInput[] = []
  let catalog: CatalogModel[] | undefined

  const path = env.LLM_CONFIG_FILE?.trim()
  if (path) {
    try {
      const parsed = parseBootFile(readFile(path), `config file ${path}`)
      if (parsed.errors.length) bootErrors.push(...parsed.errors)
      else {
        settings = { ...settings, ...parsed.value.settings }
        rules = parsed.value.rules ?? rules
        catalog = parsed.value.catalog ?? catalog
      }
    } catch (error) {
      bootErrors.push(`config file ${path}: ${messageOf(error)}`)
    }
  }

  const inline = env.LLM_CONFIG_JSON?.trim()
  if (inline) {
    const parsed = parseBootFile(inline, 'LLM_CONFIG_JSON')
    if (parsed.errors.length) bootErrors.push(...parsed.errors)
    else {
      settings = { ...settings, ...parsed.value.settings }
      rules = parsed.value.rules ?? rules
      catalog = parsed.value.catalog ?? catalog
    }
  }

  return { settings, rules, catalog }
}

/**
 * A boot file read as a JSON object and checked: the settings, the rules and
 * the catalog it carries.
 * @param text The raw file.
 * @param label The name of the source, used in the errors.
 */
function parseBootFile(
  text: string,
  label: string,
): { value: BootFile; errors: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { value: {}, errors: [`${label}: invalid JSON (${messageOf(error)})`] }
  }

  if (!isPlainObject(parsed)) return { value: {}, errors: [`${label}: must be a JSON object`] }

  const errors: string[] = []
  const value: BootFile = {}

  if (parsed.settings !== undefined) {
    const settingErrors = validateSettings(parsed.settings)
    if (settingErrors.length) errors.push(...settingErrors.map((error) => `${label}: ${error}`))
    else value.settings = parsed.settings as Partial<Settings>
  }

  if (parsed.rules !== undefined) {
    const rawRules = parsed.rules
    if (!Array.isArray(rawRules)) errors.push(`${label}: rules must be an array`)
    else {
      const ruleErrors: string[] = []
      rawRules.forEach((rule, index) => {
        ruleErrors.push(...validateRule(rule).map((error) => `rules[${index}]: ${error}`))
      })
      if (ruleErrors.length) errors.push(...ruleErrors.map((error) => `${label}: ${error}`))
      else value.rules = rawRules as RuleInput[]
    }
  }

  if (parsed.catalog !== undefined) {
    const rawCatalog = parsed.catalog
    if (!Array.isArray(rawCatalog)) errors.push(`${label}: catalog must be an array`)
    else {
      const modelErrors: string[] = []
      rawCatalog.forEach((model, index) => {
        modelErrors.push(...validateModel(model).map((error) => `catalog[${index}]: ${error}`))
      })
      if (modelErrors.length) errors.push(...modelErrors.map((error) => `${label}: ${error}`))
      else value.catalog = rawCatalog as CatalogModel[]
    }
  }

  if (errors.length) return { value: {}, errors }
  return { value, errors }
}

/**
 * A positive integer, or the fallback for anything else.
 * @param value The raw value.
 * @param fallback What to use when the value is not a positive integer.
 */
function positiveInt(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isInteger(number) && number > 0
    ? number
    : fallback
}

/**
 * An integer from zero up, or the fallback for anything else.
 * @param value The raw value.
 * @param fallback What to use when the value is not a non-negative integer.
 */
function nonNegativeInt(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isInteger(number) && number >= 0
    ? number
    : fallback
}

/**
 * An integer between two bounds, or the fallback for anything else.
 * @param value The raw value.
 * @param min The lowest value accepted.
 * @param max The highest value accepted.
 * @param fallback What to use when the value is not accepted.
 */
function boundedInt(
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max
    ? number
    : fallback
}

/**
 * One of the values of a closed set, or the fallback.
 * @param value The raw value.
 * @param allowed The values accepted.
 * @param fallback What to use when the value is not accepted.
 */
function enumOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const name = value?.trim()
  return name !== undefined && (allowed as readonly string[]).includes(name) ? (name as T) : fallback
}

/**
 * The hosts of the guard: the local names plus the ones the environment adds,
 * comma separated.
 * @param value The raw MOCK_ALLOWED_HOSTS value.
 */
function allowedHostsOf(value: string | undefined): string[] {
  const hosts = [...DEFAULT_ALLOWED_HOSTS]
  for (const host of String(value ?? '').split(',')) {
    const name = host.trim().toLowerCase()
    if (name && !hosts.includes(name)) hosts.push(name)
  }
  return hosts
}

/**
 * Whether a value is a plain object.
 * @param value The value to check.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The message of an error.
 * @param error What was thrown.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
