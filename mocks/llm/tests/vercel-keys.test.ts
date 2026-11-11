import { describe, expect, test } from 'bun:test'
import { makeApp } from './helpers.ts'

const BASE = 'http://localhost:45470'
const TOKEN = 'mock-llm-platform-key-0000'
const TEAM = 'team_llmmock'

/** A request of the Hub's `vercelkeys` adapter: the token and the team. */
function manage(method: string, path: string, body?: unknown, team = TEAM): Request {
  const url = `${BASE}/_vercel${path}${path.includes('?') ? '&' : '?'}teamId=${team}`
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** A chat completion with a key. */
function chat(key: string): Request {
  return new Request(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'oi' }] }),
  })
}

async function createKey(app: ReturnType<typeof makeApp>['app'], limitAmount = 25): Promise<{ apiKeyString: string; apiKey: { id: string } }> {
  const response = await app.fetch(
    manage('POST', '/v1/api-keys', {
      purpose: 'ai-gateway',
      name: 'hub-dev-tenant',
      metadata: { spendAttribution: 'team' },
      aiGatewayQuota: { limitAmount, refreshPeriod: 'monthly' },
    }),
  )
  expect(response.status).toBe(201)
  return response.json()
}

describe('vercel key management', () => {
  test('creates a team key with its budget, once with its value', async () => {
    const { app } = makeApp()
    const created = await createKey(app)
    expect(created.apiKeyString.startsWith('vck_mock_')).toBe(true)
    const list = await (await app.fetch(manage('GET', '/v1/api-keys?purpose=ai-gateway'))).json()
    expect(list.apiKeys).toHaveLength(1)
    expect(list.apiKeys[0]).toMatchObject({ id: created.apiKey.id, name: 'hub-dev-tenant', quota: { limitAmount: 25, currentSpend: 0 } })
    expect(JSON.stringify(list)).not.toContain(created.apiKeyString)
  })

  test('lists only the keys of the asked team', async () => {
    const { app } = makeApp()
    await createKey(app)
    const other = await (await app.fetch(manage('GET', '/v1/api-keys', undefined, 'team_other'))).json()
    expect(other.apiKeys).toHaveLength(0)
  })

  test('refuses a call without the management token or with a gateway key', async () => {
    const { app } = makeApp()
    const created = await createKey(app)
    const bare = await app.fetch(new Request(`${BASE}/_vercel/v1/api-keys?teamId=${TEAM}`))
    expect(bare.status).toBe(403)
    const withKey = await app.fetch(
      new Request(`${BASE}/_vercel/v2/user`, { headers: { authorization: `Bearer ${created.apiKeyString}` } }),
    )
    expect(withKey.status).toBe(403)
  })

  test('the gateway takes the key, counts its spend and refuses it past the budget', async () => {
    const { app } = makeApp()
    const created = await createKey(app, 1)
    const credits = await app.fetch(
      new Request(`${BASE}/v1/credits`, { headers: { authorization: `Bearer ${created.apiKeyString}` } }),
    )
    expect(credits.status).toBe(200)
    expect((await app.fetch(chat(created.apiKeyString))).status).toBe(200)
    const key = app.vercelKeys.find(created.apiKeyString)
    expect(key?.quota?.currentSpend).toBeGreaterThan(0)
    if (key?.quota) key.quota.currentSpend = key.quota.limitAmount
    const refused = await app.fetch(chat(created.apiKeyString))
    expect(refused.status).toBe(402)
    expect(JSON.stringify(await refused.json())).toContain('quota_for_entity_exceeded')
  })

  test('changes the budget and deletes the key; a gone key is 404', async () => {
    const { app } = makeApp()
    const created = await createKey(app)
    const patched = await app.fetch(manage('PATCH', `/v1/api-keys/${created.apiKey.id}/quota`, { limitAmount: 120, refreshPeriod: 'monthly' }))
    expect((await patched.json()).quota.limitAmount).toBe(120)
    expect((await app.fetch(manage('DELETE', `/v1/api-keys/${created.apiKey.id}`))).status).toBe(204)
    expect((await app.fetch(manage('DELETE', `/v1/api-keys/${created.apiKey.id}`))).status).toBe(404)
    const credits = await app.fetch(
      new Request(`${BASE}/v1/credits`, { headers: { authorization: `Bearer ${created.apiKeyString}` } }),
    )
    expect(credits.status).toBe(401)
  })

  test('the user read answers the management token', async () => {
    const { app } = makeApp()
    const user = await app.fetch(new Request(`${BASE}/_vercel/v2/user`, { headers: { authorization: `Bearer ${TOKEN}` } }))
    expect(user.status).toBe(200)
  })
})
