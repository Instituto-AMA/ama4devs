/**
 * Transfers. (Track D)
 *
 * What this file proves, and what Asaas's sandbox does not let you prove:
 *
 *   - a TED asked for today lands on the NEXT BUSINESS DAY, and you can watch it
 *     happen by advancing the clock one day;
 *   - a transfer between two Asaas accounts moves money FOR REAL: both
 *     statements balance, and that is what separates this project from a JSON mock;
 *   - an insufficient balance is refused on the spot, with the error in Asaas's format.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { financialTransactions } from '../../src/db/schema/index.ts'
import { financeHandlers } from '../../src/modules/finance/handlers.ts'
import { transferHandlers } from '../../src/modules/transfers/handlers.ts'
import { transferSettlement } from '../../src/scheduler/jobs/transfer-jobs.ts'
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

/** Puts money in the account: a Pix of `value` reais, received. */
async function fund(value: number): Promise<void> {
  const cus = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  const p = await h.api.call('create-new-payment', {
    body: { customer: cus.body.id, billingType: 'PIX', value, dueDate: '2026-01-10' },
  })
  await h.api.call('confirm-payment', { params: { id: p.body.id } })
}

const BANK_ACCOUNT = {
  bank: { code: '237' },
  ownerName: 'Fulano de Tal',
  cpfCnpj: '24971563792',
  agency: '1263',
  account: '9999991',
  accountDigit: '1',
  bankAccountType: 'CONTA_CORRENTE',
}

describe('Internal transfer — BOTH statements balance', () => {
  it('debits the origin, credits the destination, and the ledger invariant holds', async () => {
    await fund(500) // balance: 498.01 (500 − 1.99 of Pix fee)
    const second = await createSecondAccount(h)

    const res = await h.api.call('transfer-to-asaas-account', {
      body: { value: 100, walletId: second.walletId },
    })

    expect(res.status).toBe(200) // 200, never 201
    expect(res.body.status).toBe('DONE') // an internal one is instantaneous
    expect(res.body.type).toBe('INTERNAL')
    expect(res.body.transferFee).toBe(0) // and free
    expect(res.body.netValue).toBe(100)
    expect(res.body.walletId).toBe(second.walletId)
    // Plain UUID, no prefix — that is how Asaas does it, and it is not "standardized".
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/)

    // Origin: 100 went out.
    const origin = await h.api.call('retrieve-account-balance')
    expect(origin.body.balance).toBe(398.01)

    // Destination: 100 came in. The money did not evaporate.
    const dest = await h.as(second.apiKey).call('retrieve-account-balance')
    expect(dest.body.balance).toBe(100)

    const originLedger = await ledgerOf(h.accountId)
    expect(originLedger.map((l) => l.type)).toEqual([
      'PAYMENT_RECEIVED',
      'PAYMENT_FEE',
      'INTERNAL_TRANSFER_DEBIT',
    ])
    expect(originLedger.at(-1)!.valueCents).toBe(-10_000)

    const destLedger = await ledgerOf(second.accountId)
    expect(destLedger.map((l) => l.type)).toEqual(['INTERNAL_TRANSFER_CREDIT'])
    expect(destLedger[0]!.valueCents).toBe(10_000)
    expect(destLedger[0]!.balanceCents).toBe(10_000)
    expect(destLedger[0]!.transferId).toBe(res.body.id)

    // The invariant, in BOTH accounts.
    await h.assertLedgerBalances()
  })

  it('nonexistent walletId → 400, and nothing moves', async () => {
    await fund(500)

    const res = await h.api.call('transfer-to-asaas-account', {
      body: { value: 100, walletId: '00000000-0000-4000-8000-000000000000' },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_walletId')

    const balance = await h.api.call('retrieve-account-balance')
    expect(balance.body.balance).toBe(498.01)
    await h.assertLedgerBalances()
  })
})

describe('TED — charges R$ 5.00 and settles on the next business day', () => {
  it('is born PENDING, debits the amount + the fee, and only lands the next day', async () => {
    await fund(500)

    const res = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, bankAccount: BANK_ACCOUNT, operationType: 'TED' },
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('PENDING') // it has not gone out yet
    expect(res.body.type).toBe('TED')
    expect(res.body.transferFee).toBe(5) // R$ 5,00
    expect(res.body.netValue).toBe(95)
    expect(res.body.effectiveDate).toBeNull()

    // The balance already left: 498.01 − 100 − 5
    const afterRequest = await h.api.call('retrieve-account-balance')
    expect(afterRequest.body.balance).toBe(393.01)

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual([
      'PAYMENT_RECEIVED',
      'PAYMENT_FEE',
      'TRANSFER',
      'TRANSFER_FEE',
    ])
    expect(ledger.at(-2)!.valueCents).toBe(-10_000)
    expect(ledger.at(-1)!.valueCents).toBe(-500)
    expect(ledger.at(-1)!.transferId).toBe(res.body.id)

    // A tick on the same day: the bank picked up the TED, but it has not landed yet.
    await h.tick()
    let t = await h.api.call('retrieve-a-single-transfer', { params: { id: res.body.id } })
    expect(t.body.status).toBe('BANK_PROCESSING')
    // 05/01/2026 is a Monday → it lands on Tuesday, 06/01.
    expect(t.body.effectiveDate).toBe('2026-01-06')

    // The next day. It is the time travel the real sandbox does not allow.
    await h.advance({ days: 1 })

    t = await h.api.call('retrieve-a-single-transfer', { params: { id: res.body.id } })
    expect(t.body.status).toBe('DONE')
    expect(t.body.transactionReceiptUrl).toContain(t.body.id)

    // Settling does NOT generate a new entry: the money had already left at creation.
    expect((await ledgerOf(h.accountId)).length).toBe(4)
    await h.assertLedgerBalances()
  })

  it('the Friday TED lands on MONDAY — the weekend is not a business day', async () => {
    await fund(500)
    await h.advance({ days: 4 }) // 05/01 (seg) → 09/01 (sex)

    const res = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, bankAccount: BANK_ACCOUNT },
    })

    await h.tick()
    const processing = await h.api.call('retrieve-a-single-transfer', {
      params: { id: res.body.id },
    })
    expect(processing.body.effectiveDate).toBe('2026-01-12') // Monday, not Saturday

    await h.advance({ days: 2 }) // Saturday, Sunday
    const weekend = await h.api.call('retrieve-a-single-transfer', {
      params: { id: res.body.id },
    })
    expect(weekend.body.status).toBe('BANK_PROCESSING')

    await h.advance({ days: 1 }) // segunda
    const monday = await h.api.call('retrieve-a-single-transfer', {
      params: { id: res.body.id },
    })
    expect(monday.body.status).toBe('DONE')

    await h.assertLedgerBalances()
  })
})

describe('Pix — free and on the same day', () => {
  it('leaves without a fee and settles on the first tick, with endToEndIdentifier', async () => {
    await fund(500)

    const res = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, pixAddressKey: 'fulano@example.com', pixAddressKeyType: 'EMAIL' },
    })

    expect(res.body.type).toBe('PIX')
    expect(res.body.transferFee).toBe(0) // Pix is free
    expect(res.body.netValue).toBe(100)

    // Only one entry: TRANSFER. A zero fee does not become a R$ 0.00 line in the statement.
    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE', 'TRANSFER'])

    await h.tick()

    const t = await h.api.call('retrieve-a-single-transfer', { params: { id: res.body.id } })
    expect(t.body.status).toBe('DONE') // same day — the Pix network is 24×7
    expect(t.body.effectiveDate).toBe('2026-01-05')
    expect(t.body.endToEndIdentifier).toMatch(/^E\d{8}20260105/)

    const balance = await h.api.call('retrieve-account-balance')
    expect(balance.body.balance).toBe(398.01)
    await h.assertLedgerBalances()
  })
})

describe('Insufficient balance', () => {
  it("is a 400 in Asaas's format — and the statement stays untouched", async () => {
    await fund(100) // balance 98.01

    const res = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 200, bankAccount: BANK_ACCOUNT },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0].code).toBe('invalid_value')
    expect(res.body.errors[0].description).toContain('Saldo insuficiente')

    expect((await ledgerOf(h.accountId)).length).toBe(2) // only the received Pix
    await h.assertLedgerBalances()
  })

  it('the FEE counts against the balance: 95 + 5 of TED do not fit in 98.01', async () => {
    await fund(100) // 98,01

    // The amount alone would fit. With the R$ 5.00 fee it does not — and that is how
    // Asaas refuses. Ignoring the fee here is this endpoint's classic bug.
    const res = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 95, bankAccount: BANK_ACCOUNT },
    })

    expect(res.status).toBe(400)
    await h.assertLedgerBalances()
  })
})

describe('Cancellation and scheduling', () => {
  it('cancelling a PENDING transfer reverses the amount AND the fee', async () => {
    await fund(500)

    const created = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, bankAccount: BANK_ACCOUNT, scheduleDate: '2026-01-20' },
    })
    expect(created.body.scheduleDate).toBe('2026-01-20')
    expect(created.body.status).toBe('PENDING')

    const cancelled = await h.api.call('cancel-a-transfer', {
      params: { id: created.body.id },
    })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.status).toBe('CANCELLED')

    // It returned the 105: the reversal is a NEW entry, not the removal of the debit.
    const ledger = await ledgerOf(h.accountId)
    expect(ledger.at(-1)!.type).toBe('TRANSFER_REVERSAL')
    expect(ledger.at(-1)!.valueCents).toBe(10_500)

    const balance = await h.api.call('retrieve-account-balance')
    expect(balance.body.balance).toBe(498.01) // exactly the balance from before

    await h.assertLedgerBalances()
  })

  it('the scheduled transfer does NOT go out before the date', async () => {
    await fund(500)

    const created = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, pixAddressKey: 'fulano@example.com', scheduleDate: '2026-01-08' },
    })

    await h.advance({ days: 2 }) // 07/01 — not yet
    let t = await h.api.call('retrieve-a-single-transfer', { params: { id: created.body.id } })
    expect(t.body.status).toBe('PENDING')

    await h.advance({ days: 1 }) // 08/01 — the date arrived
    t = await h.api.call('retrieve-a-single-transfer', { params: { id: created.body.id } })
    expect(t.body.status).toBe('DONE')
    expect(t.body.effectiveDate).toBe('2026-01-08')

    await h.assertLedgerBalances()
  })

  it('an already settled transfer cannot be cancelled', async () => {
    await fund(500)
    const created = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, pixAddressKey: 'fulano@example.com' },
    })
    await h.tick() // liquida

    const res = await h.api.call('cancel-a-transfer', { params: { id: created.body.id } })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_action')
  })
})

describe('Failure at the destination institution', () => {
  it('goes to FAILED and GIVES BACK the money (TRANSFER_REVERSAL)', async () => {
    await fund(500)

    // TODO(rule): Asaas's sandbox does not document how to force a failure. This
    // trigger is ours — see src/modules/transfers/service.ts.
    const created = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, pixAddressKey: 'fail@asaas.com.br' },
    })

    await h.tick()

    const t = await h.api.call('retrieve-a-single-transfer', { params: { id: created.body.id } })
    expect(t.body.status).toBe('FAILED')
    expect(t.body.failReason).toContain('recusada')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.at(-1)!.type).toBe('TRANSFER_REVERSAL')

    const balance = await h.api.call('retrieve-account-balance')
    expect(balance.body.balance).toBe(498.01) // the money back

    await h.assertLedgerBalances()
  })
})

describe('Webhooks', () => {
  it('TED emits CREATED → PENDING → IN_BANK_PROCESSING → DONE, in that order', async () => {
    await h.subscribeWebhook([
      'TRANSFER_CREATED',
      'TRANSFER_PENDING',
      'TRANSFER_IN_BANK_PROCESSING',
      'TRANSFER_DONE',
    ])
    await fund(500)

    await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, bankAccount: BANK_ACCOUNT },
    })

    await h.advance({ days: 1 })

    expect(h.sink.eventNames).toEqual([
      'TRANSFER_CREATED',
      'TRANSFER_PENDING',
      'TRANSFER_IN_BANK_PROCESSING',
      'TRANSFER_DONE',
    ])

    // The payload carries the resource under the `transfer` key, frozen at the instant of the
    // evento.
    const done = h.sink.received.at(-1)!.payload as any
    expect(done.transfer.status).toBe('DONE')
    expect(done.transfer.object).toBe('transfer')
  })
})

describe('Isolation by account', () => {
  it('a transfer from another account is a 404, not a 403', async () => {
    await fund(500)
    const created = await h.api.call('transfer-to-another-institution-account-or-pix-key', {
      body: { value: 100, pixAddressKey: 'fulano@example.com' },
    })

    const second = await createSecondAccount(h)
    const res = await h
      .as(second.apiKey)
      .call('retrieve-a-single-transfer', { params: { id: created.body.id } })

    expect(res.status).toBe(404)

    const list = await h.as(second.apiKey).call('list-transfers')
    expect(list.body.totalCount).toBe(0)
  })
})
