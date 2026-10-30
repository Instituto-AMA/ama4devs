import {
  FAILURES,
  MOCK_TOKEN,
  RESULT,
  isKnownRoute,
  returnFor,
  scenarioFor,
  type Failure,
  type ResultInfo,
  type Scenario,
} from './scenarios.ts'

/** How long the slow scenario holds the answer. */
export const SLOW_DELAY_MS = 25_000

const API_VERSION = 'v3'
const ASYNC_FLAG = 'habilitar'
const HISTORY_ROUTE = 'Historico/ObterRetornoConsultaAsync'

export interface Deps {
  now: () => Date
  newId: () => string
  /** Waits for the slow scenario. */
  sleep: (ms: number) => Promise<void>
}

/** One request the mock saw, for tests to read. */
export interface LoggedRequest {
  method: string
  path: string
  status: number
  at: string
}

interface AsyncQuery {
  route: string
  cpf: string
  scenario: Scenario
  reads: number
}

interface MetaInput {
  route: string
  uid: string
  cpf: string
  result: ResultInfo
  message: string
  async: boolean
  startedAt: number
}

export interface App {
  fetch(request: Request): Promise<Response>
}

export function defaultDeps(): Deps {
  return {
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

/** The mock only answers requests: there is no client code in it, so it never calls out. */
export function createApp(deps: Deps = defaultDeps()): App {
  const queries = new Map<string, AsyncQuery>()
  const log: LoggedRequest[] = []

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

  const envelope = (meta: MetaInput, retorno: unknown, extra: Record<string, unknown> = {}) => ({
    metaDados: {
      consultaNome: meta.route,
      consultaUid: meta.uid,
      chave: meta.cpf,
      resultadoId: meta.result.id,
      resultado: meta.result.text,
      mensagem: meta.message,
      apiVersao: API_VERSION,
      assincrono: meta.async,
      data: deps.now().toISOString(),
      tempoExecucaoMs: Math.max(0, deps.now().getTime() - meta.startedAt),
      ...extra,
    },
    retorno,
  })

  const failure = (meta: Omit<MetaInput, 'result' | 'message'>, f: Failure) => {
    const extra = f.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: f.retryAfterSeconds }
    const headers = f.retryAfterSeconds === undefined ? {} : { 'Retry-After': String(f.retryAfterSeconds) }
    return json(f.status, envelope({ ...meta, result: f.result, message: f.message }, null, extra), headers)
  }

  const unauthorized = (route: string, cpf: string) =>
    failure(
      { route, uid: `direct-${deps.newId()}`, cpf, async: false, startedAt: deps.now().getTime() },
      { status: 401, result: RESULT.unauthorized, message: 'IP ou Token inválido. Verifique.' },
    )

  const success = (meta: Omit<MetaInput, 'result' | 'message'>, scenario: Scenario) =>
    json(200, envelope({ ...meta, result: RESULT.success, message: '' }, returnFor(meta.route, meta.cpf, scenario)))

  const readAsync = (url: URL): Response => {
    const uid = url.searchParams.get('ConsultaUid') ?? ''
    const startedAt = deps.now().getTime()
    const query = queries.get(uid)
    const base = { route: HISTORY_ROUTE, uid, cpf: query?.cpf ?? '', async: true, startedAt }
    if (!query) {
      return failure(base, { status: 404, result: RESULT.notFound, message: 'Consulta não encontrada.' })
    }
    query.reads += 1
    const meta = { ...base, route: query.route }
    if (query.scenario === 'neverSettles' || query.reads === 1) {
      return json(202, envelope({ ...meta, result: RESULT.processing, message: '' }, null))
    }
    return success(meta, query.scenario)
  }

  const consult = async (route: string, url: URL): Promise<Response> => {
    const cpf = url.searchParams.get('CPF') ?? ''
    const startedAt = deps.now().getTime()
    const isAsync = url.searchParams.get('Async') === ASYNC_FLAG
    const scenario = scenarioFor(cpf)
    const uid = `direct-${deps.newId()}`
    const meta = { route, uid, cpf, async: isAsync, startedAt }
    const fail = FAILURES[scenario]
    if (fail) return failure(meta, fail)
    // Simulates provider latency: the only path that waits.
    if (scenario === 'slow') await deps.sleep(SLOW_DELAY_MS)
    if (!isAsync) return success(meta, scenario)
    queries.set(uid, { route, cpf, scenario, reads: 0 })
    return json(201, envelope({ ...meta, result: RESULT.processing, message: '' }, null))
  }

  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/health') return json(200, { status: 'ok' })
    if (url.pathname === '/__mock/requests') return json(200, { requests: log })
    if (url.pathname === '/__mock/state') {
      if (request.method !== 'DELETE') return json(200, { asyncQueries: queries.size, requests: log.length })
      queries.clear()
      log.length = 0
      return json(200, { reset: true })
    }
    const name = url.pathname.startsWith('/api/') ? url.pathname.slice('/api/'.length) : ''
    if (request.method !== 'GET' || !(name === HISTORY_ROUTE || isKnownRoute(name))) {
      return json(404, { error: 'not found' })
    }
    if (url.searchParams.get('TOKEN') !== MOCK_TOKEN) return unauthorized(name, url.searchParams.get('CPF') ?? '')
    return name === HISTORY_ROUTE ? readAsync(url) : consult(name, url)
  }

  return {
    async fetch(request) {
      const response = await route(request)
      const url = new URL(request.url)
      if (!url.pathname.startsWith('/__mock/') && url.pathname !== '/health') {
        log.push({ method: request.method, path: url.pathname, status: response.status, at: deps.now().toISOString() })
      }
      return response
    },
  }
}
