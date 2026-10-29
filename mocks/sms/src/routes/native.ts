/**
 * The native API: the JSON endpoints `/v1/messages` that create, list, read
 * and delete the messages of the mock.
 */
import { json, noContent, queryFields, readFields } from '../http.ts'
import { sendMessage } from '../send.ts'
import type { ListFilter } from '../store.ts'
import type { Ctx, Direction, Route, Status } from '../types.ts'

/** The collection of the native API. */
const COLLECTION = '/v1/messages'

/** The longest a long poll waits. */
const MAX_WAIT_MS = 30000

/** The statuses a listing may filter by. */
const STATUSES: readonly Status[] = ['queued', 'sent', 'delivered', 'undelivered', 'failed', 'received']

/** The directions a listing may filter by. */
const DIRECTIONS: readonly Direction[] = ['outbound', 'inbound']

/**
 * The native routes: the messages of the mock as JSON.
 * @param ctx The shared pieces of the server.
 */
export function nativeRoutes(ctx: Ctx): Route {
  /**
   * Creates a message from the JSON body and answers it as created.
   * @param request The request to read.
   */
  async function create(request: Request): Promise<Response> {
    const fields = await readFields(request)
    if (fields === null) {
      return json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } }, 400)
    }

    const result = sendMessage(ctx, 'native', {
      to: fields['to'],
      body: fields['body'],
      from: fields['from'],
      callbackUrl: fields['callbackUrl'],
    })
    if (!result.ok) {
      const { code, message, field } = result.failure
      return json({ error: { code, message, field } }, 400)
    }
    return json(result.message, 201)
  }

  /**
   * Lists the messages the filters keep, waiting for the first one when the
   * request asks for a long poll.
   * @param url The URL of the request.
   */
  async function list(url: URL): Promise<Response> {
    const filter = filterOf(url)
    const wait = waitOf(url)
    const messages = wait > 0 ? await ctx.store.waitFor(filter, wait) : ctx.store.list(filter)
    return json({ messages, count: messages.length })
  }

  /**
   * Answers one message, or the not-found error.
   * @param id The id of the message.
   */
  function show(id: string): Response {
    const message = ctx.store.get(id)
    if (!message) return notFound()
    return json(message)
  }

  /**
   * Drops one message, or answers the not-found error.
   * @param id The id of the message.
   */
  function remove(id: string): Response {
    if (!ctx.store.remove(id)) return notFound()
    return noContent()
  }

  return (request, url) => {
    const path = withoutTrailingSlash(url.pathname)
    if (path !== COLLECTION && !path.startsWith(`${COLLECTION}/`)) return null

    const id = path === COLLECTION ? null : path.slice(COLLECTION.length + 1)

    if (id === null) {
      if (request.method === 'POST') return create(request)
      if (request.method === 'GET') return list(url)
      return methodNotAllowed('GET, POST')
    }

    if (request.method === 'GET') return show(id)
    if (request.method === 'DELETE') return remove(id)
    return methodNotAllowed('GET, DELETE')
  }
}

/**
 * The filters of a listing: every filter the query names and that makes
 * sense; an unknown status or direction is ignored.
 * @param url The URL of the request.
 */
function filterOf(url: URL): ListFilter {
  const query = queryFields(url)
  const filter: ListFilter = {}

  const to = query['to']
  if (to) filter.to = to
  const from = query['from']
  if (from) filter.from = from
  const number = query['number']
  if (number) filter.number = number
  const q = query['q']
  if (q) filter.q = q

  const status = query['status']
  if (status && isStatus(status)) filter.status = status
  const direction = query['direction']
  if (direction && isDirection(direction)) filter.direction = direction

  const after = query['after']
  if (after) filter.afterId = after

  const limit = query['limit']
  if (limit !== undefined) {
    const parsed = Number(limit)
    if (Number.isInteger(parsed) && parsed >= 1) filter.limit = parsed
  }

  return filter
}

/**
 * How long a listing waits for a message: the milliseconds of the query,
 * clamped to the longest wait; zero means no wait.
 * @param url The URL of the request.
 */
function waitOf(url: URL): number {
  const raw = queryFields(url)['wait']
  if (raw === undefined) return 0
  const wait = Number(raw)
  if (!Number.isFinite(wait) || wait <= 0) return 0
  return Math.min(Math.floor(wait), MAX_WAIT_MS)
}

/**
 * Whether a value is one of the statuses of the mock.
 * @param value The candidate status.
 */
function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value)
}

/**
 * Whether a value is one of the directions of the mock.
 * @param value The candidate direction.
 */
function isDirection(value: string): value is Direction {
  return (DIRECTIONS as readonly string[]).includes(value)
}

/**
 * A path without its trailing slashes.
 * @param path The path of the request.
 */
function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** The answer of a message the store does not know. */
function notFound(): Response {
  return json({ error: { code: 'not_found', message: 'Message not found.' } }, 404)
}

/**
 * The answer of a method the path does not answer.
 * @param allow The methods the path answers.
 */
function methodNotAllowed(allow: string): Response {
  return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405, { allow })
}
