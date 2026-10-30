/**
 * Payment split — the money crossing the border between two accounts.
 *
 * The scenario that gives this file its name: a R$ 100 Pix charge with a split of
 * 30% credits R$ 29.40 to the destination — 30% of R$ 98.01 (the netValue), NOT R$ 30.00.
 * Whoever issues the charge pays the fee; the split divides what is left. It is the rule
 * everyone gets wrong, and it is the only one this file exists to prove.
 *
 * And, in every scenario, `assertLedgerBalances()`: BOTH statements balance, or
 * someone touched a balance without going through `postEntries()`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { accounts, financialTransactions, paymentSplits } from '../../src/db/schema/index.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness
let dest: { accountId: string; walletId: string; apiKey: string }

beforeEach(async () => {
  h = await createHarness()
  dest = await createSecondAccount(h)
})
afterEach(() => h.close())

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  return res.body.id
}

const balanceOf = async (accountId: string): Promise<number> => {
  const [row] = await h.app.db
    .select({ b: accounts.balanceCents })
    .from(accounts)
    .where(eq(accounts.id, accountId))
  return row!.b
}

const ledgerOf = async (accountId: string) =>
  h.app.db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.accountId, accountId))

const splitsOf = async (paymentId: string) =>
  h.app.db.select().from(paymentSplits).where(eq(paymentSplits.paymentId, paymentId))

describe('the split applies to the netValue, not to the gross amount', () => {
  it('Pix of R$ 100 (R$ 1.99 fee) with a 30% split → the destination receives R$ 29.40', async () => {
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, percentualValue: 30 }],
      },
    })

    expect(created.body.netValue).toBe(98.01) // 100 − 1.99 of fee
    // 30% of 98.01 = 29.403 → 29.40. NOT 30.00. It is the whole rule.
    expect(created.body.split[0].totalValue).toBe(29.4)
    expect(created.body.split[0].status).toBe('PENDING')

    // It paid: the money came into the origin, and the split now WAITS for the credit.
    const paid = await h.api.call('confirm-payment', { params: { id: created.body.id } })
    expect(paid.body.status).toBe('RECEIVED')
    expect((await splitsOf(created.body.id))[0]!.status).toBe('AWAITING_CREDIT')

    // It has not moved yet: the job is what moves it.
    expect(await balanceOf(dest.accountId)).toBe(0)
    expect(await balanceOf(h.accountId)).toBe(9801)

    const report = await h.tick()

    expect(report.transitions).toContainEqual({
      resource: 'split',
      id: (await splitsOf(created.body.id))[0]!.id,
      from: 'AWAITING_CREDIT',
      to: 'DONE',
      job: 'split-release',
    })

    // 98.01 − 29.40 = 68.61 in the origin | 29.40 in the destination
    expect(await balanceOf(h.accountId)).toBe(6861)
    expect(await balanceOf(dest.accountId)).toBe(2940)

    const origin = await ledgerOf(h.accountId)
    expect(origin.map((l) => l.type)).toEqual([
      'PAYMENT_RECEIVED',
      'PAYMENT_FEE',
      'INTERNAL_TRANSFER_DEBIT',
    ])
    expect(origin.at(-1)!.valueCents).toBe(-2940)

    const destination = await ledgerOf(dest.accountId)
    expect(destination.map((l) => l.type)).toEqual(['INTERNAL_TRANSFER_CREDIT'])
    expect(destination[0]!.valueCents).toBe(2940)
    // The entry carries both links — without them the statement does not explain itself.
    expect(destination[0]!.paymentId).toBe(created.body.id)
    expect(destination[0]!.splitId).toBe((await splitsOf(created.body.id))[0]!.id)

    const split = (await splitsOf(created.body.id))[0]!
    expect(split.status).toBe('DONE')
    expect(split.creditDate).toBe('2026-01-05')

    await h.assertLedgerBalances()
  })

  it('fixed + percentage in the same charge: Asaas simply adds them up', async () => {
    const other = await createSecondAccount(h, 'Terceira Conta')
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [
          { walletId: dest.walletId, fixedValue: 10 },
          { walletId: other.walletId, percentualValue: 25 },
        ],
      },
    })

    // R$ 10.00 fixed | 25% of 98.01 = 24.5025 → R$ 24.50
    expect(created.body.split[0].totalValue).toBe(10)
    expect(created.body.split[1].totalValue).toBe(24.5)

    await h.api.call('confirm-payment', { params: { id: created.body.id } })
    await h.tick()

    expect(await balanceOf(dest.accountId)).toBe(1000)
    expect(await balanceOf(other.accountId)).toBe(2450)
    // 9801 − 1000 − 2450 = 6351
    expect(await balanceOf(h.accountId)).toBe(6351)

    await h.assertLedgerBalances()
  })

  it('the job does not credit twice — the CAS sees the split already DONE and does nothing', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, percentualValue: 30 }],
      },
    })
    await h.api.call('confirm-payment', { params: { id: created.body.id } })

    await h.tick()
    await h.tick()
    await h.tick()

    expect(await balanceOf(dest.accountId)).toBe(2940) // once, not three
    expect((await ledgerOf(dest.accountId)).length).toBe(1)

    await h.assertLedgerBalances()
  })
})

describe('credit card — the split only moves at D+32', () => {
  it('the charge confirms today, but the money only changes accounts when it credits', async () => {
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, percentualValue: 50 }],
      },
    })

    // The single-payment card fee: R$ 0.49 + 2.99% = R$ 3.48 → netValue R$ 96.52
    expect(created.body.netValue).toBe(96.52)
    expect(created.body.split[0].totalValue).toBe(48.26) // 50% de 96,52

    const confirmed = await h.api.call('confirm-payment', { params: { id: created.body.id } })
    expect(confirmed.body.status).toBe('CONFIRMED')

    // Split waiting for the credit, but nobody has money yet: not even the origin.
    expect((await splitsOf(created.body.id))[0]!.status).toBe('AWAITING_CREDIT')
    expect(await balanceOf(h.accountId)).toBe(0)
    expect(await balanceOf(dest.accountId)).toBe(0)

    await h.advance({ days: 31 })
    expect(await balanceOf(dest.accountId)).toBe(0) // 31 days: nothing.

    // The 32nd day. The charge credits and the split goes out in the SAME tick — the order of the
    // jobs (credit-settlement before split-release) is what guarantees it.
    await h.advance({ days: 1 })

    expect(await balanceOf(h.accountId)).toBe(9652 - 4826)
    expect(await balanceOf(dest.accountId)).toBe(4826)
    expect((await splitsOf(created.body.id))[0]!.creditDate).toBe('2026-02-06')

    await h.assertLedgerBalances()
  })
})

describe('value divergence — 2 business days to adjust, or the split dies', () => {
  it('splits adding up to more than the netValue are born BLOCKED_BY_VALUE_DIVERGENCE', async () => {
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        // 60 + 50 = 110 > 98.01
        split: [
          { walletId: dest.walletId, fixedValue: 60 },
          { walletId: (await createSecondAccount(h, 'Quarta')).walletId, fixedValue: 50 },
        ],
      },
    })

    const splits = await splitsOf(created.body.id)
    expect(splits.every((s) => s.status === 'BLOCKED_BY_VALUE_DIVERGENCE')).toBe(true)
    // 05/01/2026 is a Monday → 2 business days = Wednesday, 07/01.
    expect(splits.every((s) => s.blockedUntil === '2026-01-07')).toBe(true)

    // The charge itself is NOT rejected — it is the split that gets blocked.
    expect(created.status).toBe(200)
    expect(created.body.status).toBe('PENDING')
  })

  it('once the deadline passes without an adjustment → CANCELLED with VALUE_DIVERGENCE_BLOCK', async () => {
    await h.subscribeWebhook([
      'PAYMENT_SPLIT_DIVERGENCE_BLOCK',
      'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED',
      'PAYMENT_SPLIT_CANCELLED',
    ])

    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, fixedValue: 120 }], // > 98,01
      },
    })

    await h.tick()
    expect(h.sink.eventNames).toContain('PAYMENT_SPLIT_DIVERGENCE_BLOCK')

    // Still within the deadline (07/01 is the last day).
    await h.advance({ days: 2 })
    expect((await splitsOf(created.body.id))[0]!.status).toBe('BLOCKED_BY_VALUE_DIVERGENCE')

    // 08/01: the deadline passed.
    const [report] = await h.advance({ days: 1 })
    const split = (await splitsOf(created.body.id))[0]!

    expect(split.status).toBe('CANCELLED')
    expect(split.cancellationReason).toBe('VALUE_DIVERGENCE_BLOCK')
    expect(report!.transitions).toContainEqual({
      resource: 'split',
      id: split.id,
      from: 'BLOCKED_BY_VALUE_DIVERGENCE',
      to: 'CANCELLED',
      job: 'split-divergence-expiry',
    })

    await h.tick() // drains the webhook queue
    expect(h.sink.eventNames).toContain('PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED')
    expect(h.sink.eventNames).toContain('PAYMENT_SPLIT_CANCELLED')

    // Nobody received anything: the money never left the origin.
    expect(await balanceOf(dest.accountId)).toBe(0)
    await h.assertLedgerBalances()
  })

  it('a blocked split does NOT become credit just because the charge was paid', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, fixedValue: 120 }],
      },
    })

    await h.api.call('confirm-payment', { params: { id: created.body.id } })
    await h.tick()

    // It stays blocked. The money stays entirely in the origin.
    expect((await splitsOf(created.body.id))[0]!.status).toBe('BLOCKED_BY_VALUE_DIVERGENCE')
    expect(await balanceOf(h.accountId)).toBe(9801)
    expect(await balanceOf(dest.accountId)).toBe(0)

    await h.assertLedgerBalances()
  })
})

describe('validations', () => {
  it('a split to your own wallet is rejected', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: h.walletId, percentualValue: 10 }],
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_split')
  })

  it('a split with neither fixedValue nor percentualValue is rejected', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId }],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_split')
  })
})

describe('external wallet — there is no account here to credit', () => {
  it('the split stays DONE, but not a cent moves', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        // A walletId that belongs to no account of this server.
        split: [{ walletId: '11111111-2222-3333-4444-555555555555', percentualValue: 30 }],
      },
    })

    await h.api.call('confirm-payment', { params: { id: created.body.id } })
    await h.tick()

    const split = (await splitsOf(created.body.id))[0]!
    expect(split.status).toBe('DONE')
    expect(split.recipientAccountId).toBeNull()

    // DELIBERATE DIVERGENCE from the real Asaas: there the money would leave the account.
    // Here there is no destination, and debiting without a counterpart would make the amount vanish from the
    // statement with nobody able to check where it went.
    expect(await balanceOf(h.accountId)).toBe(9801)

    await h.assertLedgerBalances()
  })
})

describe('reversal — the split that already credited goes back', () => {
  it("reversing the charge returns the destination's money to the origin", async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, percentualValue: 30 }],
      },
    })

    await h.api.call('confirm-payment', { params: { id: created.body.id } })
    await h.tick()
    expect(await balanceOf(dest.accountId)).toBe(2940)

    await h.api.call('refund-payment', {
      params: { id: created.body.id },
      body: { value: 100 },
    })

    // Without this, the recipient would PROFIT from the reversal: they would keep the R$ 29.40
    // of a charge that no longer exists.
    expect(await balanceOf(dest.accountId)).toBe(0)
    expect((await splitsOf(created.body.id))[0]!.status).toBe('REFUNDED')

    // The origin gave back the R$ 100 and recovered the R$ 29.40 of the split; the fee of
    // Asaas keeps the R$ 1.99.
    expect(await balanceOf(h.accountId)).toBe(-199)

    await h.assertLedgerBalances()
  })

  it('a removed charge cancels the split and emits PAYMENT_SPLIT_CANCELLED', async () => {
    await h.subscribeWebhook(['PAYMENT_SPLIT_CANCELLED'])
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, percentualValue: 30 }],
      },
    })

    await h.api.call('delete-payment', { params: { id: created.body.id } })
    await h.tick()

    const split = (await splitsOf(created.body.id))[0]!
    expect(split.status).toBe('CANCELLED')
    expect(split.cancellationReason).toBe('PAYMENT_DELETED')
    expect(h.sink.eventNames).toContain('PAYMENT_SPLIT_CANCELLED')

    await h.assertLedgerBalances()
  })
})

describe('split queries — the same row, two views', () => {
  it('paid is what left here; received is what entered there', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [
          {
            walletId: dest.walletId,
            percentualValue: 30,
            externalReference: 'parceiro-1',
            description: 'Commission',
          },
        ],
      },
    })
    await h.api.call('confirm-payment', { params: { id: created.body.id } })
    await h.tick()

    // The origin account sees the split as PAID.
    const paid = await h.api.call('list-paid-splits')
    expect(paid.body.totalCount).toBe(1)
    const s = paid.body.data[0]
    expect(s.walletId).toBe(dest.walletId)
    expect(s.totalValue).toBe(29.4)
    expect(s.percentualValue).toBe(30) // escala 1e4 desfeita
    expect(s.status).toBe('DONE')
    expect(s.originAccountId).toBe(h.accountId)
    expect(s.destinationAccountId).toBe(dest.accountId)
    expect(s.creditDate).toBe('2026-01-05')
    expect(s.externalReference).toBe('parceiro-1')
    expect(s.payment.invoiceNumber).toBe(created.body.invoiceNumber)

    // …and sees nothing as RECEIVED: it is the origin, not the destination.
    const nothing = await h.api.call('list-received-splits')
    expect(nothing.body.totalCount).toBe(0)

    // The destination account sees exactly the opposite.
    const dst = h.as(dest.apiKey)
    const received = await dst.call('list-received-splits')
    expect(received.body.totalCount).toBe(1)
    expect(received.body.data[0].id).toBe(s.id)

    expect((await dst.call('list-paid-splits')).body.totalCount).toBe(0)

    // Individual retrieval, from both ends.
    const one = await h.api.call('retrieve-a-single-paid-split', { params: { id: s.id } })
    expect(one.body.id).toBe(s.id)

    const two = await dst.call('retrieve-a-single-received-split', { params: { id: s.id } })
    expect(two.body.id).toBe(s.id)

    // The other account's split does not exist for you — 404, not 403.
    const nope = await dst.call('retrieve-a-single-paid-split', { params: { id: s.id } })
    expect(nope.status).toBe(404)
  })

  it('filters by paymentId and by status', async () => {
    const cus = await customer()
    const a = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, percentualValue: 10 }],
      },
    })
    await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        value: 50,
        dueDate: '2026-01-10',
        split: [{ walletId: dest.walletId, percentualValue: 10 }],
      },
    })

    await h.api.call('confirm-payment', { params: { id: a.body.id } })
    await h.tick()

    const byPayment = await h.api.call('list-paid-splits', {
      query: { paymentId: a.body.id },
    })
    expect(byPayment.body.totalCount).toBe(1)

    const done = await h.api.call('list-paid-splits', { query: { status: 'DONE' } })
    expect(done.body.totalCount).toBe(1)
    expect(done.body.data[0].payment.confirmedDate).toBe('2026-01-05')

    const pending = await h.api.call('list-paid-splits', { query: { status: 'PENDING' } })
    expect(pending.body.totalCount).toBe(1)

    await h.assertLedgerBalances()
  })
})
