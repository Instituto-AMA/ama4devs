import { afterEach, describe, expect, it } from 'bun:test'
import { createHarness, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

let h: Harness | undefined
afterEach(() => {
  h?.close()
  h = undefined
})

const request = (path: string, init?: RequestInit) =>
  h!.app.app.handle(new Request(`http://localhost${path}`, init))

const errorCode = async (response: Response) => {
  const body = (await response.json()) as { errors: Array<{ code: string }> }
  return body.errors[0]?.code
}

describe('local guard', () => {
  it('allows local hosts on the panel and admin routes', async () => {
    h = await createHarness()

    for (const path of ['/', '/_admin/clock']) {
      const response = await request(path, { headers: { host: 'localhost:45445' } })
      expect(response.status, `${path} should be allowed`).toBe(200)
    }
  })

  it('rejects unknown Host headers on every local-only route', async () => {
    h = await createHarness()

    for (const path of ['/', '/_admin/clock', '/_mock/anything']) {
      const response = await request(path, { headers: { host: 'evil.example' } })
      expect(response.status).toBe(403)
      expect(await errorCode(response)).toBe('forbidden_host')
    }
  })

  it('strips the port and accepts bracketed IPv6 hosts', async () => {
    h = await createHarness()

    const response = await request('/_admin/clock', {
      headers: { host: '[::1]:45445' },
    })
    expect(response.status).toBe(200)
  })

  it('rejects foreign origins on state-changing requests', async () => {
    h = await createHarness()

    const response = await request('/_admin/tick', {
      method: 'POST',
      headers: { host: 'localhost:45445', origin: 'http://evil.example' },
    })
    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe('forbidden_origin')
  })

  it('allows local origins and requests without an Origin header', async () => {
    h = await createHarness()

    const localOrigin = await request('/_admin/tick', {
      method: 'POST',
      headers: { host: 'localhost:45445', origin: 'http://localhost:45445' },
    })
    expect(localOrigin.status).not.toBe(403)

    const withoutOrigin = await request('/_admin/tick', {
      method: 'POST',
      headers: { host: 'localhost:45445' },
    })
    expect(withoutOrigin.status).not.toBe(403)
  })

  it('refuses the opaque null origin (sandboxed iframe, data: or file: page)', async () => {
    h = await createHarness()

    const response = await request('/_admin/tick', {
      method: 'POST',
      headers: { host: 'localhost:45445', origin: 'null' },
    })
    expect(response.status).toBe(403)
  })

  it('does not check Origin on read-only requests', async () => {
    h = await createHarness()

    const response = await request('/_admin/clock', {
      headers: { host: 'localhost:45445', origin: 'http://evil.example' },
    })
    expect(response.status).toBe(200)
  })

  it('admits hosts configured through MOCK_ALLOWED_HOSTS', async () => {
    const previous = process.env.MOCK_ALLOWED_HOSTS
    process.env.MOCK_ALLOWED_HOSTS = 'asaas-mock'

    try {
      h = await createHarness()
      const response = await request('/', { headers: { host: 'asaas-mock:45445' } })
      expect(response.status).toBe(200)
    } finally {
      if (previous === undefined) delete process.env.MOCK_ALLOWED_HOSTS
      else process.env.MOCK_ALLOWED_HOSTS = previous
    }
  })

  it('leaves API and health routes outside the guard', async () => {
    h = await createHarness()

    const api = await request('/v3/myAccount/status', {
      headers: { host: 'evil.example', access_token: TEST_API_KEY },
    })
    expect(api.status).toBe(200)

    const health = await request('/health', { headers: { host: 'evil.example' } })
    expect(health.status).toBe(200)
  })
})
