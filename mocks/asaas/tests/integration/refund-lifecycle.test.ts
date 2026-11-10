/**
 * The refund lifecycle.
 *
 * A refund is a REQUEST that the provider accepts first and settles later (or
 * refuses). The charge only follows the money: it becomes REFUNDED when the
 * refund reaches DONE, and nothing at all when the refund is refused.
 *
 * This is the case the Asaas sandbox cannot produce: a boleto whose refund the
 * payer registers and the provider denies.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { financialTransactions, webhookEvents } from '../../src/db/schema/index.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

async function customer(name = 'Fulano de Tal'): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name, cpfCnpj: '24971563792' },
  })
  expect(res.status).toBe(200)
  return res.body.id
}

/** A BOLETO paid AND credited: the money is in the balance. */
async function receivedBoleto(): Promise<string> {
  const cus = await customer()
  const p = await h.api.call('create-new-payment', {
    body: { customer: cus, billingType: 'BOLETO', value: 100, dueDate: '2026-01-10' },
  })
  await h.api.call('confirm-payment', { params: { id: p.body.id } })
  // The bank slip credits in D+1 business day. Monday 05/01 → Tuesday 06/01.
  await h.advance({ days: 1 })
  return p.body.id
}

/** A Pix paid: it goes straight to RECEIVED, with the money in the balance. */
async function receivedPix(): Promise<string> {
  const cus = await customer('Titular Pix')
  const p = await h.api.call('create-new-payment', {
    body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
  })
  await h.api.call('confirm-payment', { params: { id: p.body.id } })
  return p.body.id
}

const refundsOf = async (id: string) => {
  const res = await h.api.call('retrieve-refunds-of-a-single-payment', { params: { id } })
  expect(res.status).toBe(200)
  return res.body.data as any[]
}

const statusOf = async (id: string) => {
  const res = await h.api.call('retrieve-a-single-payment', { params: { id } })
  return res.body.status as string
}

/** The events the mock QUEUED (written in the same transaction as the change). */
const queuedEvents = async (): Promise<string[]> =>
  (await h.app.db.select().from(webhookEvents).where(eq(webhookEvents.accountId, h.accountId))).map(
    (e) => e.event,
  )

const ledgerOf = async () =>
  h.app.db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.accountId, h.accountId))

const control = (path: string) =>
  h.app.app.handle(new Request(`http://localhost/_mock${path}`, { method: 'POST' }))

describe('the boleto refund is a registration', () => {
  it('registers a PENDING refund, changes no status and sends no refund event', async () => {
    await h.subscribeWebhook(['PAYMENT_REFUNDED', 'PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_REFUND_DENIED'])
    const id = await receivedBoleto()

    const res = await h.api.call('refund-bank-slip', { params: { id } })
    expect(res.status).toBe(200)
    // The spec's 200 schema — a link, not the payment object.
    expect(res.body.requestUrl).toContain('/solicitar-estorno/')

    // The money is still received: only the refund is in flight.
    expect(await statusOf(id)).toBe('RECEIVED')

    const refunds = await refundsOf(id)
    expect(refunds).toHaveLength(1)
    expect(refunds[0]).toMatchObject({ status: 'PENDING', value: 100 })

    await h.tick()
    expect(h.sink.eventsOf('PAYMENT_REFUNDED')).toHaveLength(0)
    expect(h.sink.eventsOf('PAYMENT_REFUND_DENIED')).toHaveLength(0)

    await h.assertLedgerBalances()
  })

  it('complete settles it: the refund is DONE, the charge REFUNDED, the money comes back', async () => {
    await h.subscribeWebhook(['PAYMENT_REFUNDED'])
    const id = await receivedBoleto()
    await h.api.call('refund-bank-slip', { params: { id } })

    const res = await control(`/payments/${id}/refund/complete`)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.from).toBe('RECEIVED')
    expect(body.to).toBe('REFUNDED')
    expect(body.events).toContain('PAYMENT_REFUNDED')

    expect((await refundsOf(id))[0].status).toBe('DONE')
    expect(await statusOf(id)).toBe('REFUNDED')

    await h.tick()
    expect(h.sink.eventsOf('PAYMENT_REFUNDED')).toHaveLength(1)

    // The reversal is in the statement, and the statement closes.
    expect((await ledgerOf()).map((l) => l.type)).toContain('PAYMENT_REVERSAL')
    await h.assertLedgerBalances()
  })

  it('deny refuses it: the refund is CANCELLED, the charge stays received, nothing moves', async () => {
    await h.subscribeWebhook(['PAYMENT_REFUND_DENIED'])
    const id = await receivedBoleto()
    await h.api.call('refund-bank-slip', { params: { id } })

    const res = await control(`/payments/${id}/refund/deny`)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.from).toBe('RECEIVED')
    expect(body.to).toBe('RECEIVED')
    expect(body.events).toContain('PAYMENT_REFUND_DENIED')

    expect((await refundsOf(id))[0].status).toBe('CANCELLED')
    expect(await statusOf(id)).toBe('RECEIVED')

    await h.tick()
    expect(h.sink.eventsOf('PAYMENT_REFUND_DENIED')).toHaveLength(1)
    // No money went back: there is no reversal in the statement.
    expect((await ledgerOf()).map((l) => l.type)).not.toContain('PAYMENT_REVERSAL')

    await h.assertLedgerBalances()
  })

  it('a charge with no pending refund refuses the control', async () => {
    const id = await receivedBoleto()

    const res = await control(`/payments/${id}/refund/deny`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).errors[0].code).toBe('invalid_action')
  })
})

describe('the automatic refund goes through PENDING and settles on the tick', () => {
  it('a Pix refund is PENDING, announces itself and settles on the next tick', async () => {
    await h.subscribeWebhook(['PAYMENT_REFUND_IN_PROGRESS', 'PAYMENT_REFUNDED'])
    const id = await receivedPix()

    const res = await h.api.call('refund-payment', { params: { id }, body: { value: 100 } })
    expect(res.status).toBe(200)
    // The money has NOT moved yet: the charge keeps its status.
    expect(res.body.status).toBe('RECEIVED')
    expect(res.body.refunds[0]).toMatchObject({ status: 'PENDING', value: 100 })

    const queued = await queuedEvents()
    expect(queued).toContain('PAYMENT_REFUND_IN_PROGRESS')
    expect(queued).not.toContain('PAYMENT_REFUNDED')

    await h.tick()

    expect((await refundsOf(id))[0].status).toBe('DONE')
    expect(await statusOf(id)).toBe('REFUNDED')
    expect(h.sink.eventsOf('PAYMENT_REFUNDED')).toHaveLength(1)

    // The reversal is in the statement, and the statement closes.
    expect((await ledgerOf()).map((l) => l.type)).toContain('PAYMENT_REVERSAL')
    await h.assertLedgerBalances()
  })

  it('a partial refund keeps the charge paid and posts only the refunded part', async () => {
    await h.subscribeWebhook(['PAYMENT_PARTIALLY_REFUNDED'])
    const id = await receivedPix()

    const res = await h.api.call('refund-payment', { params: { id }, body: { value: 40 } })
    expect(res.body.status).toBe('RECEIVED')
    expect(res.body.refunds[0]).toMatchObject({ status: 'PENDING', value: 40 })

    await h.tick()

    expect((await refundsOf(id))[0].status).toBe('DONE')
    // The charge is still paid: only a part of the money went back.
    expect(await statusOf(id)).toBe('RECEIVED')
    expect(h.sink.eventsOf('PAYMENT_PARTIALLY_REFUNDED')).toHaveLength(1)

    const reversal = (await ledgerOf()).find((l) => l.type === 'PAYMENT_REVERSAL')
    expect(reversal).toBeDefined()
    expect(reversal!.valueCents).toBe(-4000)

    await h.assertLedgerBalances()
  })
})

describe('the refunds of a charge', () => {
  it('GET /v3/payments/:id/refunds answers the list, in the Asaas shape', async () => {
    const id = await receivedBoleto()
    await h.api.call('refund-bank-slip', { params: { id } })

    const res = await h.api.call('retrieve-refunds-of-a-single-payment', { params: { id } })
    expect(res.status).toBe(200)
    expect(res.body.object).toBe('list')
    expect(res.body.totalCount).toBe(1)
    expect(res.body.limit).toBe(10)
    expect(res.body.data[0]).toMatchObject({
      status: 'PENDING',
      value: 100,
      paymentId: id,
    })
  })

  it('a charge with no refund answers an empty list', async () => {
    const id = await receivedBoleto()

    const res = await h.api.call('retrieve-refunds-of-a-single-payment', { params: { id } })
    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(0)
    expect(res.body.data).toEqual([])
  })
})
