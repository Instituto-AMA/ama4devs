import { describe, expect, test } from 'bun:test'
import { nativeRoutes } from '../src/routes/native.ts'
import { simpleRoutes } from '../src/routes/simple.ts'
import type { Message, Route } from '../src/types.ts'
import { makeHarness } from './helpers.ts'

/** The base URL the tests build their requests from. */
const BASE = 'http://localhost:3020'

/** The error the native API answers with. */
interface ErrorBody {
  error: { code: string; message: string; field?: string }
}

/** The listing the native API answers with. */
interface ListBody {
  messages: Message[]
  count: number
}

/** The answer of the simple API. */
interface SimpleBody {
  status: string
  id?: string
  to?: string
  segments?: number
  code?: string
  message?: string
}

/**
 * Sends a request to a route and reads the answer.
 * @param route The handler of the route module.
 * @param request The request to send.
 */
async function answer(route: Route, request: Request): Promise<Response> {
  const response = await route(request, new URL(request.url))
  if (!response) throw new Error('the route did not answer the request')
  return response
}

/**
 * Posts a JSON body to the native collection.
 * @param route The handler of the route module.
 * @param fields The body of the request.
 */
async function post(route: Route, fields: Record<string, unknown>): Promise<Response> {
  return answer(
    route,
    new Request(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    }),
  )
}

/**
 * Lists the messages of the native collection.
 * @param route The handler of the route module.
 * @param query The query string of the request.
 */
async function list(route: Route, query: string): Promise<ListBody> {
  const response = await answer(route, new Request(`${BASE}/v1/messages?${query}`))
  expect(response.status).toBe(200)
  return (await response.json()) as ListBody
}

describe('native API', () => {
  test('creates a message and normalizes the number', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const response = await post(route, { to: '(11) 91234-5678', body: 'Hello there' })
    expect(response.status).toBe(201)

    const message = (await response.json()) as Message
    expect(message.to).toBe('+5511912345678')
    expect(message.from).toBe('AMA4DEVS')
    expect(message.status).toBe('queued')
    expect(message.api).toBe('native')
    expect(message.direction).toBe('outbound')
    expect(message.body).toBe('Hello there')
  })

  test('refuses every invalid send with its own code', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const refused: { fields: Record<string, unknown>; code: string; field: string }[] = [
      { fields: { to: 'not-a-number', body: 'Hi' }, code: 'invalid_to', field: 'to' },
      { fields: { to: '+5511912340003', body: 'Hi' }, code: 'rejected_number', field: 'to' },
      { fields: { to: '+5511912345678', body: '   ' }, code: 'empty_body', field: 'body' },
      { fields: { to: '+5511912345678', body: 'x'.repeat(1601) }, code: 'body_too_long', field: 'body' },
      { fields: { to: '+5511912345678', body: 'Hi', from: '###' }, code: 'invalid_from', field: 'from' },
    ]

    for (const item of refused) {
      const response = await post(route, item.fields)
      expect(response.status).toBe(400)

      const body = (await response.json()) as ErrorBody
      expect(body.error.code).toBe(item.code)
      expect(body.error.field).toBe(item.field)
      expect(body.error.message.length).toBeGreaterThan(0)
    }
  })

  test('refuses a body that is not JSON', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const response = await answer(
      route,
      new Request(`${BASE}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      }),
    )
    expect(response.status).toBe(400)

    const body = (await response.json()) as ErrorBody
    expect(body.error.code).toBe('invalid_json')
    expect(body.error.message).toBe('The request body is not valid JSON.')
  })

  test('lists the messages the filters keep', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const first = ctx.store.add({
      direction: 'outbound',
      from: 'AMA4DEVS',
      to: '+5511912340010',
      body: 'First hello',
      api: 'native',
      status: 'queued',
    })
    ctx.store.add({
      direction: 'outbound',
      from: 'AMA4DEVS',
      to: '+5511912340011',
      body: 'Your code is 123456',
      api: 'native',
      status: 'queued',
    })
    ctx.store.add({
      direction: 'outbound',
      from: 'AMA4DEVS',
      to: '+5511912340010',
      body: 'Third message',
      api: 'native',
      status: 'queued',
    })

    const byNumber = await list(route, 'to=%2B5511912340010')
    expect(byNumber.count).toBe(2)
    expect(byNumber.messages.every((message) => message.to === '+5511912340010')).toBe(true)

    const byStatus = await list(route, 'status=queued')
    expect(byStatus.count).toBe(3)

    const byUnknownStatus = await list(route, 'status=nonsense')
    expect(byUnknownStatus.count).toBe(3)

    const byText = await list(route, 'q=code')
    expect(byText.count).toBe(1)

    const byCode = await list(route, 'q=123456')
    expect(byCode.count).toBe(1)

    const after = await list(route, `after=${first.id}`)
    expect(after.count).toBe(2)

    const limited = await list(route, 'limit=1')
    expect(limited.count).toBe(1)
    expect(limited.messages[0]?.body).toBe('Third message')

    const withoutLimit = await list(route, 'limit=0')
    expect(withoutLimit.count).toBe(3)
  })

  test('waits for the first message of a long poll', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const pending = list(route, 'wait=1000&to=%2B5511912340010')
    await post(route, { to: '+5511912340010', body: 'Ping' })

    const body = await pending
    expect(body.count).toBe(1)
    expect(body.messages[0]?.to).toBe('+5511912340010')
  })

  test('answers at once when the wait is zero', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const body = await list(route, 'wait=0')
    expect(body.count).toBe(0)
    expect(body.messages).toEqual([])
  })

  test('reads and deletes a message', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const created = await post(route, { to: '+5511912345678', body: 'Hello' })
    const id = ((await created.json()) as Message).id

    const found = await answer(route, new Request(`${BASE}/v1/messages/${id}`))
    expect(found.status).toBe(200)
    expect(((await found.json()) as Message).id).toBe(id)

    const deleted = await answer(route, new Request(`${BASE}/v1/messages/${id}`, { method: 'DELETE' }))
    expect(deleted.status).toBe(204)

    const gone = await answer(route, new Request(`${BASE}/v1/messages/${id}`))
    expect(gone.status).toBe(404)
    expect(((await gone.json()) as ErrorBody).error.code).toBe('not_found')

    const deletedAgain = await answer(route, new Request(`${BASE}/v1/messages/${id}`, { method: 'DELETE' }))
    expect(deletedAgain.status).toBe(404)
  })

  test('refuses the methods the path does not answer', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const response = await answer(route, new Request(`${BASE}/v1/messages`, { method: 'PUT' }))
    expect(response.status).toBe(405)
    expect(((await response.json()) as ErrorBody).error.code).toBe('method_not_allowed')
  })
})

describe('simple API', () => {
  test('sends a message from the query', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = simpleRoutes(ctx)

    const response = await answer(route, new Request(`${BASE}/sms/send?to=%2B5511912345678&message=Hello%20there`))
    expect(response.status).toBe(200)

    const body = (await response.json()) as SimpleBody
    expect(body.status).toBe('ok')
    expect(body.to).toBe('+5511912345678')
    expect(body.segments).toBe(1)
    expect(body.id).toMatch(/^SM[0-9a-f]{32}$/)

    const stored = ctx.store.list()
    expect(stored[0]?.api).toBe('simple')
    expect(stored[0]?.body).toBe('Hello there')
  })

  test('sends a message from the body and lets the body win', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = simpleRoutes(ctx)

    const response = await answer(
      route,
      new Request(`${BASE}/sms/send?to=%2B5511900000000`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: '+5511912345678', text: 'From the body', sender: 'AMA4DEVS' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(((await response.json()) as SimpleBody).to).toBe('+5511912345678')

    const stored = ctx.store.list()
    expect(stored[0]?.body).toBe('From the body')
    expect(stored[0]?.from).toBe('AMA4DEVS')
  })

  test('refuses an invalid send', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = simpleRoutes(ctx)

    const response = await answer(route, new Request(`${BASE}/sms/send?to=not-a-number&message=Hi`))
    expect(response.status).toBe(400)

    const body = (await response.json()) as SimpleBody
    expect(body.status).toBe('error')
    expect(body.code).toBe('invalid_to')
    expect((body.message ?? '').length).toBeGreaterThan(0)
  })
})

describe('route ownership', () => {
  test('the native route leaves the other paths alone', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = nativeRoutes(ctx)

    const request = new Request(`${BASE}/sms/send`)
    expect(await route(request, new URL(request.url))).toBeNull()
  })

  test('the simple route leaves the other paths alone', async () => {
    const { ctx } = makeHarness({ autoDeliver: false })
    const route = simpleRoutes(ctx)

    const request = new Request(`${BASE}/v1/messages`)
    expect(await route(request, new URL(request.url))).toBeNull()
  })
})
