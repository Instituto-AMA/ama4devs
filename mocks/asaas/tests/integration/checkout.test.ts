/**
 * Checkout — hosted payment session.
 *
 * The point this test protects: the cancellation is a TRANSITION, and the webhook is
 * an effect of it. Cancelling twice does not produce two CHECKOUT_CANCELED.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { checkouts, webhookEvents } from '../../src/db/schema/index.ts'
import { checkoutHandlers } from '../../src/modules/checkout/handlers.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

const BODY = {
  billingTypes: ['PIX'],
  chargeTypes: ['DETACHED'],
  minutesToExpire: 100,
  externalReference: 'order-42',
  callback: {
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/canceled',
  },
  items: [
    { name: 'T-shirt', description: 'Black', imageBase64: 'SU1BR0U=', quantity: 2, value: 100 },
  ],
}

const newCheckout = async (over: Record<string, unknown> = {}) => {
  const { status, body } = await h.api.call('create-new-checkout', {
    body: { ...BODY, ...over },
  })
  expect(status).toBe(200)
  return body
}

const eventsOf = (id: string, event: string) =>
  h.app.db
    .select()
    .from(webhookEvents)
    .where(and(eq(webhookEvents.resourceId, id), eq(webhookEvents.event, event)))

describe('creation', () => {
  it('returns 200 with the link, ACTIVE status and the echoed items', async () => {
    const checkout = await newCheckout()

    expect(checkout.status).toBe('ACTIVE')
    expect(checkout.link).toContain(`/checkoutSession/show/${checkout.id}`)
    expect(checkout.billingTypes).toEqual(['PIX'])
    expect(checkout.chargeTypes).toEqual(['DETACHED'])
    expect(checkout.minutesToExpire).toBe(100)
    expect(checkout.externalReference).toBe('order-42')
    expect(checkout.items[0].name).toBe('T-shirt')
    expect(checkout.callback.successUrl).toBe('https://example.com/success')
  })

  it('emits CHECKOUT_CREATED', async () => {
    const checkout = await newCheckout()
    const events = await eventsOf(checkout.id, 'CHECKOUT_CREATED')

    expect(events.length).toBe(1)
    expect((events[0]!.payload as any).checkout.id).toBe(checkout.id)
  })

  it('the amount is added in CENTS: 2 × R$ 100.55 = R$ 201.10', async () => {
    const checkout = await newCheckout({
      items: [
        {
          name: 'T-shirt',
          imageBase64: 'SU1BR0U=',
          quantity: 2,
          value: 100.55,
        },
      ],
    })

    // The money is NEVER added in reais: 2 × 100.55 as a float would give 201.10000000000002.
    const [row] = await h.app.db
      .select()
      .from(checkouts)
      .where(eq(checkouts.id, checkout.id))

    expect(row!.valueCents).toBe(20110)
  })

  it('without items → 400 invalid_items', async () => {
    const { status, body } = await h.api.call('create-new-checkout', {
      body: { ...BODY, items: [] },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_items')
  })

  it('RECURRENT requires the subscription data', async () => {
    const { status, body } = await h.api.call('create-new-checkout', {
      body: { ...BODY, chargeTypes: ['RECURRENT'] },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_subscription')
  })

  it('INSTALLMENT requires the installment data', async () => {
    const { status, body } = await h.api.call('create-new-checkout', {
      body: { ...BODY, chargeTypes: ['INSTALLMENT'] },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_installment')
  })

  it('without a callback → 400 (the spec declares it mandatory)', async () => {
    const { callback, ...noCallback } = BODY
    void callback

    const { status, body } = await h.api.call('create-new-checkout', { body: noCallback })

    expect(status).toBe(400)
    expect(body.errors.map((e: any) => e.code)).toContain('invalid_callback')
  })
})

describe('cancellation', () => {
  it('ACTIVE → CANCELED, and it emits CHECKOUT_CANCELED exactly once', async () => {
    const checkout = await newCheckout()

    const canceled = await h.api.call('cancel-a-checkout', {
      params: { id: checkout.id },
      body: {},
    })
    expect(canceled.status).toBe(200)
    expect(canceled.body.status).toBe('CANCELED')

    const again = await h.api.call('cancel-a-checkout', {
      params: { id: checkout.id },
      body: {},
    })
    expect(again.status).toBe(400)
    expect(again.body.errors[0].code).toBe('invalid_action')

    const events = await eventsOf(checkout.id, 'CHECKOUT_CANCELED')
    expect(events.length).toBe(1)
  })

  it('nonexistent checkout → 404', async () => {
    const { status } = await h.api.call('cancel-a-checkout', {
      params: { id: 'does-not-exist' },
      body: {},
    })

    expect(status).toBe(404)
  })

  it('the checkout of another account does not exist (404)', async () => {
    const checkout = await newCheckout()
    const other = await createSecondAccount(h, 'Neighbouring Account')

    const { status } = await h.as(other.apiKey).call('cancel-a-checkout', {
      params: { id: checkout.id },
      body: {},
    })

    expect(status).toBe(404)
  })
})
