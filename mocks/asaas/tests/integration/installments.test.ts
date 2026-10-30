/**
 * Installment plans. (Track E)
 *
 * The project's scenario #1 — R$ 350.00 in 12x — is here. It is an
 * EXACT REMAINDER rule ("the remainder goes to the last installment") and it is the test that proves that
 * the money is integer cents: in floating point, the sum of the 12 installments does not
 * close at 350.00.
 *
 * And the card's D+32, installment by installment: it is what Asaas's sandbox does not let
 * you test without waiting a month.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { financialTransactions, paymentSplits } from '../../src/db/schema/index.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  expect(res.status).toBe(200)
  return res.body.id
}

const installments = async (installmentId: string) => {
  const res = await h.api.call('list-payments-of-a-installment', {
    params: { id: installmentId },
    query: { limit: 100 },
  })
  expect(res.status).toBe(200)
  return res.body.data as any[]
}

const ledgerOf = async (accountId: string) =>
  h.app.db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.accountId, accountId))

describe('R$ 350.00 in 12x — the remainder goes to the LAST installment', () => {
  it('creates the 12 charges RIGHT AWAY, and the sum closes at exactly 350.00', async () => {
    const cus = await customer()

    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        installmentCount: 12,
        totalValue: 350,
        dueDate: '2026-02-05',
        description: 'Order 056984',
      },
    })

    expect(created.status).toBe(200) // 200, never 201
    expect(created.body.object).toBe('installment')
    // The plan's id is a PLAIN UUID — no prefix. It is on purpose.
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.body.installmentCount).toBe(12)
    expect(created.body.value).toBe(350) // the TOTAL
    // Asaas reports in `paymentValue` the value of the LAST installment — the one that carries the
    // left over from the rounding. Counterintuitive, and proven against the real sandbox.
    expect(created.body.paymentValue).toBe(29.24)
    expect(created.body.expirationDay).toBe(5)

    // Unlike the subscription, the charges ALL exist from the start.
    const list = await installments(created.body.id)
    expect(list.length).toBe(12)

    const values = list.map((p) => p.value)
    expect(values).toEqual([
      29.16, 29.16, 29.16, 29.16, 29.16, 29.16, 29.16, 29.16, 29.16, 29.16, 29.16,
      // the rounding remainder goes on the LAST one: 350 − 11 × 29.16 = 29.24
      29.24,
    ])

    // The sum has to be EXACT. We add in cents — in reais, 11 × 29.16 does not
    // close in binary and the assertion would depend on an epsilon.
    const totalCents = values.reduce((a, v) => a + Math.round(v * 100), 0)
    expect(totalCents).toBe(35_000)

    // Monthly due dates from the first one.
    expect(list.map((p) => p.dueDate)).toEqual([
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
      '2026-07-05',
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ])

    // Every installment points to the plan and knows its own number.
    expect(list.map((p) => p.installmentNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    expect(new Set(list.map((p) => p.installment))).toEqual(new Set([created.body.id]))
  })

  it('`value` (the installment amount) and `totalValue` (the total) are different paths', async () => {
    const cus = await customer()

    // value = value PER INSTALLMENT → total = 3 × 100 = 300
    const perInstallment = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
      },
    })
    expect(perInstallment.body.value).toBe(300)
    expect(perInstallment.body.paymentValue).toBe(100)

    // totalValue = the total TO DIVIDE → installment = 100/3 = 33.33 (the remainder on the last one)
    const total = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        totalValue: 100,
        dueDate: '2026-02-05',
      },
    })
    expect(total.body.value).toBe(100)
    expect((await installments(total.body.id)).map((p) => p.value)).toEqual([33.33, 33.33, 33.34])
  })

  it('without value nor totalValue, Asaas refuses', async () => {
    const cus = await customer()
    const res = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        dueDate: '2026-02-05',
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_value')
  })
})

describe('Installment plan on the card — each installment credits at D+32', () => {
  it('the fee is the one of the 12x BRACKET, and the money only shows up 32 days later', async () => {
    const cus = await customer()

    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        installmentCount: 12,
        totalValue: 350,
        dueDate: '2026-02-05',
      },
    })

    const list = await installments(created.body.id)
    const first = list[0]!

    /**
     * The installment card fee is NOT computed over the installment — this test
     * asserted that it was (0.49 + 3.99% of each installment = R$ 1.65 → net 27.51)
     * and it was wrong. The capture against the sandbox proved the opposite:
     *
     *   Asaas charges `0.49 + pct% × TOTAL` ONCE and divides it among the installments.
     *   12x of R$ 350: 0.49 + 3.99% × 350 = R$ 14.455 → 1446 cents.
     *
     * And the division TRUNCATES: 1446/12 = 120.5. Rounding gives 121 (net 27.95);
     * truncating gives 120 (net 27.96). This test asserted 27.95 — and it was off by ONE
     * CENT PER INSTALLMENT. The real sandbox returns netValue 27.96 for an
     * INSTALLMENT of 29.16. No other case of the suite separated the two rules, and that is
     * why the error survived: in 300/3x and 600/6x, round and trunc coincide.
     */
    expect(first.value).toBe(29.16)
    expect(first.netValue).toBe(27.96)

    const confirmed = await h.api.call('confirm-payment', { params: { id: first.id } })
    expect(confirmed.body.status).toBe('CONFIRMED')
    // Installment #1 → D+32×1 from the confirmation (05/01), rolled to a business day.
    expect(confirmed.body.estimatedCreditDate).toBe('2026-02-06')

    // Confirmed, but the money is NOT in the account.
    expect((await ledgerOf(h.accountId)).length).toBe(0)

    await h.advance({ days: 31 })
    let p = await h.api.call('retrieve-a-single-payment', { params: { id: first.id } })
    expect(p.body.status).toBe('CONFIRMED')

    // The 32nd day.
    const [report] = await h.advance({ days: 1 })
    expect(report!.transitions).toContainEqual({
      resource: 'payment',
      id: first.id,
      from: 'CONFIRMED',
      to: 'RECEIVED',
      job: 'credit-settlement',
    })

    p = await h.api.call('retrieve-a-single-payment', { params: { id: first.id } })
    expect(p.body.status).toBe('RECEIVED')
    expect(p.body.creditDate).toBe('2026-02-06')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE'])
    expect(ledger[0]!.valueCents).toBe(2916) // the gross of the installment
    // The fee comes out of the TOTAL (0.49 + 3.99% × 350 = 1446 cents) divided by 12,
    // TRUNCATING → R$ 1.20 per installment. Not 0.49 + 3.99% OF THE INSTALLMENT (R$ 1.65), and
    // not R$ 1.21 (which is 1446/12 rounded). Both mistakes lived here once.
    expect(ledger[1]!.valueCents).toBe(-120)
    expect(ledger[1]!.balanceCents).toBe(2796)

    // The other 11 keep waiting — each one will credit at its own D+32.
    const rest = (await installments(created.body.id)).filter((x) => x.id !== first.id)
    expect(rest.every((x) => x.status === 'PENDING')).toBe(true)

    await h.assertLedgerBalances()
  })
})

describe('Split on an installment plan — fixedValue vs totalFixedValue', () => {
  it('`fixedValue` is applied to EACH installment', async () => {
    const other = await createSecondAccount(h)
    const cus = await customer()

    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
        splits: [{ walletId: other.walletId, fixedValue: 10 }],
      },
    })

    const list = await installments(created.body.id)
    // R$ 10 in EACH of the 3 installments — R$ 30 in total, not R$ 10.
    for (const p of list) {
      expect(p.split.length).toBe(1)
      expect(p.split[0].fixedValue).toBe(10)
      expect(p.split[0].totalValue).toBe(10)
    }
  })

  it('`totalFixedValue` is DIVIDED among the installments, with the remainder on the last one', async () => {
    const other = await createSecondAccount(h)
    const cus = await customer()

    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        totalValue: 300,
        dueDate: '2026-02-05',
        splits: [{ walletId: other.walletId, totalFixedValue: 100 }],
      },
    })

    // R$ 100 divided into 3 → 33.33 | 33.33 | 33.34. The SAME rule as the value of the
    // installments. `fixedValue` would be R$ 100 on each one — R$ 300 in total.
    const list = await installments(created.body.id)
    expect(list.map((p) => p.split[0].totalValue)).toEqual([33.33, 33.33, 33.34])

    const sum = list.reduce((a, p) => a + Math.round(p.split[0].totalValue * 100), 0)
    expect(sum).toBe(10_000)
  })

  it('totalFixedValue together with installmentNumber is refused', async () => {
    const other = await createSecondAccount(h)
    const cus = await customer()

    const res = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
        splits: [
          { walletId: other.walletId, totalFixedValue: 100, installmentNumber: 2 },
        ],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_split')
  })

  it('update-installment-splits rewrites the split of the open installments', async () => {
    const other = await createSecondAccount(h)
    const cus = await customer()

    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
        splits: [{ walletId: other.walletId, fixedValue: 10 }],
      },
    })

    const res = await h.api.call('update-installment-splits', {
      params: { id: created.body.id },
      body: { splits: [{ walletId: other.walletId, percentualValue: 20 }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.splits.length).toBe(3) // one entry per open installment

    // 20% of the NETVALUE (R$ 100 − R$ 1.99 of Pix = R$ 98.01) → R$ 19.60.
    // Over the gross it would give R$ 20.00. The split applies to the net, and that is the mistake
    // everybody makes.
    const list = await installments(created.body.id)
    for (const p of list) {
      expect(p.split.length).toBe(1)
      expect(p.split[0].percentualValue).toBe(20)
      expect(p.split[0].totalValue).toBe(19.6)
    }
  })
})

describe('Remove, cancel and refund', () => {
  it('removing the installment plan removes the open installments', async () => {
    const cus = await customer()
    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
      },
    })

    const list = await installments(created.body.id)
    // The 1st is paid — money that came in is not erased.
    await h.api.call('confirm-payment', { params: { id: list[0]!.id } })

    const removed = await h.api.call('remove-installment', {
      params: { id: created.body.id },
    })
    expect(removed.status).toBe(200)
    expect(removed.body.deleted).toBe(true)

    const p2 = await h.api.call('retrieve-a-single-payment', { params: { id: list[1]!.id } })
    expect(p2.body.deleted).toBe(true)

    const p1 = await h.api.call('retrieve-a-single-payment', { params: { id: list[0]!.id } })
    expect(p1.body.deleted).toBe(false) // the paid one remains
    expect(p1.body.status).toBe('RECEIVED')

    // Once removed, it disappears from the listing.
    const all = await h.api.call('list-installments', {})
    expect(all.body.data.map((i: any) => i.id)).not.toContain(created.body.id)

    await h.assertLedgerBalances()
  })

  it('cancelling the charges keeps the plan and returns the removed ones', async () => {
    const cus = await customer()
    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
      },
    })

    const res = await h.api.call('cancel-charges-of-an-installment', {
      params: { id: created.body.id },
    })

    expect(res.status).toBe(200)
    expect(res.body.deletedPayments.length).toBe(3)
    expect(res.body.deletedPayments.every((p: any) => p.deleted)).toBe(true)

    // The PLAN continues — it is the difference against the remove.
    const still = await h.api.call('retrieve-a-single-installment', {
      params: { id: created.body.id },
    })
    expect(still.status).toBe(200)
    expect(still.body.deleted).toBe(false)
  })

  it('a reversal returns the money of every paid installment — and keeps the fees', async () => {
    const cus = await customer()
    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 2,
        value: 100,
        dueDate: '2026-02-05',
      },
    })

    const list = await installments(created.body.id)
    for (const p of list) {
      await h.api.call('confirm-payment', { params: { id: p.id } })
    }

    const refunded = await h.api.call('refund-installment', {
      params: { id: created.body.id },
      body: { value: 200 },
    })
    expect(refunded.status).toBe(200)
    expect(refunded.body.refunds.length).toBe(2)

    const after = await installments(created.body.id)
    expect(after.every((p) => p.status === 'REFUNDED')).toBe(true)

    /**
     * THE FEES ARE NOT REFUNDED. R$ 200 came in, R$ 3.98 of fee went out, and the
     * refund gave back the R$ 200 — the account still owes the fees.
     */
    const ledger = await ledgerOf(h.accountId)
    expect(ledger.at(-1)!.balanceCents).toBe(-398)

    await h.assertLedgerBalances()
  })

  it('a partial reversal of an installment plan is explicitly refused (TODO(rule))', async () => {
    const cus = await customer()
    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 2,
        value: 100,
        dueDate: '2026-02-05',
      },
    })

    const list = await installments(created.body.id)
    await h.api.call('confirm-payment', { params: { id: list[0]!.id } })

    // Refusing is better than inventing an allocation rule and producing values
    // that look right but are wrong.
    const res = await h.api.call('refund-installment', {
      params: { id: created.body.id },
      body: { value: 50 },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_value')
  })
})

describe('Payment booklet (paymentBook) and per-account isolation', () => {
  it('the payment booklet is a real PDF, not a JSON with a URL', async () => {
    const cus = await customer()
    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
      },
    })

    // Straight to the server: the harness's ApiClient does JSON.parse, and a PDF is not
    // JSON. That is exactly the point — the 200 response of this operation has no schema.
    const res = await h.app.app.handle(
      new Request(`http://localhost/v3/installments/${created.body.id}/paymentBook`, {
        headers: { access_token: '$aact_hmlg_test0000000000000000000000000' },
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/pdf')

    const body = await res.text()
    expect(body.startsWith('%PDF-1.4')).toBe(true)
    expect(body).toContain('Parcela 1/3')
    expect(body).toContain('%%EOF')
  })

  it('a plan from another account does not exist (404, not 403)', async () => {
    const other = await createSecondAccount(h)
    const cus = await customer()

    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 2,
        value: 100,
        dueDate: '2026-02-05',
      },
    })

    const res = await h.as(other.apiKey).call('retrieve-a-single-installment', {
      params: { id: created.body.id },
    })
    expect(res.status).toBe(404)
  })
})

describe('the installment is a charge like any other', () => {
  it('is born from createPayment: same format, same webhooks, same split', async () => {
    await h.subscribeWebhook(['PAYMENT_CREATED'])
    const cus = await customer()

    const created = await h.api.call('create-installment', {
      body: {
        customer: cus,
        billingType: 'PIX',
        installmentCount: 3,
        value: 100,
        dueDate: '2026-02-05',
      },
    })

    await h.tick() // the dispatcher runs on the tick

    // One charge created = one PAYMENT_CREATED. Three installments, three events.
    expect(h.sink.eventNames.filter((e) => e === 'PAYMENT_CREATED').length).toBe(3)

    const splits = await h.app.db.select().from(paymentSplits)
    expect(splits.length).toBe(0) // without a split configured, no row
    void created
  })
})

describe('Installment plan on the card', () => {
  const CARD = {
    creditCard: {
      holderName: 'Fulano de Tal',
      number: '4444444444444444', // the test card that APPROVES
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
    },
    creditCardHolderInfo: {
      name: 'Fulano de Tal',
      email: 'fulano@localhost',
      cpfCnpj: '24971563792',
      postalCode: '01310-100',
      addressNumber: '1',
      phone: '11999998888',
    },
    remoteIp: '127.0.0.1',
  }

  /**
   * Regression of a silent failure: `POST /v3/installments` shares the route with the
   * "with card" variant, and the handler ignored the card. The 12 installments were born
   * PENDING — the card was never charged, and nobody saw any error.
   *
   * On the card, the issuer authorizes the total at once: the N installments are already born
   * CONFIRMED, and it is the customer who pays in N installments.
   */
  it('charges the card and the 12 installments are born CONFIRMED', async () => {
    const res = await h.api.call('create-installment', {
      body: {
        customer: await customer(),
        billingType: 'CREDIT_CARD',
        installmentCount: 12,
        totalValue: 350,
        dueDate: '2026-02-05',
        ...CARD,
      },
    })
    expect(res.status).toBe(200)

    const list = await h.api.call('list-payments-of-a-installment', {
      params: { id: res.body.id },
      query: { limit: 100 },
    })

    expect(list.body.data).toHaveLength(12)
    for (const p of list.body.data) expect(p.status).toBe('CONFIRMED')

    // The remainder rule still holds — the card does not change it.
    const values = list.body.data.map((p: any) => p.value)
    expect(values.slice(0, 11)).toEqual(Array(11).fill(29.16))
    expect(values[11]).toBe(29.24)
  })

  it('a declined card → 400, and NO plan is left behind', async () => {
    const before = await h.api.call('list-installments', {})

    const res = await h.api.call('create-installment', {
      body: {
        customer: await customer(),
        billingType: 'CREDIT_CARD',
        installmentCount: 3,
        totalValue: 300,
        dueDate: '2026-02-05',
        ...CARD,
        creditCard: { ...CARD.creditCard, number: '5184019740373151' }, // declines
      },
    })

    expect(res.status).toBe(400)

    // The point: the validation happens BEFORE any write.
    const after = await h.api.call('list-installments', {})
    expect(after.body.totalCount).toBe(before.body.totalCount)
  })
})
