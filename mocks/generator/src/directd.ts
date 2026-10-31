import {
  CHARGED_RESULTS,
  DEFAULT_TEST_CPFS,
  DIRECTD_TOKEN,
  FAILURES,
  MESSAGES,
  OUTCOMES,
  RESULT,
  ROUTE_ASYNC_READ,
  ROUTE_BOA_VISTA,
  ROUTE_SCORE,
  SLOW_DELAY_MS,
  UNLISTED_POLICIES,
  answerFor,
  envelope,
  normalizeCpf,
} from './core/credit.js'
import { isValidCpf } from './core/documents.js'

/**
 * The Direct Data routes of the generator: the provider's own paths, the
 * token check, the async consultations, the request log, the counters and the
 * control routes of the test CPFs.
 *
 * Every answer body comes from the core (`src/core/credit.js`): this module
 * adds the server around it and never calls out to anyone.
 */

/** The outcome a test CPF forces; the core names them. */
export type Outcome =
  | 'lowRisk'
  | 'mediumRisk'
  | 'highRisk'
  | 'restrictions'
  | 'deceased'
  | 'irregular'
  | 'warnings'
  | 'badDocument'
  | 'notFound'
  | 'timeout'
  | 'noBalance'
  | 'unauthorized'
  | 'rateLimited'
  | 'unavailable'
  | 'internalError'
  | 'slow'
  | 'neverSettles'

/** What the mock answers a CPF that is not in the test table. */
export type UnlistedPolicy = 'lowRisk' | 'derived' | 'notFound'

/** The state of the token of a request: the state, never the value. */
export type TokenState = 'valid' | 'invalid' | 'missing'

/** A row of the test CPF table. */
interface TestCpfRow {
  cpf: string
  outcome: Outcome
  profile?: any
}

/** A request the mock answered, the way the log keeps it. */
export interface LoggedRequest {
  id: number
  at: string
  method: string
  path: string
  query: Record<string, string>
  route: string
  cpf: string | null
  outcome: Outcome | null
  status: number
  resultado: string | null
  consultaUid: string | null
  async: boolean
  charged: boolean
  durationMs: number
  response: unknown
}

/** A consultation that runs in the background, waiting for the reads. */
export interface AsyncQuery {
  uid: string
  route: string
  cpf: string
  outcome: Outcome
  createdAt: string
  reads: number
  released: boolean
  charged: boolean
  final: { status: number; body: unknown }
}

/** The counters of the charge rule: what was charged and what was not. */
export interface Counters {
  charged: { total: number; byRoute: Record<string, number> }
  notCharged: { total: number; byStatus: Record<string, number> }
}

/** The answer of a route, before it is logged. */
interface Answer {
  status: number
  body: unknown
  headers: Record<string, string>
  route: string
  outcome: Outcome | null
  resultado: string | null
  consultaUid: string | null
  async: boolean
  chargeRoute: string
}

/** How many requests the log keeps. */
const LOG_LIMIT = 500

/**
 * The Direct Data server: the provider's routes and the control routes of the
 * test CPFs.
 * @param deps The outside world: the clock, the ids and the wait.
 * @param options The policy of the CPFs that are not in the test table.
 */
export function createDirectd(
  deps: { now: () => Date; newId: () => string; sleep: (ms: number) => Promise<void> },
  options: { unlisted: UnlistedPolicy },
): {
  api(request: Request, url: URL, clientIp?: string): Promise<Response>
  control(request: Request, url: URL): Promise<Response>
} {
  const { now, newId, sleep } = deps
  const envUnlisted = options.unlisted

  let unlisted: UnlistedPolicy = envUnlisted
  let testCpfs: TestCpfRow[] = DEFAULT_TEST_CPFS.map((row) => ({ ...row }))

  /** The log, newest first. */
  const requests: LoggedRequest[] = []
  /** The consultations waiting for their reads. */
  const queries = new Map<string, AsyncQuery>()
  /** The consultations already charged: a consultation is charged once. */
  const chargedUids = new Set<string>()
  const counters: Counters = {
    charged: { total: 0, byRoute: {} },
    notCharged: { total: 0, byStatus: {} },
  }
  let sequence = 0

  /**
   * The provider's routes: the Hub calls them from another container, so they
   * carry no local guard and no CORS header.
   * @param request The request to answer.
   * @param url The URL of the request.
   * @param clientIp The address of the caller.
   */
  async function api(request: Request, url: URL, clientIp?: string): Promise<Response> {
    const startedAt = now()
    const route = routeOf(url.pathname)
    const params = url.searchParams
    const tokenState = tokenStateOf(params)
    const ip = ipOf(request, clientIp)
    const cpf = normalizeCpf(paramOf(params, 'CPF') ?? '')

    let answer: Answer

    if (request.method !== 'GET' || route === null) {
      answer = {
        status: 404,
        body: { error: { code: 'not_found', message: 'Route not found.' } },
        headers: {},
        route: route ?? url.pathname.replace(/^\/api\//, ''),
        outcome: null,
        resultado: null,
        consultaUid: null,
        async: false,
        chargeRoute: route ?? '',
      }
    } else if (tokenState !== 'valid') {
      answer = unauthorizedAnswer(route, ip, startedAt)
    } else if (route === ROUTE_ASYNC_READ) {
      answer = readAnswer(route, params, ip, startedAt)
    } else {
      answer = await consultAnswer(route, params, ip, startedAt, cpf)
    }

    const charged = countAnswer(answer)
    const entry = entryOf(request, url, answer, charged, tokenState, cpf, startedAt)
    entry.id = ++sequence
    entry.durationMs = Math.max(0, now().getTime() - startedAt.getTime())

    requests.unshift(entry)
    if (requests.length > LOG_LIMIT) requests.pop()

    return respond(answer)
  }

  /**
   * The control routes: the state of the mock, the log and the test CPFs.
   * They carry no key and stay bound to this machine.
   * @param request The request to answer.
   * @param url The URL of the request.
   */
  async function control(request: Request, url: URL): Promise<Response> {
    const path = url.pathname
      .replace(/^\/_mock\/directd/, '')
      .replace(/^\//, '')
      .replace(/\/$/, '')
    const method = request.method

    if (method === 'GET' && path === 'state') {
      return json({
        token: DIRECTD_TOKEN,
        unlisted,
        counters,
        asyncQueries: [...queries.values()].reverse(),
        requests: requests.length,
      })
    }

    if (method === 'GET' && path === 'requests') {
      return json({ requests })
    }

    if (method === 'GET' && path === 'test-cpfs') {
      return json({ unlisted, policies: UNLISTED_POLICIES, outcomes: OUTCOMES, testCpfs })
    }

    if (method === 'POST' && path === 'test-cpfs') {
      const body = await bodyOf(request)
      if (body instanceof Response) return body

      const outcome = String(body.outcome ?? '')
      if (!OUTCOMES.some((entry) => entry.id === outcome)) {
        return json(
          { error: { code: 'invalid_outcome', message: `Unknown outcome: ${outcome}.` } },
          400,
        )
      }

      const cpf = normalizeCpf(body.cpf ?? '')
      if (cpf.length !== 11) {
        return json(
          { error: { code: 'invalid_cpf', message: 'The CPF must have 11 digits.' } },
          400,
        )
      }

      if (outcome !== 'badDocument' && !isValidCpf(cpf)) {
        return json(
          {
            error: {
              code: 'invalid_cpf',
              message: 'The check digits of the CPF do not match.',
            },
          },
          400,
        )
      }

      const row: TestCpfRow = { cpf, outcome: outcome as Outcome }
      if (body.profile && typeof body.profile === 'object') row.profile = body.profile

      const index = testCpfs.findIndex((entry) => entry.cpf === cpf)
      if (index >= 0) testCpfs[index] = row
      else testCpfs.push(row)

      return json(row, 201)
    }

    if (method === 'PUT' && path === 'test-cpfs/policy') {
      const body = await bodyOf(request)
      if (body instanceof Response) return body

      const value = String(body.unlisted ?? '')
      if (!UNLISTED_POLICIES.some((policy) => policy === value)) {
        return json(
          { error: { code: 'invalid_policy', message: `Unknown policy: ${value}.` } },
          400,
        )
      }

      unlisted = value as UnlistedPolicy
      return json({ unlisted })
    }

    if (method === 'DELETE' && path === 'test-cpfs') {
      testCpfs = DEFAULT_TEST_CPFS.map((row) => ({ ...row }))
      unlisted = envUnlisted
      return json({ restored: true })
    }

    if (method === 'DELETE' && path.startsWith('test-cpfs/')) {
      const cpf = normalizeCpf(decodeURIComponent(path.slice('test-cpfs/'.length)))
      const index = testCpfs.findIndex((entry) => entry.cpf === cpf)
      if (index < 0) {
        return json({ error: { code: 'not_found', message: `No test CPF: ${cpf}.` } }, 404)
      }

      testCpfs.splice(index, 1)
      return json({ removed: cpf })
    }

    const release = /^queries\/([^/]+)\/release$/.exec(path)
    if (method === 'POST' && release) {
      const uid = decodeURIComponent(release[1]!)
      const query = queries.get(uid)
      if (!query) {
        return json({ error: { code: 'not_found', message: `No query: ${uid}.` } }, 404)
      }

      query.released = true
      return json({ released: uid })
    }

    if (method === 'DELETE' && path === 'state') {
      requests.length = 0
      queries.clear()
      chargedUids.clear()
      counters.charged.total = 0
      counters.charged.byRoute = {}
      counters.notCharged.total = 0
      counters.notCharged.byStatus = {}
      return json({ reset: true })
    }

    return json({ error: { code: 'not_found', message: 'Route not found.' } }, 404)
  }

  /**
   * A consultation: the core answers what the CPF is worth, the server adds
   * the wait, the async query and the counters.
   * @param route The route of the consultation.
   * @param params The query string.
   * @param ip The address of the caller.
   * @param startedAt When the request came in.
   * @param cpf The digits of the CPF.
   */
  async function consultAnswer(
    route: string,
    params: URLSearchParams,
    ip: string,
    startedAt: Date,
    cpf: string,
  ): Promise<Answer> {
    const uid = newId()
    const core = answerFor(route, consultParams(params), {
      testCpfs,
      unlisted,
      now: now(),
      uid,
      ip,
      startedAt,
    })

    const body = core.body
    const meta = metaOf(body)
    const resultado = meta ? (meta.resultado ?? null) : null
    const consultaUid = meta ? (meta.consultaUid ?? null) : null
    const outcome = (core.outcome ?? null) as Outcome | null

    // The slow CPF is the only wait of the mock.
    if (outcome === 'slow') {
      await sleep(SLOW_DELAY_MS)
    }

    const wantsAsync = flagOf(params, 'Async') === 'habilitar'

    if (wantsAsync && core.status === 200 && consultaUid) {
      queries.set(consultaUid, {
        uid: consultaUid,
        route,
        cpf,
        outcome: outcome ?? 'lowRisk',
        createdAt: now().toISOString(),
        reads: 0,
        released: false,
        charged: false,
        final: { status: core.status, body: withAssincrono(body) },
      })

      const created = withConsultaUid(
        envelope(
          {
            route,
            uid,
            cpf: cpf || null,
            result: RESULT.success,
            message: MESSAGES.asyncCreated,
            ip,
            async: true,
            callback: flagOf(params, 'Callback') === 'habilitar',
            receipt: flagOf(params, 'GERARCOMPROVANTE') === 'habilitar',
            now: now(),
            startedAt,
          },
          null,
        ),
        consultaUid,
      )

      return {
        status: 201,
        body: created,
        headers: {},
        route,
        outcome,
        resultado: RESULT.success.text,
        consultaUid,
        async: true,
        chargeRoute: route,
      }
    }

    return {
      status: core.status,
      body,
      headers: core.headers ?? {},
      route,
      outcome,
      resultado,
      consultaUid,
      async: wantsAsync,
      chargeRoute: route,
    }
  }

  /**
   * The read of an async consultation: 202 while it runs, 200 when it is over.
   * @param route The route of the read.
   * @param params The query string.
   * @param ip The address of the caller.
   * @param startedAt When the request came in.
   */
  function readAnswer(
    route: string,
    params: URLSearchParams,
    ip: string,
    startedAt: Date,
  ): Answer {
    const requested = paramOf(params, 'ConsultaUid') ?? ''
    const query = queries.get(requested)

    if (!query) {
      const failure = FAILURES.notFound
      const body = withConsultaUid(
        envelope(
          {
            route,
            uid: requested || null,
            cpf: null,
            result: failure.result,
            message: failure.message,
            ip,
            async: false,
            callback: false,
            receipt: false,
            now: now(),
            startedAt,
          },
          null,
        ),
        requested || null,
      )

      return {
        status: failure.status,
        body,
        headers: {},
        route,
        outcome: 'notFound',
        resultado: metaOf(body)?.resultado ?? null,
        consultaUid: requested || null,
        async: true,
        chargeRoute: route,
      }
    }

    query.reads += 1
    const ready = query.outcome === 'neverSettles' ? query.released : query.reads > 1

    if (!ready) {
      const body = withConsultaUid(
        envelope(
          {
            route: query.route,
            uid: query.uid,
            cpf: query.cpf || null,
            result: RESULT.processing,
            message: MESSAGES.processing,
            ip,
            async: true,
            callback: false,
            receipt: false,
            now: now(),
            startedAt,
          },
          null,
        ),
        query.uid,
      )

      return {
        status: 202,
        body,
        headers: {},
        route,
        outcome: query.outcome,
        resultado: RESULT.processing.text,
        consultaUid: query.uid,
        async: true,
        chargeRoute: query.route,
      }
    }

    const body = query.final.body
    const meta = metaOf(body)
    const resultado = meta?.resultado ?? null

    // The consultation is charged when it answers, once.
    if (resultado !== null && CHARGED_RESULTS.some((value) => value === resultado)) {
      query.charged = true
    }

    return {
      status: query.final.status,
      body,
      headers: {},
      route,
      outcome: query.outcome,
      resultado,
      consultaUid: meta?.consultaUid ?? query.uid,
      async: true,
      chargeRoute: query.route,
    }
  }

  /**
   * The refusal of a token that is missing or wrong.
   * @param route The route of the request.
   * @param ip The address of the caller.
   * @param startedAt When the request came in.
   */
  function unauthorizedAnswer(route: string, ip: string, startedAt: Date): Answer {
    const failure = FAILURES.unauthorized
    const body = envelope(
      {
        route,
        uid: null,
        cpf: null,
        result: failure.result,
        message: failure.message,
        ip,
        async: false,
        callback: false,
        receipt: false,
        now: now(),
        startedAt,
      },
      null,
    )

    return {
      status: failure.status,
      body,
      headers: {},
      route,
      outcome: 'unauthorized',
      resultado: metaOf(body)?.resultado ?? null,
      consultaUid: null,
      async: false,
      chargeRoute: route,
    }
  }

  /**
   * The counters: a consultation is charged once, when it answers 200 with a
   * charged result. Everything else is a request that was not charged.
   * @param answer The answer of the request.
   * @return Whether the answer was the charge of its consultation.
   */
  function countAnswer(answer: Answer): boolean {
    const resultado = answer.resultado
    const chargeable =
      answer.status === 200 &&
      resultado !== null &&
      CHARGED_RESULTS.some((value) => value === resultado)

    if (chargeable && answer.consultaUid && !chargedUids.has(answer.consultaUid)) {
      chargedUids.add(answer.consultaUid)
      counters.charged.total += 1
      const route = answer.chargeRoute
      counters.charged.byRoute[route] = (counters.charged.byRoute[route] ?? 0) + 1
      return true
    }

    counters.notCharged.total += 1
    const status = String(answer.status)
    counters.notCharged.byStatus[status] = (counters.notCharged.byStatus[status] ?? 0) + 1
    return false
  }

  return { api, control }
}

/**
 * The route a path names, or null when the path is not one of them.
 * @param pathname The path of the request.
 */
function routeOf(pathname: string): string | null {
  if (!pathname.startsWith('/api/')) return null

  const name = pathname.slice('/api/'.length)
  if (name === ROUTE_SCORE || name === ROUTE_BOA_VISTA || name === ROUTE_ASYNC_READ) return name
  return null
}

/**
 * The state of the token of a request: the state, never the value.
 * @param params The query string.
 */
function tokenStateOf(params: URLSearchParams): TokenState {
  const token = paramOf(params, 'TOKEN')
  if (token === undefined) return 'missing'
  return token === DIRECTD_TOKEN ? 'valid' : 'invalid'
}

/**
 * The address of the caller: the one of the server, the one the proxy sends
 * or the loopback.
 * @param request The request.
 * @param clientIp The address the server saw.
 */
function ipOf(request: Request, clientIp?: string): string {
  if (clientIp) return clientIp

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return '127.0.0.1'
}

/**
 * A parameter of the query string, by name, whatever its case.
 * @param params The query string.
 * @param name The name of the parameter.
 */
function paramOf(params: URLSearchParams, name: string): string | undefined {
  for (const [key, value] of params) {
    if (key.toLowerCase() === name.toLowerCase()) return value
  }
  return undefined
}

/**
 * The value of a flag, in lower case: the flags are case insensitive.
 * @param params The query string.
 * @param name The name of the flag.
 */
function flagOf(params: URLSearchParams, name: string): string | undefined {
  const value = paramOf(params, name)
  return value === undefined ? undefined : value.trim().toLowerCase()
}

/**
 * The parameters the core reads: everything the caller sent, the token
 * excepted.
 * @param params The query string.
 */
function consultParams(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of params) {
    if (key.toUpperCase() === 'TOKEN') continue
    result[key] = value
  }
  return result
}

/**
 * The `metaDados` of an answer, when it has one.
 * @param body The body of the answer.
 */
function metaOf(body: unknown): Record<string, any> | null {
  if (!body || typeof body !== 'object') return null

  const meta = (body as Record<string, any>).metaDados
  if (!meta || typeof meta !== 'object') return null
  return meta as Record<string, any>
}

/**
 * The body of an answer that says it ran in the background.
 * @param body The body of the answer.
 */
function withAssincrono(body: unknown): unknown {
  const meta = metaOf(body)
  if (!meta) return body

  return { ...(body as Record<string, any>), metaDados: { ...meta, assincrono: true } }
}

/**
 * The body of an answer that carries the id of its consultation. The id of the
 * consultation the core answered is the truth: the envelope only repeats it.
 * @param body The body of the answer.
 * @param uid The id of the consultation.
 */
function withConsultaUid(body: unknown, uid: string | null): unknown {
  const meta = metaOf(body)
  if (!meta) return body

  return { ...(body as Record<string, any>), metaDados: { ...meta, consultaUid: uid } }
}

/**
 * The row of the log of a request.
 * @param request The request.
 * @param url The URL of the request.
 * @param answer The answer of the request.
 * @param charged Whether the answer was the charge of its consultation.
 * @param tokenState The state of the token of the request.
 * @param cpf The digits of the CPF of the request.
 * @param startedAt When the request came in.
 */
function entryOf(
  request: Request,
  url: URL,
  answer: Answer,
  charged: boolean,
  tokenState: TokenState,
  cpf: string,
  startedAt: Date,
): LoggedRequest {
  return {
    id: 0,
    at: startedAt.toISOString(),
    method: request.method,
    path: url.pathname,
    query: loggedQuery(url.searchParams, tokenState),
    route: answer.route,
    cpf: cpf || null,
    outcome: answer.outcome,
    status: answer.status,
    resultado: answer.resultado,
    consultaUid: answer.consultaUid,
    async: answer.async,
    charged,
    durationMs: 0,
    response: answer.body,
  }
}

/**
 * The query string of the log: every parameter, the token as its state.
 * @param params The query string.
 * @param tokenState The state of the token.
 */
function loggedQuery(params: URLSearchParams, tokenState: TokenState): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of params) {
    query[key] = key.toUpperCase() === 'TOKEN' ? tokenState : value
  }
  return query
}

/**
 * The answer of a route, as JSON.
 * @param answer The answer.
 */
function respond(answer: Answer): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    ...answer.headers,
  }

  return new Response(JSON.stringify(answer.body, null, 2), { status: answer.status, headers })
}

/**
 * A JSON answer of the control routes.
 * @param payload The body of the answer.
 * @param status The status of the answer.
 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * The body of a request of the control routes.
 * @param request The request.
 */
async function bodyOf(request: Request): Promise<Record<string, any> | Response> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object') throw new Error('the body is not an object')
    return value as Record<string, any>
  } catch {
    return json(
      { error: { code: 'invalid_body', message: 'The request body must be valid JSON.' } },
      400,
    )
  }
}
