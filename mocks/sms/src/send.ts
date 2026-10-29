import { isAlphaSender, normalizePhone, outcomeFor } from './core/phone.js'
import type { Api, Ctx, Message } from './types.ts'

/** The longest body the APIs accept (ten concatenated segments). */
export const MAX_BODY_LENGTH = 1600

/** Why a send was refused; the route modules map it to their own error shape. */
export interface SendFailure {
  code: 'invalid_to' | 'rejected_number' | 'empty_body' | 'body_too_long' | 'invalid_from'
  message: string
  field: 'to' | 'body' | 'from'
}

/** What every send API reduces its request to. */
export interface SendInput {
  to?: unknown
  body?: unknown
  from?: unknown
  callbackUrl?: unknown
}

/**
 * Validates a send request, stores the message as `queued` and starts its
 * lifecycle. The returned message is the one just created (still `queued`),
 * whatever the lifecycle does next.
 * @param ctx The shared pieces of the server.
 * @param api The API the request came through.
 * @param input The raw fields of the request.
 */
export function sendMessage(
  ctx: Ctx,
  api: Api,
  input: SendInput,
): { ok: true; message: Message } | { ok: false; failure: SendFailure } {
  const to = typeof input.to === 'string' ? normalizePhone(input.to, ctx.config.defaultCountryCode) : null
  if (!to) {
    return fail('invalid_to', "Invalid 'To' phone number: use E.164, e.g. +5511912345678.", 'to')
  }
  if (outcomeFor(to).kind === 'rejected') {
    return fail('rejected_number', `The number ${to} is rejected by the API (magic suffix 0003).`, 'to')
  }

  const body = typeof input.body === 'string' ? input.body : ''
  if (body.trim() === '') return fail('empty_body', 'The message body is required.', 'body')
  if (body.length > MAX_BODY_LENGTH) {
    return fail('body_too_long', `The message body exceeds ${MAX_BODY_LENGTH} characters.`, 'body')
  }

  const rawFrom = typeof input.from === 'string' ? input.from.trim() : ''
  let from: string | null
  if (rawFrom === '') from = ctx.settings.get().defaultFrom
  else if (isAlphaSender(rawFrom)) from = rawFrom
  else from = normalizePhone(rawFrom, ctx.config.defaultCountryCode)
  if (!from) {
    return fail('invalid_from', "Invalid 'From': use E.164 or an alphanumeric sender id (up to 11 characters).", 'from')
  }

  const callbackUrl = typeof input.callbackUrl === 'string' && isHttpUrl(input.callbackUrl) ? input.callbackUrl : null
  const message = ctx.store.add({ direction: 'outbound', from, to, body, api, status: 'queued', callbackUrl })
  ctx.lifecycle.accept(message)
  return { ok: true, message }
}

/**
 * True for an absolute http(s) URL.
 * @param value The candidate URL.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A refusal in the shape `sendMessage` returns.
 * @param code Which rule was broken.
 * @param message The English description.
 * @param field The request field at fault.
 */
function fail(
  code: SendFailure['code'],
  message: string,
  field: SendFailure['field'],
): { ok: false; failure: SendFailure } {
  return { ok: false, failure: { code, message, field } }
}
