/**
 * The requests the panel's "Nova cobrança", customer and charge screens send, as the
 * panel builds them: every one is a real `/v3` call and must be accepted.
 *
 * What this file proves: a customer with the optional fields; a charge, an
 * installment plan (by total or per installment) and a subscription (open, with an
 * end date, with a maximum) with "Pergunte ao cliente" or card and no card data;
 * interest, fine and discount; cash receipt and its undo; cancelling an installment
 * plan's pending charges; and the per-customer filters the customer page reads.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
afterEach(() => h?.close())

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: {
      name: 'Maria Teste',
      cpfCnpj: '24971563792',
      email: 'maria@localhost',
      mobilePhone: '47999998888',
      postalCode: '89223005',
      address: 'Rua A',
      addressNumber: '10',
      province: 'Centro',
      externalReference: 'patient-1',
      observations: 'criado pelo painel',
    },
  })
  expect(res.status).toBe(200)
  return res.body.id
}

describe('panel charge requests', () => {
  it('creates a charge for each billing type, card without card data included', async () => {
    h = await createHarness()
    const cus = await customer()
    for (const billingType of ['UNDEFINED', 'PIX', 'BOLETO', 'CREDIT_CARD']) {
      const res = await h.api.call('create-new-payment', {
        body: { customer: cus, billingType, value: 120.5, dueDate: '2026-01-20', description: 'Consulta' },
      })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('PENDING')
    }
  })

  it('accepts interest, fine and discount as the form sends them', async () => {
    h = await createHarness()
    const res = await h.api.call('create-new-payment', {
      body: {
        customer: await customer(),
        billingType: 'BOLETO',
        value: 200,
        dueDate: '2026-01-20',
        interest: { value: 1 },
        fine: { value: 2 },
        discount: { value: 5, type: 'PERCENTAGE', dueDateLimitDays: 0 },
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.discount.value).toBe(5)
  })

  it('creates installment plans by total and per installment, card included', async () => {
    h = await createHarness()
    const cus = await customer()

    const byTotal = await h.api.call('create-installment', {
      body: { customer: cus, billingType: 'UNDEFINED', installmentCount: 3, totalValue: 300, dueDate: '2026-02-05' },
    })
    expect(byTotal.status).toBe(200)

    const each = await h.api.call('create-installment', {
      body: { customer: cus, billingType: 'CREDIT_CARD', installmentCount: 4, value: 50, dueDate: '2026-02-05' },
    })
    expect(each.status).toBe(200)
    const list = await h.api.call('list-payments-of-a-installment', { params: { id: each.body.id } })
    expect(list.body.data).toHaveLength(4)

    const cancel = await h.api.call('cancel-charges-of-an-installment', { params: { id: byTotal.body.id } })
    expect(cancel.status).toBe(200)
    const after = await h.api.call('list-payments-of-a-installment', { params: { id: byTotal.body.id } })
    expect(after.body.data.filter((p: any) => p.status === 'PENDING')).toHaveLength(0)
  })

  it('creates subscriptions open, with an end date and with a maximum', async () => {
    h = await createHarness()
    const cus = await customer()
    const bodies = [
      { cycle: 'MONTHLY' },
      { cycle: 'WEEKLY', endDate: '2026-06-01' },
      { cycle: 'YEARLY', maxPayments: 2 },
    ]
    for (const extra of bodies) {
      const res = await h.api.call('create-new-subscription', {
        body: { customer: cus, billingType: 'UNDEFINED', value: 89.9, nextDueDate: '2026-01-10', ...extra },
      })
      expect(res.status).toBe(200)
      const charges = await h.api.call('list-payments-of-a-subscription', { params: { id: res.body.id } })
      expect(charges.body.data.length).toBeGreaterThan(0)
    }
    const filtered = await h.api.call('list-subscriptions', { query: { customer: cus } })
    expect(filtered.body.data).toHaveLength(3)
  })

  it('splits a percentage to a subaccount on a charge, a plan and a subscription', async () => {
    h = await createHarness()
    const sub = await h.api.call('create-subaccount', {
      body: {
        name: 'Subconta Split',
        email: 'split@localhost',
        cpfCnpj: '11222333000181',
        birthDate: '1990-01-01',
        companyType: 'LIMITED',
        mobilePhone: '47999998888',
        incomeValue: 10000,
        address: 'Rua A',
        addressNumber: '10',
        province: 'Centro',
        postalCode: '89223005',
      },
    })
    expect(sub.status).toBe(200)
    const split = [{ walletId: sub.body.walletId, percentualValue: 10 }]
    const cus = await customer()

    const pay = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-01-20', split },
    })
    expect(pay.status).toBe(200)
    const plan = await h.api.call('create-installment', {
      body: { customer: cus, billingType: 'BOLETO', installmentCount: 2, totalValue: 200, dueDate: '2026-02-05', split },
    })
    expect(plan.status).toBe(200)
    const subscription = await h.api.call('create-new-subscription', {
      body: { customer: cus, billingType: 'PIX', value: 50, nextDueDate: '2026-01-10', cycle: 'MONTHLY', split },
    })
    expect(subscription.status).toBe(200)
  })

  it('receives in cash and undoes it, as the charge dialog does', async () => {
    h = await createHarness()
    const cus = await customer()
    const p = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 80, dueDate: '2026-01-20' },
    })

    const cash = await h.api.call('confirm-cash-receipt', {
      params: { id: p.body.id },
      body: { paymentDate: '2026-01-06', value: 80, notifyCustomer: false },
    })
    expect(cash.status).toBe(200)
    expect(cash.body.status).toBe('RECEIVED_IN_CASH')

    const undo = await h.api.call('undo-cash-receipt-confirmation', { params: { id: p.body.id } })
    expect(undo.status).toBe(200)
    expect(undo.body.status).toBe('PENDING')
    await h.assertLedgerBalances()

    const mine = await h.api.call('list-payments', { query: { customer: cus } })
    expect(mine.body.data.map((x: any) => x.id)).toContain(p.body.id)
  })
})
