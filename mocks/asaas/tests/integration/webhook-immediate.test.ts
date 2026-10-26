/**
 * Webhooks go out right after a mutating request, not on the next tick. The queue is the signal:
 * the HTTP layer calls `scheduler.dispatchNow()` once the handler finished with a 2xx.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
let dispatchCalls: number

beforeEach(async () => {
  h = await createHarness()
  dispatchCalls = 0
  const scheduler = h.app.scheduler
  const original = scheduler.dispatchNow.bind(scheduler)
  scheduler.dispatchNow = () => {
    dispatchCalls++
    return original()
  }
})
afterEach(() => h.close())

async function newPayment(): Promise<string> {
  const cus = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  const pay = await h.api.call('create-new-payment', {
    body: { customer: cus.body.id, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
  })
  expect(pay.status).toBe(200)
  return pay.body.id
}

const post = (path: string, body?: unknown) =>
  h.app.app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )

/** The after-response hook runs once `handle` resolved: yield to it, then wait for the dispatch. */
async function settled(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await h.app.scheduler.idle()
}

describe('immediate webhook dispatch', () => {
  it('delivers PAYMENT_RECEIVED after /_mock receive, without a tick', async () => {
    await h.subscribeWebhook(['PAYMENT_RECEIVED'])
    const id = await newPayment()
    await settled()
    h.sink.clear()

    const res = await post(`/_mock/payments/${id}/receive`)
    expect(res.status).toBe(200)
    await settled()

    expect(h.sink.eventsOf('PAYMENT_RECEIVED').length).toBe(1)
  })

  it('holds the delivery while paused, and sends it once resumed', async () => {
    await h.subscribeWebhook(['PAYMENT_RECEIVED'])
    const id = await newPayment()
    await settled()
    h.sink.clear()

    expect((await post('/_admin/webhooks/pause')).status).toBe(200)
    await post(`/_mock/payments/${id}/receive`)
    await settled()
    expect(h.sink.received.length).toBe(0)

    expect((await post('/_admin/webhooks/resume')).status).toBe(200)
    await settled()
    expect(h.sink.eventsOf('PAYMENT_RECEIVED').length).toBe(1)
  })

  it('does not dispatch after a 4xx request', async () => {
    const before = dispatchCalls
    const res = await h.app.app.handle(
      new Request('http://localhost/v3/customers', {
        method: 'POST',
        headers: { access_token: 'x'.repeat(8), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Sem CPF' }),
      }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    await settled()

    expect(dispatchCalls).toBe(before)
  })

  it('delivers two quick changes in order, in at most two passes', async () => {
    await h.subscribeWebhook(['PAYMENT_RECEIVED', 'PAYMENT_OVERDUE'])
    const a = await newPayment()
    const b = await newPayment()
    await settled()
    h.sink.clear()
    const before = dispatchCalls

    await post(`/_mock/payments/${a}/receive`)
    await post(`/_mock/payments/${b}/overdue`)
    await settled()

    expect(h.sink.eventNames).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_OVERDUE'])
    expect(dispatchCalls - before).toBe(2)
  })

  it('coalesces calls made while a pass is queued into one promise', async () => {
    const first = h.app.scheduler.dispatchNow()
    const second = h.app.scheduler.dispatchNow()
    expect(second).toBe(first)
    await first
    await h.app.scheduler.idle()
  })
})
