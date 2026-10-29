import { describe, expect, test } from 'bun:test'
import { createApp, type App, type MockServer } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { LiveEvent } from '../src/types.ts'
import { websocketHandlers } from '../src/ws.ts'

/**
 * The application under test: a fixed clock, counted ids and no timer, so a
 * message stays `queued` and nothing waits for real time.
 */
function makeApp(): App {
  let tick = 0
  let counter = 0

  return createApp(loadConfig({}), {
    now: () => new Date(Date.UTC(2026, 0, 1, 12, 0, tick++)),
    newId: () => `SM${(++counter).toString(16).padStart(32, '0')}`,
    schedule: () => {},
  })
}

/**
 * Asks the app something and returns its answer.
 * @param app The application under test.
 * @param path The path of the request.
 * @param init The method, the headers and the body of the request.
 */
async function call(app: App, path: string, init?: RequestInit): Promise<Response> {
  const response = await app.fetch(new Request(`http://localhost:3020${path}`, init))
  if (!response) throw new Error(`the app did not answer ${path}`)
  return response
}

/**
 * The JSON body of an answer.
 * @param response The response to read.
 */
async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/**
 * The error code of an answer.
 * @param response The response to read.
 */
async function errorCodeOf(response: Response): Promise<string> {
  const body = await bodyOf<{ error: { code: string } }>(response)
  return body.error.code
}

/**
 * The frames a socket receives, in order: the reader that waits for them.
 * @param socket The socket of the panel.
 */
function frameReader(socket: WebSocket): { next(): Promise<LiveEvent> } {
  const frames: LiveEvent[] = []
  const waiters: ((frame: LiveEvent) => void)[] = []

  socket.onmessage = (event) => {
    const frame = JSON.parse(String(event.data)) as LiveEvent
    const waiter = waiters.shift()
    if (waiter) waiter(frame)
    else frames.push(frame)
  }

  return {
    next() {
      const ready = frames.shift()
      if (ready) return Promise.resolve(ready)
      return new Promise<LiveEvent>((resolve) => waiters.push(resolve))
    },
  }
}

describe('the health check', () => {
  test('answers with the service and its version, even to a foreign host', async () => {
    const app = makeApp()

    const response = await call(app, '/health', { headers: { host: 'evil.example' } })

    expect(response.status).toBe(200)
    const body = await bodyOf<{ status: string; service: string; version: string }>(response)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('sms')
    expect(typeof body.version).toBe('string')
  })
})

describe('the local guard', () => {
  test('refuses a foreign host', async () => {
    const app = makeApp()

    const response = await call(app, '/v1/messages', { headers: { host: 'evil.example' } })

    expect(response.status).toBe(403)
    expect(await errorCodeOf(response)).toBe('forbidden_host')
  })

  test('refuses a foreign origin on a write', async () => {
    const app = makeApp()

    const response = await call(app, '/v1/messages', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+5511912345678', body: 'Hello' }),
    })

    expect(response.status).toBe(403)
    expect(await errorCodeOf(response)).toBe('forbidden_origin')
  })
})

describe('the CORS', () => {
  test('answers the preflight of an allowed origin', async () => {
    const app = makeApp()

    const response = await call(app, '/v1/messages', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-headers': 'authorization,content-type',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,POST,PUT,DELETE,OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization,content-type')
    expect(response.headers.get('access-control-max-age')).toBe('600')
    expect(response.headers.get('vary')).toBe('Origin')
  })

  test('refuses the preflight of a foreign origin', async () => {
    const app = makeApp()

    const response = await call(app, '/v1/messages', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    })

    expect(response.status).toBe(403)
    expect(await errorCodeOf(response)).toBe('forbidden_origin')
  })

  test('answers a write of an allowed origin with the header of the origin', async () => {
    const app = makeApp()

    const response = await call(app, '/v1/messages', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+5511912345678', body: 'Hello' }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(response.headers.get('vary')).toBe('Origin')
  })
})

describe('the static files', () => {
  test('serves the panel', async () => {
    const app = makeApp()

    const response = await call(app, '/')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('SMS')
  })

  test('serves the script of the panel and the core modules', async () => {
    const app = makeApp()

    const script = await call(app, '/app.js')
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')

    const core = await call(app, '/core/phone.js')
    expect(core.status).toBe(200)
    expect(core.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
  })

  test('does not serve a file outside the core', async () => {
    const app = makeApp()

    const response = await call(app, '/core/..%2Fx.js')

    expect(response.status).toBe(404)
    expect(await errorCodeOf(response)).toBe('not_found')
  })

  test('answers a path it does not know with a 404', async () => {
    const app = makeApp()

    const response = await call(app, '/nothing/here')

    expect(response.status).toBe(404)
    expect(await errorCodeOf(response)).toBe('not_found')
  })
})

describe('the routes', () => {
  test('the native route answers', async () => {
    const app = makeApp()

    const response = await call(app, '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+5511912345678', body: 'Hello' }),
    })

    expect(response.status).toBe(201)
  })

  test('the Twilio route answers', async () => {
    const app = makeApp()

    const response = await call(app, '/2010-04-01/Accounts/ACmock/Messages.json', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: '+5511912345678', From: 'AMA4DEVS', Body: 'Hello' }).toString(),
    })

    expect(response.status).toBe(201)
  })

  test('the simple route answers', async () => {
    const app = makeApp()

    const response = await call(app, '/sms/send?to=%2B5511912345678&message=Hello')

    expect(response.status).toBe(200)
  })

  test('the control route answers', async () => {
    const app = makeApp()

    const response = await call(app, '/_mock/sms/settings')

    expect(response.status).toBe(200)
  })
})

describe('the live feed', () => {
  test('sends the snapshot and then the events of the store', async () => {
    const app = makeApp()
    const server = Bun.serve({
      port: 0,
      fetch: (request, bun) => app.fetch(request, bun as unknown as MockServer),
      websocket: websocketHandlers(app),
    })

    const socket = new WebSocket(`ws://localhost:${server.port}/ws`)
    const frames = frameReader(socket)

    const snapshot = await frames.next()
    expect(snapshot.type).toBe('snapshot')

    const created = await call(app, '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+5511912345678', body: 'Hello' }),
    })
    expect(created.status).toBe(201)

    const event = await frames.next()
    expect(event.type).toBe('message.created')

    socket.close()
    server.stop(true)
  })
})
