import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

/** The Asaas is not reachable in these tests: the routes that need it are refused first. */
const unreachable = (async () => {
  throw new Error('the Asaas mock is not reachable in this test')
}) as unknown as typeof fetch

const config = loadConfig({})
const app = createApp(config, { fetch: unreachable })

const request = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://localhost:45450${path}`, init))

const bodyOf = async (response: Response) => (await response.json()) as any

describe('the health check', () => {
  test('answers with the service and its version', async () => {
    const response = await request('/health')

    expect(response.status).toBe(200)
    const body = await bodyOf(response)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('generator')
    expect(typeof body.version).toBe('string')
  })
})

describe('the generation API', () => {
  test('lists the twelve kinds', async () => {
    const response = await request('/v1/kinds')

    expect(response.status).toBe(200)
    const body = await bodyOf(response)
    expect(body.kinds).toHaveLength(12)
    expect(body.kinds.map((kind: { id: string }) => kind.id)).toContain('pix-key')
  })

  test('answers the same batch for the same seed', async () => {
    const first = await request('/v1/cpf?count=3&seed=a')
    const firstText = await first.text()

    expect(first.status).toBe(200)
    expect(first.headers.get('access-control-allow-origin')).toBe('*')

    const body = JSON.parse(firstText)
    expect(body.count).toBe(3)
    expect(body.items).toHaveLength(3)

    const second = await request('/v1/cpf?count=3&seed=a')
    expect(await second.text()).toBe(firstText)
  })

  test('masks the documents of a person when asked', async () => {
    const response = await request('/v1/person?seed=a&formatted=true&now=2026-10-29')

    expect(response.status).toBe(200)
    const body = await bodyOf(response)
    expect(body.items[0].cpf).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/)
  })

  test('refuses a kind it does not know', async () => {
    const response = await request('/v1/nope')

    expect(response.status).toBe(400)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    const body = await bodyOf(response)
    expect(body.error.code).toBe('unknown_kind')
  })

  test('validates the documents', async () => {
    const valid = await request('/v1/validate/cpf/11144477735')
    expect(valid.status).toBe(200)
    expect((await bodyOf(valid)).valid).toBe(true)

    const invalid = await request('/v1/validate/cpf/11111111111')
    expect((await bodyOf(invalid)).valid).toBe(false)

    const unknown = await request('/v1/validate/nope/123')
    expect(unknown.status).toBe(400)
    expect((await bodyOf(unknown)).error.code).toBe('unknown_type')
  })

  test('answers the preflight of the browser', async () => {
    const response = await request('/v1/cpf', { method: 'OPTIONS' })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
  })
})

describe('the local guard', () => {
  test('keeps the panel bound to this machine', async () => {
    const response = await request('/', { headers: { host: 'evil.example' } })

    expect(response.status).toBe(403)
    const body = await bodyOf(response)
    expect(body.error.code).toBe('forbidden_host')
  })

  test('refuses a foreign origin on the population', async () => {
    const response = await request('/_mock/asaas/populate', {
      method: 'POST',
      headers: {
        host: 'localhost:45450',
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(response.status).toBe(403)
    const body = await bodyOf(response)
    expect(body.error.code).toBe('forbidden_origin')
  })
})

describe('the static files', () => {
  test('does not serve a file outside the core', async () => {
    const response = await request('/core/../config.ts')

    expect(response.status).toBe(404)
    expect((await bodyOf(response)).error.code).toBe('not_found')
  })

  test('serves the core modules for the browser', async () => {
    const response = await request('/core/rng.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
  })
})
