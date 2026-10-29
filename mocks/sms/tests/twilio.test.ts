import { describe, expect, test } from 'bun:test'
import { twilioRoutes } from '../src/routes/twilio.ts'
import type { Route } from '../src/types.ts'
import { makeHarness } from './helpers.ts'

/** The account sid the tests use on every path. */
const ACCOUNT_SID = 'ACmock00000000000000000000000000'

/** The collection path prefix of the Twilio surface. */
const BASE = `/2010-04-01/Accounts/${ACCOUNT_SID}`

/** The form content type a Twilio SDK posts with. */
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }

/**
 * A URL of the mock server for a path.
 * @param path The absolute path, query included.
 */
function url(path: string): URL {
  return new URL(path, 'http://localhost')
}

/**
 * The response a route must answer for a path of its own.
 * @param route The route under test.
 * @param method The HTTP method.
 * @param path The absolute path, query included.
 * @param init Extra request init.
 */
async function call(route: Route, method: string, path: string, init: RequestInit = {}): Promise<Response> {
  const target = url(path)
  const response = await route(new Request(target, { method, ...init }), target)
  if (!response) throw new Error(`the route answered null for ${method} ${path}`)
  return response
}

/**
 * A POST to the collection path as a Twilio SDK writes it.
 * @param route The route under test.
 * @param fields The form fields.
 * @param headers Extra headers.
 */
function post(route: Route, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  return call(route, 'POST', `${BASE}/Messages.json`, {
    headers: { ...FORM, ...headers },
    body: new URLSearchParams(fields).toString(),
  })
}

describe('twilioRoutes', () => {
  test('POST creates a message and answers it queued in the Twilio shape', async () => {
    const harness = makeHarness()
    const route = twilioRoutes(harness.ctx)

    const response = await post(route, {
      To: '+5511912340000',
      From: 'AMA4DEVS',
      Body: 'Your code is 123456',
      StatusCallback: 'http://localhost/callback',
      MessagingServiceSid: 'MG00000000000000000000000000000000',
    })

    expect(response).not.toBeNull()
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.sid).toMatch(/^SM[0-9a-f]{32}$/)
    expect(body.account_sid).toBe(ACCOUNT_SID)
    expect(body.api_version).toBe('2010-04-01')
    expect(body.body).toBe('Your code is 123456')
    expect(body.to).toBe('+5511912340000')
    expect(body.from).toBe('AMA4DEVS')
    expect(body.status).toBe('queued')
    expect(body.direction).toBe('outbound-api')
    expect(body.num_segments).toBe('1')
    expect(body.num_media).toBe('0')
    expect(body.date_sent).toBeNull()
    expect(body.date_created).toBe('Thu, 01 Jan 2026 12:00:00 +0000')
    expect(body.price).toBeNull()
    expect(body.price_unit).toBe('USD')
    expect(body.messaging_service_sid).toBeNull()
    expect(body.uri).toBe(`${BASE}/Messages/${body.sid}.json`)
    expect(body.subresource_uris.media).toBe(`${BASE}/Messages/${body.sid}/Media.json`)

    harness.runScheduled()
    const stored = harness.ctx.store.get(body.sid)
    expect(stored?.status).toBe('delivered')
    expect(stored?.callbackUrl).toBe('http://localhost/callback')
  })

  test('POST with a MessagingServiceSid and no From uses the default sender', async () => {
    const route = twilioRoutes(makeHarness().ctx)

    const response = await post(route, {
      To: '+5511912340000',
      MessagingServiceSid: 'MG00000000000000000000000000000000',
      Body: 'hi',
    })

    expect(response.status).toBe(201)
    expect((await response.json()).from).toBe('AMA4DEVS')
  })

  test('POST maps each refusal to its Twilio error code', async () => {
    const route = twilioRoutes(makeHarness().ctx)
    const cases: { fields: Record<string, string>; code: number }[] = [
      { fields: { To: 'abc', Body: 'hi' }, code: 21211 },
      { fields: { To: '+5511912340003', Body: 'hi' }, code: 21211 },
      { fields: { To: '+5511912340000', From: '!!!', Body: 'hi' }, code: 21212 },
      { fields: { To: '+5511912340000', Body: '' }, code: 21602 },
      { fields: { To: '+5511912340000', Body: 'a'.repeat(1601) }, code: 21617 },
    ]

    for (const { fields, code } of cases) {
      const response = await post(route, fields)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.code).toBe(code)
      expect(body.status).toBe(400)
      expect(typeof body.message).toBe('string')
      expect(body.more_info).toBe(`https://www.twilio.com/docs/errors/${code}`)
    }
  })

  test('GET lists newest first with the paging fields, inbound included', async () => {
    const harness = makeHarness()
    const route = twilioRoutes(harness.ctx)
    await post(route, { To: '+5511912340000', From: 'AMA4DEVS', Body: 'first' })
    await post(route, { To: '+5511912340001', From: 'AMA4DEVS', Body: 'second' })
    harness.ctx.store.add({
      direction: 'inbound',
      from: '+5511987654321',
      to: '+5511912340000',
      body: 'ping',
      api: 'mock',
      status: 'received',
    })

    const response = await call(route, 'GET', `${BASE}/Messages.json`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.page).toBe(0)
    expect(body.page_size).toBe(50)
    expect(body.start).toBe(0)
    expect(body.end).toBe(2)
    expect(body.uri).toBe(`${BASE}/Messages.json`)
    expect(body.first_page_uri).toBe(body.uri)
    expect(body.next_page_uri).toBeNull()
    expect(body.previous_page_uri).toBeNull()
    expect(body.messages.map((message: { body: string }) => message.body)).toEqual(['ping', 'second', 'first'])
    expect(body.messages.map((message: { direction: string }) => message.direction)).toEqual([
      'inbound',
      'outbound-api',
      'outbound-api',
    ])
    expect(body.messages[0].status).toBe('received')
  })

  test('GET narrows by To and From and honors PageSize', async () => {
    const route = twilioRoutes(makeHarness().ctx)
    await post(route, { To: '+5511912340000', From: 'AMA4DEVS', Body: 'first' })
    await post(route, { To: '+5511912340001', From: 'AMA4DEVS', Body: 'second' })

    const toQuery = new URLSearchParams({ To: '+5511912340000', PageSize: '1' })
    const toResponse = await call(route, 'GET', `${BASE}/Messages.json?${toQuery.toString()}`)
    const toBody = await toResponse.json()
    expect(toBody.page_size).toBe(1)
    expect(toBody.end).toBe(0)
    expect(toBody.messages).toHaveLength(1)
    expect(toBody.messages[0].body).toBe('first')
    expect(toBody.uri).toBe(`${BASE}/Messages.json?To=%2B5511912340000&PageSize=1`)

    const fromQuery = new URLSearchParams({ From: 'AMA4DEVS' })
    const fromResponse = await call(route, 'GET', `${BASE}/Messages.json?${fromQuery.toString()}`)
    const fromBody = await fromResponse.json()
    expect(fromBody.messages.map((message: { body: string }) => message.body).sort()).toEqual(['first', 'second'])
  })

  test('GET answers one message, delivered once the lifecycle has run', async () => {
    const harness = makeHarness()
    const route = twilioRoutes(harness.ctx)
    const created = await (await post(route, { To: '+5511912340000', Body: 'hi' })).json()
    harness.runScheduled()

    const response = await call(route, 'GET', `${BASE}/Messages/${created.sid}.json`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.sid).toBe(created.sid)
    expect(body.status).toBe('delivered')
    expect(typeof body.date_sent).toBe('string')
    expect((body.date_sent as string).endsWith('+0000')).toBe(true)
  })

  test('DELETE drops the message, and the next reads answer 20404', async () => {
    const route = twilioRoutes(makeHarness().ctx)
    const created = await (await post(route, { To: '+5511912340000', Body: 'hi' })).json()

    const deleted = await call(route, 'DELETE', `${BASE}/Messages/${created.sid}.json`)
    expect(deleted.status).toBe(204)

    const read = await call(route, 'GET', `${BASE}/Messages/${created.sid}.json`)
    expect(read.status).toBe(404)
    const readBody = await read.json()
    expect(readBody.code).toBe(20404)
    expect(readBody.more_info).toBe('https://www.twilio.com/docs/errors/20404')

    const gone = await call(route, 'DELETE', `${BASE}/Messages/${created.sid}.json`)
    expect(gone.status).toBe(404)
    expect((await gone.json()).code).toBe(20404)

    const unknown = await call(route, 'GET', `${BASE}/Messages/SM${'0'.repeat(32)}.json`)
    expect(unknown.status).toBe(404)
  })

  test('the Authorization header changes nothing', async () => {
    const route = twilioRoutes(makeHarness().ctx)
    const headers = { Authorization: `Basic ${btoa(`${ACCOUNT_SID}:test-secret`)}` }

    const created = await post(route, { To: '+5511912340000', Body: 'hi' }, headers)
    expect(created.status).toBe(201)

    const plain = await post(route, { To: '+5511912340001', Body: 'hi' })
    expect(plain.status).toBe(201)

    const listed = await call(route, 'GET', `${BASE}/Messages.json`, { headers })
    expect(listed.status).toBe(200)
    expect((await listed.json()).messages).toHaveLength(2)
  })

  test('a path or a method of another route answers null', async () => {
    const route = twilioRoutes(makeHarness().ctx)

    const foreign = url('/messages')
    expect(await route(new Request(foreign), foreign)).toBeNull()

    const calls = url(`${BASE}/Calls.json`)
    expect(await route(new Request(calls), calls)).toBeNull()

    const wrongMethod = url(`${BASE}/Messages.json`)
    expect(await route(new Request(wrongMethod, { method: 'PUT' }), wrongMethod)).toBeNull()

    const wrongMethodOne = url(`${BASE}/Messages/SM${'0'.repeat(32)}.json`)
    expect(await route(new Request(wrongMethodOne, { method: 'POST' }), wrongMethodOne)).toBeNull()
  })
})
