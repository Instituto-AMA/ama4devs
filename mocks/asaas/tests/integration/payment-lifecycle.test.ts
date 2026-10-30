/**
 * The charge's lifecycle. It is the project's acceptance criterion.
 *
 * Every scenario here is something Asaas's sandbox does NOT let you test:
 * waiting D+32 for the card to credit, watching the interest grow one day at a time, or
 * checking that the statement closes with the balance.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { financialTransactions } from '../../src/db/schema/index.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

/** Creates a customer and returns the id. */
async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  expect(res.status).toBe(200) // 200, never 201
  return res.body.id
}

const ledgerOf = async (accountId: string) =>
  h.app.db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.accountId, accountId))

describe('Pix — credits right away and skips CONFIRMED', () => {
  it('PENDING → RECEIVED directly, with the fixed R$ 1.99 fee on the statement', async () => {
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })

    expect(created.body.status).toBe('PENDING')
    // netValue = 100 − 1.99. The Pix fee is FIXED, not a percentage.
    expect(created.body.value).toBe(100)
    expect(created.body.netValue).toBe(98.01)

    // A PENDING Pix has no `confirmedDate` key — it does not come null, it does not
    // even exist. Captured.
    expect('confirmedDate' in created.body).toBe(false)

    const paid = await h.api.call('confirm-payment', { params: { id: created.body.id } })

    // Pix does NOT go through CONFIRMED — it goes straight to RECEIVED, with the money already
    // available. Everything else (bank slip, card) stops at CONFIRMED first.
    expect(paid.body.status).toBe('RECEIVED')
    expect(paid.body.creditDate).toBe('2026-01-05')

    /**
     * And AFTER BEING PAID the key appears. We only emitted it for the card, so a
     * paid Pix returned `confirmedDate: undefined` — and the client that reads that field
     * to know when the payment was recognized received nothing here and a date on
     * Asaas. Captured (tools/probe-pix.ts).
     */
    expect(paid.body.confirmedDate).toBe('2026-01-05')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE'])
    expect(ledger[0]!.valueCents).toBe(10_000) // +R$ 100.00 gross
    expect(ledger[1]!.valueCents).toBe(-199) // −R$ 1.99 of fee
    expect(ledger[1]!.balanceCents).toBe(9801) // final balance = netValue

    await h.assertLedgerBalances()
  })

  /**
   * Confirming twice is the REAL case: a button clicked twice, a duplicated webhook,
   * a retry. Asaas has its own sentence for it — we used to return the
   * generic sentence of the state machine. Captured (tools/probe-pix.ts).
   */
  it('confirming an ALREADY PAID charge → "Cobrança já confirmada."', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })

    await h.api.call('confirm-payment', { params: { id: created.body.id } })
    const again = await h.api.call('confirm-payment', { params: { id: created.body.id } })

    expect(again.status).toBe(400)
    expect(again.body.errors[0]).toEqual({
      code: 'invalid_action',
      description: 'Cobrança já confirmada.',
    })
  })

  it('no PAYMENT_CONFIRMED webhook is emitted for Pix', async () => {
    await h.subscribeWebhook(['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])

    const cus = await customer()
    const p = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 50, dueDate: '2026-01-10' },
    })
    await h.api.call('confirm-payment', { params: { id: p.body.id } })
    await h.tick() // the dispatcher runs on the tick

    const events = h.sink.eventNames
    expect(events).toContain('PAYMENT_CREATED')
    expect(events).toContain('PAYMENT_RECEIVED')
    // Pix skips CONFIRMED — whoever subscribes to that event never receives it on a Pix.
    expect(events).not.toContain('PAYMENT_CONFIRMED')
  })
})

describe('Credit card — CONFIRMED now, the money at D+32', () => {
  it('the balance only appears 32 days later — and time travel proves it', async () => {
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'CREDIT_CARD', value: 100, dueDate: '2026-01-10' },
    })

    // The single-payment card fee: R$ 0.49 + 2.99% = R$ 3.48 → net R$ 96.52
    expect(created.body.netValue).toBe(96.52)

    const confirmed = await h.api.call('confirm-payment', { params: { id: created.body.id } })
    expect(confirmed.body.status).toBe('CONFIRMED')
    expect(confirmed.body.estimatedCreditDate).toBe('2026-02-06') // 05/01 + 32 days

    // Confirmed, but the money is NOT in the account.
    expect((await ledgerOf(h.accountId)).length).toBe(0)

    // Advance 31 days: still nothing.
    await h.advance({ days: 31 })
    let p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.status).toBe('CONFIRMED')

    // The 32nd day. This is the test the real sandbox does not let you do.
    const [report] = await h.advance({ days: 1 })

    expect(report!.transitions).toContainEqual({
      resource: 'payment',
      id: created.body.id,
      from: 'CONFIRMED',
      to: 'RECEIVED',
      job: 'credit-settlement',
    })

    p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.status).toBe('RECEIVED')
    expect(p.body.creditDate).toBe('2026-02-06')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE'])
    expect(ledger[1]!.balanceCents).toBe(9652) // R$ 96,52

    await h.assertLedgerBalances()
  })
})

describe('Bank slip — it expires, accrues interest, and credits at D+1 business day', () => {
  it('PENDING → OVERDUE once the due date passes', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'BOLETO', value: 100, dueDate: '2026-01-06' },
    })

    const reports = await h.advance({ days: 2 }) // today becomes 07/01

    const overdueTick = reports.find((r) =>
      r.transitions.some((t) => t.to === 'OVERDUE' && t.id === created.body.id),
    )
    expect(overdueTick).toBeDefined()

    const p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.status).toBe('OVERDUE')
  })

  it('paid late: value = original + fine (once) + pro-rata interest', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        value: 100,
        dueDate: '2026-01-05',
        fine: { value: 2, type: 'PERCENTAGE' }, // 2%
        interest: { value: 1 }, // 1% a month
      },
    })

    await h.advance({ days: 10 }) // 15/01 — 10 days of delay

    const paid = await h.api.call('confirm-payment', { params: { id: created.body.id } })

    // fine 2% = R$ 2.00 | interest = 100 × 1% / 30 × 10 = R$ 0.33
    expect(paid.body.originalValue).toBe(100)
    expect(paid.body.interestValue).toBe(2.33)
    expect(paid.body.value).toBe(102.33)
    expect(paid.body.status).toBe('CONFIRMED') // the bank slip goes through CONFIRMED

    // The bank slip credits on the next business day. 15/01/2026 is a Thursday → 16/01, Friday.
    expect(paid.body.estimatedCreditDate).toBe('2026-01-16')

    await h.advance({ days: 1 })
    const settled = await h.api.call('retrieve-a-single-payment', {
      params: { id: created.body.id },
    })
    expect(settled.body.status).toBe('RECEIVED')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger[0]!.valueCents).toBe(10_233) // it credited the value WITH interest
    expect(ledger[1]!.valueCents).toBe(-199) // the bank slip fee

    await h.assertLedgerBalances()
  })
})

describe('Cash receipt — it does NOT create balance', () => {
  it('goes to RECEIVED_IN_CASH without touching the statement', async () => {
    // It is easy to get this wrong: the money went into the merchant's pocket, OUTSIDE the
    // platform. Asaas credits nothing and charges no fee.
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'BOLETO', value: 100, dueDate: '2026-01-10' },
    })

    const res = await h.api.call('confirm-cash-receipt', {
      params: { id: created.body.id },
      body: { paymentDate: '2026-01-05', value: 100, notifyCustomer: false },
    })

    expect(res.body.status).toBe('RECEIVED_IN_CASH')
    expect((await ledgerOf(h.accountId)).length).toBe(0) // the statement stays untouched

    // And it can be undone.
    const undone = await h.api.call('undo-cash-receipt-confirmation', {
      params: { id: created.body.id },
    })
    expect(undone.body.status).toBe('PENDING')

    await h.assertLedgerBalances()
  })
})

describe('Refund', () => {
  it('reverses a received Pix and returns the money — but keeps the fee', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })
    await h.api.call('confirm-payment', { params: { id: created.body.id } })

    const refunded = await h.api.call('refund-payment', {
      params: { id: created.body.id },
      body: { value: 100, description: 'Customer gave up' },
    })
    expect(refunded.body.status).toBe('REFUNDED')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual([
      'PAYMENT_RECEIVED',
      'PAYMENT_FEE',
      'PAYMENT_REVERSAL',
    ])

    // THE FEES ARE NOT REFUNDED. 100 came in, 1.99 of fee went out, and the reversal
    // returned the 100 — the account owes the fee. It is the real behaviour.
    expect(ledger.at(-1)!.balanceCents).toBe(-199)

    await h.assertLedgerBalances()
  })

  it('lists the refund on the payment, and null before any refund', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })
    await h.api.call('confirm-payment', { params: { id: created.body.id } })

    const before = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(before.body.refunds).toBeNull()

    await h.api.call('refund-payment', {
      params: { id: created.body.id },
      body: { value: 100, description: 'Cancelled plan' },
    })

    const after = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(after.body.refunds).toHaveLength(1)
    expect(after.body.refunds[0]).toMatchObject({
      status: 'DONE',
      value: 100,
      description: 'Cancelled plan',
      paymentId: created.body.id,
    })
  })

  it('it is not possible to reverse a charge nobody paid', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })

    const res = await h.api.call('refund-payment', {
      params: { id: created.body.id },
      body: { value: 100 },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_action')
  })
})

describe('the validations Asaas does', () => {
  it('a CPF with a wrong check digit is rejected', async () => {
    const res = await h.api.call('create-new-customer', {
      body: { name: 'Fulano', cpfCnpj: '11111111111' },
    })
    expect(res.status).toBe(400)
    // `invalid_object`, and not `invalid_cpfCnpj` — it looks wrong, but it is what the
    // the real sandbox returns. Proven by the parity capture.
    expect(res.body.errors[0].code).toBe('invalid_object')
  })

  it('a charge for a customer of another account does not exist (404, not 403)', async () => {
    const res = await h.api.call('create-new-payment', {
      body: {
        customer: 'cus_000000000000',
        billingType: 'PIX',
        value: 10,
        dueDate: '2026-01-10',
      },
    })
    expect(res.status).toBe(404)
  })

  it('the customer of a charge never changes — the field does not even exist in the update', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })

    // The spec's update schema has no `customer`: sending the field is not an error,
    // it is simply discarded. What matters is that the customer did not change.
    const res = await h.api.call('update-existing-payment', {
      params: { id: created.body.id },
      body: {
        customer: 'cus_000000000001',
        billingType: 'PIX',
        value: 50,
        dueDate: '2026-01-10',
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.customer).toBe(cus) // it stays the original
    expect(res.body.value).toBe(50) // but the value changed
    expect(res.body.netValue).toBe(48.01) // and the fee was recalculated
  })

  it('a paid charge cannot be edited', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })
    await h.api.call('confirm-payment', { params: { id: created.body.id } })

    const res = await h.api.call('update-existing-payment', {
      params: { id: created.body.id },
      body: { value: 50 },
    })
    expect(res.status).toBe(400)
  })
})
