/**
 * The Vercel key management of the mock (0.3.0): the routes the Hub's
 * `vercelkeys` adapter calls with a team's access token to create, list,
 * budget and delete the organizations' AI Gateway keys, under `/_vercel`
 * (where `https://api.vercel.com` would be), and the gateway's `/v1/credits`,
 * where a pasted key is checked with itself. The keys it creates are taken by
 * the gateway routes, which count their spend against the key's budget and
 * refuse a key past it with `402 quota_for_entity_exceeded`, as the AI Gateway
 * does. Everything lives in memory; a reset forgets the keys.
 */
import { json, noContent, readJsonBody } from './http.ts'

/** The prefix every AI Gateway key of the mock starts with. */
export const MOCK_KEY_PREFIX = 'vck_mock_'

/** The root of the management routes. */
export const VERCEL_ROOT = '/_vercel'

/** A key's budget: USD, its refresh and the spend of the current period. */
export interface KeyQuota {
  limitAmount: number
  refreshPeriod: string
  currentSpend: number
}

/** A key as the management routes describe it: never its value. */
export interface VercelKey {
  id: string
  name: string
  partialKey: string
  teamId: string
  purpose: string
  expiresAt: number | null
  quota: KeyQuota | null
  metadata: Record<string, unknown>
}

/** The keys of the mock and how a request reaches them. */
export interface VercelKeys {
  /** Answers a management route or `/v1/credits`; null for any other path. */
  route(request: Request, url: URL): Promise<Response | null>
  /** The key a gateway request carries, when the mock created it. */
  find(secret: string): VercelKey | undefined
  /** Whether the key spent its budget. */
  overBudget(key: VercelKey): boolean
  /** Adds the cost of one answer to the key's spend. */
  charge(key: VercelKey, costUsd: number | null): void
  /** Every key, for the panel. */
  list(): VercelKey[]
  /** Forgets every key. */
  reset(): void
}

/** The outside world the keys need: the ids. */
export interface VercelKeysDeps {
  newId: () => string
}

/** The answer of a refused management call, as Vercel's API reads it. */
function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status)
}

/** The token of an `Authorization: Bearer <token>` header. */
function bearerOf(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.*)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? ''
}

/** A plain JSON object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The budget a creation or a quota change asks for; null with a bad one. */
function quotaOf(raw: unknown, previous: KeyQuota | null): KeyQuota | null | 'invalid' {
  if (!isObject(raw)) return previous
  if (raw.archived === true) return null
  const limit = raw.limitAmount ?? previous?.limitAmount
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return 'invalid'
  const refresh = raw.refreshPeriod ?? previous?.refreshPeriod ?? 'none'
  if (typeof refresh !== 'string') return 'invalid'
  return { limitAmount: limit, refreshPeriod: refresh, currentSpend: previous?.currentSpend ?? 0 }
}

/**
 * The key management of the mock.
 * @param deps The ids of the keys.
 */
export function createVercelKeys(deps: VercelKeysDeps): VercelKeys {
  const byId = new Map<string, VercelKey>()
  const bySecret = new Map<string, string>()

  /** The management token every route asks for: any bearer but a key of the mock. */
  const authorized = (request: Request): boolean => {
    const token = bearerOf(request)
    return token !== '' && !token.startsWith(MOCK_KEY_PREFIX)
  }

  const create = async (request: Request, teamId: string): Promise<Response> => {
    const body = await readJsonBody(request)
    if (body.status !== 'ok' || !isObject(body.value)) {
      return failure(400, 'bad_request', 'body must be a JSON object')
    }
    const value = body.value
    if (value.purpose !== 'ai-gateway') {
      return failure(400, 'bad_request', 'purpose must be ai-gateway')
    }
    const quota = quotaOf(value.aiGatewayQuota, null)
    if (quota === 'invalid') return failure(400, 'bad_request', 'invalid aiGatewayQuota')
    const id = `key_${deps.newId()}`
    const secret = `${MOCK_KEY_PREFIX}${deps.newId()}${deps.newId()}`
    const key: VercelKey = {
      id,
      name: typeof value.name === 'string' ? value.name : '',
      partialKey: `vck_...${secret.slice(-4)}`,
      teamId,
      purpose: 'ai-gateway',
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null,
      quota,
      metadata: isObject(value.metadata) ? value.metadata : {},
    }
    byId.set(id, key)
    bySecret.set(secret, id)
    return json({ apiKeyString: secret, apiKey: key }, 201)
  }

  const patchQuota = async (request: Request, key: VercelKey): Promise<Response> => {
    const body = await readJsonBody(request)
    if (body.status !== 'ok' || !isObject(body.value)) {
      return failure(400, 'bad_request', 'body must be a JSON object')
    }
    const quota = quotaOf(body.value, key.quota)
    if (quota === 'invalid') return failure(400, 'bad_request', 'invalid quota')
    key.quota = quota
    return json({ apiKey: key, quota })
  }

  const management = async (request: Request, url: URL): Promise<Response> => {
    if (!authorized(request)) return failure(403, 'forbidden', 'not authorized')
    const path = url.pathname.slice(VERCEL_ROOT.length)
    const teamId = url.searchParams.get('teamId') ?? ''
    if (path === '/v2/user' && request.method === 'GET') {
      return json({ user: { id: 'user_llmmock', username: 'llm-mock' } })
    }
    if (path === '/v1/api-keys' && request.method === 'POST') return create(request, teamId)
    if (path === '/v1/api-keys' && request.method === 'GET') {
      const purpose = url.searchParams.get('purpose')
      const keys = [...byId.values()].filter(
        (k) => k.teamId === teamId && (purpose === null || k.purpose === purpose),
      )
      return json({ apiKeys: keys })
    }
    const match = /^\/v1\/api-keys\/([^/]+)(\/quota)?$/.exec(path)
    const key = match ? byId.get(decodeURIComponent(match[1] ?? '')) : undefined
    if (!match || !key || key.teamId !== teamId) return failure(404, 'not_found', 'key not found')
    if (match[2] && request.method === 'PATCH') return patchQuota(request, key)
    if (!match[2] && request.method === 'DELETE') {
      byId.delete(key.id)
      for (const [secret, id] of bySecret) if (id === key.id) bySecret.delete(secret)
      return noContent()
    }
    return failure(405, 'method_not_allowed', 'method not allowed')
  }

  const find = (secret: string): VercelKey | undefined => {
    const id = bySecret.get(secret)
    return id === undefined ? undefined : byId.get(id)
  }

  return {
    async route(request, url) {
      if (url.pathname.startsWith(`${VERCEL_ROOT}/`)) return management(request, url)
      if (url.pathname === '/v1/credits' && request.method === 'GET') {
        const key = find(bearerOf(request))
        if (!key) return json({ error: { message: 'invalid api key', type: 'authentication_error' } }, 401)
        return json({ balance: '100.00', total_used: String(key.quota?.currentSpend ?? 0), token_pass: null })
      }
      return null
    },
    find,
    overBudget(key) {
      return key.quota !== null && key.quota.currentSpend >= key.quota.limitAmount
    },
    charge(key, costUsd) {
      if (key.quota === null || costUsd === null) return
      key.quota.currentSpend = Math.round((key.quota.currentSpend + costUsd) * 1e6) / 1e6
    },
    list() {
      return [...byId.values()]
    },
    reset() {
      byId.clear()
      bySecret.clear()
    },
  }
}
