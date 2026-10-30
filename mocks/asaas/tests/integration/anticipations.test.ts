/**
 * Anticipation of receivables. (Track D)
 *
 * The scene that matters is the last one: the money comes in TODAY and goes out when the
 * original receivable settles — and the two movements, added together, leave exactly the
 * net of the anticipation fee in the account. If the entries do not cancel each other, the
 * balance diverges from the statement forever, in silence.
 *
 * WARNING: the fee formula is NOT documented by Asaas. Ours is in
 * src/domain/anticipation.ts, recorded in progress.md, and the numbers live in
 * config.fees.anticipation. These tests prove the CHOSEN formula — not the real one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { financialTransactions } from '../../src/db/schema/index.ts'
import { anticipationHandlers } from '../../src/modules/anticipations/handlers.ts'
import { financeHandlers } from '../../src/modules/finance/handlers.ts'
import { anticipationSettlement } from '../../src/scheduler/jobs/anticipation-jobs.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

const ledgerOf = async (accountId: string) =>
  h.app.db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.accountId, accountId))

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  return res.body.id
}

/** A CONFIRMED card charge: the classic receivable, with the credit at D+32. */
async function confirmedCreditCard(value = 100): Promise<any> {
  const cus = await customer()
  const created = await h.api.call('create-new-payment', {
    body: { customer: cus, billingType: 'CREDIT_CARD', value, dueDate: '2026-01-10' },
  })
  const confirmed = await h.api.call('confirm-payment', { params: { id: created.body.id } })
  return confirmed.body
}

describe('POST /v3/anticipations/simulate', () => {
  it('quote of a confirmed card: 32 days, a pro-rata fee over the net', async () => {
    const payment = await confirmedCreditCard(100)
    expect(payment.estimatedCreditDate).toBe('2026-02-06') // 05/01 + 32

    const res = await h.api.call('simulate-anticipation', { body: { payment: payment.id } })

    expect(res.status).toBe(200)
    expect(res.body.anticipationDays).toBe(32)

    // totalValue = gross | value = the net of the charge (100 − 3.48 of fee)
    expect(res.body.totalValue).toBe(100)
    expect(res.body.value).toBe(96.52)

    // fee = 96.52 × 2.49% / 30 × 32 = R$ 2.56 (rounded half-up)
    expect(res.body.fee).toBe(2.56)
    expect(res.body.netValue).toBe(93.96)

    // A confirmed card is certain money: the issuer already authorized it.
    expect(res.body.isDocumentationRequired).toBe(false)

    // Simulating does NOT store anything.
    const list = await h.api.call('list-anticipations')
    expect(list.body.totalCount).toBe(0)
    await h.assertLedgerBalances()
  })

  it('the simulation and the order give the SAME number — it is the same quoting function', async () => {
    const payment = await confirmedCreditCard(100)

    const simulated = await h.api.call('simulate-anticipation', {
      body: { payment: payment.id },
    })
    const requested = await h.api.call('request-anticipation', {
      body: { payment: payment.id },
    })

    // If these two diverge, the integration shows one fee on the screen and charges
    // another. It is the most dishonest defect this endpoint can have.
    expect(requested.body.fee).toBe(simulated.body.fee)
    expect(requested.body.netValue).toBe(simulated.body.netValue)
    expect(requested.body.anticipationDays).toBe(simulated.body.anticipationDays)
  })
})

describe('POST /v3/anticipations — the money arrives today', () => {
  it('credits NOW, charges the fee, and marks the charge as anticipated', async () => {
    const payment = await confirmedCreditCard(100)

    // The card was confirmed: the money is NOT in the account yet.
    expect((await h.api.call('retrieve-account-balance')).body.balance).toBe(0)

    const res = await h.api.call('request-anticipation', { body: { payment: payment.id } })

    expect(res.status).toBe(200) // 200, never 201
    expect(res.body.status).toBe('CREDITED')
    expect(res.body.payment).toBe(payment.id)
    expect(res.body.dueDate).toBe('2026-02-06')
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/) // a bare UUID

    // 96.52 (net) − 2.56 (fee) = 93.96 — today, not at D+32.
    const balance = await h.api.call('retrieve-account-balance')
    expect(balance.body.balance).toBe(93.96)

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual([
      'RECEIVABLE_ANTICIPATION_GROSS_CREDIT',
      'RECEIVABLE_ANTICIPATION_FEE',
    ])
    expect(ledger[0]!.valueCents).toBe(9652)
    expect(ledger[1]!.valueCents).toBe(-256)
    expect(ledger[1]!.anticipationId).toBe(res.body.id)
    expect(ledger[1]!.paymentId).toBe(payment.id)

    const p = await h.api.call('retrieve-a-single-payment', { params: { id: payment.id } })
    expect(p.body.anticipated).toBe(true)

    await h.assertLedgerBalances()
  })

  it('the debit happens when the original receivable settles — and the balance closes', async () => {
    const payment = await confirmedCreditCard(100)
    await h.api.call('request-anticipation', { body: { payment: payment.id } })

    expect((await h.api.call('retrieve-account-balance')).body.balance).toBe(93.96)

    // D+32: the card credits. It is the time travel the real sandbox does not allow.
    await h.advance({ days: 32 })

    const p = await h.api.call('retrieve-a-single-payment', { params: { id: payment.id } })
    expect(p.body.status).toBe('RECEIVED')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual([
      'RECEIVABLE_ANTICIPATION_GROSS_CREDIT', // +96.52  (today)
      'RECEIVABLE_ANTICIPATION_FEE', //          − 2.56  (today)
      'PAYMENT_RECEIVED', //                     +100,00 (D+32)
      'PAYMENT_FEE', //                          −  3,48 (D+32)
      'RECEIVABLE_ANTICIPATION_DEBIT', //        − 96.52 (D+32) — it was already advanced
    ])
    expect(ledger.at(-1)!.valueCents).toBe(-9652)

    // The balance did NOT double: the advance went out when the receivable came in. What was left
    // is exactly the net minus the anticipation fee.
    const balance = await h.api.call('retrieve-account-balance')
    expect(balance.body.balance).toBe(93.96)

    const a = await h.api.call('list-anticipations')
    expect(a.body.data[0].status).toBe('DEBITED')

    await h.assertLedgerBalances()
  })

  it('the same charge cannot be anticipated twice', async () => {
    const payment = await confirmedCreditCard(100)
    await h.api.call('request-anticipation', { body: { payment: payment.id } })

    const res = await h.api.call('request-anticipation', { body: { payment: payment.id } })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_payment')

    await h.assertLedgerBalances()
  })

  it('a Pix charge has no receivable to anticipate', async () => {
    const cus = await customer()
    const p = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })

    const res = await h.api.call('request-anticipation', { body: { payment: p.body.id } })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].description).toContain('cartão de crédito ou boleto')
  })

  it('a charge from another account does not exist (404, not 403)', async () => {
    const payment = await confirmedCreditCard(100)
    const second = await createSecondAccount(h)

    const res = await h
      .as(second.apiKey)
      .call('request-anticipation', { body: { payment: payment.id } })
    expect(res.status).toBe(404)
  })
})

describe('Bank slip not paid yet — SCHEDULED anticipation', () => {
  it('is born SCHEDULED and only credits when the payer pays', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'BOLETO', value: 200, dueDate: '2026-01-20' },
    })

    const a = await h.api.call('request-anticipation', { body: { payment: created.body.id } })

    // The bank slip's money does not exist yet — nobody paid. You do not credit what
    // has not come in.
    expect(a.body.status).toBe('SCHEDULED')
    expect((await h.api.call('retrieve-account-balance')).body.balance).toBe(0)
    expect((await ledgerOf(h.accountId)).length).toBe(0)

    // The payer pays. The bank slip goes to CONFIRMED.
    await h.api.call('confirm-payment', { params: { id: created.body.id } })
    await h.tick()

    const credited = await h.api.call('retrieve-a-single-anticipation', {
      params: { id: a.body.id },
    })
    expect(credited.body.status).toBe('CREDITED')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual([
      'RECEIVABLE_ANTICIPATION_GROSS_CREDIT',
      'RECEIVABLE_ANTICIPATION_FEE',
    ])

    await h.assertLedgerBalances()
  })

  it('cancelling a SCHEDULED anticipation returns the charge to the pool', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'BOLETO', value: 200, dueDate: '2026-01-20' },
    })
    const a = await h.api.call('request-anticipation', { body: { payment: created.body.id } })

    const cancelled = await h.api.call('cancel-anticipation', {
      params: { id: a.body.id },
      body: {},
    })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.status).toBe('CANCELLED')

    const p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.anticipated).toBe(false) // it can be anticipated again

    await h.assertLedgerBalances()
  })

  it('a CREDITED anticipation cannot be cancelled — the money is already in the account', async () => {
    const payment = await confirmedCreditCard(100)
    const a = await h.api.call('request-anticipation', { body: { payment: payment.id } })

    const res = await h.api.call('cancel-anticipation', {
      params: { id: a.body.id },
      body: {},
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_action')
  })
})

describe('Limits and automatic anticipation', () => {
  it('the available limit drops by the amount already anticipated', async () => {
    const before = await h.api.call('retrieve-anticipation-limits')
    expect(before.body.creditCard.total).toBe(50_000)
    expect(before.body.creditCard.available).toBe(50_000)

    const payment = await confirmedCreditCard(100)
    await h.api.call('request-anticipation', { body: { payment: payment.id } })

    const after = await h.api.call('retrieve-anticipation-limits')
    expect(after.body.creditCard.available).toBe(50_000 - 96.52)
    expect(after.body.bankSlip.available).toBe(50_000) // the bank slip has its own limit
  })

  it('with the flag on, the confirmed card is anticipated by itself', async () => {
    const off = await h.api.call('retrieve-status-of-automatic-anticipation')
    expect(off.body.creditCardAutomaticEnabled).toBe(false)

    const on = await h.api.call('update-status-of-automatic-anticipation', {
      body: { creditCardAutomaticEnabled: true },
    })
    expect(on.body.creditCardAutomaticEnabled).toBe(true)

    const payment = await confirmedCreditCard(100)
    await h.tick() // the job anticipates without anyone asking

    const list = await h.api.call('list-anticipations')
    expect(list.body.totalCount).toBe(1)
    expect(list.body.data[0].payment).toBe(payment.id)
    expect(list.body.data[0].status).toBe('CREDITED')

    const balance = await h.api.call('retrieve-account-balance')
    expect(balance.body.balance).toBe(93.96)

    await h.assertLedgerBalances()
  })
})

describe('Webhooks', () => {
  it('CREDITED on the anticipation and DEBITED on the settlement of the receivable', async () => {
    await h.subscribeWebhook([
      'RECEIVABLE_ANTICIPATION_CREDITED',
      'RECEIVABLE_ANTICIPATION_DEBITED',
    ])

    const payment = await confirmedCreditCard(100)
    await h.api.call('request-anticipation', { body: { payment: payment.id } })
    await h.tick()

    expect(h.sink.eventNames).toEqual(['RECEIVABLE_ANTICIPATION_CREDITED'])

    await h.advance({ days: 32 })

    expect(h.sink.eventNames).toEqual([
      'RECEIVABLE_ANTICIPATION_CREDITED',
      'RECEIVABLE_ANTICIPATION_DEBITED',
    ])

    const debited = h.sink.received.at(-1)!.payload as any
    expect(debited.anticipation.status).toBe('DEBITED')
    expect(debited.anticipation.object).toBe('receivableAnticipation')
  })
})
