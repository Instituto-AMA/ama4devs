/**
 * The control routes of the mock: the settings the panel changes at runtime,
 * the inbound replies the handset writes, the manual status changes, the
 * reset of the store and the sample inbox the demo seeds.
 */
import { isAlphaSender, normalizePhone } from '../core/phone.js'
import { json, noContent, readFields } from '../http.ts'
import { applyStatus } from '../lifecycle.ts'
import { MAX_BODY_LENGTH } from '../send.ts'
import type { Ctx, Message, Route, Settings } from '../types.ts'

/** The prefix every control route lives under. */
const PREFIX = '/_mock/sms/'

/** The statuses a manual change may set. */
const MANUAL_STATUSES = ['sent', 'delivered', 'undelivered', 'failed'] as const

/** One of the statuses a manual change may set. */
type ManualStatus = (typeof MANUAL_STATUSES)[number]

/** The settings that carry a string. */
const SETTINGS_STRINGS = ['webhookUrl', 'webhookSecret', 'defaultFrom'] as const

/** One message of the sample inbox the demo seeds. */
interface DemoMessage {
  direction: 'outbound' | 'inbound'
  from: string
  to: string
  body: string
}

/**
 * The sample inbox: an OTP and its reply, a delivery notice, a long promo and
 * a message to the number that always fails. The numbers are fixed, so the
 * panel shows the same conversations on every seed.
 */
const DEMO_MESSAGES: DemoMessage[] = [
  {
    direction: 'outbound',
    from: 'BANCO',
    to: '+5511912340010',
    body: 'Seu código de verificação é 482913. Não compartilhe com ninguém.',
  },
  {
    direction: 'inbound',
    from: '+5511912340010',
    to: '+5511912340010',
    body: 'Recebi, obrigado!',
  },
  {
    direction: 'outbound',
    from: 'LOJA',
    to: '+5521987650020',
    body: 'Seu pedido #4821 saiu para entrega. Acompanhe: https://example.com/rastreio/4821',
  },
  {
    direction: 'outbound',
    from: 'LOJA',
    to: '+5521987650020',
    body: '🎉 Oferta LOJA: 50% de desconto em todo o site, frete grátis acima de R$199 e cupom exclusivo para novos clientes. O estoque é limitado e a oferta acaba à meia-noite. Compre online agora! 🎉',
  },
  {
    direction: 'outbound',
    from: 'AMA4DEVS',
    to: '+5511912340001',
    body: 'Este número sempre falha na entrega (final 0001).',
  },
]

/** The patch of a settings change, or the field that refused it. */
type SettingsPatch =
  | { ok: true; patch: Partial<Settings> }
  | { ok: false; field: string; message: string }

/**
 * The control routes of the mock: the settings, the inbound replies, the
 * manual status changes, the reset, the webhook log and the demo inbox.
 * @param ctx The shared pieces of the server.
 */
export function controlRoutes(ctx: Ctx): Route {
  return async (request: Request, url: URL): Promise<Response | null> => {
    const pathname = url.pathname
    if (!pathname.startsWith(PREFIX)) return null

    if (pathname === `${PREFIX}settings`) return settingsRoute(ctx, request)
    if (pathname === `${PREFIX}inbound`) return inboundRoute(ctx, request)
    if (pathname === `${PREFIX}reset`) return resetRoute(ctx, request)
    if (pathname === `${PREFIX}demo`) return demoRoute(ctx, request)
    if (pathname === `${PREFIX}webhooks/deliveries`) return deliveriesRoute(ctx, request)

    const status = /^\/_mock\/sms\/messages\/([^/]+)\/status$/.exec(pathname)
    if (status) return statusRoute(ctx, request, status[1]!)

    return null
  }
}

/**
 * Reads the settings and writes a partial change to them.
 * @param ctx The shared pieces of the server.
 * @param request The request to answer.
 */
async function settingsRoute(ctx: Ctx, request: Request): Promise<Response> {
  if (request.method === 'GET') return json(ctx.settings.get())
  if (request.method !== 'PUT') return methodNotAllowed()

  const fields = await readFields(request)
  if (fields === null) return invalidJson()

  const patch = settingsPatch(fields)
  if (!patch.ok) {
    return json({ error: { code: 'invalid_settings', message: patch.message } }, 400)
  }

  return json(ctx.settings.update(patch.patch))
}

/**
 * Stores the reply the handset wrote and posts the inbound event.
 * @param ctx The shared pieces of the server.
 * @param request The request to answer.
 */
async function inboundRoute(ctx: Ctx, request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  const fields = await readFields(request)
  if (fields === null) return invalidJson()

  const from =
    typeof fields.from === 'string' ? normalizePhone(fields.from, ctx.config.defaultCountryCode) : null
  if (from === null) {
    return json(
      { error: { code: 'invalid_from', message: "Invalid 'from': use E.164, e.g. +5511912345678." } },
      400,
    )
  }

  const rawTo =
    typeof fields.to === 'string' && fields.to.trim() !== ''
      ? fields.to.trim()
      : ctx.settings.get().defaultFrom
  const to = isAlphaSender(rawTo) ? rawTo : normalizePhone(rawTo, ctx.config.defaultCountryCode)
  if (to === null) {
    return json(
      { error: { code: 'invalid_to', message: "Invalid 'to': use E.164, e.g. +5511912345678." } },
      400,
    )
  }

  const body = typeof fields.body === 'string' ? fields.body : ''
  if (body.trim() === '') {
    return json({ error: { code: 'empty_body', message: 'The message body is required.' } }, 400)
  }
  if (body.length > MAX_BODY_LENGTH) {
    return json(
      {
        error: {
          code: 'body_too_long',
          message: `The message body exceeds ${MAX_BODY_LENGTH} characters.`,
        },
      },
      400,
    )
  }

  const message = ctx.store.add({
    direction: 'inbound',
    from,
    to,
    body,
    api: 'mock',
    status: 'received',
  })
  void ctx.webhooks.notify(message, 'inbound')
  return json(message, 201)
}

/**
 * Moves an outbound message to the status the caller asks for.
 * @param ctx The shared pieces of the server.
 * @param request The request to answer.
 * @param id The id of the message.
 */
async function statusRoute(ctx: Ctx, request: Request, id: string): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  const fields = await readFields(request)
  if (fields === null) return invalidJson()

  const status = fields.status
  if (typeof status !== 'string' || !MANUAL_STATUSES.includes(status as ManualStatus)) {
    return json(
      {
        error: {
          code: 'invalid_status',
          message: `The status must be one of ${MANUAL_STATUSES.join(', ')}.`,
        },
      },
      400,
    )
  }

  const existing = ctx.store.get(id)
  if (!existing) {
    return json({ error: { code: 'not_found', message: 'Message not found.' } }, 404)
  }
  if (existing.direction === 'inbound') {
    return json(
      { error: { code: 'not_outbound', message: 'An inbound message has no status to change.' } },
      409,
    )
  }

  const errorCode =
    typeof fields.errorCode === 'number' && Number.isFinite(fields.errorCode)
      ? fields.errorCode
      : undefined
  const updated = await applyStatus(
    { store: ctx.store, webhooks: ctx.webhooks },
    id,
    status as ManualStatus,
    errorCode,
  )
  if (!updated) {
    return json({ error: { code: 'not_found', message: 'Message not found.' } }, 404)
  }

  return json(updated)
}

/**
 * Drops every message and every webhook attempt.
 * @param ctx The shared pieces of the server.
 * @param request The request to answer.
 */
async function resetRoute(ctx: Ctx, request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  ctx.store.reset()
  ctx.webhooks.clear()
  return noContent()
}

/**
 * Lists the webhook attempts and empties the log.
 * @param ctx The shared pieces of the server.
 * @param request The request to answer.
 */
async function deliveriesRoute(ctx: Ctx, request: Request): Promise<Response> {
  if (request.method === 'GET') return json({ deliveries: ctx.webhooks.deliveries() })
  if (request.method !== 'DELETE') return methodNotAllowed()

  ctx.webhooks.clear()
  return noContent()
}

/**
 * Seeds the sample inbox: the outbound messages go through the lifecycle, so
 * the panel shows the statuses a real run would leave behind.
 * @param ctx The shared pieces of the server.
 * @param request The request to answer.
 */
async function demoRoute(ctx: Ctx, request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  const created: Message[] = []
  for (const demo of DEMO_MESSAGES) {
    const message = ctx.store.add({
      direction: demo.direction,
      from: demo.from,
      to: demo.to,
      body: demo.body,
      api: 'mock',
      status: demo.direction === 'inbound' ? 'received' : 'queued',
    })
    if (demo.direction === 'outbound') ctx.lifecycle.accept(message)
    created.push(message)
  }

  const messages = created.map((message) => ctx.store.get(message.id) ?? message)
  return json({ messages }, 201)
}

/**
 * The patch of a settings change: a delay from zero up, a boolean or a
 * string; a value of the wrong type refuses the whole change.
 * @param fields The fields of the request.
 */
function settingsPatch(fields: Record<string, unknown>): SettingsPatch {
  const patch: Partial<Settings> = {}

  const delay = fields.deliveryDelayMs
  if (delay !== undefined) {
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0) {
      return {
        ok: false,
        field: 'deliveryDelayMs',
        message: 'deliveryDelayMs must be a number of milliseconds greater than or equal to 0.',
      }
    }
    patch.deliveryDelayMs = delay
  }

  const autoDeliver = fields.autoDeliver
  if (autoDeliver !== undefined) {
    if (typeof autoDeliver !== 'boolean') {
      return { ok: false, field: 'autoDeliver', message: 'autoDeliver must be a boolean.' }
    }
    patch.autoDeliver = autoDeliver
  }

  for (const key of SETTINGS_STRINGS) {
    const value = fields[key]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      return { ok: false, field: key, message: `${key} must be a string.` }
    }
    patch[key] = value
  }

  return { ok: true, patch }
}

/**
 * The answer for a body that is not valid JSON.
 */
function invalidJson(): Response {
  return json(
    { error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } },
    400,
  )
}

/**
 * The answer for a method the route does not answer.
 */
function methodNotAllowed(): Response {
  return json(
    { error: { code: 'method_not_allowed', message: 'This method is not allowed on this route.' } },
    405,
  )
}
