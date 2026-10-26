/**
 * `/_mock` payment controls: one POST per outcome, no access_token, any account.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { webhookEvents } from '../../src/db/schema/index.ts'
import { createHarness, createSecondAccount, type ApiClient, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

async function newPayment(
  billingType: 'PIX' | 'BOLETO',
  api: ApiClient = h.api,
): Promise<string> {
  const cus = await api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  const pay = await api.call('create-new-payment', {
    body: { customer: cus.body.id, billingType, value: 100, dueDate: '2026-01-10' },
  })
  expect(pay.status).toBe(200)
  return pay.body.id
}

const post = (path: string, body?: unknown) =>
  h.app.app.handle(
    new Request(`http://localhost/_mock${path}`, {
      method: 'POST',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )

const queuedEvents = async (accountId: string) =>
  (await h.app.db.select().from(webhookEvents).where(eq(webhookEvents.accountId, accountId))).map(
    (e) => e.event,
  )

describe('/_mock/payments/:id', () => {
  it('receive on a Pix ends RECEIVED and queues PAYMENT_RECEIVED', async () => {
    await h.subscribeWebhook(['PAYMENT_RECEIVED'])
    const id = await newPayment('PIX')

    const res = await post(`/payments/${id}/receive`)
    const body: any = await res.json()

    expect(res.status).toBe(200)
    expect(body.from).toBe('PENDING')
    expect(body.to).toBe('RECEIVED')
    expect(body.payment.status).toBe('RECEIVED')
    expect(body.events).toContain('PAYMENT_RECEIVED')
    expect(await queuedEvents(h.accountId)).toContain('PAYMENT_RECEIVED')

    await h.tick()
    expect(h.sink.eventsOf('PAYMENT_RECEIVED').length).toBe(1)
    await h.assertLedgerBalances()
  })

  it('receive on a boleto goes through CONFIRMED and ends RECEIVED', async () => {
    const id = await newPayment('BOLETO')

    const res = await post(`/payments/${id}/receive`)
    const body: any = await res.json()

    expect(res.status).toBe(200)
    expect(body.to).toBe('RECEIVED')
    expect(body.payment.status).toBe('RECEIVED')
    expect(body.events).toEqual(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
    // The creation queued PAYMENT_CREATED first; receive appends the two settlement events.
    expect((await queuedEvents(h.accountId)).slice(-2)).toEqual(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
    await h.assertLedgerBalances()
  })

  it('confirm stops a boleto at CONFIRMED', async () => {
    const id = await newPayment('BOLETO')
    const body: any = await (await post(`/payments/${id}/confirm`)).json()
    expect(body.to).toBe('CONFIRMED')
    expect(body.events).toEqual(['PAYMENT_CONFIRMED'])
  })

  it('overdue and fail turn a PENDING payment OVERDUE', async () => {
    for (const action of ['overdue', 'fail']) {
      const id = await newPayment('PIX')
      const res = await post(`/payments/${id}/${action}`)
      const body: any = await res.json()

      expect(res.status).toBe(200)
      expect(body.from).toBe('PENDING')
      expect(body.to).toBe('OVERDUE')
      expect(body.events).toEqual(['PAYMENT_OVERDUE'])
    }
  })

  it('refund on a received Pix emits PAYMENT_REFUNDED', async () => {
    const id = await newPayment('PIX')
    await post(`/payments/${id}/receive`)

    const res = await post(`/payments/${id}/refund`)
    const body: any = await res.json()

    expect(res.status).toBe(200)
    expect(body.from).toBe('RECEIVED')
    expect(body.to).toBe('REFUNDED')
    expect(body.events).toContain('PAYMENT_REFUNDED')
    await h.assertLedgerBalances()
  })

  it('unknown id is 404; confirm on a REFUNDED payment is 400', async () => {
    const missing = await post('/payments/pay_nope/confirm')
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as any).errors[0].code).toBeTruthy()

    const id = await newPayment('PIX')
    await post(`/payments/${id}/receive`)
    await post(`/payments/${id}/refund`)

    const res = await post(`/payments/${id}/confirm`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).errors[0].code).toBe('invalid_action')
  })
})

describe('GET /_mock/payments', () => {
  it('lists only the requested status, across accounts', async () => {
    const second = await createSecondAccount(h)
    const other = h.as(second.apiKey)

    const a = await newPayment('PIX')
    const b = await newPayment('PIX', other)
    const pending = await newPayment('PIX')
    await post(`/payments/${a}/receive`)
    await post(`/payments/${b}/receive`)

    const res = await h.app.app.handle(new Request('http://localhost/_mock/payments?status=RECEIVED'))
    const body: any = await res.json()

    expect(res.status).toBe(200)
    expect(body.object).toBe('list')
    expect(body.totalCount).toBe(2)
    expect(body.hasMore).toBe(false)
    expect(body.limit).toBe(50)
    const ids = body.data.map((p: any) => p.id)
    expect(ids.sort()).toEqual([a, b].sort())
    expect(ids).not.toContain(pending)
    expect(body.data.every((p: any) => p.status === 'RECEIVED')).toBe(true)
  })
})

describe('adminEnabled: false', () => {
  it('answers 404 on the mock routes', async () => {
    h.close()
    h = await createHarness({ adminEnabled: false })

    const list = await h.app.app.handle(new Request('http://localhost/_mock/payments'))
    expect(list.status).toBe(404)
    expect((await post('/payments/pay_x/receive')).status).toBe(404)
  })
})
