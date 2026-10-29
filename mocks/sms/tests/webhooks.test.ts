import { describe, expect, test } from 'bun:test'
import { createWebhooks } from '../src/webhooks.ts'
import type { Message, Settings } from '../src/types.ts'

/** The settings type the webhooks expect, taken from the module itself. */
type SettingsLike = Parameters<typeof createWebhooks>[0]['settings']

/** One call the fake fetch recorded. */
interface Call {
  url: string
  init: RequestInit | undefined
}

/**
 * The settings the tests use: a plain object the webhooks only read.
 * @param overrides The fields the test wants to change.
 */
function settingsOf(overrides: Partial<Settings> = {}): SettingsLike {
  const settings: Settings = {
    deliveryDelayMs: 1500,
    autoDeliver: true,
    webhookUrl: '',
    webhookSecret: '',
    defaultFrom: 'AMA4DEVS',
    ...overrides,
  }
  return {
    get: () => settings,
    update: (patch: Partial<Settings>) => Object.assign(settings, patch),
    subscribe: () => () => {},
  } as unknown as SettingsLike
}

/**
 * A message the tests post.
 * @param overrides The fields the test wants to change.
 */
function messageOf(overrides: Partial<Message> = {}): Message {
  return {
    id: 'SM0123456789abcdef0123456789abcdef',
    direction: 'outbound',
    from: 'AMA4DEVS',
    to: '+5511912340000',
    body: 'Your code is 1234',
    status: 'queued',
    api: 'native',
    encoding: 'GSM-7',
    segments: 1,
    codes: ['1234'],
    errorCode: null,
    errorMessage: null,
    callbackUrl: null,
    createdAt: '2026-10-29T12:00:00.000Z',
    updatedAt: '2026-10-29T12:00:00.000Z',
    sentAt: null,
    deliveredAt: null,
    history: [{ status: 'queued', at: '2026-10-29T12:00:00.000Z' }],
    ...overrides,
  }
}

/**
 * A fetch that records its calls and answers with the given status.
 * @param calls The list the calls go into.
 * @param status The status the fake answers with.
 */
function fakeFetch(calls: Call[], status = 200): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response('', { status })
  }) as unknown as typeof fetch
}

/**
 * The headers of a recorded call.
 * @param call The recorded call.
 */
function headersOf(call: Call): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>
}

/**
 * The HMAC-SHA256 of a body, hex encoded, computed the way the mock does.
 * @param secret The shared secret.
 * @param body The exact body that goes out.
 */
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The ids the tests hand out, one after the other. */
function idMaker(prefix = 'dl'): () => string {
  let counter = 0
  return () => `${prefix}-${++counter}`
}

describe('the webhook delivery', () => {
  test('does nothing when there is no URL', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf(),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(delivery).toBeNull()
    expect(calls).toHaveLength(0)
    expect(webhooks.deliveries()).toHaveLength(0)
  })

  test('prefers the callback URL of the message for a status event', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    await webhooks.notify(messageOf({ callbackUrl: 'http://per-message.test/hook' }), 'status')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://per-message.test/hook')
  })

  test('ignores the callback URL of the message for an inbound event', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    await webhooks.notify(messageOf({ callbackUrl: 'http://per-message.test/hook' }), 'inbound')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://global.test/hook')
  })

  test('posts the event and the message as JSON', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })
    const message = messageOf()

    const delivery = await webhooks.notify(message, 'status')

    expect(delivery!.ok).toBe(true)
    expect(delivery!.statusCode).toBe(200)
    expect(delivery!.contentType).toBe('application/json')
    expect(headersOf(calls[0]!)['content-type']).toBe('application/json')
    expect(calls[0]!.init?.method).toBe('POST')
    expect(calls[0]!.init?.body).toBe(delivery!.requestBody)

    const body = JSON.parse(delivery!.requestBody) as { event: string; message: Message }
    expect(body.event).toBe('message.status')
    expect(body.message).toEqual(message)
  })

  test('names the inbound event in the JSON body', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(messageOf({ direction: 'inbound' }), 'inbound')

    const body = JSON.parse(delivery!.requestBody) as { event: string }
    expect(body.event).toBe('message.inbound')
  })

  test('posts a Twilio-shaped form body', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })
    const message = messageOf({ api: 'twilio', status: 'delivered', segments: 2 })

    const delivery = await webhooks.notify(message, 'status')

    expect(delivery!.contentType).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(delivery!.requestBody)
    expect(form.get('MessageSid')).toBe(message.id)
    expect(form.get('SmsSid')).toBe(message.id)
    expect(form.get('AccountSid')).toBe('ACmock00000000000000000000000000')
    expect(form.get('MessageStatus')).toBe('delivered')
    expect(form.get('SmsStatus')).toBe('delivered')
    expect(form.get('From')).toBe(message.from)
    expect(form.get('To')).toBe(message.to)
    expect(form.get('NumSegments')).toBe('2')
    expect(form.get('Body')).toBeNull()
  })

  test('carries the body and the error of an inbound Twilio message', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(
      messageOf({ api: 'twilio', direction: 'inbound', errorCode: 30003, errorMessage: 'Unreachable' }),
      'inbound',
    )

    const form = new URLSearchParams(delivery!.requestBody)
    expect(form.get('Body')).toBe('Your code is 1234')
    expect(form.get('ErrorCode')).toBe('30003')
    expect(form.get('ErrorMessage')).toBe('Unreachable')
  })

  test('signs the exact body with the secret', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook', webhookSecret: 'test-secret' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(delivery!.signed).toBe(true)
    const expected = await hmacHex('test-secret', delivery!.requestBody)
    expect(headersOf(calls[0]!)['x-sms-signature']).toBe(`sha256=${expected}`)
    expect(headersOf(calls[0]!)['user-agent']).toBe('sms-mock')
    expect(headersOf(calls[0]!)['x-sms-event']).toBe('status')
  })

  test('sends no signature without a secret', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(delivery!.signed).toBe(false)
    expect(headersOf(calls[0]!)['x-sms-signature']).toBeUndefined()
  })

  test('rewrites a loopback host and keeps the original URL in the log', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://localhost:4000/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
      localhostRewrite: 'host.docker.internal',
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(new URL(calls[0]!.url).hostname).toBe('host.docker.internal')
    expect(new URL(calls[0]!.url).port).toBe('4000')
    expect(delivery!.url).toBe('http://localhost:4000/hook')
  })

  test('keeps the attempt when the request fails', async () => {
    const calls: Call[] = []
    const failing = (async () => {
      throw new Error('the host is not reachable')
    }) as unknown as typeof fetch
    const webhooks = createWebhooks({
      fetch: failing,
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(delivery!.ok).toBe(false)
    expect(delivery!.statusCode).toBeNull()
    expect(delivery!.error).toBe('the host is not reachable')
    expect(webhooks.deliveries()).toHaveLength(1)
  })

  test('keeps the attempt when the answer is not a success', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls, 500),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(delivery!.ok).toBe(false)
    expect(delivery!.statusCode).toBe(500)
  })

  test('keeps an invalid URL as a failed attempt', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'not-a-url' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(calls).toHaveLength(0)
    expect(delivery!.ok).toBe(false)
    expect(delivery!.error).toBe('invalid_url')
    expect(delivery!.url).toBe('not-a-url')
  })

  test('keeps the last 200 attempts, newest first', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    for (let index = 1; index <= 205; index += 1) {
      await webhooks.notify(messageOf({ id: `SM${String(index).padStart(32, '0')}` }), 'status')
    }

    const deliveries = webhooks.deliveries()
    expect(deliveries).toHaveLength(200)
    expect(deliveries[0]!.messageId).toBe(`SM${String(205).padStart(32, '0')}`)
    expect(deliveries[0]!.id).toBe('dl-205')
    expect(deliveries[199]!.id).toBe('dl-6')
  })

  test('clears the log', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })

    await webhooks.notify(messageOf(), 'status')
    webhooks.clear()

    expect(webhooks.deliveries()).toHaveLength(0)
  })

  test('tells the watchers and survives one that throws', async () => {
    const calls: Call[] = []
    const webhooks = createWebhooks({
      fetch: fakeFetch(calls),
      settings: settingsOf({ webhookUrl: 'http://global.test/hook' }),
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      newId: idMaker(),
    })
    const seen: string[] = []
    const unsubscribe = webhooks.subscribe((delivery) => {
      seen.push(delivery.id)
      throw new Error('the watcher is broken')
    })

    const delivery = await webhooks.notify(messageOf(), 'status')

    expect(seen).toEqual([delivery!.id])
    expect(webhooks.deliveries()).toHaveLength(1)

    unsubscribe()
    await webhooks.notify(messageOf(), 'status')
    expect(seen).toHaveLength(1)
  })
})
