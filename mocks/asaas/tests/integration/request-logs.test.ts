/**
 * Request Logs and the events no webhook took.
 *
 * What this file proves: every call to the API is recorded for its account, the
 * successes and the refusals (a validation 400, a 404, a disabled key's 401) with
 * the body that went in and the one that came back; card data is masked; a key
 * that exists nowhere records nothing; the admin list filters by outcome; only the
 * newest REQUEST_LOG_LIMIT per account are kept; and the webhook log lists the
 * events no webhook took, next to the deliveries.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { apiKeys, requestLogs } from '../../src/db/schema/index.ts'
import { bodyForLog, REQUEST_LOG_LIMIT } from '../../src/http/request-log.ts'
import { createHarness, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

let h: Harness
afterEach(() => h?.close())

async function admin(path: string) {
  const res = await h.app.app.handle(new Request(`http://localhost/_admin${path}`))
  return (await res.json()) as any
}

const raw = (path: string, init: RequestInit & { key?: string } = {}) =>
  h.app.app.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { access_token: init.key ?? TEST_API_KEY, 'content-type': 'application/json' },
    }),
  )

describe('Request Logs', () => {
  it('records successes and refusals with what went in and what came back', async () => {
    h = await createHarness()
    const created = await h.api.call('create-new-customer', {
      body: { name: 'Maria Souza', cpfCnpj: '24971563792' },
    })
    expect(created.status).toBe(200)
    await raw('/v3/customers', { method: 'POST', body: JSON.stringify({ name: 'No document', cpfCnpj: 'abc' }) })
    await raw('/v3/customers?limit=5&offset=0')
    await raw('/v3/does-not-exist')

    const list = await admin(`/request-logs?accountId=${h.accountId}`)
    expect(list.data.map((r: any) => [r.method, r.path, r.status])).toEqual([
      ['GET', '/v3/does-not-exist', 404],
      ['GET', '/v3/customers', 200],
      ['POST', '/v3/customers', 400],
      ['POST', '/v3/customers', 200],
    ])
    expect(list.data[1].query).toBe('limit=5&offset=0')
    expect(list.data[0].requestBody).toBeUndefined()

    const ok = await admin(`/request-logs/${list.data[3].id}`)
    expect(ok.requestBody).toMatchObject({ name: 'Maria Souza', cpfCnpj: '24971563792' })
    expect(ok.responseBody).toMatchObject({ id: created.body.id, object: 'customer' })
    const refused = await admin(`/request-logs/${list.data[2].id}`)
    expect(refused.responseBody.errors[0].code).toBeTruthy()
    const missing = await admin(`/request-logs/${list.data[0].id}`)
    expect(missing.responseBody.errors[0].code).toBe('not_found')

    expect((await admin(`/request-logs?accountId=${h.accountId}&status=error`)).data).toHaveLength(2)
    expect((await admin(`/request-logs?accountId=${h.accountId}&status=success`)).data).toHaveLength(2)
  })

  it("a disabled key's 401 is its account's; an unknown key records nothing", async () => {
    h = await createHarness()
    const [key] = await h.app.ctx.db.select().from(apiKeys).where(eq(apiKeys.key, TEST_API_KEY))
    await h.app.ctx.db.update(apiKeys).set({ active: false }).where(eq(apiKeys.id, key!.id))
    expect((await raw('/v3/customers')).status).toBe(401)
    expect((await raw('/v3/customers', { key: '$aact_hmlg_nobody' })).status).toBe(401)

    const rows = await h.app.ctx.db.select().from(requestLogs)
    expect(rows.map((r) => [r.accountId, r.status, r.apiKeyId])).toEqual([[h.accountId, 401, key!.id]])
  })

  it('masks card data and describes files', () => {
    expect(bodyForLog({ creditCard: { number: '4111111111111111', ccv: '123', holderName: 'Maria' } })).toEqual({
      creditCard: { number: '411111******1111', ccv: '***', holderName: 'Maria' },
    })
    const form = new FormData()
    form.set('documentFile', new File(['abc'], 'rg.png', { type: 'image/png' }))
    form.set('type', 'IDENTIFICATION')
    expect(bodyForLog(form)).toEqual({ documentFile: { file: 'rg.png', type: 'image/png', size: 3 }, type: 'IDENTIFICATION' })
    const big = bodyForLog({ text: 'x'.repeat(70_000) }) as any
    expect(big.truncated).toBe(true)
    expect(big.start).toHaveLength(64_000)
  })

  it('keeps the newest calls of each account', async () => {
    h = await createHarness()
    const now = { dateCreated: '2026-01-05 09:00:00', createdAtMs: 0, method: 'GET', path: '/v3/x', query: '', status: 200 }
    const rows = Array.from({ length: REQUEST_LOG_LIMIT + 5 }, () => ({ ...now, accountId: h.accountId }))
    for (let i = 0; i < rows.length; i += 500) await h.app.ctx.db.insert(requestLogs).values(rows.slice(i, i + 500))
    await h.tick()
    const kept = await h.app.ctx.db.select({ id: requestLogs.id }).from(requestLogs)
    expect(kept).toHaveLength(REQUEST_LOG_LIMIT)
    expect(Math.min(...kept.map((r) => r.id))).toBe(6)
  })
})

describe('Webhook Logs', () => {
  it('lists the events no webhook took next to the deliveries', async () => {
    h = await createHarness()
    const customer = await h.api.call('create-new-customer', { body: { name: 'Maria', cpfCnpj: '24971563792' } })
    const charge = { customer: customer.body.id, billingType: 'PIX', value: 50, dueDate: '2026-01-20' }
    await h.api.call('create-new-payment', { body: charge })

    const before = await admin(`/webhooks/deliveries?accountId=${h.accountId}`)
    expect(before.data.map((d: any) => [d.event, d.status, d.webhookName])).toEqual([
      ['PAYMENT_CREATED', 'NO_WEBHOOK', null],
    ])
    expect(before.data[0].payload.payment.value).toBe(50)

    await h.api.call('create-new-webhook', {
      body: {
        name: 'Integration',
        url: h.sink.url,
        email: 'dev@localhost',
        sendType: 'NON_SEQUENTIALLY',
        authToken: 'a'.repeat(32),
        events: ['PAYMENT_CREATED'],
      },
    })
    await h.api.call('create-new-payment', { body: charge })
    const after = await admin(`/webhooks/deliveries?accountId=${h.accountId}`)
    expect(after.data.map((d: any) => [d.event, d.status === 'NO_WEBHOOK' ? 'none' : 'delivery'])).toEqual([
      ['PAYMENT_CREATED', 'delivery'],
      ['PAYMENT_CREATED', 'none'],
    ])
  })
})
