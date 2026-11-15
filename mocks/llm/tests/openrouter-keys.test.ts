import { describe, expect, test } from 'bun:test'
import { makeApp } from './helpers.ts'

const BASE = 'http://localhost:45470/api/v1'
const PROVISIONING = 'mock-llm-openrouter-provisioning-0000'

/** A request of the Hub's `openrouter` adapter with the Provisioning Key. */
function manage(method: string, path: string, body?: unknown, token = PROVISIONING): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function createKey(app: ReturnType<typeof makeApp>['app'], name = 'hub-dev-tenant'): Promise<{ key: string; data: { hash: string } }> {
  const response = await app.fetch(manage('POST', '/keys', { name, limit: 5, limit_reset: 'monthly' }))
  expect(response.status).toBe(201)
  return response.json()
}

describe('openrouter key management', () => {
  test('creates a key with its limit and answers its value once', async () => {
    const { app } = makeApp()
    const created = await createKey(app)
    expect(created.key.startsWith('sk-or-v1-mock')).toBe(true)
    const list = await (await app.fetch(manage('GET', '/keys?offset=0&include_disabled=true'))).json()
    expect(list.data).toHaveLength(1)
    expect(list.data[0]).toMatchObject({ hash: created.data.hash, name: 'hub-dev-tenant', limit: 5, limit_reset: 'monthly' })
    expect(JSON.stringify(list)).not.toContain(created.key)
  })

  test('reads, limits, disables and deletes a key by its hash', async () => {
    const { app } = makeApp()
    const { data } = await createKey(app)
    const read = await (await app.fetch(manage('GET', `/keys/${data.hash}`))).json()
    expect(read.data.limit).toBe(5)
    const limited = await (await app.fetch(manage('PATCH', `/keys/${data.hash}`, { limit: 12, limit_reset: 'monthly' }))).json()
    expect(limited.data.limit).toBe(12)
    await app.fetch(manage('PATCH', `/keys/${data.hash}`, { disabled: true }))
    const active = await (await app.fetch(manage('GET', '/keys?offset=0'))).json()
    expect(active.data).toHaveLength(0)
    expect((await app.fetch(manage('DELETE', `/keys/${data.hash}`))).status).toBe(204)
    expect((await app.fetch(manage('GET', `/keys/${data.hash}`))).status).toBe(404)
  })

  test('lists one workspace at a time and pages by 100', async () => {
    const { app } = makeApp()
    for (let i = 0; i < 101; i++) await createKey(app, `k${i}`)
    await app.fetch(manage('POST', '/keys', { name: 'other', limit: 1, workspace_id: 'ws-2' }))
    const first = await (await app.fetch(manage('GET', '/keys?offset=0'))).json()
    const second = await (await app.fetch(manage('GET', '/keys?offset=100'))).json()
    expect(first.data).toHaveLength(100)
    expect(second.data).toHaveLength(1)
    const named = await (await app.fetch(manage('GET', '/keys?offset=0&workspace_id=ws-2'))).json()
    expect(named.data.map((k: { name: string }) => k.name)).toEqual(['other'])
  })

  test('refuses the management routes to a key it created and without a bearer', async () => {
    const { app } = makeApp()
    const { key } = await createKey(app)
    expect((await app.fetch(manage('GET', '/keys', undefined, key))).status).toBe(401)
    expect((await app.fetch(new Request(`${BASE}/keys`))).status).toBe(401)
  })

  test('GET /key tells the Provisioning Key from a key it created', async () => {
    const { app } = makeApp()
    const { key } = await createKey(app)
    const management = await (await app.fetch(manage('GET', '/key'))).json()
    expect(management.data.is_management_key).toBe(true)
    const own = await (await app.fetch(manage('GET', '/key', undefined, key))).json()
    expect(own.data).toMatchObject({ is_management_key: false, limit: 5 })
    expect((await app.fetch(manage('GET', '/key', undefined, 'sk-or-v1-mock-unknown'))).status).toBe(401)
  })

  test('a created key embeds, and a reset forgets every key', async () => {
    const { app } = makeApp()
    const { key, data } = await createKey(app)
    const embed = await app.fetch(
      new Request(`${BASE}/embeddings`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'intfloat/multilingual-e5-large', input: ['passage: oi'] }),
      }),
    )
    expect(embed.status).toBe(200)
    expect(app.openRouterKeys.list()).toHaveLength(1)
    await app.fetch(new Request('http://localhost:45470/_mock/llm/reset', { method: 'POST' }))
    expect(app.openRouterKeys.list()).toHaveLength(0)
    expect((await app.fetch(manage('GET', `/keys/${data.hash}`))).status).toBe(404)
  })

  test('credits answer the account balance to any bearer', async () => {
    const { app } = makeApp()
    const credits = await (await app.fetch(manage('GET', '/credits'))).json()
    expect(credits.data).toEqual({ total_credits: 100, total_usage: 0 })
  })
})
