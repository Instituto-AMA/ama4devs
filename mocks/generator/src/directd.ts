import {
  CHARGED_RESULTS,
  DEFAULT_TEST_CPFS,
  DIRECTD_TOKEN,
  FAILURES,
  OUTCOMES,
  ROUTE_ASYNC_READ,
  ROUTE_BOA_VISTA,
  ROUTE_SCORE,
  SLOW_DELAY_MS,
  UNLISTED_POLICIES,
  answerFor,
  asyncCreated,
  asyncProcessing,
  asyncSettled,
  consultParams,
  envelope,
  normalizeCpf,
  resolveCpf,
} from './core/credit.js'
import type { Outcome, TestCpf, UnlistedPolicy } from './core/credit.js'
import { isValidCpf } from './core/documents.js'

export type { Outcome, UnlistedPolicy }

/**
 * The Direct Data routes of the generator: the provider's own paths, the
 * token check, the async consultations, the request log, the counters and the
 * control routes of the test CPFs.
 *
 * Every answer body comes from the core (`src/core/credit.js`): this module
 * adds the server around it and never calls out to anyone.
 */

/** The state of the token of a request: the state, never the value. */
export type TokenState = 'valid' | 'invalid' | 'missing'

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
  /** Whether a read already answered the final body. */
  delivered: boolean
  charged: boolean
  /** Whether the consultation asked for a callback. */
  callback: boolean
  /** Whether the callback of the consultation was posted. */
  announced: boolean
  final: { status: number; body: unknown }
}

/**
 * The registration of a callback URL: the URL, the code the provider sends to
 * it and whether the receiver confirmed that code.
 */
export interface WebhookRegistration {
  /** The id of the registration, the uuid the provider answers with. */
  id: string
  /** The URL the provider posts to. */
  url: string
  /** The code the receiver confirms. */
  code: string
  /** Whether the receiver confirmed the code. */
  confirmed: boolean
  /** The status the receiver answered the code message with. */
  codeStatus: number | null
  /** The status of the last callback the mock posted. */
  lastStatus: number | null
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

/** The route that reads the balance of the account. */
const ROUTE_BALANCE = 'Marketplace/GetBalance'

/**
 * How long a consultation that asked for a callback runs before it announces
 * itself.
 */
const CALLBACK_DELAY_MS = 1000

/** The route that reads the consumption of the account. */
const ROUTE_CONSUMPTION = 'Billing/GetConsumptionApiV3'

/**
 * The cost of each product of the catalog, the way the provider's catalog
 * prices them: a charged consultation subtracts its cost from the balance.
 */
const PRODUCT_COSTS: Record<string, number> = {
  [ROUTE_SCORE]: 1.98,
  [ROUTE_BOA_VISTA]: 11.18,
}

/** The description of the balance, the way the provider writes it. */
const BALANCE_DESCRIPTION = 'Faturamento Saldo (Pré)'

/**
 * The Direct Data server: the provider's routes and the control routes of the
 * test CPFs.
 * @param deps The outside world: the clock, the ids, the wait, the schedule and
 * the post.
 * @param options The policy of the CPFs that are not in the test table and the
 * public URL of the mock itself.
 */
export function createDirectd(
  deps: {
    now: () => Date
    newId: () => string
    sleep: (ms: number) => Promise<void>
    schedule: (ms: number, task: () => Promise<void>) => void
    post: (url: string, body: unknown) => Promise<{ status: number }>
  },
  options: { unlisted: UnlistedPolicy; baseUrl: string; balance: number },
): {
  api(request: Request, url: URL, clientIp?: string): Promise<Response>
  control(request: Request, url: URL): Promise<Response>
} {
  const { now, newId, sleep, schedule, post } = deps
  const envUnlisted = options.unlisted
  const baseUrl = options.baseUrl.replace(/\/+$/, '')

  let unlisted: UnlistedPolicy = envUnlisted
  let testCpfs: TestCpf[] = DEFAULT_TEST_CPFS.map((row) => ({ ...row }))

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
  /** The registration of the callback URL, when there is one. */
  let registration: WebhookRegistration | null = null
  /** The balance of the account, in the currency of the provider. */
  let balance = round2(options.balance)
  /** What was added to the balance over the last 30 days. */
  let addedLast30Days = 0
  /** What was consumed from the balance over the last 30 days. */
  let consumedLast30Days = 0

  /**
   * The provider's routes: the Hub calls them from another container, so they
   * carry no local guard. They send the CORS header of the API (like /v1), so
   * the playground on Pages can call a container on the developer's machine;
   * the body and the status stay the provider's.
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

    const webhook = webhookRouteOf(url.pathname)
    const account = accountRouteOf(url.pathname)

    if (webhook) {
      answer = await webhookAnswer(request, webhook, startedAt)
    } else if (account) {
      answer = accountAnswer(request, account, startedAt)
    } else if (request.method !== 'GET' || route === null) {
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
      answer = await readAnswer(route, params, ip, startedAt)
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
   * The answer of the provider's webhook routes: the token comes in the
   * `Token` header, the way the provider takes it.
   * @param request The request to answer.
   * @param route The webhook route.
   * @param startedAt When the request came in.
   */
  async function webhookAnswer(
    request: Request,
    route: string,
    startedAt: Date,
  ): Promise<Answer> {
    const base = {
      headers: {},
      route,
      outcome: null,
      resultado: null,
      consultaUid: null,
      async: false,
      chargeRoute: route,
    }

    if (request.method !== 'POST') {
      return { ...base, status: 405, body: webhookError('method_not_allowed', 'The webhook routes use POST.') }
    }

    if (headerTokenState(request) !== 'valid') {
      return { ...base, status: 401, body: webhookError('unauthorized', 'The Token header is missing or wrong.') }
    }

    if (route === WEBHOOK_ROUTE_CREATE) {
      return { ...base, ...(await createUrlCallBack(request, startedAt)) }
    }

    return { ...base, ...(await confirmUrlCallBack(request, startedAt)) }
  }

  /**
   * The answer of the routes of the account: the balance and the consumption.
   * The token comes in the `Token` header, the way the provider takes it.
   * @param request The request to answer.
   * @param route The route of the account.
   * @param startedAt When the request came in.
   */
  function accountAnswer(request: Request, route: string, startedAt: Date): Answer {
    const base = {
      headers: {},
      route,
      outcome: null,
      resultado: null,
      consultaUid: null,
      async: false,
      chargeRoute: route,
    }

    if (request.method !== 'GET') {
      return { ...base, status: 405, body: webhookError('method_not_allowed', 'The account routes use GET.') }
    }

    if (headerTokenState(request) !== 'valid') {
      return { ...base, status: 401, body: webhookError('unauthorized', 'The Token header is missing or wrong.') }
    }

    const body = route === ROUTE_CONSUMPTION ? consumptionBody(startedAt) : balanceBody(startedAt)
    return { ...base, status: 200, body }
  }

  /**
   * The body of the balance, in the key order of the captured answer.
   * @param startedAt When the request came in.
   */
  function balanceBody(startedAt: Date): Record<string, unknown> {
    return {
      balance: {
        description: BALANCE_DESCRIPTION,
        type: 'Prepaid',
        balance: round2(balance),
        addedLast30Days: round2(addedLast30Days),
        consumedLast30Days: round2(consumedLast30Days),
      },
      success: true,
      status: 'OK',
      elapsedTimeMs: Math.max(0, now().getTime() - startedAt.getTime()),
      dateTimeExecution: formatExecutionDate(now()),
      error: null,
    }
  }

  /**
   * The body of the consumption, in the key order of the captured answer.
   * @param startedAt When the request came in.
   */
  function consumptionBody(startedAt: Date): Record<string, unknown> {
    return {
      consumption: {
        details: { balance: round2(balance) },
        description: BALANCE_DESCRIPTION,
        active: true,
      },
      success: true,
      status: 'OK',
      elapsedTimeMs: Math.max(0, now().getTime() - startedAt.getTime()),
      dateTimeExecution: formatExecutionDate(now()),
      error: null,
    }
  }

  /**
   * The charge of a consultation: the cost of the product leaves the balance
   * and joins what was consumed over the last 30 days.
   * @param route The route of the consultation.
   */
  function chargeProduct(route: string): void {
    const cost = PRODUCT_COSTS[route]
    if (cost === undefined) return

    balance = round2(balance - cost)
    consumedLast30Days = round2(consumedLast30Days + cost)
  }

  /**
   * The registration of a callback URL: the mock remembers it, posts the code
   * to it and waits for the receiver to answer `201`. The URL is ready only
   * when the code comes back through `ConfirmUrlCallBack`.
   * @param request The request of the registration.
   * @param startedAt When the request came in.
   */
  async function createUrlCallBack(
    request: Request,
    startedAt: Date,
  ): Promise<{ status: number; body: unknown }> {
    const body = await jsonBody(request)
    if (!body) {
      return { status: 400, body: webhookError('invalid_body', 'The request body must be valid JSON.') }
    }

    const raw = body.Url
    if (typeof raw !== 'string' || raw.trim() === '') {
      return { status: 400, body: webhookError('invalid_url', 'The Url is missing.') }
    }

    const url = raw.trim()
    if (!isHttpUrl(url)) {
      return { status: 400, body: webhookError('invalid_url', 'The Url must be an http(s) URL.') }
    }

    // The mock never leaves the machine: a foreign host is refused and
    // nothing is posted.
    if (!isLocalDestination(url)) {
      return { status: 400, body: webhookError('forbidden_destination', 'The Url must be a local address.') }
    }

    const id = newId()
    const current: WebhookRegistration = {
      id,
      url,
      code: codeFrom(id),
      confirmed: false,
      codeStatus: null,
      lastStatus: null,
    }
    // A new registration replaces the previous one.
    registration = current

    const result = await post(url, {
      MessageStep: "Send this code to 'POST Webhook/ConfirmUrlCallBack'",
      Code: current.code,
      Status: 'Created',
    })

    current.codeStatus = result.status

    return { status: 200, body: webhookExecution(current.id, 'Created', startedAt) }
  }

  /**
   * The confirmation of a registration: the receiver sends the code it got and
   * the URL is ready for the callbacks.
   * @param request The request of the confirmation.
   * @param startedAt When the request came in.
   */
  async function confirmUrlCallBack(
    request: Request,
    startedAt: Date,
  ): Promise<{ status: number; body: unknown }> {
    const body = await jsonBody(request)
    if (!body) {
      return { status: 400, body: webhookError('invalid_body', 'The request body must be valid JSON.') }
    }

    const code = typeof body.Code === 'string' ? body.Code.trim().toUpperCase() : ''
    if (!registration || code !== registration.code) {
      return { status: 400, body: webhookError('unknown_code', 'The code does not match a registration.') }
    }

    registration.confirmed = true

    return { status: 200, body: webhookExecution(registration.id, 'Confirmed', startedAt) }
  }

  /**
   * The callback of a settled consultation, in the documented key order.
   * @param id The `consultaUid` of the consultation.
   * @param product The product of the callback.
   * @param status The status of the callback.
   */
  async function postCallback(id: string, product: string, status: string): Promise<void> {
    if (!registration || !registration.confirmed) return

    const result = await post(registration.url, {
      Product: product,
      Id: id,
      Status: status,
      Url: `${baseUrl}/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${id}`,
    })

    registration.lastStatus = result.status
  }

  /**
   * The announcement of a consultation that asked for a callback: the callback
   * goes to the confirmed URL, once, with the status of the answer.
   * @param query The consultation that settles.
   */
  async function announce(query: AsyncQuery): Promise<void> {
    if (!query.callback || query.announced) return
    if (!registration || !registration.confirmed) return

    query.announced = true
    const resultado: string | null = metaOf(query.final.body)?.resultado ?? null
    const status = resultado !== null && CHARGED_RESULTS.includes(resultado) ? 'Finished' : 'Error'
    await postCallback(query.uid, 'APIv3', status)
  }

  /**
   * A consultation that settles by itself: its timer released it and it
   * announces itself, with no read.
   * @param query The consultation that settles.
   */
  async function settleAlone(query: AsyncQuery): Promise<void> {
    // A reset forgets the query: its timer must not post it.
    if (queries.get(query.uid) !== query) return
    query.released = true
    await announce(query)
  }

  /**
   * The callback the control route fires at once: the tester chooses the
   * product, the id and the status.
   * @param body The body of the request.
   */
  async function fireCallback(body: Record<string, any>): Promise<{ status: number; body: unknown }> {
    if (!registration || !registration.confirmed) {
      return { status: 409, body: webhookError('not_confirmed', 'There is no confirmed registration.') }
    }

    const product = String(body.product ?? '')
    if (!WEBHOOK_PRODUCTS.includes(product)) {
      return { status: 400, body: webhookError('invalid_product', `Unknown product: ${product}.`) }
    }

    const status = String(body.status ?? '')
    if (!WEBHOOK_STATUSES.includes(status)) {
      return { status: 400, body: webhookError('invalid_status', `Unknown status: ${status}.`) }
    }

    const id = String(body.id ?? '')
    if (!id) {
      return { status: 400, body: webhookError('invalid_id', 'The id is missing.') }
    }

    await postCallback(id, product, status)

    return { status: 200, body: { posted: true, status: registration?.lastStatus ?? null } }
  }

  /**
   * The body of a webhook answer, the way the provider writes it.
   * @param id The id of the registration.
   * @param result What the answer says (`Created` or `Confirmed`).
   * @param startedAt When the request came in.
   */
  function webhookExecution(id: string, result: string, startedAt: Date): Record<string, unknown> {
    return {
      id,
      result,
      status: 'OK',
      elapsedTimeMs: Math.max(0, now().getTime() - startedAt.getTime()),
      dateTimeExecution: formatExecutionDate(now()),
    }
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
        balance: round2(balance),
        consumedLast30Days: round2(consumedLast30Days),
        addedLast30Days: round2(addedLast30Days),
        webhook: registration
          ? {
              url: registration.url,
              code: registration.code,
              confirmed: registration.confirmed,
              codeStatus: registration.codeStatus,
              lastStatus: registration.lastStatus,
            }
          : null,
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

      const invalid = body.profile === undefined ? null : profileError(body.profile)
      if (invalid) {
        return json({ error: { code: 'invalid_profile', message: invalid } }, 400)
      }

      const row: TestCpf = { cpf, outcome: outcome as Outcome }
      if (body.profile !== undefined) row.profile = body.profile

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

    if (method === 'GET' && path === 'balance') {
      return json(balanceBody(now()))
    }

    if (method === 'POST' && path === 'balance') {
      const body = await bodyOf(request)
      if (body instanceof Response) return body

      const set = body.set
      const add = body.add

      if (set !== undefined) {
        if (!isAmount(set)) {
          return json(
            { error: { code: 'invalid_amount', message: 'The set must be a number.' } },
            400,
          )
        }
        balance = round2(Number(set))
      } else if (add !== undefined) {
        if (!isAmount(add)) {
          return json(
            { error: { code: 'invalid_amount', message: 'The add must be a number.' } },
            400,
          )
        }
        balance = round2(balance + Number(add))
        addedLast30Days = round2(addedLast30Days + Number(add))
      } else {
        return json(
          { error: { code: 'invalid_body', message: 'The body needs a set or an add.' } },
          400,
        )
      }

      return json(balanceBody(now()))
    }

    if (method === 'GET' && path === 'webhook') {
      return json({
        url: registration?.url ?? null,
        confirmed: registration?.confirmed ?? false,
        code: registration?.code ?? null,
      })
    }

    if (method === 'POST' && path === 'webhook/fire') {
      const body = await bodyOf(request)
      if (body instanceof Response) return body

      const fired = await fireCallback(body)
      return json(fired.body, fired.status)
    }

    if (method === 'DELETE' && path === 'webhook') {
      registration = null
      return json({ cleared: true })
    }

    const release = /^queries\/([^/]+)\/release$/.exec(path)
    if (method === 'POST' && release) {
      const uid = decodeURIComponent(release[1]!)
      const query = queries.get(uid)
      if (!query) {
        return json({ error: { code: 'not_found', message: `No query: ${uid}.` } }, 404)
      }

      query.released = true
      await announce(query)
      return json({ released: uid })
    }

    const fail = /^queries\/([^/]+)\/fail$/.exec(path)
    if (method === 'POST' && fail) {
      const uid = decodeURIComponent(fail[1]!)
      const query = queries.get(uid)
      if (!query) {
        return json({ error: { code: 'not_found', message: `No query: ${uid}.` } }, 404)
      }

      if (query.delivered) {
        return json(
          { error: { code: 'already_settled', message: `The query is already settled: ${uid}.` } },
          409,
        )
      }

      const body = await bodyOf(request)
      if (body instanceof Response) return body

      const outcome = String(body.outcome ?? '')
      const key = FAILURE_OUTCOMES.find((entry) => entry === outcome)
      const failure = key ? FAILURES[key] : undefined
      if (!failure) {
        return json(
          { error: { code: 'invalid_outcome', message: `Unknown outcome: ${outcome}.` } },
          400,
        )
      }

      query.outcome = outcome as Outcome
      query.final = {
        status: failure.status,
        body: envelope(
          {
            route: query.route,
            uid: query.uid,
            cpf: query.cpf || null,
            result: failure.result,
            message: failure.message,
            ip: '127.0.0.1',
            async: true,
            callback: query.callback,
            receipt: false,
            now: now(),
            startedAt: now(),
          },
          null,
        ),
      }
      query.released = true
      await announce(query)
      return json({ failed: uid, outcome })
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
    const query = consultParams(params)
    const wantsAsync = flagOf(params, 'Async') === 'habilitar'

    // The balance pays for the consultation: a balance shorter than the cost
    // of the product answers the failure of the provider, no charge at all.
    const cost = PRODUCT_COSTS[route]
    if (cost !== undefined && balance < cost) {
      return noBalanceAnswer(route, ip, startedAt)
    }

    // The slow CPF is the only wait of the mock; an async consultation is
    // created at once, so only the synchronous call waits.
    if (!wantsAsync && resolveCpf(cpf, { testCpfs, unlisted }).outcome === 'slow') {
      await sleep(SLOW_DELAY_MS)
    }

    const uid = newId()
    const core = answerFor(route, query, { testCpfs, unlisted, now: now(), uid, ip, startedAt })
    const meta = metaOf(core.body)
    const consultaUid: string | null = meta?.consultaUid ?? null
    const outcome = core.outcome as Outcome

    if (wantsAsync && core.status === 200 && consultaUid) {
      const query: AsyncQuery = {
        uid: consultaUid,
        route,
        cpf,
        outcome,
        createdAt: now().toISOString(),
        reads: 0,
        released: false,
        delivered: false,
        charged: false,
        callback: Boolean(meta?.enviarCallback),
        announced: false,
        final: { status: core.status, body: core.body },
      }
      queries.set(consultaUid, query)

      // A consultation that asked for a callback settles alone: it announces
      // itself to the confirmed URL, with no read.
      if (query.callback && registration?.confirmed && outcome !== 'neverSettles') {
        schedule(outcome === 'slow' ? SLOW_DELAY_MS : CALLBACK_DELAY_MS, () => settleAlone(query))
      }

      const created = asyncCreated({
        route,
        uid: consultaUid,
        cpf,
        ip,
        callback: Boolean(meta?.enviarCallback),
        receipt: Boolean(meta?.gerarComprovante),
        now: now(),
        startedAt,
      })

      return {
        status: 201,
        body: created,
        headers: {},
        route,
        outcome,
        resultado: created.metaDados.resultado as string,
        consultaUid,
        async: true,
        chargeRoute: route,
      }
    }

    return {
      status: core.status,
      body: core.body,
      headers: core.headers,
      route,
      outcome,
      resultado: meta?.resultado ?? null,
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
  async function readAnswer(
    route: string,
    params: URLSearchParams,
    ip: string,
    startedAt: Date,
  ): Promise<Answer> {
    const requested = paramOf(params, 'ConsultaUid') ?? ''
    const query = queries.get(requested)

    if (!query) {
      const failure = FAILURES.notFound
      const body = envelope(
        { route, uid: requested || null, cpf: null, result: failure.result, message: failure.message, ip, now: now(), startedAt },
        null,
      )

      return {
        status: failure.status,
        body,
        headers: {},
        route,
        outcome: 'notFound',
        resultado: failure.result.text,
        consultaUid: requested || null,
        async: true,
        chargeRoute: route,
      }
    }

    query.reads += 1
    const finalMeta = metaOf(query.final.body)

    if (!asyncSettled(query.outcome, query.reads, query.released)) {
      const body = asyncProcessing({
        route: query.route,
        uid: query.uid,
        cpf: query.cpf || null,
        ip,
        callback: Boolean(finalMeta?.enviarCallback),
        receipt: Boolean(finalMeta?.gerarComprovante),
        now: now(),
        startedAt,
      })

      return {
        status: 202,
        body,
        headers: {},
        route,
        outcome: query.outcome,
        resultado: body.metaDados.resultado as string,
        consultaUid: query.uid,
        async: true,
        chargeRoute: query.route,
      }
    }

    const resultado: string | null = finalMeta?.resultado ?? null
    query.delivered = true
    // The consultation is charged when it answers, once.
    if (resultado !== null && CHARGED_RESULTS.includes(resultado)) query.charged = true

    // The consultation is over: the callback goes to the confirmed URL.
    await announce(query)

    return {
      status: query.final.status,
      body: query.final.body,
      headers: {},
      route,
      outcome: query.outcome,
      resultado,
      consultaUid: query.uid,
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
   * The refusal of a balance that does not pay for the product: the failure
   * of the provider, with no consultation and no charge.
   * @param route The route of the request.
   * @param ip The address of the caller.
   * @param startedAt When the request came in.
   */
  function noBalanceAnswer(route: string, ip: string, startedAt: Date): Answer {
    const failure = FAILURES.noBalance
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
      outcome: 'noBalance',
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
      // A charged consultation is a consultation the balance pays for.
      chargeProduct(route)
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

/** The route of the registration of a callback URL. */
const WEBHOOK_ROUTE_CREATE = 'Webhook/CreateUrlCallBack'

/** The route of the confirmation of a callback URL. */
const WEBHOOK_ROUTE_CONFIRM = 'Webhook/ConfirmUrlCallBack'

/** The products a callback may carry. */
const WEBHOOK_PRODUCTS = [
  'Enrichment',
  'AdvancedSearch',
  'LookALike',
  'Dossier',
  'CorporateLinkage',
  'APIv3',
  'APIv3-StatusAvailability',
]

/** The statuses a callback may carry. */
const WEBHOOK_STATUSES = ['Created', 'Processing', 'Error', 'Canceled', 'Modified', 'Finished']

/**
 * The failures a consultation can fail with: the ones that happen after the
 * consultation exists, so the query has a uid to fail.
 */
const FAILURE_OUTCOMES = (Object.keys(FAILURES) as Array<keyof typeof FAILURES>).filter(
  (key) => !FAILURES[key].beforeConsultation,
)

/** The alphabet of the code of a registration: no letter that reads like a digit. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * The webhook route a path names, or null when the path is not one of them.
 * @param pathname The path of the request.
 */
function webhookRouteOf(pathname: string): string | null {
  if (pathname === '/api/Webhook/CreateUrlCallBack') return WEBHOOK_ROUTE_CREATE
  if (pathname === '/api/Webhook/ConfirmUrlCallBack') return WEBHOOK_ROUTE_CONFIRM
  return null
}

/**
 * The account route a path names, or null when the path is not one of them.
 * @param pathname The path of the request.
 */
function accountRouteOf(pathname: string): string | null {
  if (pathname === '/api/Marketplace/GetBalance') return ROUTE_BALANCE
  if (pathname === '/api/Billing/GetConsumptionApiV3') return ROUTE_CONSUMPTION
  return null
}

/**
 * A money value with two decimals: the balance never carries a fraction of a
 * cent.
 * @param value The value.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Whether a value is a number of money: a finite number from zero up.
 * @param value The value.
 */
function isAmount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * The state of the token of a request that carries it in the header: the
 * state, never the value.
 * @param request The request.
 */
function headerTokenState(request: Request): TokenState {
  const token = request.headers.get('token')
  if (token === null) return 'missing'
  return token.trim() === DIRECTD_TOKEN ? 'valid' : 'invalid'
}

/**
 * Whether a URL is a destination the mock may post to: a loopback address or
 * the single-label name of a service of a compose network. Everything else is
 * refused — the mock never leaves the machine.
 * @param raw The URL of the destination.
 */
export function isLocalDestination(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true

  // A single label is the name of a service of a compose network; a name with
  // a dot is a host of the internet.
  return host !== '' && !host.includes('.') && !host.includes(':')
}

/**
 * Whether a string is an http(s) URL.
 * @param raw The string.
 */
function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The code of a registration, from the id the provider gave it: `CALL-` and
 * four uppercase alphanumerics.
 * @param id The id of the registration.
 */
function codeFrom(id: string): string {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }

  let code = ''
  for (let index = 0; index < 4; index += 1) {
    code += CODE_ALPHABET[hash % CODE_ALPHABET.length]
    hash = Math.imul(hash, 48271) >>> 0
  }

  return `CALL-${code}`
}

/**
 * The date of an execution, the way the provider writes it: `7/14/2025 3:46:14 PM`.
 * @param date The moment of the execution.
 */
function formatExecutionDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = date.getHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12

  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ` +
    `${hour12}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ` +
    `${hours >= 12 ? 'PM' : 'AM'}`
}

/**
 * The error of a webhook answer.
 * @param code The code of the error.
 * @param message What went wrong.
 */
function webhookError(code: string, message: string): Record<string, unknown> {
  return { error: { code, message } }
}

/**
 * The body of a request, or null when it is not a JSON object.
 * @param request The request.
 */
async function jsonBody(request: Request): Promise<Record<string, any> | null> {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object') return null
    return value as Record<string, any>
  } catch {
    return null
  }
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

/** The kind of each field a test CPF row may override in its profile. */
const PROFILE_FIELDS: Record<string, 'count' | 'text' | 'flag' | 'amount'> = {
  name: 'text',
  score: 'count',
  faixaScore: 'text',
  capacidadePagamento: 'text',
  perfil: 'text',
  classificacaoABC: 'text',
  probabilidade: 'text',
  debts: 'amount',
  creditors: 'count',
  protests: 'amount',
  restrictions: 'count',
  deceased: 'flag',
  cpfSituacao: 'text',
  rendaFaixa: 'text',
}

/** Money the way the provider writes it: `4.230,50`. */
const MONEY = /^\d{1,3}(\.\d{3})*,\d{2}$/

/**
 * Why a profile override would break the documented answer, or null when it
 * is fine: a known field of the right kind each, so the score stays a number
 * and every Boa Vista leaf stays a string.
 * @param profile The `profile` of the request body.
 */
function profileError(profile: unknown): string | null {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return 'The profile must be an object.'
  }

  for (const [key, value] of Object.entries(profile)) {
    const kind = PROFILE_FIELDS[key]
    if (!kind) return `Unknown profile field: ${key}.`
    if (kind === 'amount') {
      if (!value || typeof value !== 'object') return `${key} must be { count, total }.`
      const { count, total, ...rest } = value as Record<string, unknown>
      if (Object.keys(rest).length > 0) return `${key} must be { count, total }.`
      if (count !== undefined && !isCount(count)) return `${key}.count must be a whole number.`
      if (total !== undefined && !(typeof total === 'string' && MONEY.test(total))) {
        return `${key}.total must be money like 4.230,50.`
      }
    } else if (kind === 'count' && !isCount(value)) {
      return `${key} must be a whole number.`
    } else if (kind === 'text' && typeof value !== 'string') {
      return `${key} must be a string.`
    } else if (kind === 'flag' && typeof value !== 'boolean') {
      return `${key} must be true or false.`
    }
  }
  return null
}

/**
 * Whether a value is a whole number from zero up.
 * @param value The value.
 */
function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
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
    // The playground on Pages calls the container from the browser.
    'access-control-allow-origin': '*',
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
