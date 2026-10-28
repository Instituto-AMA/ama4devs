/**
 * "Logs de Requisições": records each call to the API (`/v3`) with what went in
 * and what came back, for the panel (Integrações › Logs de Requisições).
 *
 * Two places call it, both before the response leaves: after the handler (a
 * success) and in the error handler (a refusal: 400, 401, 404). An error body is
 * not visible after the response, and writing first lets a test read the row
 * right after its call. A request is recorded once, whichever comes first.
 *
 * A call is the account's when its key says so; a key that is disabled or
 * expired still names its account (the 401 is what the developer needs to see).
 * A key that exists nowhere names no account and is not recorded. Recording
 * never fails the call: a write that fails is logged and dropped.
 */
import { eq } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../core/context.ts'
import { apiKeys, requestLogs } from '../db/schema/index.ts'

/** The newest calls kept per account (src/scheduler/jobs/retention-purge.ts). */
export const REQUEST_LOG_LIMIT = 1000

/** A body bigger than this is kept as its first characters, marked as cut. */
const MAX_BODY_CHARS = 64_000

const recorded = new WeakSet<Request>()

export const isApiPath = (pathname: string) => pathname === '/v3' || pathname.startsWith('/v3/')

/**
 * What is stored of a body: files as their name, type and size, card data
 * masked as Asaas masks it, and anything too long cut.
 */
export function bodyForLog(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null
  const plain = toPlain(value)
  const text = JSON.stringify(plain)
  if (text === undefined || text.length <= MAX_BODY_CHARS) return plain
  return { truncated: true, size: text.length, start: text.slice(0, MAX_BODY_CHARS) }
}

function toPlain(value: unknown, key = ''): unknown {
  if (value instanceof Blob) {
    return { file: value instanceof File ? value.name : 'blob', type: value.type, size: value.size }
  }
  if (value instanceof FormData) {
    return Object.fromEntries([...value.entries()].map(([k, v]) => [k, toPlain(v, k)]))
  }
  if (Array.isArray(value)) return value.map((v) => toPlain(v))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v, k)]))
  }
  if (typeof value === 'string' && key === 'ccv') return '***'
  if (typeof value === 'string' && key === 'number' && /^\d{13,19}$/.test(value)) {
    return `${value.slice(0, 6)}${'*'.repeat(value.length - 10)}${value.slice(-4)}`
  }
  return value
}

async function accountOfKey(ctx: AppContext, token: string | null): Promise<AuthContext | null> {
  if (!token) return null
  const [row] = await ctx.db
    .select({ apiKeyId: apiKeys.id, accountId: apiKeys.accountId })
    .from(apiKeys)
    .where(eq(apiKeys.key, token))
    .limit(1)
  return row ? { ...row, walletId: '' } : null
}

export interface RecordedCall {
  request: Request
  body: unknown
  status: unknown
  /** Set when the key was accepted; otherwise the key is looked up. */
  auth?: AuthContext
}

export async function recordRequest(ctx: AppContext, call: RecordedCall, response: unknown): Promise<void> {
  const { request } = call
  const url = new URL(request.url)
  if (!isApiPath(url.pathname) || recorded.has(request)) return
  recorded.add(request)
  try {
    const auth = call.auth ?? (await accountOfKey(ctx, request.headers.get('access_token')))
    if (!auth) return
    await ctx.db.insert(requestLogs).values({
      accountId: auth.accountId,
      apiKeyId: auth.apiKeyId,
      method: request.method,
      path: url.pathname,
      query: url.search.replace(/^\?/, ''),
      status: response instanceof Response ? response.status : call.status === undefined ? 200 : Number(call.status),
      requestBody: bodyForLog(call.body),
      responseBody: bodyForLog(response instanceof Response ? null : response),
      dateCreated: ctx.clock.timestamp(),
      createdAtMs: ctx.clock.nowMs(),
    })
  } catch (err) {
    ctx.log('warn', 'Request log not written', { path: url.pathname, error: String(err) })
  }
}
