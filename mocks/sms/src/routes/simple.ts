/**
 * The simple API: `GET|POST /sms/send`, the shortest way to send a message to
 * the mock.
 */
import { json, queryFields, readFields } from '../http.ts'
import { sendMessage } from '../send.ts'
import type { Ctx, Route } from '../types.ts'

/** The path of the simple API. */
const PATH = '/sms/send'

/**
 * The simple routes: one path that sends a message from the query or from
 * the body.
 * @param ctx The shared pieces of the server.
 */
export function simpleRoutes(ctx: Ctx): Route {
  return async (request, url) => {
    if (withoutTrailingSlash(url.pathname) !== PATH) return null
    if (request.method !== 'GET' && request.method !== 'POST') {
      return json({ status: 'error', code: 'method_not_allowed', message: 'Method not allowed.' }, 405)
    }

    const body = request.method === 'POST' ? await readFields(request) : {}
    if (body === null) {
      return json({ status: 'error', code: 'invalid_json', message: 'The request body is not valid JSON.' }, 400)
    }
    const fields: Record<string, unknown> = { ...queryFields(url), ...body }

    const result = sendMessage(ctx, 'simple', {
      to: fields['to'],
      body: fields['message'] ?? fields['text'] ?? fields['body'],
      from: fields['sender'] ?? fields['from'],
      callbackUrl: fields['callbackUrl'],
    })
    if (!result.ok) {
      return json({ status: 'error', code: result.failure.code, message: result.failure.message }, 400)
    }

    const message = result.message
    return json({ status: 'ok', id: message.id, to: message.to, segments: message.segments })
  }
}

/**
 * A path without its trailing slashes.
 * @param path The path of the request.
 */
function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}
