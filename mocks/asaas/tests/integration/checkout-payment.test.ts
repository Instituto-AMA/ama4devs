/**
 * Checkout — paying it and letting it expire.
 *
 * What these tests protect: a paid checkout leaves behind exactly what the real
 * one does (a card subscription or a single charge, both marked with
 * `checkoutSession`), CHECKOUT_PAID and CHECKOUT_EXPIRED happen once, and a
 * refused card or a dead checkout creates nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import {
  checkouts,
  customers,
  paymentSplits,
  payments,
  subscriptionSplits,
  subscriptions,
  webhookEvents,
} from '../../src/db/schema/index.ts'
import { CARD_ERRORS } from '../../src/domain/credit-card.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

const ITEM = { name: 'Plano Mensal', imageBase64: 'SU1BR0U=', quantity: 1, value: 99.9 }
const CALLBACK = { successUrl: 'https://example.com/ok', cancelUrl: 'https://example.com/cancel' }

async function newCustomer(): Promise<string> {
  const { body } = await h.api.call('create-new-customer', {
    body: { name: 'Maria Souza', cpfCnpj: '24971563792' },
  })
  return body.id
}

async function newCheckout(over: Record<string, unknown> = {}) {
  const { status, body } = await h.api.call('create-new-checkout', {
    body: {
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      minutesToExpire: 60,
      externalReference: 'plan-42',
      callback: CALLBACK,
      items: [ITEM],
      subscription: { cycle: 'MONTHLY', nextDueDate: '2026-01-10' },
      ...over,
    },
  })
  expect(status).toBe(200)
  return body
}

const post = (path: string, body?: unknown) =>
  h.app.app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  )

const pay = async (id: string, body?: unknown) => {
  const r = await post(`/_mock/checkouts/${id}/pay`, body)
  return { status: r.status, body: (await r.json()) as any }
}

/** The events of the account, in the order they were queued. */
const queued = async () =>
  (
    await h.app.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.accountId, h.accountId))
      .orderBy(sql`rowid`)
  ).map((e) => ({ event: e.event, payload: e.payload as any }))

const statusOf = async (id: string) =>
  (await h.app.db.select().from(checkouts).where(eq(checkouts.id, id)))[0]!.status

describe('creation', () => {
  it('keeps an existing customer and links to this server', async () => {
    const customer = await newCustomer()
    const checkout = await newCheckout({ customer })

    expect(checkout.customer).toBe(customer)
    expect(checkout.link).toBe(`${h.app.ctx.config.invoiceBaseUrl}/checkoutSession/show/${checkout.id}`)
  })

  it('an unknown customer → 400 invalid_customer', async () => {
    const { status, body } = await h.api.call('create-new-checkout', {
      body: {
        billingTypes: ['PIX'],
        chargeTypes: ['DETACHED'],
        callback: CALLBACK,
        items: [ITEM],
        customer: 'cus_000000000000',
      },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_customer')
  })
})

describe('paying a RECURRENT checkout', () => {
  it('creates the card subscription, pays its first charge and emits CHECKOUT_PAID first', async () => {
    const customer = await newCustomer()
    const checkout = await newCheckout({ customer })

    const { status, body } = await pay(checkout.id)
    expect(status).toBe(200)
    expect(body.checkout.status).toBe('PAID')

    const sub = body.subscription
    expect(sub.billingType).toBe('CREDIT_CARD')
    expect(sub.customer).toBe(customer)
    expect(sub.cycle).toBe('MONTHLY')
    expect(sub.checkoutSession).toBe(checkout.id)
    // Observed against the real sandbox: the checkout's externalReference stays on the checkout.
    expect(sub.externalReference).toBeNull()

    expect(body.payment.status).toBe('CONFIRMED')
    expect(body.payment.subscription).toBe(sub.id)
    expect(body.payment.checkoutSession).toBe(checkout.id)
    expect(body.payment.externalReference).toBeNull()
    expect(body.payment.value).toBe(99.9)

    const events = await queued()
    const names = events.map((e) => e.event)
    expect(names.slice(-4)).toEqual([
      'CHECKOUT_PAID',
      'SUBSCRIPTION_CREATED',
      'PAYMENT_CREATED',
      'PAYMENT_CONFIRMED',
    ])
    const paid = events.find((e) => e.event === 'CHECKOUT_PAID')!
    expect(paid.payload.checkout.id).toBe(checkout.id)
    expect(paid.payload.checkout.status).toBe('PAID')
    expect(paid.payload.checkout.customer).toBe(customer)

    await h.assertLedgerBalances()
  })

  it('PAYMENT_FIRST queues CHECKOUT_PAID after the charge', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })

    const { status } = await pay(checkout.id, { eventOrder: 'PAYMENT_FIRST' })
    expect(status).toBe(200)

    const names = (await queued()).map((e) => e.event)
    expect(names.slice(-4)).toEqual([
      'SUBSCRIPTION_CREATED',
      'PAYMENT_CREATED',
      'PAYMENT_CONFIRMED',
      'CHECKOUT_PAID',
    ])
  })

  it('later charges carry the checkout and the saved card', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })
    const { body } = await pay(checkout.id)

    await h.advance({ days: 1 })

    const charges = await h.app.db
      .select()
      .from(payments)
      .where(eq(payments.subscriptionId, body.subscription.id))
    expect(charges.length).toBe(2)
    expect(charges.every((c) => c.checkoutSession === checkout.id)).toBe(true)
    expect(new Set(charges.map((c) => c.creditCardId)).size).toBe(1)
  })

  it('cannot be paid twice', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })
    await pay(checkout.id)

    const again = await pay(checkout.id)
    expect(again.status).toBe(400)
    expect(again.body.errors[0].code).toBe('invalid_action')

    const paid = (await queued()).filter((e) => e.event === 'CHECKOUT_PAID')
    expect(paid.length).toBe(1)
  })

  it('a refused card creates nothing and leaves the checkout ACTIVE', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })

    const { status, body } = await pay(checkout.id, {
      creditCard: { number: '5184019740373151' },
    })
    expect(status).toBe(400)
    // The issuer's refusal, the same captured sentence the API answers.
    expect(body.errors[0]).toEqual(CARD_ERRORS.DECLINE)

    expect(await statusOf(checkout.id)).toBe('ACTIVE')
    expect(await h.app.db.select().from(subscriptions)).toEqual([])
    expect((await queued()).map((e) => e.event)).not.toContain('CHECKOUT_PAID')
  })

  for (const eventOrder of ['CHECKOUT_FIRST', 'PAYMENT_FIRST'] as const) {
    it(`an endDate before the first due date is refused before anything is created (${eventOrder})`, async () => {
      // Created with these terms, the subscription would expire before its first
      // charge: a CHECKOUT_PAID with nothing paid behind it.
      const checkout = await newCheckout({
        customerData: { name: 'Ana Reis', cpfCnpj: '24971563792' },
        subscription: { cycle: 'MONTHLY', nextDueDate: '2026-02-10', endDate: '2026-01-01' },
      })

      const { status, body } = await pay(checkout.id, { eventOrder })
      expect(status).toBe(400)
      expect(body.errors[0].code).toBe('invalid_endDate')

      expect(await statusOf(checkout.id)).toBe('ACTIVE')
      expect(await h.app.db.select().from(subscriptions)).toEqual([])
      expect(await h.app.db.select().from(customers)).toEqual([])
      expect((await queued()).map((e) => e.event)).not.toContain('CHECKOUT_PAID')
    })
  }

  it('refuses Pix: a subscription is paid by card', async () => {
    const checkout = await newCheckout({
      customer: await newCustomer(),
      billingTypes: ['CREDIT_CARD', 'PIX'],
    })

    const { status, body } = await pay(checkout.id, { billingType: 'PIX' })
    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_billingType')
  })
})

describe('paying a DETACHED checkout', () => {
  const detached = (over: Record<string, unknown> = {}) =>
    newCheckout({ chargeTypes: ['DETACHED'], billingTypes: ['PIX', 'CREDIT_CARD'], subscription: undefined, ...over })

  it('by Pix: one charge, received, marked with the checkout', async () => {
    const checkout = await detached({ customer: await newCustomer() })

    const { status, body } = await pay(checkout.id)
    expect(status).toBe(200)
    expect(body.subscription).toBeUndefined()
    expect(body.payment.billingType).toBe('PIX')
    expect(body.payment.status).toBe('RECEIVED')
    expect(body.payment.checkoutSession).toBe(checkout.id)

    await h.assertLedgerBalances()
  })

  it('by card: the charge is confirmed', async () => {
    const checkout = await detached({ customer: await newCustomer() })

    const { body } = await pay(checkout.id, { billingType: 'CREDIT_CARD' })
    expect(body.payment.billingType).toBe('CREDIT_CARD')
    expect(body.payment.status).toBe('CONFIRMED')
  })

  it('the payer comes from customerData when there is no customer', async () => {
    const checkout = await detached({ customerData: { name: 'João Lima', cpfCnpj: '24971563792' } })

    const { body } = await pay(checkout.id)
    expect(body.payment.customer).toMatch(/^cus_/)
    expect(body.checkout.customer).toBe(body.payment.customer)
  })

  it('without customer nor customerData the payer must say who pays', async () => {
    const checkout = await detached()

    const missing = await pay(checkout.id)
    expect(missing.status).toBe(400)
    expect(missing.body.errors[0].code).toBe('invalid_customerData')
    expect(await statusOf(checkout.id)).toBe('ACTIVE')

    const typed = await pay(checkout.id, { customerData: { name: 'Ana Reis', cpfCnpj: '24971563792' } })
    expect(typed.status).toBe(200)
  })
})

describe('choosing the charge type', () => {
  const both = async () =>
    newCheckout({ customer: await newCustomer(), chargeTypes: ['DETACHED', 'RECURRENT'] })

  it('takes the first one when the payer does not choose', async () => {
    const { body } = await pay((await both()).id)
    expect(body.subscription).toBeUndefined()
    expect(body.payment.subscription).toBeFalsy() // a single charge has no subscription
  })

  it('takes the one the payer chose', async () => {
    const { body } = await pay((await both()).id, { chargeType: 'RECURRENT' })
    expect(body.subscription.checkoutSession).toBe(body.checkout.id)
  })

  it('refuses one the checkout does not offer', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })
    const { status, body } = await pay(checkout.id, { chargeType: 'DETACHED' })
    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_chargeType')
  })
})

describe('split', () => {
  // The checkout names the percentage `percentageValue`; the charge, `percentualValue`.
  const splitTo = (walletId: string) => [{ walletId, percentageValue: 30 }]

  it('a DETACHED checkout carries its split to the charge', async () => {
    const partner = await createSecondAccount(h, 'Partner Clinic')
    const checkout = await newCheckout({
      customer: await newCustomer(),
      chargeTypes: ['DETACHED'],
      billingTypes: ['PIX'],
      subscription: undefined,
      splits: splitTo(partner.walletId),
    })

    const { body } = await pay(checkout.id)
    const splits = await h.app.db
      .select()
      .from(paymentSplits)
      .where(eq(paymentSplits.paymentId, body.payment.id))
    expect(splits.map((s) => [s.walletId, s.percentualValueE4])).toEqual([[partner.walletId, 300_000]])

    await h.assertLedgerBalances()
  })

  it('a RECURRENT checkout carries it to the subscription and its charges', async () => {
    const partner = await createSecondAccount(h, 'Partner Clinic')
    const checkout = await newCheckout({ customer: await newCustomer(), splits: splitTo(partner.walletId) })

    const { body } = await pay(checkout.id)
    const template = await h.app.db
      .select()
      .from(subscriptionSplits)
      .where(eq(subscriptionSplits.subscriptionId, body.subscription.id))
    expect(template.map((s) => s.walletId)).toEqual([partner.walletId])

    const charged = await h.app.db
      .select()
      .from(paymentSplits)
      .where(eq(paymentSplits.paymentId, body.payment.id))
    expect(charged.map((s) => s.walletId)).toEqual([partner.walletId])
  })

  it('a split to the account itself is refused before anything is created', async () => {
    const checkout = await newCheckout({ customer: await newCustomer(), splits: splitTo(h.walletId) })

    const { status, body } = await pay(checkout.id)
    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_split')
    expect(await statusOf(checkout.id)).toBe('ACTIVE')
    expect(await h.app.db.select().from(subscriptions)).toEqual([])
  })
})

describe('expiration', () => {
  it('the tick expires it once its minutes run out, with one CHECKOUT_EXPIRED', async () => {
    const checkout = await newCheckout({ customer: await newCustomer(), minutesToExpire: 10 })

    await h.advance({ minutes: 9 })
    expect(await statusOf(checkout.id)).toBe('ACTIVE')

    await h.advance({ minutes: 2 })
    await h.tick()
    expect(await statusOf(checkout.id)).toBe('EXPIRED')

    const expired = (await queued()).filter((e) => e.event === 'CHECKOUT_EXPIRED')
    expect(expired.length).toBe(1)
    expect(expired[0]!.payload.checkout.status).toBe('EXPIRED')

    const late = await pay(checkout.id)
    expect(late.status).toBe(400)
    expect(late.body.errors[0].code).toBe('invalid_action')
  })

  it('paying past the time expires it there, before any tick', async () => {
    const checkout = await newCheckout({ customer: await newCustomer(), minutesToExpire: 10 })
    h.clock.advance(11 * 60_000)

    const late = await pay(checkout.id)
    expect(late.status).toBe(400)
    expect(await statusOf(checkout.id)).toBe('EXPIRED')
    expect(await h.app.db.select().from(subscriptions)).toEqual([])
  })

  it('/_mock/checkouts/:id/expire expires it now, and only an ACTIVE one', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })

    const r = await post(`/_mock/checkouts/${checkout.id}/expire`)
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).status).toBe('EXPIRED')

    const again = await post(`/_mock/checkouts/${checkout.id}/expire`)
    expect(again.status).toBe(400)
  })
})

describe('the checkout page', () => {
  it('shows the total and pays from the page', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })

    const page = await h.app.app.handle(new Request(`http://localhost/checkoutSession/show/${checkout.id}`))
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Plano Mensal')
    expect(html).toMatch(/R\$\s99,90/) // toLocaleString puts a no-break space after R$
    expect(html).toContain('Pagar com cartão')

    const paid = await post(`/checkoutSession/show/${checkout.id}/pay`, {
      billingType: 'CREDIT_CARD',
      creditCard: {
        holderName: 'TITULAR TESTE',
        number: '4444444444444444',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
      },
    })
    expect(paid.status).toBe(200)

    const after = await (
      await h.app.app.handle(new Request(`http://localhost/checkoutSession/show/${checkout.id}`))
    ).text()
    expect(after).toContain('Pago')
    expect(after).not.toContain('Pagar com cartão')
  })

  it('callback URLs cannot inject a script or a javascript: link', async () => {
    const checkout = await newCheckout({
      customer: await newCustomer(),
      callback: {
        successUrl: 'https://example.com/ok</script><script>alert(1)</script>$&',
        cancelUrl: 'javascript:alert(2)',
      },
    })
    const page = await (
      await h.app.app.handle(new Request(`http://localhost/checkoutSession/show/${checkout.id}`))
    ).text()
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('\\u003c/script>')
    expect(page).not.toContain('__SUCCESS__')

    await post(`/_mock/checkouts/${checkout.id}/expire`)
    const expired = await (
      await h.app.app.handle(new Request(`http://localhost/checkoutSession/show/${checkout.id}`))
    ).text()
    expect(expired).not.toContain('javascript:')
  })

  it('a foreign origin cannot pay through the page', async () => {
    const checkout = await newCheckout({ customer: await newCustomer() })
    const r = await h.app.app.handle(
      new Request(`http://localhost/checkoutSession/show/${checkout.id}/pay`, {
        method: 'POST',
        headers: { host: 'localhost:45445', origin: 'http://evil.example', 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(r.status).toBe(403)
    expect(await statusOf(checkout.id)).toBe('ACTIVE')
  })

  it('an unknown checkout → 404', async () => {
    const r = await h.app.app.handle(
      new Request('http://localhost/checkoutSession/show/00000000-0000-0000-0000-000000000000'),
    )
    expect(r.status).toBe(404)
  })
})
