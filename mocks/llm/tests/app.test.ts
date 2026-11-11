import { describe, expect, test } from 'bun:test'
import { makeApp } from './helpers.ts'
import type { App } from '../src/app.ts'

/** The key the tests send. */
const KEY = 'Bearer test-key'

/**
 * A POST to the mock.
 * @param app The app of the test.
 * @param path The path of the request.
 * @param body The body of the request.
 * @param headers The headers of the request.
 */
function post(
  app: App,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: KEY, ...headers },
      body: JSON.stringify(body),
    }),
  )
}

/**
 * A chat request the tests send.
 * @param content The text of the user.
 * @param extra What else the request carries.
 */
function chat(content: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'mock-model',
    messages: [{ role: 'user', content }],
    ...extra,
  }
}

describe('the health check', () => {
  test('answers without a key', async () => {
    const { app } = makeApp()
    const response = await app.fetch(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.status).toBe('ok')
    expect(body.service).toBe('llm-mock')
    expect(typeof body.version).toBe('string')
  })
})

describe('the catalog of the models', () => {
  test('answers both gateway shapes', async () => {
    const { app } = makeApp()

    const vercel = await app.fetch(new Request('http://localhost/v1/models'))
    expect(vercel.status).toBe(200)
    const vercelBody = (await vercel.json()) as { data?: Record<string, unknown>[] }
    expect(Array.isArray(vercelBody.data)).toBe(true)
    expect(vercelBody.data?.length).toBeGreaterThan(0)

    const openRouter = await app.fetch(new Request('http://localhost/api/v1/models'))
    expect(openRouter.status).toBe(200)
    const openRouterBody = (await openRouter.json()) as { data?: Record<string, unknown>[] }
    expect(Array.isArray(openRouterBody.data)).toBe(true)
    expect(openRouterBody.data?.length).toBeGreaterThan(0)
  })

  test('answers one model of the Vercel shape', async () => {
    const { app } = makeApp()
    const list = (await (await app.fetch(new Request('http://localhost/v1/models'))).json()) as {
      data?: Record<string, unknown>[]
    }
    const first = list.data?.[0]
    const id = first?.id
    expect(typeof id).toBe('string')

    const response = await app.fetch(new Request(`http://localhost/v1/models/${String(id)}`))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.id).toBe(id)
  })

  test('answers 404 for a model that is not there', async () => {
    const { app } = makeApp()
    const response = await app.fetch(new Request('http://localhost/v1/models/no-such-model'))

    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('model_not_found')
  })
})

describe('the key of the request', () => {
  test('refuses a request without a key', async () => {
    const { app } = makeApp()
    const response = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chat('oi')),
      }),
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('invalid_api_key')
    expect(body.error.message).toBe('missing api key')
  })

  const magicKeys = [
    { key: 'mock-invalid-key', status: 401, code: 'invalid_api_key' },
    { key: 'mock-no-credit', status: 402, code: 'insufficient_credits' },
    { key: 'mock-rate-limited', status: 429, code: 'rate_limit_exceeded' },
    { key: 'mock-down', status: 503, code: 'service_unavailable' },
  ]

  for (const magic of magicKeys) {
    test(`fails the magic key ${magic.key}`, async () => {
      const { app } = makeApp({ LLM_REQUIRE_AUTH: '0' })
      const response = await post(
        app,
        '/v1/chat/completions',
        chat('oi'),
        { authorization: `Bearer ${magic.key}` },
      )

      expect(response.status).toBe(magic.status)
      const body = (await response.json()) as { error: { code: string } }
      expect(body.error.code).toBe(magic.code)
      if (magic.status === 429) expect(response.headers.get('retry-after')).toBe('1')
    })
  }

  test('refuses an unknown model when the settings say so', async () => {
    const { app } = makeApp({ LLM_UNKNOWN_MODELS: 'reject' })
    const response = await post(app, '/v1/chat/completions', chat('oi', { model: 'no-such-model' }))

    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('model_not_found')
    expect(body.error.message).toBe('model not found: no-such-model')
  })
})

describe('the rules', () => {
  test('a rule answers once and then the auto reply answers', async () => {
    const { app } = makeApp()

    const created = await post(app, '/_mock/llm/rules', {
      match: { lastUser: 'faturamento' },
      reply: {
        kind: 'tool_calls',
        calls: [{ name: 'query_metrics', arguments: { period: '30d' } }],
      },
      times: 1,
    })
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as { rules: { id: string }[] }
    expect(createdBody.rules.length).toBe(1)

    const first = await post(
      app,
      '/v1/chat/completions',
      chat('faturamento', {
        tools: [{ type: 'function', function: { name: 'query_metrics', parameters: { type: 'object' } } }],
      }),
    )
    expect(first.status).toBe(200)
    expect(await first.text()).toContain('query_metrics')

    // The rule reached its times: it is gone.
    expect(app.store.rules().length).toBe(0)

    const second = await post(app, '/v1/chat/completions', chat('outra pergunta'))
    expect(second.status).toBe(200)
    expect(await second.text()).not.toContain('query_metrics')
  })

  test('an error rule answers with its status', async () => {
    const { app } = makeApp()
    await post(app, '/_mock/llm/rules', {
      match: { lastUser: 'erro' },
      reply: { kind: 'error', status: 503, message: 'boom' },
    })

    const response = await post(app, '/v1/chat/completions', chat('erro'))
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { message: string } }
    expect(body.error.message).toBe('boom')
  })

  test('a rule that does not validate changes nothing', async () => {
    const { app } = makeApp()
    const response = await post(app, '/_mock/llm/rules', {
      match: { lastUser: 'faturamento' },
      reply: { kind: 'text', text: 42 },
    })

    expect(response.status).toBe(400)
    expect(app.store.rules().length).toBe(0)
  })
})

describe('the answer of a chat completion', () => {
  test('the stream ends with DONE and carries the usage', async () => {
    const { app } = makeApp()
    const response = await post(
      app,
      '/api/v1/chat/completions',
      chat('oi', { stream: true, stream_options: { include_usage: true }, usage: { include: true } }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true)
    expect(text).toContain('data: ')
    expect(text).toContain('usage')
  })

  test('the wait is the latency of the settings, the rule and the message', async () => {
    const { app, waits } = makeApp({ LLM_LATENCY_MS: '100' })
    await post(app, '/_mock/llm/rules', {
      match: { lastUser: 'faturamento' },
      reply: { kind: 'text', text: 'ok' },
      latencyMs: 50,
    })

    const response = await post(app, '/v1/chat/completions', chat('faturamento [mock:latency=25]'))
    expect(response.status).toBe(200)
    expect(waits).toContain(175)

    const logged = app.store.requests(10)
    expect(logged[0]?.latencyMs).toBe(175)
  })

  test('a request without a model is refused', async () => {
    const { app } = makeApp()
    const response = await post(app, '/v1/chat/completions', { messages: [{ role: 'user', content: 'oi' }] })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('invalid_request_error')
  })
})

describe('the log of the requests', () => {
  test('keeps the newest first and never the key', async () => {
    const { app } = makeApp()
    await post(app, '/v1/chat/completions', chat('one', { model: 'first-model' }))
    await post(app, '/v1/chat/completions', chat('two', { model: 'second-model' }))

    const response = await app.fetch(new Request('http://localhost/_mock/llm/requests'))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('test-key')

    const entries = JSON.parse(text) as { model: string }[]
    expect(entries[0]?.model).toBe('second-model')
    expect(entries[1]?.model).toBe('first-model')
  })
})

describe('the local guard', () => {
  test('refuses a foreign host and admits the name of the service', async () => {
    const { app } = makeApp()

    const refused = await app.fetch(new Request('http://evil.example/_mock/llm/state'))
    expect(refused.status).toBe(403)

    const allowed = await app.fetch(new Request('http://llm-mock/_mock/llm/state'))
    expect(allowed.status).toBe(200)
  })
})

describe('the reset', () => {
  test('goes back to the rules of the boot', async () => {
    const boot = JSON.stringify({
      rules: [{ match: { lastUser: 'boot' }, reply: { kind: 'text', text: 'from boot' } }],
    })
    const { app } = makeApp({ LLM_CONFIG_JSON: boot })
    expect(app.store.rules().length).toBe(1)

    await post(app, '/_mock/llm/rules', {
      match: { lastUser: 'other' },
      reply: { kind: 'text', text: 'other' },
    })
    expect(app.store.rules().length).toBe(2)

    const response = await post(app, '/_mock/llm/reset', {})
    expect(response.status).toBe(200)
    expect(app.store.rules().length).toBe(1)
    expect(app.store.rules()[0]?.match.lastUser).toBe('boot')
  })
})
