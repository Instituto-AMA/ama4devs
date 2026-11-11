/**
 * The brain of the LLM mock: it decides what one request is answered with
 * (the first scripted rule that matches, else the built-in heuristic), how
 * many tokens it costs and what the wire bodies look like.
 *
 * Everything here is a pure function: no clock, no network, no timer. The
 * moment is given by the caller (`decide` takes the `now` it must use).
 */

import { findModel } from './catalog.ts'
import type {
  AnswerIds,
  CatalogModel,
  ChatMessage,
  ChatRequest,
  Decision,
  EngineState,
  Gateway,
  JsonSchema,
  ResolvedReply,
  Rule,
  ScriptedCall,
  Settings,
  ToolSpec,
  ToolStrategy,
  Usage,
  UsageOverride,
} from './types.ts'

/** The text the `auto` reply answers with when the settings keep the default. */
export const DEFAULT_ANSWER_TEMPLATE =
  'Resposta simulada pelo mock de LLM para: "{question}". Ferramentas consultadas: {tools}. Resultados recebidos: {results}.'

/** What the text of a request can ask the mock to do. */
export interface Markers {
  /** The status of an error the mock answers with; `400` to `599`. */
  error?: number
  /** The mock answers with text, without calling a tool. */
  text?: boolean
  /** The name of the tool the mock must call. */
  tool?: string
  /** Extra wait before the answer, in ms. */
  latencyMs?: number
  /** The mock answers with the text of the question itself. */
  echo?: boolean
}

/** The text of a message: the string as it is, the text parts joined. */
export function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
}

/** The text of the last user message, or an empty string when there is none. */
export function lastUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && message.role === 'user') return textOf(message.content)
  }
  return ''
}

/** The messages that came after the last user message. */
function afterLastUser(messages: ChatMessage[]): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && message.role === 'user') return messages.slice(index + 1)
  }
  return []
}

/** The text of the system and developer messages, joined. */
function systemText(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => textOf(message.content))
    .join('\n')
}

/** The markers the text of a request carries. */
export function markersOf(text: string): Markers {
  const markers: Markers = {}
  const pattern = /\[mock:([a-z_]+)(?:=([^\]]*))?\]/gi
  for (const match of text.matchAll(pattern)) {
    const key = (match[1] ?? '').toLowerCase()
    const value = match[2] ?? ''
    if (key === 'error') {
      const status = Number.parseInt(value, 10)
      if (/^\d+$/.test(value.trim()) && status >= 400 && status <= 599) markers.error = status
    } else if (key === 'text') {
      markers.text = true
    } else if (key === 'tool') {
      const name = value.trim()
      if (name.length > 0) markers.tool = name
    } else if (key === 'latency') {
      const latency = Number.parseInt(value, 10)
      if (/^\d+$/.test(value.trim()) && latency >= 0 && latency <= 120000) markers.latencyMs = latency
    } else if (key === 'echo') {
      markers.echo = true
    }
  }
  return markers
}

/** The text without the markers, trimmed. */
export function stripMarkers(text: string): string {
  return text.replace(/\[mock:[^\]]*\]/gi, '').trim()
}

/** Whether a regular expression holds; an invalid one never holds. */
function regexHolds(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(text)
  } catch {
    return false
  }
}

/**
 * The name of the tool whose result is the last message: the assistant tool
 * call whose id equals the last message's tool_call_id; '' when the last
 * message is not a tool result or no call matches.
 * @param messages The messages of the request.
 */
export function lastToolName(messages: ChatMessage[]): string {
  const list = messages ?? []
  const last = list[list.length - 1]
  if (!last || last.role !== 'tool') return ''
  const id = last.tool_call_id
  if (typeof id !== 'string' || id === '') return ''

  for (const message of list) {
    if (message.role !== 'assistant') continue
    for (const call of message.tool_calls ?? []) {
      if (call.id === id) return call.function.name
    }
  }
  return ''
}

/**
 * The last tool message's content parsed as JSON; undefined when it is not
 * JSON or there is none.
 * @param messages The messages of the request.
 */
export function lastToolResult(messages: ChatMessage[]): unknown {
  const list = messages ?? []
  const last = list[list.length - 1]
  if (!last || last.role !== 'tool') return undefined

  const content = last.content
  const text = typeof content === 'string' ? content : textOf(content)
  if (text.trim() === '') return undefined

  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** What the placeholders of a scripted reply are filled with. */
export interface TemplateContext {
  /** The text of the last user message, without the markers. */
  question: string
  /** The day of the answer, as `YYYY-MM-DD`. */
  today: string
  /** The result of the last tool, parsed as JSON. */
  toolResult: unknown
}

/** A placeholder and its value; `ok` is false when the placeholder is unknown. */
interface Resolved {
  ok: boolean
  value?: unknown
}

/** The value of a path inside a JSON value: keys and array indexes. */
function resolvePath(root: unknown, path: string[]): Resolved {
  let current: unknown = root
  for (const key of path) {
    if (current === null || current === undefined) return { ok: false }
    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { ok: false }
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return { ok: false }
    if (!Object.prototype.hasOwnProperty.call(current, key)) return { ok: false }
    current = (current as Record<string, unknown>)[key]
  }
  return { ok: true, value: current }
}

/** A day of the calendar, as `YYYY-MM-DD`, moved by some days. */
function shiftDate(today: string, days: number): string {
  const base = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(base)) return today
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

/** The value of one placeholder. */
function resolvePlaceholder(name: string, ctx: TemplateContext): Resolved {
  const key = name.trim()
  if (key === 'question') return { ok: true, value: ctx.question }
  if (key === 'today') return { ok: true, value: ctx.today }

  const date = /^date:([+-])(\d+)$/.exec(key)
  if (date) {
    const sign = date[1] === '-' ? -1 : 1
    return { ok: true, value: shiftDate(ctx.today, sign * Number.parseInt(date[2] as string, 10)) }
  }

  if (key.startsWith('tool.')) {
    const path = key
      .slice('tool.'.length)
      .split('.')
      .filter((part) => part !== '')
    if (path.length === 0) return { ok: false }
    return resolvePath(ctx.toolResult, path)
  }

  return { ok: false }
}

/** A string that is one placeholder and nothing else. */
const WHOLE_PLACEHOLDER = /^\{\{([^}]*)\}\}$/

/** A placeholder inside a longer string. */
const INNER_PLACEHOLDER = /\{\{([^}]*)\}\}/g

/** One string of a value, with its placeholders filled. */
function fillString(text: string, ctx: TemplateContext): unknown {
  const whole = WHOLE_PLACEHOLDER.exec(text)
  if (whole) {
    const resolved = resolvePlaceholder(whole[1] as string, ctx)
    if (!resolved.ok) return ''
    return resolved.value
  }

  return text.replace(INNER_PLACEHOLDER, (_match, name: string) => {
    const resolved = resolvePlaceholder(name, ctx)
    if (!resolved.ok) return ''
    const value = resolved.value
    if (value === null || value === undefined) return ''
    return typeof value === 'string' ? value : String(value)
  })
}

/**
 * Fills placeholders in every string of a JSON value: the objects and the
 * arrays are walked deeply. A string that is one placeholder keeps the type of
 * its value; a placeholder inside a longer string becomes its text. An unknown
 * placeholder is empty. It never throws.
 * @param value The value to fill.
 * @param ctx What the placeholders are filled with.
 */
export function fillTemplates(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') return fillString(value, ctx)
  if (Array.isArray(value)) return value.map((item) => fillTemplates(item, ctx))
  if (typeof value === 'object' && value !== null) {
    const filled: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      filled[key] = fillTemplates(item, ctx)
    }
    return filled
  }
  return value
}

/** A text with its placeholders filled, always a string. */
function fillText(text: string, ctx: TemplateContext): string {
  const filled = fillTemplates(text, ctx)
  return typeof filled === 'string' ? filled : String(filled)
}

/** A reply with its placeholders filled. */
function fillReply(reply: ResolvedReply, ctx: TemplateContext): ResolvedReply {
  if (reply.kind === 'tool_calls') {
    const calls: ScriptedCall[] = reply.calls.map((call) => ({
      name: call.name,
      arguments: fillTemplates(call.arguments, ctx) as Record<string, unknown>,
    }))
    if (reply.text === undefined) return { kind: 'tool_calls', calls }
    return { kind: 'tool_calls', calls, text: fillText(reply.text, ctx) }
  }
  if (reply.kind === 'text') return { kind: 'text', text: fillText(reply.text, ctx) }
  return reply
}

/** Whether the rule matches the request: every field the rule sets must hold. */
export function matches(rule: Rule, req: ChatRequest, gateway: Gateway): boolean {
  const match = rule.match
  if (match.model !== undefined && match.model !== req.model) return false
  if (match.gateway !== undefined && match.gateway !== gateway) return false
  if (match.lastUser !== undefined && !regexHolds(match.lastUser, lastUserText(req.messages ?? []))) {
    return false
  }
  if (match.system !== undefined && !regexHolds(match.system, systemText(req.messages ?? []))) {
    return false
  }
  if (match.hasTools !== undefined && match.hasTools !== ((req.tools?.length ?? 0) > 0)) {
    return false
  }
  if (match.afterTool !== undefined) {
    const last = (req.messages ?? [])[(req.messages ?? []).length - 1]
    const afterTool = last?.role === 'tool'
    if (match.afterTool !== afterTool) return false
  }
  if (match.toolOffered !== undefined) {
    const offered = (req.tools ?? []).some((tool) => tool.function.name === match.toolOffered)
    if (!offered) return false
  }
  if (match.lastToolName !== undefined && match.lastToolName !== lastToolName(req.messages ?? [])) {
    return false
  }
  return true
}

/** How many tool rounds the assistant already did since the last user message. */
export function toolRounds(messages: ChatMessage[]): number {
  return afterLastUser(messages).filter(
    (message) => message.role === 'assistant' && (message.tool_calls?.length ?? 0) > 0,
  ).length
}

/** The names of the tools called since the last user message. */
function calledToolsAfterLastUser(messages: ChatMessage[]): string[] {
  const names: string[] = []
  for (const message of afterLastUser(messages)) {
    if (message.role !== 'assistant') continue
    for (const call of message.tool_calls ?? []) names.push(call.function.name)
  }
  return names
}

/** The lowercase text without accents. */
function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** The words of the question that may match a tool; short ones are noise. */
function questionTokens(question: string): string[] {
  return normalizeText(question)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3)
}

/** How well a tool matches the question: the name counts double, the description once. */
function scoreTool(tool: ToolSpec, tokens: string[]): number {
  const nameParts = normalizeText(tool.function.name)
    .split(/[._-]+/)
    .filter((part) => part.length > 0)
  const description = normalizeText(tool.function.description ?? '')
  let score = 0
  for (const token of tokens) {
    if (nameParts.some((part) => part.includes(token))) score += 2
    if (description.includes(token)) score += 1
  }
  return score
}

/**
 * The tool the mock calls: `none` never calls, `first` takes the first one
 * offered, `match` takes the tool whose name or description talks about the
 * question. A tool of `exclude` is never picked.
 */
export function pickTool(
  tools: ToolSpec[],
  question: string,
  strategy: ToolStrategy,
  exclude?: string[],
): ToolSpec | undefined {
  if (strategy === 'none') return undefined
  const excluded = new Set(exclude ?? [])
  const candidates = tools.filter((tool) => !excluded.has(tool.function.name))
  if (strategy === 'first') return candidates[0]

  const tokens = questionTokens(question)
  let best: ToolSpec | undefined
  let bestScore = 0
  for (const tool of candidates) {
    const score = scoreTool(tool, tokens)
    if (score > bestScore) {
      bestScore = score
      best = tool
    }
  }
  return best
}

/** The type of a property: the first of an array of types that is not `null`. */
function firstType(type: unknown): string {
  if (Array.isArray(type)) {
    for (const candidate of type) {
      if (typeof candidate === 'string' && candidate !== 'null') return candidate
    }
    return 'null'
  }
  return typeof type === 'string' ? type : ''
}

/** The value of one property, out of its own schema. */
function valueFor(property: JsonSchema, today: string): unknown {
  if (typeof property !== 'object' || property === null || Array.isArray(property)) return ''
  if ('default' in property) return property.default
  const values = property.enum
  if (Array.isArray(values) && values.length > 0) return values[0]
  const examples = property.examples
  if (Array.isArray(examples) && examples.length > 0) return examples[0]

  switch (firstType(property.type)) {
    case 'string':
      if (property.format === 'date') return today
      if (property.format === 'date-time') return `${today}T00:00:00Z`
      return ''
    case 'integer':
    case 'number':
      return typeof property.minimum === 'number' ? property.minimum : 1
    case 'boolean':
      return false
    case 'array': {
      const minItems = property.minItems
      if (typeof minItems === 'number' && minItems > 0) {
        const items = property.items
        const value = valueFor(
          typeof items === 'object' && items !== null && !Array.isArray(items)
            ? (items as JsonSchema)
            : {},
          today,
        )
        return [value]
      }
      return []
    }
    case 'object':
      return argumentsFor(property, today)
    case 'null':
      return null
    default:
      return ''
  }
}

/**
 * The arguments of a call: one value for every name the schema requires.
 */
export function argumentsFor(schema: JsonSchema | undefined, today: string): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return {}
  const required = schema.required
  if (!Array.isArray(required)) return {}

  const properties = schema.properties
  const known =
    typeof properties === 'object' && properties !== null && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)
      : {}

  const args: Record<string, unknown> = {}
  for (const name of required) {
    if (typeof name !== 'string') continue
    const property = known[name]
    if (typeof property !== 'object' || property === null || Array.isArray(property)) continue
    args[name] = valueFor(property as JsonSchema, today)
  }
  return args
}

/** The text answer of the `auto` reply, out of the answer template. */
function textAnswer(req: ChatRequest, settings: Settings): ResolvedReply {
  const messages = req.messages ?? []
  const question = stripMarkers(lastUserText(messages))
  const tools = calledToolsAfterLastUser(messages)
  const results = afterLastUser(messages).filter((message) => message.role === 'tool').length
  const text = settings.answerTemplate
    .replace('{question}', question)
    .replace('{tools}', tools.length > 0 ? tools.join(', ') : 'nenhuma')
    .replace('{results}', String(results))
  return { kind: 'text', text }
}

/**
 * What the mock answers when no rule matched: a tool call when the request
 * offers tools, the answer template otherwise.
 */
export function autoReply(
  req: ChatRequest,
  settings: Settings,
  markers: Markers,
  today: string,
): ResolvedReply {
  const messages = req.messages ?? []
  const question = stripMarkers(lastUserText(messages))
  const tools = req.tools ?? []

  if (markers.error !== undefined) {
    return {
      kind: 'error',
      status: markers.error,
      message: `mock error ${markers.error}`,
      code: 'mock_error',
    }
  }
  if (markers.echo) {
    return { kind: 'text', text: question }
  }
  if (markers.text || tools.length === 0 || settings.toolStrategy === 'none') {
    return textAnswer(req, settings)
  }

  const rounds = toolRounds(messages)
  if (markers.tool) {
    const offered = tools.find((tool) => tool.function.name === markers.tool)
    if (offered && rounds < settings.maxToolRounds) {
      return {
        kind: 'tool_calls',
        calls: [
          {
            name: offered.function.name,
            arguments: argumentsFor(offered.function.parameters, today),
          },
        ],
      }
    }
    return textAnswer(req, settings)
  }

  if (rounds < settings.maxToolRounds) {
    const tool = pickTool(tools, question, settings.toolStrategy, calledToolsAfterLastUser(messages))
    if (tool) {
      return {
        kind: 'tool_calls',
        calls: [{ name: tool.function.name, arguments: argumentsFor(tool.function.parameters, today) }],
      }
    }
  }
  return textAnswer(req, settings)
}

/** How many tokens a text costs: four characters per token, never less than one. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/** A decimal string as its units and scale, without any float. */
function decimalParts(value: string): { units: bigint; scale: number } {
  const dot = value.indexOf('.')
  if (dot === -1) return { units: BigInt(value), scale: 0 }
  const whole = value.slice(0, dot) === '' ? '0' : value.slice(0, dot)
  const fraction = value.slice(dot + 1)
  const units = BigInt(whole) * 10n ** BigInt(fraction.length) + BigInt(fraction === '' ? '0' : fraction)
  return { units, scale: fraction.length }
}

/** The price of some tokens, in pico-dollars (one dollar is a trillion of them). */
export function priceOf(tokens: number, pricePerToken: string): bigint {
  const { units, scale } = decimalParts(pricePerToken)
  const numerator = BigInt(tokens) * units * 10n ** 12n
  const denominator = 10n ** BigInt(scale)
  return (numerator + denominator / 2n) / denominator
}

/** Pico-dollars as dollars: at most twelve decimals, without trailing zeros. */
export function formatUsd(pico: bigint): string {
  const negative = pico < 0n
  const absolute = negative ? -pico : pico
  const whole = absolute / 10n ** 12n
  const fraction = (absolute % 10n ** 12n).toString().padStart(12, '0').replace(/0+$/, '')
  const text = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`
  return negative && text !== '0' ? `-${text}` : text
}

/**
 * The tokens and the cost of one answer. The cost is `null` when the settings
 * hide it, when the model is outside the catalog or when the answer is an
 * error; an override wins field by field.
 */
export function usageFor(
  req: ChatRequest,
  reply: ResolvedReply,
  model: CatalogModel | undefined,
  settings: Settings,
  override?: UsageOverride,
): Usage {
  const input: string[] = (req.messages ?? []).map((message) => textOf(message.content))
  if ((req.tools?.length ?? 0) > 0) input.push(JSON.stringify(req.tools ?? []))
  let inputTokens = estimateTokens(input.join('\n'))

  let outputText = ''
  if (reply.kind === 'text') {
    outputText = reply.text
  } else if (reply.kind === 'tool_calls') {
    outputText =
      (reply.text ?? '') +
      reply.calls.map((call) => call.name + JSON.stringify(call.arguments)).join('')
  }
  let outputTokens = reply.kind === 'error' ? 0 : estimateTokens(outputText)

  let costUsd: string | null = null
  if (settings.reportCost && model !== undefined && reply.kind !== 'error') {
    costUsd = formatUsd(
      priceOf(inputTokens, model.inputPrice) + priceOf(outputTokens, model.outputPrice),
    )
  }

  if (override !== undefined) {
    if (override.inputTokens !== undefined) inputTokens = override.inputTokens
    if (override.outputTokens !== undefined) outputTokens = override.outputTokens
    if (override.costUsd !== undefined) costUsd = override.costUsd
  }

  return { inputTokens, outputTokens, costUsd }
}

/**
 * What the mock answers one request with: the first rule that matches, else
 * the built-in heuristic. The state is never changed.
 */
export function decide(
  req: ChatRequest,
  gateway: Gateway,
  state: EngineState,
  now: Date = new Date(),
): Decision {
  const settings = state.settings
  const today = now.toISOString().slice(0, 10)
  const markers = markersOf(lastUserText(req.messages ?? []))

  const rule = state.rules.find((candidate) => matches(candidate, req, gateway))
  let reply: ResolvedReply
  let ruleId: string | undefined
  let latencyMs: number

  if (rule) {
    const scripted = rule.reply
    reply = scripted.kind === 'auto' ? autoReply(req, settings, markers, today) : scripted
    ruleId = rule.id
    latencyMs = settings.latencyMs + (rule.latencyMs ?? 0) + (markers.latencyMs ?? 0)
  } else {
    reply = autoReply(req, settings, markers, today)
    latencyMs = settings.latencyMs + (markers.latencyMs ?? 0)
  }

  const model = findModel(state.catalog, req.model)
  if (reply.kind === 'tool_calls' && model !== undefined && !model.tools) {
    reply = textAnswer(req, settings)
  }

  const context: TemplateContext = {
    question: stripMarkers(lastUserText(req.messages ?? [])),
    today,
    toolResult: lastToolResult(req.messages ?? []),
  }
  reply = fillReply(reply, context)

  const limited = limitReply(req, reply)
  const usage = usageFor(req, limited.reply, model, settings, rule?.usage)
  return { reply: limited.reply, ruleId, latencyMs, usage, model: req.model, truncated: limited.truncated }
}

/**
 * The reply cut at the request's `max_tokens` (four characters per token):
 * the cut happens once, here, so the non-streamed body, the streamed chunks,
 * the token counts and the cost all describe the same text.
 */
function limitReply(req: ChatRequest, reply: ResolvedReply): { reply: ResolvedReply; truncated: boolean } {
  const limit = req.max_tokens ?? req.max_completion_tokens
  if (typeof limit !== 'number' || limit <= 0 || reply.kind === 'error') {
    return { reply, truncated: false }
  }
  const maxChars = limit * 4
  const text = reply.text
  if (typeof text !== 'string' || text.length <= maxChars) {
    return { reply, truncated: false }
  }
  return { reply: { ...reply, text: text.slice(0, maxChars) }, truncated: true }
}

/** How an answer finishes: `length` when it was cut, else by its kind. */
function finishReasonOf(decision: Decision): 'stop' | 'tool_calls' | 'length' {
  if (decision.truncated === true) return 'length'
  return decision.reply.kind === 'tool_calls' ? 'tool_calls' : 'stop'
}

/** The body of a non-streamed answer, in the OpenAI shape. */
export function completionBody(
  req: ChatRequest,
  gateway: Gateway,
  decision: Decision,
  ids: AnswerIds,
): Record<string, unknown> {
  const reply = decision.reply
  if (reply.kind === 'error') {
    return errorBody(reply.status, reply.message, reply.code)
  }

  const content: string | null = reply.kind === 'text' ? reply.text : (reply.text ?? null)
  const finishReason = finishReasonOf(decision)

  const message: Record<string, unknown> = { role: 'assistant', content }
  if (reply.kind === 'tool_calls') {
    message.tool_calls = reply.calls.map((call, index) => ({
      id: ids.callId(index),
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }))
  }

  const usage: Record<string, unknown> = {
    prompt_tokens: decision.usage.inputTokens,
    completion_tokens: decision.usage.outputTokens,
    total_tokens: decision.usage.inputTokens + decision.usage.outputTokens,
  }

  const body: Record<string, unknown> = {
    id: ids.id,
    object: 'chat.completion',
    created: ids.created,
    model: decision.model,
    choices: [{ index: 0, message, finish_reason: finishReason, logprobs: null }],
    usage,
  }

  if (decision.usage.costUsd !== null) {
    if (gateway === 'openrouter') {
      usage.cost = Number(decision.usage.costUsd)
    } else {
      body.provider_metadata = { gateway: { cost: decision.usage.costUsd } }
    }
  }
  return body
}

/**
 * The chunks of a streamed answer, in the order they are written; the caller
 * writes `data: [DONE]` at the end.
 */
export function streamChunks(
  req: ChatRequest,
  gateway: Gateway,
  decision: Decision,
  ids: AnswerIds,
  chunkChars: number,
): Record<string, unknown>[] {
  const reply = decision.reply
  if (reply.kind === 'error') return []

  const base = {
    id: ids.id,
    object: 'chat.completion.chunk',
    created: ids.created,
    model: decision.model,
  }
  const chunks: Record<string, unknown>[] = []
  const push = (choices: unknown[]) => {
    chunks.push({ ...base, choices })
  }

  push([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])

  const text = reply.kind === 'text' ? reply.text : (reply.text ?? '')
  const size = chunkChars > 0 ? chunkChars : 1
  for (let index = 0; index < text.length; index += size) {
    push([{ index: 0, delta: { content: text.slice(index, index + size) }, finish_reason: null }])
  }

  if (reply.kind === 'tool_calls') {
    reply.calls.forEach((call, index) => {
      push([
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: ids.callId(index),
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              },
            ],
          },
          finish_reason: null,
        },
      ])
    })
  }

  push([{ index: 0, delta: {}, finish_reason: finishReasonOf(decision) }])

  if (req.stream_options?.include_usage || gateway === 'openrouter') {
    const usage: Record<string, unknown> = {
      prompt_tokens: decision.usage.inputTokens,
      completion_tokens: decision.usage.outputTokens,
      total_tokens: decision.usage.inputTokens + decision.usage.outputTokens,
    }
    const chunk: Record<string, unknown> = { ...base, choices: [], usage }
    if (decision.usage.costUsd !== null) {
      if (gateway === 'openrouter') {
        usage.cost = Number(decision.usage.costUsd)
      } else {
        chunk.provider_metadata = { gateway: { cost: decision.usage.costUsd } }
      }
    }
    chunks.push(chunk)
  }
  return chunks
}

/** The body of an error, in the OpenAI shape. */
export function errorBody(status: number, message: string, code?: string): Record<string, unknown> {
  return {
    error: {
      message,
      type: code ?? 'mock_error',
      code: code ?? String(status),
    },
  }
}
