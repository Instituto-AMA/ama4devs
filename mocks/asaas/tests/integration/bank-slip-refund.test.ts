/**
 * POST /v3/payments/{id}/bankSlip/refund — the refund of a PAID bank slip.
 *
 * What matters here: the refund of a boleto is a REGISTRATION and not a refund.
 * The row is born PENDING, the charge keeps its status (the money is still
 * received), no PAYMENT_REFUNDED is sent and the 200 body is the spec's
 * `{ requestUrl }` shape — the link the payer uses to ask for the refund. The
 * provider answers later, through the control plane.
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
    body: { name: 'Payer', cpfCnpj: '24971563792' },
  })
  const p = await h.api.call('create-new-payment', {
    body: { customer: cus.body.id, billingType: 'BOLETO', value: 100, dueDate: '2026-01-10' },
  })
  await h.api.call('confirm-payment', { params: { id: p.body.id } })
  return p.body.id
}

describe('refund-bank-slip', () => {
  it('registers the refund of a CONFIRMED bank slip and changes no status', async () => {
    await h.subscribeWebhook(['PAYMENT_REFUNDED'])
    const id = await paidBoleto()

    const res = await h.api.call('refund-bank-slip', { params: { id } })
    expect(res.status).toBe(200)
    // The spec's 200 schema — a link, not the payment object.
    expect(res.body.requestUrl).toBeString()

    // The money has not moved: only the refund is in flight.
    const after = await h.api.call('retrieve-a-single-payment', { params: { id } })
    expect(after.body.status).toBe('CONFIRMED')
    expect(after.body.refunds[0]).toMatchObject({ status: 'PENDING', value: 100 })

    await h.tick()
    // A registration does not refund anything by itself.
    expect(h.sink.eventsOf('PAYMENT_REFUNDED')).toHaveLength(0)

    await h.assertLedgerBalances()
  })

  it('registers the refund of a RECEIVED bank slip without touching the balance', async () => {
    const id = await paidBoleto()

    // The bank slip credits in D+1 business day. Monday 05/01 → Tuesday 06/01.
    await h.advance({ days: 1 })
    const before = await h.api.call('retrieve-a-single-payment', { params: { id } })
    expect(before.body.status).toBe('RECEIVED')

    const res = await h.api.call('refund-bank-slip', { params: { id } })
    expect(res.status).toBe(200)

    const after = await h.api.call('retrieve-a-single-payment', { params: { id } })
    expect(after.body.status).toBe('RECEIVED')
    expect(after.body.refunds[0]).toMatchObject({ status: 'PENDING' })

    // The money is still in the balance: the ledger does not close by itself.
    await h.assertLedgerBalances()
  })

  it('a Pix is refused with 400 invalid_action — this path is bank-slip-only', async () => {
    const cus = await h.api.call('create-new-customer', {
      body: { name: 'Pix Payer', cpfCnpj: '98765432100' },
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

  it('a PENDING bank slip cannot be refunded — the machine refuses', async () => {
    const cus = await h.api.call('create-new-customer', {
      body: { name: 'Payer', cpfCnpj: '24971563792' },
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
