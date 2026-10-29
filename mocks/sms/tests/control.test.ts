import { describe, expect, test } from 'bun:test'
import { controlRoutes } from '../src/routes/control.ts'
import { makeHarness } from './helpers.ts'
import type { Ctx, Delivery, Message, Settings } from '../src/types.ts'

/**
 * Calls the control route with a request and returns its answer.
 * @param ctx The shared pieces of the server.
 * @param method The HTTP method.
 * @param path The path of the request.
 * @param body The JSON body of the request, when it has one.
 */
async function call(ctx: Ctx, method: string, path: string, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost:3020${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const response = await controlRoutes(ctx)(request, new URL(request.url))
  if (response === null) throw new Error(`the control route did not answer ${method} ${path}`)
  return response
}

/**
 * The JSON body of a response.
 * @param response The response to read.
 */
async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe('the control routes', () => {
  test('leave the paths of the other routes alone', async () => {
    const harness = makeHarness()
    const route = controlRoutes(harness.ctx)

    const native = new Request('http://localhost:3020/v1/messages')
    expect(await route(native, new URL(native.url))).toBeNull()

    const unknown = new Request('http://localhost:3020/_mock/sms/nothing')
    expect(await route(unknown, new URL(unknown.url))).toBeNull()
  })
})

describe('the settings', () => {
  test('are read as they are', async () => {
    const harness = makeHarness()

    const response = await call(harness.ctx, 'GET', '/_mock/sms/settings')

    expect(response.status).toBe(200)
    const settings = await bodyOf<Settings>(response)
    expect(settings.deliveryDelayMs).toBe(0)
    expect(settings.autoDeliver).toBe(true)
    expect(settings.defaultFrom).toBe('AMA4DEVS')
  })

  test('take a partial change and give the new settings back', async () => {
    const harness = makeHarness()

    const response = await call(harness.ctx, 'PUT', '/_mock/sms/settings', {
      deliveryDelayMs: 750,
      autoDeliver: false,
      webhookUrl: 'http://global.test/hook',
    })

    expect(response.status).toBe(200)
    const settings = await bodyOf<Settings>(response)
    expect(settings.deliveryDelayMs).toBe(750)
    expect(settings.autoDeliver).toBe(false)
    expect(settings.webhookUrl).toBe('http://global.test/hook')
    expect(settings.webhookSecret).toBe('')
    expect(harness.ctx.settings.get().deliveryDelayMs).toBe(750)
  })

  test('refuse a value of the wrong type and name the field', async () => {
    const harness = makeHarness()

    const response = await call(harness.ctx, 'PUT', '/_mock/sms/settings', {
      deliveryDelayMs: 'soon',
    })

    expect(response.status).toBe(400)
    const error = await bodyOf<{ error: { code: string; message: string } }>(response)
    expect(error.error.code).toBe('invalid_settings')
    expect(error.error.message).toContain('deliveryDelayMs')
    expect(harness.ctx.settings.get().deliveryDelayMs).toBe(0)
  })

  test('refuse a delay below zero and a flag that is not a boolean', async () => {
    const harness = makeHarness()

    const negative = await call(harness.ctx, 'PUT', '/_mock/sms/settings', {
      deliveryDelayMs: -1,
    })
    expect(negative.status).toBe(400)

    const flag = await call(harness.ctx, 'PUT', '/_mock/sms/settings', { autoDeliver: 'yes' })
    expect(flag.status).toBe(400)
    const error = await bodyOf<{ error: { code: string; message: string } }>(flag)
    expect(error.error.code).toBe('invalid_settings')
    expect(error.error.message).toContain('autoDeliver')
  })

  test('tell the watchers of the settings', async () => {
    const harness = makeHarness()
    const seen: Settings[] = []
    harness.ctx.settings.subscribe((settings) => seen.push(settings))

    await call(harness.ctx, 'PUT', '/_mock/sms/settings', { deliveryDelayMs: 300 })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.deliveryDelayMs).toBe(300)
  })
})

describe('the inbound replies', () => {
  test('are stored and post the inbound webhook', async () => {
    const harness = makeHarness()
    await call(harness.ctx, 'PUT', '/_mock/sms/settings', {
      webhookUrl: 'http://global.test/hook',
    })

    const response = await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: '+5511912340010',
      body: 'Recebi, obrigado!',
    })

    expect(response.status).toBe(201)
    const message = await bodyOf<Message>(response)
    expect(message.direction).toBe('inbound')
    expect(message.status).toBe('received')
    expect(message.api).toBe('mock')
    expect(message.from).toBe('+5511912340010')
    expect(message.to).toBe('AMA4DEVS')
    expect(message.body).toBe('Recebi, obrigado!')
    expect(harness.ctx.store.list()).toHaveLength(1)

    expect(harness.fetchCalls).toHaveLength(1)
    expect(harness.fetchCalls[0]!.url).toBe('http://global.test/hook')
    const posted = JSON.parse(String(harness.fetchCalls[0]!.init.body)) as { event: string }
    expect(posted.event).toBe('message.inbound')
  })

  test('normalize the numbers and keep an alphanumeric receiver', async () => {
    const harness = makeHarness()

    const response = await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: '(11) 91234-0010',
      to: 'LOJA',
      body: 'Oi',
    })

    expect(response.status).toBe(201)
    const message = await bodyOf<Message>(response)
    expect(message.from).toBe('+5511912340010')
    expect(message.to).toBe('LOJA')
  })

  test('refuse a sender that is not a number', async () => {
    const harness = makeHarness()

    const response = await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: 'not-a-number',
      body: 'Oi',
    })

    expect(response.status).toBe(400)
    const error = await bodyOf<{ error: { code: string } }>(response)
    expect(error.error.code).toBe('invalid_from')
  })

  test('refuse a receiver that is not a number', async () => {
    const harness = makeHarness()

    const response = await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: '+5511912340010',
      to: '123',
      body: 'Oi',
    })

    expect(response.status).toBe(400)
    const error = await bodyOf<{ error: { code: string } }>(response)
    expect(error.error.code).toBe('invalid_to')
  })

  test('refuse an empty body and a body that is too long', async () => {
    const harness = makeHarness()

    const empty = await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: '+5511912340010',
      body: '   ',
    })
    expect(empty.status).toBe(400)
    const emptyError = await bodyOf<{ error: { code: string } }>(empty)
    expect(emptyError.error.code).toBe('empty_body')

    const long = await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: '+5511912340010',
      body: 'x'.repeat(1601),
    })
    expect(long.status).toBe(400)
    const longError = await bodyOf<{ error: { code: string } }>(long)
    expect(longError.error.code).toBe('body_too_long')
  })
})

describe('the manual status', () => {
  test('moves a queued message to the status the caller asks for', async () => {
    const harness = makeHarness({ autoDeliver: false })
    const queued = harness.ctx.store.add({
      direction: 'outbound',
      from: 'AMA4DEVS',
      to: '+5511912340010',
      body: 'Seu código é 482913',
      api: 'mock',
      status: 'queued',
    })
    expect(harness.ctx.store.get(queued.id)!.status).toBe('queued')

    const response = await call(
      harness.ctx,
      'POST',
      `/_mock/sms/messages/${queued.id}/status`,
      { status: 'delivered' },
    )

    expect(response.status).toBe(200)
    const message = await bodyOf<Message>(response)
    expect(message.status).toBe('delivered')
    expect(message.deliveredAt).not.toBeNull()
    expect(message.history.map((entry) => entry.status)).toEqual(['queued', 'delivered'])
  })

  test('refuses a status that is not a real one', async () => {
    const harness = makeHarness()
    const queued = harness.ctx.store.add({
      direction: 'outbound',
      from: 'AMA4DEVS',
      to: '+5511912340010',
      body: 'Seu código é 482913',
      api: 'mock',
      status: 'queued',
    })

    const response = await call(
      harness.ctx,
      'POST',
      `/_mock/sms/messages/${queued.id}/status`,
      { status: 'exploded' },
    )

    expect(response.status).toBe(400)
    const error = await bodyOf<{ error: { code: string } }>(response)
    expect(error.error.code).toBe('invalid_status')
  })

  test('refuses a message the store does not know', async () => {
    const harness = makeHarness()

    const response = await call(
      harness.ctx,
      'POST',
      '/_mock/sms/messages/SMffffffffffffffffffffffffffffffff/status',
      { status: 'sent' },
    )

    expect(response.status).toBe(404)
    const error = await bodyOf<{ error: { code: string } }>(response)
    expect(error.error.code).toBe('not_found')
  })

  test('refuses to change the status of an inbound message', async () => {
    const harness = makeHarness()
    const inbound = harness.ctx.store.add({
      direction: 'inbound',
      from: '+5511912340010',
      to: 'AMA4DEVS',
      body: 'Oi',
      api: 'mock',
      status: 'received',
    })

    const response = await call(
      harness.ctx,
      'POST',
      `/_mock/sms/messages/${inbound.id}/status`,
      { status: 'delivered' },
    )

    expect(response.status).toBe(409)
    const error = await bodyOf<{ error: { code: string } }>(response)
    expect(error.error.code).toBe('not_outbound')
  })
})

describe('the reset', () => {
  test('empties the store and the webhook log', async () => {
    const harness = makeHarness()
    await call(harness.ctx, 'PUT', '/_mock/sms/settings', {
      webhookUrl: 'http://global.test/hook',
    })
    await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: '+5511912340010',
      body: 'Oi',
    })
    expect(harness.ctx.store.list()).toHaveLength(1)
    expect(harness.ctx.webhooks.deliveries()).toHaveLength(1)

    const response = await call(harness.ctx, 'POST', '/_mock/sms/reset')

    expect(response.status).toBe(204)
    expect(harness.ctx.store.list()).toHaveLength(0)
    expect(harness.ctx.webhooks.deliveries()).toHaveLength(0)
  })
})

describe('the webhook deliveries', () => {
  test('are listed and the log is emptied', async () => {
    const harness = makeHarness()
    await call(harness.ctx, 'PUT', '/_mock/sms/settings', {
      webhookUrl: 'http://global.test/hook',
    })
    await call(harness.ctx, 'POST', '/_mock/sms/inbound', {
      from: '+5511912340010',
      body: 'Oi',
    })

    const response = await call(harness.ctx, 'GET', '/_mock/sms/webhooks/deliveries')
    expect(response.status).toBe(200)
    const { deliveries } = await bodyOf<{ deliveries: Delivery[] }>(response)
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]!.event).toBe('inbound')
    expect(deliveries[0]!.ok).toBe(true)

    const deleted = await call(harness.ctx, 'DELETE', '/_mock/sms/webhooks/deliveries')
    expect(deleted.status).toBe(204)
    expect(harness.ctx.webhooks.deliveries()).toHaveLength(0)
  })
})

describe('the demo inbox', () => {
  test('seeds five messages, one of them failed and one of them long', async () => {
    const harness = makeHarness()

    const response = await call(harness.ctx, 'POST', '/_mock/sms/demo')

    expect(response.status).toBe(201)
    const { messages } = await bodyOf<{ messages: Message[] }>(response)
    expect(messages).toHaveLength(5)

    const otp = messages[0]!
    expect(otp.from).toBe('BANCO')
    expect(otp.to).toBe('+5511912340010')
    expect(otp.direction).toBe('outbound')
    expect(otp.status).toBe('delivered')
    expect(otp.codes).toEqual(['482913'])

    const reply = messages[1]!
    expect(reply.direction).toBe('inbound')
    expect(reply.status).toBe('received')
    expect(reply.body).toBe('Recebi, obrigado!')

    const notice = messages[2]!
    expect(notice.from).toBe('LOJA')
    expect(notice.to).toBe('+5521987650020')

    const promo = messages[3]!
    expect(promo.encoding).toBe('UCS-2')
    expect(promo.segments).toBe(3)
    expect(promo.body.length).toBe(190)

    const failed = messages[4]!
    expect(failed.to).toBe('+5511912340001')
    expect(failed.status).toBe('failed')
    expect(failed.errorCode).toBe(30003)

    expect(harness.ctx.store.list()).toHaveLength(5)
  })
})
