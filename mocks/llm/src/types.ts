/**
 * The shapes of the LLM mock: the OpenAI-compatible chat request it receives,
 * the catalog it answers, the rules that script its replies, the settings an
 * operator changes at runtime and the log of what it answered.
 *
 * Every other module imports from here; nothing here imports from them.
 */

/** The gateway a request came in through: its path prefix decides it. */
export type Gateway = 'vercel' | 'openrouter'

/** The gateways, in the order the docs list them. */
export const GATEWAYS: readonly Gateway[] = ['vercel', 'openrouter']

/** One part of a multimodal message; only the text parts are read. */
export interface ContentPart {
  type: string
  text?: string
}

/** One tool call of an assistant message, as the OpenAI shape writes it. */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One message of the conversation. */
export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content?: string | ContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

/** A JSON Schema object, as the caller sent it. */
export type JsonSchema = Record<string, unknown>

/** One tool offered to the model. */
export interface ToolSpec {
  type: 'function'
  function: { name: string; description?: string; parameters?: JsonSchema }
}

/** The body of `POST /chat/completions`. */
export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  tool_choice?: unknown
  max_tokens?: number
  max_completion_tokens?: number
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  temperature?: number
  /** OpenRouter's own extension; accepted and ignored on the Vercel path. */
  usage?: { include?: boolean }
}

/**
 * One model of the catalog. Prices are dollars per token as a decimal string,
 * the way both gateways answer them (`"0.00000027"`).
 */
export interface CatalogModel {
  id: string
  name: string
  contextWindow: number
  maxOutputTokens: number
  inputPrice: string
  outputPrice: string
  /** Whether the model calls tools: `tool-use` tag (Vercel), `tools` parameter (OpenRouter). */
  tools: boolean
}

/** What a rule looks at. Every field set must hold; an empty match always holds. */
export interface RuleMatch {
  /** Exact model id. */
  model?: string
  gateway?: Gateway
  /** A case-insensitive regular expression tested on the text of the last user message. */
  lastUser?: string
  /** A case-insensitive regular expression tested on the text of the system messages. */
  system?: string
  /** True: the request offers tools; false: it offers none. */
  hasTools?: boolean
  /** True: the last message is a tool result; false: it is not. */
  afterTool?: boolean
  /** The request offers a tool with this exact name. */
  toolOffered?: string
}

/** A tool call a scripted reply makes; `arguments` is serialized to a JSON string on the wire. */
export interface ScriptedCall {
  name: string
  arguments: Record<string, unknown>
}

/** What a reply does. `auto` runs the built-in heuristic (see `engine.ts`). */
export type Reply =
  | { kind: 'text'; text: string }
  | { kind: 'tool_calls'; calls: ScriptedCall[]; text?: string }
  | { kind: 'error'; status: number; message: string; code?: string }
  | { kind: 'auto' }

/** A reply the engine resolved: never `auto`. */
export type ResolvedReply = Exclude<Reply, { kind: 'auto' }>

/** Token counts and cost a rule may pin instead of the computed ones. */
export interface UsageOverride {
  inputTokens?: number
  outputTokens?: number
  /** Dollars as a decimal string; `null` answers the call without any cost. */
  costUsd?: string | null
}

/** One scripted behavior. Rules are tried in order; the first that matches answers. */
export interface Rule {
  id: string
  match: RuleMatch
  reply: Reply
  /** Extra wait before this reply, on top of the settings' latency. */
  latencyMs?: number
  /** How many more requests this rule answers; absent means forever. Reaching 0 removes it. */
  times?: number
  usage?: UsageOverride
}

/** A rule as a caller sends it: the id is assigned when absent. */
export type RuleInput = Omit<Rule, 'id'> & { id?: string }

/** How the `auto` reply picks a tool. */
export type ToolStrategy = 'match' | 'first' | 'none'

/** What the mock does with a model outside its catalog. */
export type UnknownModelPolicy = 'accept' | 'reject'

/** The runtime settings; `PUT /_mock/llm/settings` changes them. */
export interface Settings {
  /** Wait before every answer, in ms. */
  latencyMs: number
  /** Wait between two stream chunks, in ms. */
  streamChunkDelayMs: number
  /** Characters per text chunk of a stream. */
  streamChunkChars: number
  /** A request without `Authorization: Bearer <non-empty>` gets 401. */
  requireAuth: boolean
  unknownModels: UnknownModelPolicy
  toolStrategy: ToolStrategy
  /** The `auto` reply stops calling tools after this many tool rounds since the last user message. */
  maxToolRounds: number
  /** The text the `auto` reply answers with; `{question}`, `{tools}` and `{results}` are filled in. */
  answerTemplate: string
  /** Whether cost is answered at all (`usage.cost` and `provider_metadata.gateway.cost`). */
  reportCost: boolean
}

/** Tokens and cost of one answer. `costUsd` is `null` when no cost is reported. */
export interface Usage {
  inputTokens: number
  outputTokens: number
  costUsd: string | null
}

/** What the engine decided for one request. */
export interface Decision {
  reply: ResolvedReply
  /** The rule that answered; absent when the default (`auto`) answered. */
  ruleId?: string
  /** Total wait before the answer: settings latency + rule latency + `[mock:latency=N]`. */
  latencyMs: number
  usage: Usage
  /** The model id the answer names. */
  model: string
}

/** The ids an answer carries; injected so tests are deterministic. */
export interface AnswerIds {
  /** `chatcmpl-...` */
  id: string
  /** Unix seconds. */
  created: number
  /** Builds the id of the n-th tool call of the answer (`call_...`). */
  callId: (index: number) => string
}

/** One request the mock answered, kept in memory for `/_mock/llm/requests`. The key is never kept. */
export interface LoggedRequest {
  id: string
  at: string
  gateway: Gateway
  model: string
  stream: boolean
  messageCount: number
  toolNames: string[]
  /** The text of the last user message, cut at 500 characters. */
  lastUser: string
  ruleId?: string
  status: number
  replyKind: ResolvedReply['kind']
  /** Names of the tools the answer called. */
  calledTools: string[]
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: string | null
  /** The full request body, kept only when `LLM_LOG_BODIES=1`. */
  body?: ChatRequest
}

/** The engine's view of the mock's state. */
export interface EngineState {
  settings: Settings
  rules: Rule[]
  catalog: CatalogModel[]
}
