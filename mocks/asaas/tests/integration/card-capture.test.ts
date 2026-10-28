/**
 * The saved card of a subscription is charged by Asaas on each due date, and a
 * refused capture is retried on Asaas's schedule before the charge goes OVERDUE.
 *
 * What this file proves, end to end through the API and the clock:
 *   - three monthly charges captured on their due dates (PAYMENT_CONFIRMED);
 *   - a card set to approve 3 charges declines the 4th: six attempts, three on the
 *     due date and three on the next day, each a PAYMENT_CREDIT_CARD_CAPTURE_REFUSED
 *     while the charge stays PENDING, then PAYMENT_OVERDUE and no more attempts;
 *   - a new card on the subscription is used by the pending charge's next attempt;
 *   - the schedule is configuration.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

const GOOD_CARD = '4444444444444444'
const holderInfo = {
  name: 'John Doe',
  email: 'john.doe@localhost',
  cpfCnpj: '24971563792',
  postalCode: '89223005',
  addressNumber: '277',
  phone: '4738010919',
}

async function admin(path: string, method = 'GET', body?: unknown) {
  const res = await h.app.app.handle(
    new Request(`http://localhost/_admin${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

/** A customer, a tokenized card that approves `approvals` charges, and a monthly subscription on it. */
async function subscriptionOnSavedCard(approvals: number | null, nextDueDate = '2026-01-10') {
  const cus = await h.api.call('create-new-customer', { body: { name: 'Maria Souza', cpfCnpj: '24971563792' } })
  const tok = await h.api.call('credit-card-tokenization', {
    body: {
      customer: cus.body.id,
      creditCard: { holderName: 'MARIA SOUZA', number: GOOD_CARD, expiryMonth: '12', expiryYear: '2030', ccv: '123' },
      creditCardHolderInfo: holderInfo,
      remoteIp: '116.213.42.53',
    },
  })
  expect(tok.status).toBe(200)
  const token = tok.body.creditCardToken as string
  if (approvals !== null) {
    const set = await admin(`/credit-cards/${token}`, 'PUT', { approvalsLeft: approvals })
    expect(set.status).toBe(200)
  }
  const sub = await h.api.call('create-new-subscription', {
    body: {
      customer: cus.body.id,
      billingType: 'CREDIT_CARD',
      value: 99.9,
      nextDueDate,
      cycle: 'MONTHLY',
      creditCardToken: token,
      remoteIp: '116.213.42.53',
    },
  })
  expect(sub.status).toBe(200)
  return { customer: cus.body.id as string, token, subscription: sub.body.id as string }
}

async function chargesOf(subscription: string) {
  const res = await h.api.call('list-payments-of-a-subscription', { params: { id: subscription } })
  return (res.body.data as any[]).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

const refusalsOf = (paymentId: string) =>
  h.sink.eventsOf('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED').filter((w) => w.payload.payment.id === paymentId)

describe('automatic capture of a saved card', () => {
  it('captures three months, then retries the refused fourth six times and turns it overdue', async () => {
    await h.subscribeWebhook([
      'PAYMENT_CONFIRMED',
      'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      'PAYMENT_OVERDUE',
    ])
    const { subscription } = await subscriptionOnSavedCard(3)

    // The clock starts on 2026-01-05 09:00. The due date's 08:00 slot comes on 01-10.
    await h.advance({ days: 5 })
    await h.advance({ days: 31 }) // 02-10
    await h.advance({ days: 28 }) // 03-10

    // Each captured on its own due date; the first already credited (D+32).
    const charges = await chargesOf(subscription)
    expect(charges.slice(0, 3).map((c) => [c.dueDate, c.confirmedDate, c.status])).toEqual([
      ['2026-01-10', '2026-01-10', 'RECEIVED'],
      ['2026-02-10', '2026-02-10', 'CONFIRMED'],
      ['2026-03-10', '2026-03-10', 'CONFIRMED'],
    ])
    expect(h.sink.eventsOf('PAYMENT_CONFIRMED')).toHaveLength(3)

    // 04-10 09:00: the 08:00 attempt is refused, the charge stays PENDING.
    await h.advance({ days: 31 })
    const fourth = (await chargesOf(subscription)).find((c) => c.dueDate === '2026-04-10')
    expect(fourth.status).toBe('PENDING')
    expect(refusalsOf(fourth.id)).toHaveLength(1)

    // 14:00 and 20:00 of the due date.
    await h.advance({ hours: 12 })
    expect(refusalsOf(fourth.id)).toHaveLength(3)
    expect((await h.api.call('retrieve-a-single-payment', { params: { id: fourth.id } })).body.status).toBe('PENDING')

    // The next day's three, then OVERDUE.
    await h.advance({ hours: 12 })
    expect(refusalsOf(fourth.id)).toHaveLength(4)
    await h.advance({ hours: 12 })
    expect(refusalsOf(fourth.id)).toHaveLength(6)
    const after = await h.api.call('retrieve-a-single-payment', { params: { id: fourth.id } })
    expect(after.body.status).toBe('OVERDUE')
    expect(h.sink.eventsOf('PAYMENT_OVERDUE').map((w) => w.payload.payment.id)).toEqual([fourth.id])

    // No attempt after the schedule ran out.
    await h.advance({ days: 3 })
    expect(refusalsOf(fourth.id)).toHaveLength(6)

    // Refused captures never touch the money.
    await h.assertLedgerBalances()
  })

  it('a new card on the subscription is used by the pending charge on its next attempt', async () => {
    await h.subscribeWebhook(['PAYMENT_CONFIRMED', 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'])
    const { customer, subscription } = await subscriptionOnSavedCard(0)

    await h.advance({ days: 5 }) // 01-10 09:00: the 08:00 attempt is refused
    const [first] = await chargesOf(subscription)
    expect(refusalsOf(first.id)).toHaveLength(1)

    const tok = await h.api.call('credit-card-tokenization', {
      body: {
        customer,
        creditCard: { holderName: 'MARIA SOUZA', number: '4111111111111111', expiryMonth: '12', expiryYear: '2030', ccv: '123' },
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })
    // Without a token, the new card's holder is required.
    const noHolder = await h.api.call('update-subscription-credit-card', {
      params: { id: subscription },
      body: { remoteIp: '116.213.42.53' },
    })
    expect(noHolder.status).toBe(400)

    // A saved card needs only its token (Asaas's reference; spec/overlays/007).
    const swap = await h.api.call('update-subscription-credit-card', {
      params: { id: subscription },
      body: { creditCardToken: tok.body.creditCardToken, remoteIp: '116.213.42.53' },
    })
    expect(swap.status).toBe(200)

    await h.advance({ hours: 6 }) // 15:00: the 14:00 attempt uses the new card
    const after = await h.api.call('retrieve-a-single-payment', { params: { id: first.id } })
    expect(after.body.status).toBe('CONFIRMED')
    expect(refusalsOf(first.id)).toHaveLength(1)
  })

  it('follows the schedule set in the admin', async () => {
    await h.subscribeWebhook(['PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', 'PAYMENT_OVERDUE'])
    const set = await admin('/card-capture/schedule', 'PUT', { schedule: '0@08:00' })
    expect(set.body.schedule).toBe('0@08:00')

    const { subscription } = await subscriptionOnSavedCard(0)
    await h.advance({ days: 5 })
    const [first] = await chargesOf(subscription)
    expect(refusalsOf(first.id)).toHaveLength(1)
    expect((await h.api.call('retrieve-a-single-payment', { params: { id: first.id } })).body.status).toBe('OVERDUE')

    const reset = await admin('/card-capture/schedule', 'PUT', { schedule: '' })
    expect(reset.body.attempts).toHaveLength(6)
    expect((await admin('/card-capture/schedule', 'PUT', { schedule: 'soon' })).status).toBe(400)
  })

  it('lists saved cards and declines a token whose approvals ran out', async () => {
    const { token, customer } = await subscriptionOnSavedCard(0)
    const list = await admin('/credit-cards')
    const card = list.body.data.find((c: any) => c.creditCardToken === token)
    expect(card).toMatchObject({ last4: '4444', approvalsLeft: 0, approvesNext: false })

    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: { customer, billingType: 'CREDIT_CARD', value: 10, dueDate: '2026-01-20', creditCardToken: token, remoteIp: '116.213.42.53' },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_action')

    expect((await admin('/credit-cards/no-such-token', 'PUT', { outcome: 'DECLINE' })).status).toBe(404)
  })
})
