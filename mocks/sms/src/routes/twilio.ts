/**
 * The Twilio-shaped REST surface: the same store and the same send rules as
 * the native API under the paths a Twilio SDK calls, so pointing the SDK at
 * the mock is a base URL change. Authorization is ignored.
 */
import { json, noContent, readFields } from '../http.ts'
import { sendMessage, type SendFailure } from '../send.ts'
import type { Ctx, Message, Route } from '../types.ts'

/** The collection path: `/2010-04-01/Accounts/{accountSid}/Messages.json`. */
const LIST_PATTERN = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/

/** The one-message path: `/2010-04-01/Accounts/{accountSid}/Messages/{messageSid}.json`. */
const ONE_PATTERN = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\/([^/]+)\.json$/

/** The Twilio error code each send failure maps to. */
const ERROR_CODES: Record<SendFailure['code'], number> = {
  invalid_to: 21211,
  rejected_number: 21211,
  invalid_from: 21212,
  empty_body: 21602,
  body_too_long: 21617,
}

/**
 * The Twilio routes: the create-and-list endpoint and the one-message
 * endpoint. A request outside them (path or method) is not its own.
 * @param ctx The shared pieces of the server.
 */
export function twilioRoutes(ctx: Ctx): Route {
  return (request, url) => {
    const list = LIST_PATTERN.exec(url.pathname)
    if (list) {
      const accountSid = list[1] ?? ''
      if (request.method === 'POST') return sendResponse(ctx, request, accountSid)
      if (request.method === 'GET') return listResponse(ctx, url, accountSid)
      return null
    }

    const one = ONE_PATTERN.exec(url.pathname)
    if (one) {
      const accountSid = one[1] ?? ''
      const messageSid = one[2] ?? ''
      if (request.method === 'GET') return oneResponse(ctx, url, accountSid, messageSid)
      if (request.method === 'DELETE') return deleteResponse(ctx, url, messageSid)
    }
    return null
  }
}

/**
 * A message in the Twilio shape.
 * @param message The message as the store keeps it.
 * @param accountSid The account sid of the request path.
 */
export function toTwilio(message: Message, accountSid: string): Record<string, unknown> {
  const base = `/2010-04-01/Accounts/${accountSid}/Messages/${message.id}`
  return {
    sid: message.id,
    account_sid: accountSid,
    api_version: '2010-04-01',
    body: message.body,
    date_created: rfc2822(message.createdAt),
    date_updated: rfc2822(message.updatedAt),
    date_sent: message.sentAt === null ? null : rfc2822(message.sentAt),
    direction: message.direction === 'outbound' ? 'outbound-api' : 'inbound',
    error_code: message.errorCode,
    error_message: message.errorMessage,
    from: message.from,
    to: message.to,
    num_segments: String(message.segments),
    num_media: '0',
    price: null,
    price_unit: 'USD',
    status: message.status,
    messaging_service_sid: null,
    uri: `${base}.json`,
    subresource_uris: { media: `${base}/Media.json` },
  }
}

/**
 * Creates a message from the form fields (`To`, `From`, `Body`,
 * `StatusCallback`; a `MessagingServiceSid` with no `From` uses the default
 * sender) and answers 201, or the Twilio error shape with 400.
 * @param ctx The shared pieces of the server.
 * @param request The create request.
 * @param accountSid The account sid of the request path.
 */
async function sendResponse(ctx: Ctx, request: Request, accountSid: string): Promise<Response> {
  const fields = (await readFields(request)) ?? {}
  const result = sendMessage(ctx, 'twilio', {
    to: fields.To,
    from: fields.From,
    body: fields.Body,
    callbackUrl: fields.StatusCallback,
  })
  if (!result.ok) return errorResponse(result.failure)
  return json(toTwilio(result.message, accountSid), 201)
}

/**
 * Lists the messages newest first, narrowed by `To` and `From` and cut to
 * `PageSize` (default 50, at most 1000), with the paging fields a Twilio
 * client reads.
 * @param ctx The shared pieces of the server.
 * @param url The request URL.
 * @param accountSid The account sid of the request path.
 */
function listResponse(ctx: Ctx, url: URL, accountSid: string): Response {
  const query = url.searchParams
  const pageSize = pageSizeOf(query.get('PageSize'))
  const messages = ctx.store
    .list({ to: query.get('To') ?? undefined, from: query.get('From') ?? undefined })
    .reverse()
    .slice(0, pageSize)

  const uri = `${url.pathname}${url.search}`
  return json({
    messages: messages.map((message) => toTwilio(message, accountSid)),
    page: 0,
    page_size: pageSize,
    start: 0,
    end: messages.length > 0 ? messages.length - 1 : 0,
    uri,
    first_page_uri: uri,
    next_page_uri: null,
    previous_page_uri: null,
  })
}

/**
 * One message in the Twilio shape, or the 20404 error when the store does
 * not know the sid.
 * @param ctx The shared pieces of the server.
 * @param url The request URL.
 * @param accountSid The account sid of the request path.
 * @param messageSid The sid of the message.
 */
function oneResponse(ctx: Ctx, url: URL, accountSid: string, messageSid: string): Response {
  const message = ctx.store.get(messageSid)
  return message ? json(toTwilio(message, accountSid)) : notFound(url.pathname)
}

/**
 * Drops a message: 204 when it existed, the 20404 error when it did not.
 * @param ctx The shared pieces of the server.
 * @param url The request URL.
 * @param messageSid The sid of the message.
 */
function deleteResponse(ctx: Ctx, url: URL, messageSid: string): Response {
  return ctx.store.remove(messageSid) ? noContent() : notFound(url.pathname)
}

/**
 * A send refusal in the Twilio error shape, always HTTP 400.
 * @param failure The refusal `sendMessage` returned.
 */
function errorResponse(failure: SendFailure): Response {
  const code = ERROR_CODES[failure.code]
  return json(
    {
      code,
      message: failure.message,
      more_info: `https://www.twilio.com/docs/errors/${code}`,
      status: 400,
    },
    400,
  )
}

/**
 * The 20404 error a missing resource answers with.
 * @param path The path the request asked for.
 */
function notFound(path: string): Response {
  return json(
    {
      code: 20404,
      message: `The requested resource ${path} was not found`,
      more_info: 'https://www.twilio.com/docs/errors/20404',
      status: 404,
    },
    404,
  )
}

/**
 * The page size a list answers with: a positive integer of at most 1000,
 * 50 for anything else.
 * @param raw The raw `PageSize` query value.
 */
function pageSizeOf(raw: string | null): number {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 1000) : 50
}

/**
 * An instant in the RFC 2822 shape the Twilio API writes dates in.
 * @param iso The instant as an ISO string.
 */
function rfc2822(iso: string): string {
  return new Date(iso).toUTCString().replace('GMT', '+0000')
}
