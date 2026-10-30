/**
 * Balance and statement. (Track D)
 *
 * The invariant this file protects is a single one, and it is the most expensive of the
 * project:
 *
 *     accounts.balanceCents === SUM(financial_transactions.valueCents)
 *
 * Every scene ends with `h.assertLedgerBalances()`. A mock that credits the account
 * without posting to the statement (or that posts without crediting) is worse than no
 * mock at all: the developer closes the reconciliation against it, sleeps soundly, and
 * finds out in production.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'
import { financeHandlers } from '../../src/modules/finance/handlers.ts'
import { transferHandlers } from '../../src/modules/transfers/handlers.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  return res.body.id
}

/** Receives a Pix of `value` reais. It is the shortest way to put money in the account. */
async function receivePix(value: number, dueDate = '2026-01-10'): Promise<string> {
  const cus = await customer()
  const created = await h.api.call('create-new-payment', {
    body: { customer: cus, billingType: 'PIX', value, dueDate },
  })
  await h.api.call('confirm-payment', { params: { id: created.body.id } })
  return created.body.id
}

describe('GET /v3/finance/balance', () => {
  it('a new account has a zero balance', async () => {
    const res = await h.api.call('retrieve-account-balance')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ balance: 0 })
  })

  it('a received Pix of R$ 100 → balance 98.01 (the gross minus the R$ 1.99 fee)', async () => {
    await receivePix(100)

    const res = await h.api.call('retrieve-account-balance')

    // ONLY the balance field. One field more here breaks whoever does a strict
    // destructuring — and Asaas returns exactly this.
    expect(res.body).toEqual({ balance: 98.01 })

    await h.assertLedgerBalances()
  })
})

describe('GET /v3/financialTransactions — the statement', () => {
  it('the received Pix generates TWO rows, and the `balance` column accumulates', async () => {
    const paymentId = await receivePix(100)

    // `order=asc` EXPLICIT: Asaas's default is `desc` (the most recent first),
    // captured from the sandbox. Here we want the chronological order, which is the only
    // one in which the `balance` column makes sense from top to bottom — that is what
    // this test measures.
    const res = await h.api.call('retrieve-extract', { query: { order: 'asc' } })
    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(2)

    const [received, fee] = res.body.data

    expect(received.type).toBe('PAYMENT_RECEIVED')
    expect(received.value).toBe(100)
    expect(received.balance).toBe(100) // balance AFTER this row
    expect(received.paymentId).toBe(paymentId)

    expect(fee.type).toBe('PAYMENT_FEE')
    expect(fee.value).toBe(-1.99) // a debit is NEGATIVE
    expect(fee.balance).toBe(98.01) // and the final balance matches GET /balance
    expect(fee.paymentId).toBe(paymentId)

    // The correlation fields exist even when empty — clients read all of them.
    expect(fee.transferId).toBeNull()
    expect(fee.anticipationId).toBeNull()
    expect(fee.splitId).toBeNull()

    await h.assertLedgerBalances()
  })

  /**
   * The DEFAULT ORDER IS `desc`. Captured from the sandbox (tools/probe-pix.ts) — the doc
   * does not say, and we had chosen `asc` for looking more logical.
   *
   * It is not cosmetic, and that is why it became a test: whoever reads `data[0]` to get
   * "the latest entry" — which is what one does with a statement — got the FIRST one of
   * the account's life here, and the most recent one on Asaas.
   */
  it('without `order`, the statement comes from the NEWEST to the oldest', async () => {
    await receivePix(100)

    const res = await h.api.call('retrieve-extract')

    expect(res.body.data[0].type).toBe('PAYMENT_FEE')
    expect(res.body.data[1].type).toBe('PAYMENT_RECEIVED')
  })

  it('`order=desc` inverts the statement without shuffling the balance of each row', async () => {
    await receivePix(100)

    const res = await h.api.call('retrieve-extract', { query: { order: 'desc' } })

    expect(res.body.data.map((t: any) => t.type)).toEqual(['PAYMENT_FEE', 'PAYMENT_RECEIVED'])
    // `balance` keeps being the balance AT THE MOMENT of the entry, not the position.
    expect(res.body.data[0].balance).toBe(98.01)
    expect(res.body.data[1].balance).toBe(100)
  })

  it('filters by period and paginates', async () => {
    await receivePix(100)

    const inRange = await h.api.call('retrieve-extract', {
      query: { startDate: '2026-01-05', finishDate: '2026-01-05' },
    })
    expect(inRange.body.totalCount).toBe(2)

    const outOfRange = await h.api.call('retrieve-extract', {
      query: { startDate: '2026-02-01' },
    })
    expect(outOfRange.body.totalCount).toBe(0)
    expect(outOfRange.body.data).toEqual([])

    const page = await h.api.call('retrieve-extract', { query: { limit: 1, offset: 0 } })
    expect(page.body.hasMore).toBe(true)
    expect(page.body.limit).toBe(1)
    expect(page.body.data).toHaveLength(1)
  })

  it('an invalid date is 400 in Asaas’s format', async () => {
    const res = await h.api.call('retrieve-extract', { query: { startDate: '05/01/2026' } })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_startDate')
  })

  it('a statement NEVER shows another account’s entry', async () => {
    await receivePix(100)
    const second = await createSecondAccount(h)

    const mine = await h.api.call('retrieve-extract')
    expect(mine.body.totalCount).toBe(2)

    const theirs = await h.as(second.apiKey).call('retrieve-extract')
    expect(theirs.body.totalCount).toBe(0)

    const theirBalance = await h.as(second.apiKey).call('retrieve-account-balance')
    expect(theirBalance.body.balance).toBe(0)
  })
})

describe('GET /v3/finance/payment/statistics', () => {
  it('counts and sums the charges of the filter — gross and net', async () => {
    const cus = await customer()
    for (const value of [100, 50]) {
      await h.api.call('create-new-payment', {
        body: { customer: cus, billingType: 'PIX', value, dueDate: '2026-01-10' },
      })
    }
    await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'BOLETO', value: 200, dueDate: '2026-01-10' },
    })

    const all = await h.api.call('billing-statistics')
    expect(all.body.quantity).toBe(3)
    expect(all.body.value).toBe(350)
    // 350 − 3 × R$ 1.99 (Pix and bank slip have the same fixed fee)
    expect(all.body.netValue).toBe(344.03)

    const pix = await h.api.call('billing-statistics', { query: { billingType: 'PIX' } })
    expect(pix.body.quantity).toBe(2)
    expect(pix.body.value).toBe(150)

    const paid = await h.api.call('billing-statistics', { query: { status: 'RECEIVED' } })
    expect(paid.body.quantity).toBe(0)
    expect(paid.body.value).toBe(0) // a SUM of zero rows is 0, never null
  })
})

describe('GET /v3/finance/split/statistics', () => {
  it('without a split, both totals are zero', async () => {
    const res = await h.api.call('retrieve-split-values')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ income: 0, value: 0 })
  })
})
