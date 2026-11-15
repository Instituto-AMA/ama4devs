/**
 * The OpenRouter key management of the mock (0.5.0): the routes the Hub's
 * `openrouter` adapter calls with the platform's Provisioning Key to create,
 * list, read, limit, disable and delete one key per organization, under
 * `/api/v1/keys` (where `https://openrouter.ai/api/v1` would be), plus
 * `/api/v1/key`, where a pasted key is read with itself, and `/api/v1/credits`.
 * The keys it creates are ordinary bearers for the chat and embeddings
 * routes. Everything lives in memory; a reset forgets the keys.
 */
import { json, noContent, readJsonBody } from './http.ts'

/** The prefix every key the mock creates starts with. */
export const OPENROUTER_KEY_PREFIX = 'sk-or-v1-mock'

/** The root of the key management routes. */
export const OPENROUTER_ROOT = '/api/v1'

/** The biggest page `GET /keys` answers, as OpenRouter's. */
const PAGE_SIZE = 100

/** A key as the management routes describe it: never its value. */
export interface OpenRouterKey {
  hash: string
  name: string
  label: string
  limit: number | null
  limit_reset: string | null
  usage_daily: number
  usage_weekly: number
  usage_monthly: number
  disabled: boolean
  expires_at: string | null
  workspace_id: string | null
  created_at: string
}

/** The keys of the mock and how a request reaches them. */
export interface OpenRouterKeys {
  /** Answers a management route, `/key` or `/credits`; null for any other path. */
  route(request: Request, url: URL): Promise<Response | null>
  /** Every key, for the panel. */
  list(): OpenRouterKey[]
  /** Forgets every key. */
  reset(): void
}

/** The outside world the keys need: the ids and the clock. */
export interface OpenRouterKeysDeps {
  newId: () => string
  now: () => Date
}

/** The answer of a refused call, as OpenRouter's API reads it. */
function failure(status: number, message: string): Response {
  return json({ error: { code: status, message } }, status)
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

/** A limit in USD, or null for none; undefined when the value is not a limit. */
function limitOf(raw: unknown): number | null | undefined {
  if (raw === null) return null
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw
  return undefined
}

/**
 * The key management of the mock.
 * @param deps The ids and the clock of the keys.
 */
export function createOpenRouterKeys(deps: OpenRouterKeysDeps): OpenRouterKeys {
  const byHash = new Map<string, OpenRouterKey>()
  const bySecret = new Map<string, string>()

  /** The management key every route asks for: any bearer but a key of the mock. */
  const authorized = (request: Request): boolean => {
    const token = bearerOf(request)
    return token !== '' && !token.startsWith(OPENROUTER_KEY_PREFIX)
  }

  const create = async (request: Request): Promise<Response> => {
    const body = await readJsonBody(request)
    if (body.status !== 'ok' || !isObject(body.value)) return failure(400, 'body must be a JSON object')
    const value = body.value
    if (typeof value.name !== 'string' || value.name.trim() === '') return failure(400, 'name is required')
    const limit = limitOf(value.limit ?? null)
    if (limit === undefined) return failure(400, 'invalid limit')
    const hash = `${deps.newId()}${deps.newId()}`.slice(0, 64)
    const secret = `${OPENROUTER_KEY_PREFIX}-${deps.newId()}${deps.newId()}`
    const key: OpenRouterKey = {
      hash,
      name: value.name,
      label: `${secret.slice(0, 12)}...${secret.slice(-3)}`,
      limit,
      limit_reset: typeof value.limit_reset === 'string' ? value.limit_reset : null,
      usage_daily: 0,
      usage_weekly: 0,
      usage_monthly: 0,
      disabled: false,
      expires_at: null,
      workspace_id: typeof value.workspace_id === 'string' ? value.workspace_id : null,
      created_at: deps.now().toISOString(),
    }
    byHash.set(hash, key)
    bySecret.set(secret, hash)
    return json({ data: key, key: secret }, 201)
  }

  const listPage = (url: URL): Response => {
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)
    const workspace = url.searchParams.get('workspace_id')
    const withDisabled = url.searchParams.get('include_disabled') === 'true'
    const keys = [...byHash.values()]
      .filter((k) => (workspace === null ? k.workspace_id === null : k.workspace_id === workspace))
      .filter((k) => withDisabled || !k.disabled)
      .reverse()
    return json({ data: keys.slice(offset, offset + PAGE_SIZE) })
  }

  const patch = async (request: Request, key: OpenRouterKey): Promise<Response> => {
    const body = await readJsonBody(request)
    if (body.status !== 'ok' || !isObject(body.value)) return failure(400, 'body must be a JSON object')
    const value = body.value
    if ('limit' in value) {
      const limit = limitOf(value.limit)
      if (limit === undefined) return failure(400, 'invalid limit')
      key.limit = limit
    }
    if (typeof value.limit_reset === 'string') key.limit_reset = value.limit_reset
    if (typeof value.disabled === 'boolean') key.disabled = value.disabled
    if (typeof value.name === 'string' && value.name.trim() !== '') key.name = value.name
    return json({ data: key })
  }

  /** `GET /key`: the bearer reads itself; the Provisioning Key says it manages. */
  const current = (request: Request): Response => {
    const token = bearerOf(request)
    if (token === '') return failure(401, 'missing api key')
    const hash = bySecret.get(token)
    const key = hash === undefined ? undefined : byHash.get(hash)
    if (key) {
      return json({
        data: {
          label: key.label,
          limit: key.limit,
          usage_daily: key.usage_daily,
          usage_weekly: key.usage_weekly,
          usage_monthly: key.usage_monthly,
          is_management_key: false,
          is_provisioning_key: false,
          expires_at: key.expires_at,
        },
      })
    }
    if (token.startsWith(OPENROUTER_KEY_PREFIX)) return failure(401, 'invalid api key')
    return json({
      data: {
        label: `${token.slice(0, 6)}...${token.slice(-3)}`,
        limit: null,
        usage_daily: 0,
        usage_weekly: 0,
        usage_monthly: 0,
        is_management_key: true,
        is_provisioning_key: true,
        expires_at: null,
      },
    })
  }

  const management = async (request: Request, url: URL): Promise<Response> => {
    if (!authorized(request)) return failure(401, 'invalid management key')
    const path = url.pathname.slice(OPENROUTER_ROOT.length)
    if (path === '/keys' && request.method === 'POST') return create(request)
    if (path === '/keys' && request.method === 'GET') return listPage(url)
    const match = /^\/keys\/([^/]+)$/.exec(path)
    const key = match ? byHash.get(decodeURIComponent(match[1] ?? '')) : undefined
    if (!key) return failure(404, 'key not found')
    if (request.method === 'GET') return json({ data: key })
    if (request.method === 'PATCH') return patch(request, key)
    if (request.method === 'DELETE') {
      byHash.delete(key.hash)
      for (const [secret, hash] of bySecret) if (hash === key.hash) bySecret.delete(secret)
      return noContent()
    }
    return failure(405, 'method not allowed')
  }

  return {
    async route(request, url) {
      const path = url.pathname
      if (path === `${OPENROUTER_ROOT}/keys` || path.startsWith(`${OPENROUTER_ROOT}/keys/`)) {
        return management(request, url)
      }
      if (path === `${OPENROUTER_ROOT}/key` && request.method === 'GET') return current(request)
      if (path === `${OPENROUTER_ROOT}/credits` && request.method === 'GET') {
        if (bearerOf(request) === '') return failure(401, 'missing api key')
        return json({ data: { total_credits: 100, total_usage: 0 } })
      }
      return null
    },
    list() {
      return [...byHash.values()]
    },
    reset() {
      byHash.clear()
      bySecret.clear()
    },
  }
}
