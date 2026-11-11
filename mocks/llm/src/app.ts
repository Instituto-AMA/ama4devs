/**
 * The application of the LLM mock: the guard, the CORS, the routes of the two
 * gateways, the control routes and the static files of the panel.
 */
import { findModel, openRouterModels, vercelModels } from './catalog.ts'
import type { Config } from './config.ts'
import { completionBody, decide, errorBody, lastUserText, streamChunks } from './engine.ts'
import { json, noContent, readJsonBody } from './http.ts'
import { guardLocal } from './local-guard.ts'
import { createStore, type Store } from './store.ts'
import type {
  AnswerIds,
  CatalogModel,
  ChatMessage,
  ChatRequest,
  Gateway,
  LoggedRequest,
} from './types.ts'

/**
 * The parts of the outside world the server talks to. The tests replace them
 * with fakes, so the whole API can be exercised without a network and without
 * waiting for a timer.
 */
export interface AppDeps {
  now?: () => Date
  newId?: () => string
  wait?: (ms: number) => Promise<void>
  log?: (line: string) => void
}

/** The application: the fetch handler the server (and the tests) can call. */
export interface App {
  /** Answers a request. */
  fetch(request: Request): Promise<Response>
  /** The state of the mock: the settings, the rules, the catalog and the log. */
  store: Store
}

/** The files of the public directory: `/app.js`, `/style.css`, `/favicon.svg`. */
const STATIC_FILE = /^\/([a-z0-9-]+)\.(js|css|svg|html)$/

/** The content type each kind of static file is served with. */
const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
}

/** The methods a preflight asks for. */
const ALLOWED_METHODS = 'GET,POST,PUT,DELETE,OPTIONS'

/** The headers a preflight asks for when it names none. */
const DEFAULT_ALLOWED_HEADERS = 'authorization,content-type'

/** How long a browser may keep the answer of a preflight. */
const PREFLIGHT_MAX_AGE = '600'

/** The biggest number of requests the log route answers. */
const MAX_REQUEST_LIMIT = 1000

/** The number of requests the log route answers when the caller names none. */
const DEFAULT_REQUEST_LIMIT = 50

/** The keys that always fail, whatever the settings say. */
const MAGIC_KEYS: Record<string, { status: number; message: string; code: string }> = {
  'mock-invalid-key': { status: 401, message: 'invalid api key', code: 'invalid_api_key' },
  'mock-no-credit': { status: 402, message: 'insufficient credits', code: 'insufficient_credits' },
  'mock-rate-limited': {
    status: 429,
    message: 'rate limit exceeded',
    code: 'rate_limit_exceeded',
  },
  'mock-down': { status: 503, message: 'service unavailable', code: 'service_unavailable' },
}

/**
 * The application of the mock: the store and the handler that ties it to the
 * routes.
 * @param config The configuration of the server.
 * @param deps The outside world: the clock, the ids, the waits and the log.
 */
export function createApp(config: Config, deps: AppDeps = {}): App {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? (() => crypto.randomUUID().replace(/-/g, '').slice(0, 24))
  const wait = deps.wait ?? ((ms: number) => Bun.sleep(ms))
  const logLine = deps.log ?? ((line: string) => console.log(line))

  const store = createStore(config, { now, newId })

  /** The state the panel reads. */
  const state = (): Record<string, unknown> => ({
    settings: store.settings(),
    rules: store.rules(),
    catalog: store.catalog(),
    requestCount: store.requestCount(),
    version: config.version,
    bootErrors: config.bootErrors,
  })

  /** Keeps a request in the log of the mock. */
  const logRequest = (entry: Omit<LoggedRequest, 'id' | 'at'>): void => {
    store.log(entry)
  }

  /**
   * The control routes of the mock: the state, the settings, the rules, the
   * catalog, the log of the requests and the reset.
   * @param request The request to answer.
   * @param url The URL of the request.
   */
  const controlRoutes = async (request: Request, url: URL): Promise<Response | null> => {
    const pathname = url.pathname
    const method = request.method

    if (pathname === '/_mock/llm/state' && method === 'GET') return json(state())

    if (pathname === '/_mock/llm/settings') {
      if (method === 'GET') return json(store.settings())
      if (method === 'PUT') {
        const body = await readJsonBody(request)
        if (body.status !== 'ok') return json({ errors: ['body must be a JSON object'] }, 400)
        const errors = store.updateSettings(body.value)
        if (errors.length) return json({ errors }, 400)
        return json(store.settings())
      }
    }

    if (pathname === '/_mock/llm/rules') {
      if (method === 'GET') return json(store.rules())
      if (method === 'POST') {
        const body = await readJsonBody(request)
        if (body.status !== 'ok') return json({ errors: ['body must be a JSON object'] }, 400)
        const position = url.searchParams.get('position') === 'first' ? 'first' : 'last'
        const result = store.addRules(body.value, position)
        if (result.errors.length) return json({ errors: result.errors }, 400)
        return json({ rules: result.rules }, 201)
      }
      if (method === 'DELETE') {
        store.clearRules()
        return noContent()
      }
    }

    if (pathname.startsWith('/_mock/llm/rules/') && method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/_mock/llm/rules/'.length))
      if (!store.removeRule(id)) return json(errorBody(404, 'not found', 'not_found'), 404)
      return noContent()
    }

    if (pathname === '/_mock/llm/catalog') {
      if (method === 'GET') return json(store.catalog())
      if (method === 'PUT') {
        const body = await readJsonBody(request)
        if (body.status !== 'ok') return json({ errors: ['body must be an JSON array'] }, 400)
        const errors = store.replaceCatalog(body.value)
        if (errors.length) return json({ errors }, 400)
        return json(store.catalog())
      }
      if (method === 'POST') {
        const body = await readJsonBody(request)
        if (body.status !== 'ok') return json({ errors: ['body must be a JSON object'] }, 400)
        const errors = store.upsertModel(body.value)
        if (errors.length) return json({ errors }, 400)
        return json(store.catalog())
      }
    }

    if (pathname.startsWith('/_mock/llm/catalog/') && method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/_mock/llm/catalog/'.length))
      if (!store.removeModel(id)) return json(errorBody(404, 'not found', 'not_found'), 404)
      return noContent()
    }

    if (pathname === '/_mock/llm/requests') {
      if (method === 'GET') {
        return json(store.requests(limitOf(url.searchParams.get('limit'))))
      }
      if (method === 'DELETE') {
        store.clearRequests()
        return noContent()
      }
    }

    if (pathname.startsWith('/_mock/llm/requests/') && method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/_mock/llm/requests/'.length))
      const entry = store.request(id)
      if (!entry) return json(errorBody(404, 'not found', 'not_found'), 404)
      return json(entry)
    }

    if (pathname === '/_mock/llm/reset' && method === 'POST') {
      store.reset()
      return json(state())
    }

    return null
  }

  /**
   * The answer of a chat completion: the checks, the decision of the engine
   * and the body of the answer.
   * @param request The request to answer.
   * @param gateway The gateway the request came in through.
   */
  const chatCompletions = async (request: Request, gateway: Gateway): Promise<Response> => {
    let model = ''
    let messages: unknown[] = []
    let tools: string[] = []

    /**
     * The refusal of a request that never reached the engine.
     * @param why The reason, as the OpenAI error reads it.
     * @param status The HTTP status.
     */
    const refuse = (why: string, status = 400): Response => {
      logRequest({
        gateway,
        model,
        stream: false,
        messageCount: messages.length,
        toolNames: tools,
        lastUser: '',
        status,
        replyKind: 'error',
        calledTools: [],
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
      })
      return json(errorBody(status, why, 'invalid_request_error'), status)
    }

    const body = await readJsonBody(request)
    if (body.status === 'too-large') {
      return refuse('invalid request: body too large', 413)
    }
    if (body.status === 'invalid') {
      return refuse('invalid request: body must be a JSON object')
    }

    const value = body.value
    if (!isPlainObject(value)) {
      return refuse('invalid request: body must be a JSON object')
    }

    if (typeof value.model !== 'string' || value.model.trim() === '') {
      return refuse('invalid request: model must be a string')
    }
    model = value.model

    const rawMessages = value.messages
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return refuse('invalid request: messages must be a non-empty array')
    }
    for (const message of rawMessages) {
      if (!isPlainObject(message) || typeof message.role !== 'string') {
        return refuse('invalid request: messages must be a list of messages')
      }
    }
    messages = rawMessages

    const req = value as unknown as ChatRequest
    tools = (req.tools ?? [])
      .map((tool) => tool?.function?.name)
      .filter((name): name is string => typeof name === 'string')

    const settings = store.settings()

    // The magic keys always fail, whatever the settings say.
    const token = bearerOf(request.headers.get('authorization'))
    const magic = MAGIC_KEYS[token]
    if (magic) {
      const headers: Record<string, string> = magic.status === 429 ? { 'retry-after': '1' } : {}
      logRequest({
        gateway,
        model,
        stream: Boolean(req.stream),
        messageCount: messages.length,
        toolNames: tools,
        lastUser: lastUserText(messages as ChatMessage[]).slice(0, 500),
        status: magic.status,
        replyKind: 'error',
        calledTools: [],
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        ...(config.logBodies ? { body: req } : {}),
      })
      return json(errorBody(magic.status, magic.message, magic.code), magic.status, headers)
    }

    if (!token && settings.requireAuth) {
      logRequest({
        gateway,
        model,
        stream: Boolean(req.stream),
        messageCount: messages.length,
        toolNames: tools,
        lastUser: lastUserText(messages as ChatMessage[]).slice(0, 500),
        status: 401,
        replyKind: 'error',
        calledTools: [],
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        ...(config.logBodies ? { body: req } : {}),
      })
      return json(errorBody(401, 'missing api key', 'invalid_api_key'), 401)
    }

    if (settings.unknownModels === 'reject' && !findModel(store.catalog(), model)) {
      logRequest({
        gateway,
        model,
        stream: Boolean(req.stream),
        messageCount: messages.length,
        toolNames: tools,
        lastUser: lastUserText(messages as ChatMessage[]).slice(0, 500),
        status: 404,
        replyKind: 'error',
        calledTools: [],
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        ...(config.logBodies ? { body: req } : {}),
      })
      return json(errorBody(404, `model not found: ${model}`, 'model_not_found'), 404)
    }

    const decision = decide(req, gateway, store.engineState(), now())
    store.consume(decision.ruleId)
    await wait(decision.latencyMs)

    const calledTools = decision.reply.kind === 'tool_calls' ? decision.reply.calls.map((call) => call.name) : []
    const entry: Omit<LoggedRequest, 'id' | 'at'> = {
      gateway,
      model: decision.model || model,
      stream: Boolean(req.stream),
      messageCount: messages.length,
      toolNames: tools,
      lastUser: lastUserText(messages as ChatMessage[]).slice(0, 500),
      ruleId: decision.ruleId,
      status: 200,
      replyKind: decision.reply.kind,
      calledTools,
      latencyMs: decision.latencyMs,
      inputTokens: decision.usage.inputTokens,
      outputTokens: decision.usage.outputTokens,
      costUsd: decision.usage.costUsd,
      ...(config.logBodies ? { body: req } : {}),
    }

    if (decision.reply.kind === 'error') {
      const status = decision.reply.status
      const headers: Record<string, string> = status === 429 ? { 'retry-after': '1' } : {}
      logRequest({ ...entry, status, replyKind: 'error' })
      return json(errorBody(status, decision.reply.message, decision.reply.code), status, headers)
    }

    const ids = answerIds(newId, now())

    if (req.stream) {
      const chunks = streamChunks(req, gateway, decision, ids, settings.streamChunkChars)
      const delay = settings.streamChunkDelayMs
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let index = 0; index < chunks.length; index++) {
            if (index > 0) await wait(delay)
            const chunk = chunks[index]
            if (!chunk) continue
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      logRequest(entry)
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
      })
    }

    logRequest(entry)
    return json(completionBody(req, gateway, decision, ids))
  }

  /**
   * Answers a request: the health check, the guard, the CORS, the routes and,
   * at the end, the static files of the panel.
   * @param request The request to answer.
   */
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const pathname = url.pathname
    const method = request.method

    if (pathname === '/health' && method === 'GET') {
      return json({ status: 'ok', service: 'llm-mock', version: config.version })
    }

    const control = pathname.startsWith('/_mock/')
    const local = control || pathname === '/' || STATIC_FILE.test(pathname)

    // The panel and the control routes carry no key: they belong to this machine.
    if (local) {
      const refusal = guardLocal(request, config.allowedHosts)
      if (refusal) return refusal
    }

    const origin = request.headers.get('origin')
    const allowedOrigin =
      origin !== null && isAllowedOrigin(origin, config.allowedHosts) ? origin : null

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: preflightHeaders(request, allowedOrigin) })
    }

    /**
     * A response with the CORS headers of the allowed origin.
     * @param response The response to answer with.
     */
    const withCors = (response: Response): Response => {
      if (control || allowedOrigin === null) return response
      return withCorsHeaders(response, allowedOrigin)
    }

    if (control) {
      const response = await controlRoutes(request, url)
      return response ?? json(errorBody(404, 'not found', 'not_found'), 404)
    }

    if (method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
      return withCors(json(vercelModels(store.catalog())))
    }

    if (method === 'GET' && pathname === '/api/v1/models') {
      return withCors(json(openRouterModels(store.catalog())))
    }

    if (method === 'GET' && pathname.startsWith('/v1/models/')) {
      const id = decodeURIComponent(pathname.slice('/v1/models/'.length))
      const item = findVercelModel(store.catalog(), id)
      if (!item) {
        return withCors(json(errorBody(404, `model not found: ${id}`, 'model_not_found'), 404))
      }
      return withCors(json(item))
    }

    if (
      method === 'POST' &&
      (pathname === '/v1/chat/completions' ||
        pathname === '/chat/completions' ||
        pathname === '/api/v1/chat/completions')
    ) {
      const gateway: Gateway = pathname.startsWith('/api/') ? 'openrouter' : 'vercel'
      return withCors(await chatCompletions(request, gateway))
    }

    if (method === 'GET' || method === 'HEAD') {
      const file = await staticFile(config, pathname)
      if (file) return withCors(file)
    }

    return withCors(json(errorBody(404, 'not found', 'not_found'), 404))
  }

  /**
   * Answers a request and tells the log what happened.
   * @param request The request to answer.
   */
  const fetchHandler = async (request: Request): Promise<Response> => {
    const response = await handle(request)
    logLine(`llm: ${request.method} ${new URL(request.url).pathname} ${response.status}`)
    return response
  }

  return { fetch: fetchHandler, store }
}

/**
 * The token of an `Authorization: Bearer <token>` header.
 * @param authorization The raw header.
 */
function bearerOf(authorization: string | null): string {
  if (!authorization) return ''
  const match = /^Bearer\s+(.*)$/i.exec(authorization.trim())
  return match?.[1]?.trim() ?? ''
}

/**
 * The ids an answer carries.
 * @param newId How a new id is made.
 * @param now The moment of the answer.
 */
function answerIds(newId: () => string, now: Date): AnswerIds {
  return {
    id: `chatcmpl-${hex24(newId())}`,
    created: Math.floor(now.getTime() / 1000),
    callId: () => `call_${hex24(newId())}`,
  }
}

/**
 * Twenty-four hexadecimal characters of an id, so the answers look like the
 * ones of the real gateways.
 * @param raw The raw id.
 */
function hex24(raw: string): string {
  const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, '')
  if (hex.length >= 24) return hex.slice(0, 24)
  return hex.padStart(24, '0')
}

/**
 * The model of the catalog in the item shape of the Vercel gateway.
 * @param catalog The models of the mock.
 * @param id The id of the model.
 */
function findVercelModel(
  catalog: CatalogModel[],
  id: string,
): Record<string, unknown> | undefined {
  const listed = vercelModels(catalog)
  const data = listed.data
  const items = Array.isArray(data)
    ? data
    : Object.values(listed).filter(
        (value): value is Record<string, unknown> =>
          typeof value === 'object' && value !== null && !Array.isArray(value),
      )
  return items.find((item) => item.id === id)
}

/**
 * The number of requests the log route answers.
 * @param raw The raw limit of the query.
 */
function limitOf(raw: string | null): number {
  const limit = Number(raw)
  if (raw === null || raw.trim() === '' || !Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_REQUEST_LIMIT
  }
  return Math.min(limit, MAX_REQUEST_LIMIT)
}

/**
 * Whether the origin of a request is one the server answers to.
 * @param origin The raw Origin header.
 * @param allowedHosts The hostnames the server answers to.
 */
function isAllowedOrigin(origin: string, allowedHosts: string[]): boolean {
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }

  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1)
  const name = hostname.toLowerCase()
  return allowedHosts.some((host) => host.toLowerCase() === name)
}

/**
 * The headers of the answer of a preflight.
 * @param request The request to read.
 * @param origin The origin the answer is for, when it is allowed.
 */
function preflightHeaders(request: Request, origin: string | null): Record<string, string> {
  const requested = request.headers.get('access-control-request-headers')
  return {
    ...(origin === null ? {} : { 'access-control-allow-origin': origin, vary: 'Origin' }),
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-allow-headers':
      requested !== null && requested.trim() !== '' ? requested : DEFAULT_ALLOWED_HEADERS,
    'access-control-max-age': PREFLIGHT_MAX_AGE,
  }
}

/**
 * A response with the CORS headers of an allowed origin.
 * @param response The response to answer with.
 * @param origin The origin the answer is for.
 */
function withCorsHeaders(response: Response, origin: string): Response {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * The file of the public directory the path names, and null when the path
 * names no file or the file is not there.
 * @param config The configuration of the server.
 * @param pathname The path of the request.
 */
async function staticFile(config: Config, pathname: string): Promise<Response | null> {
  if (pathname === '/') {
    return serveFile(config.publicDir, 'index.html', CONTENT_TYPES.html ?? 'text/html; charset=utf-8')
  }

  const match = STATIC_FILE.exec(pathname)
  if (!match) return null
  const name = match[1]
  const extension = match[2]
  if (!name || !extension) return null
  return serveFile(config.publicDir, `${name}.${extension}`, CONTENT_TYPES[extension] ?? 'application/octet-stream')
}

/**
 * A file of the public directory, served with its type; null when the file is
 * not there.
 * @param dir The directory the file lives in.
 * @param name The name of the file.
 * @param type The content type it is served with.
 */
async function serveFile(dir: string, name: string, type: string): Promise<Response | null> {
  const file = Bun.file(`${dir.replace(/\/+$/, '')}/${name}`)
  if (!(await file.exists())) return null

  return new Response(file, {
    headers: { 'content-type': type, 'cache-control': 'no-cache' },
  })
}

/**
 * Whether a value is a plain object.
 * @param value The value to check.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
