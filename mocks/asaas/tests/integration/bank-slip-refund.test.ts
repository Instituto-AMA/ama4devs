/**
 * POST /v3/payments/{id}/bankSlip/refund — the refund of a PAID boleto.
 *
 * What matters here: the status goes through the SAME state machine as every
 * other transition (webhook emitted, ledger reversed when the money had
 * already credited), the 200 body is the spec's `{ requestUrl }` shape and NOT
 * the payment, and a non-boleto payment is refused instead of silently
 * refunded by the wrong gateway path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

/** Customer + BOLETO paid via the sandbox action (stops at CONFIRMED). */
async function paidBoleto() {
  const cus = await h.api.call('create-new-customer', {
    body: { name: 'Pagador', cpfCnpj: '24971563792' },
  })
  const p = await h.api.call('create-new-payment', {
    body: { customer: cus.body.id, billingType: 'BOLETO', value: 100, dueDate: '2026-01-10' },
  })
  await h.api.call('confirm-payment', { params: { id: p.body.id } })
  return p.body.id
}

describe('refund-bank-slip', () => {
  it('refunds a CONFIRMED boleto: REFUNDED and PAYMENT_REFUNDED queued', async () => {
    await h.subscribeWebhook(['PAYMENT_REFUNDED'])
    const id = await paidBoleto()

    const res = await h.api.call('refund-bank-slip', { params: { id } })
    expect(res.status).toBe(200)
    // The spec's 200 schema — a link, not the payment object.
    expect(res.body.requestUrl).toBeString()

    const after = await h.api.call('retrieve-a-single-payment', { params: { id } })
    expect(after.body.status).toBe('REFUNDED')

    await h.tick()
    expect(h.sink.eventsOf('PAYMENT_REFUNDED')).toHaveLength(1)

    await h.assertLedgerBalances()
  })

  it('refunds a RECEIVED boleto and reverses the credited balance', async () => {
    const id = await paidBoleto()

    // Boleto credits in D+1 business day. Monday 05/01 → Tuesday 06/01.
    await h.advance({ days: 1 })
    const before = await h.api.call('retrieve-a-single-payment', { params: { id } })
    expect(before.body.status).toBe('RECEIVED')

    const res = await h.api.call('refund-bank-slip', { params: { id } })
    expect(res.status).toBe(200)

    const after = await h.api.call('retrieve-a-single-payment', { params: { id } })
    expect(after.body.status).toBe('REFUNDED')

    // The machine debits the credited value back — the ledger must close.
    await h.assertLedgerBalances()
  })

  it('a Pix is refused with 400 invalid_action — this path is boleto-only', async () => {
    const cus = await h.api.call('create-new-customer', {
      body: { name: 'Pagador Pix', cpfCnpj: '98765432100' },
    })
    const p = await h.api.call('create-new-payment', {
      body: { customer: cus.body.id, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })
    await h.api.call('confirm-payment', { params: { id: p.body.id } }) // Pix goes straight to RECEIVED

    const res = await h.api.call('refund-bank-slip', { params: { id: p.body.id } })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_action')

    // Untouched: still RECEIVED.
    const after = await h.api.call('retrieve-a-single-payment', { params: { id: p.body.id } })
    expect(after.body.status).toBe('RECEIVED')
  })

  it('a PENDING boleto cannot be refunded — the machine refuses', async () => {
    const cus = await h.api.call('create-new-customer', {
      body: { name: 'Pagador', cpfCnpj: '24971563792' },
    })
    const p = await h.api.call('create-new-payment', {
      body: { customer: cus.body.id, billingType: 'BOLETO', value: 100, dueDate: '2026-01-10' },
    })

    const res = await h.api.call('refund-bank-slip', { params: { id: p.body.id } })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_action')
  })

  it('unknown id is 404', async () => {
    const res = await h.api.call('refund-bank-slip', { params: { id: 'pay_nonexistent' } })
    expect(res.status).toBe(404)
  })
})
