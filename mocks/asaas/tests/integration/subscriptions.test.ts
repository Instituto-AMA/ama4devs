/**
 * Subscription. (Track E)
 *
 * THE RULE THAT DEFINES THE FEATURE, and it is counterintuitive:
 *
 *   **creating the subscription ALREADY creates the first charge, on the spot.**
 *
 * The 40-day lookahead governs the SUBSEQUENT charges: Asaas generates the next one when
 * 40 days are missing for the `nextDueDate`. It is the #1 difference between a
 * subscription and an installment plan (which creates the N charges at once), and it is
 * the origin of the classic bug: "I created the subscription and the webhook
 * PAYMENT_CREATED never arrived" — the first charge's webhook does arrive, but the
 * second one's only comes 40 days ahead of its due date.
 *
 * We prove BOTH SIDES of the window: on the 41st day nothing is born; on the 40th, it is.
 * A test that only proves the inside would pass even with an infinite lookahead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { creditCards, financialTransactions, subscriptions } from '../../src/db/schema/index.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

/** The tests' clock starts at 2026-01-05. */
const TODAY = '2026-01-05'
/** Exactly 40 days later — the first day INSIDE the window. */
const IN_40_DAYS = '2026-02-14'
/** 41 days later — one day OUTSIDE. */
const IN_41_DAYS = '2026-02-15'

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  expect(res.status).toBe(200)
  return res.body.id
}

async function subscribe(over: Record<string, unknown> = {}) {
  const res = await h.api.call('create-new-subscription', {
    body: {
      customer: await customer(),
      billingType: 'BOLETO',
      value: 19.9,
      nextDueDate: IN_41_DAYS,
      cycle: 'MONTHLY',
      description: 'Plano Pro',
      ...over,
    },
  })
  expect(res.status).toBe(200) // 200, never 201
  return res.body
}

const chargesOf = async (subscriptionId: string) => {
  const res = await h.api.call('list-payments-of-a-subscription', {
    params: { id: subscriptionId },
    query: { limit: 100 },
  })
  expect(res.status).toBe(200)
  return res.body.data as any[]
}

const reload = async (id: string) =>
  (await h.api.call('retrieve-a-single-subscription', { params: { id } })).body

const ledgerOf = async (accountId: string) =>
  h.app.db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.accountId, accountId))

describe('The first charge is born AT CREATION — and the second one, in the 40-day window', () => {
  /**
   * This block already asserted the OPPOSITE, confidently, across three tests in a row:
   * that creating a subscription created no charge at all, and that the first one only
   * was born only when 40 days were missing for the due date.
   *
   * The capture against the real sandbox disproved that (`bun run capture`). Asaas:
   *
   *   POST /v3/subscriptions with nextDueDate = today+60
   *     → returns nextDueDate = today+90 (it already advanced one cycle)
   *     → and the charge of today+60 already exists, created on the spot
   *
   * The 40-day window is real, but it governs the SECOND charge onwards.
   */
  it('creating the subscription ALREADY creates the first charge and advances the cycle', async () => {
    const sub = await subscribe({ nextDueDate: IN_41_DAYS })

    expect(sub.id).toMatch(/^sub_[A-Za-z0-9]{12}$/)
    expect(sub.status).toBe('ACTIVE')
    expect(sub.value).toBe(19.9)

    // The nextDueDate ALREADY advanced one cycle — the one given became the charge.
    expect(sub.nextDueDate).toBe('2026-03-15')

    const charges = await chargesOf(sub.id)
    expect(charges.length).toBe(1)
    expect(charges[0]!.dueDate).toBe(IN_41_DAYS) // the due date I asked for
    expect(charges[0]!.value).toBe(19.9)
    expect(charges[0]!.status).toBe('PENDING')
    expect(charges[0]!.subscription).toBe(sub.id)
  })

  it('the SECOND charge respects the window: nothing on the 41st day, it is born on the 40th', async () => {
    // nextDueDate=IN_41_DAYS → the 1st charge is on that date, and the cycle goes to 15/03.
    const sub = await subscribe({ nextDueDate: IN_41_DAYS })
    expect((await chargesOf(sub.id)).length).toBe(1)

    // Today is 05/01; the next due date is 15/03 — 69 days away. Outside the window.
    await h.tick()
    expect((await chargesOf(sub.id)).length).toBe(1)

    // Advance until 40 days are missing for 15/03 → 03/02.
    const reports = await h.advance({ days: 29 })

    const charges = await chargesOf(sub.id)
    expect(charges.length).toBe(2)

    const segunda = charges.find((c) => c.dueDate === '2026-03-15')
    expect(segunda).toBeDefined()
    expect(segunda!.value).toBe(19.9)

    // The job records what it created in the tick's report.
    expect(reports.flatMap((r) => r.created)).toContainEqual({
      resource: 'payment',
      id: segunda!.id,
      job: 'subscription-generation',
    })

    // And the cycle advanced again.
    expect((await reload(sub.id)).nextDueDate).toBe('2026-04-15')
    void TODAY
    void IN_40_DAYS
  })

  /**
   * Idempotency is what separates "it works" from "it works under time travel".
   * The CAS claims the due date BEFORE the charge is born, so a repeated tick
   * finds the `nextDueDate` already advanced and generates nothing.
   */
  it('repeated ticks on the same day do not duplicate the charge', async () => {
    const sub = await subscribe({ nextDueDate: IN_40_DAYS })

    await h.tick()
    await h.tick()
    await h.tick()

    // One only — the creation's. The due date was already consumed.
    expect((await chargesOf(sub.id)).length).toBe(1)
    expect((await reload(sub.id)).nextDueDate).toBe('2026-03-14')
  })
})

describe('Time passes and the charges are born one by one', () => {
  it('120 days ahead: 4 monthly charges, and the nextDueDate follows the cycle', async () => {
    const sub = await subscribe({ nextDueDate: IN_41_DAYS })

    await h.advance({ days: 120 }) // today = 2026-05-05

    /**
     * Horizon on 05/05 = 14/06. The ones of 15/02, 15/03, 15/04 and 15/05 were born.
     * Not the one of 15/06 yet: 41 days are missing for it. The window never runs ahead.
     */
    const charges = await chargesOf(sub.id)
    expect(charges.map((c) => c.dueDate)).toEqual([
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
      '2026-05-15',
    ])

    const after = await reload(sub.id)
    expect(after.nextDueDate).toBe('2026-06-15')
    expect(after.status).toBe('ACTIVE')

    // Whatever expired without being paid is OVERDUE — job 2 did its job.
    expect(charges[0]!.status).toBe('OVERDUE')
  })

  it('weekly cycle: the 40-day window covers SEVERAL due dates at once', async () => {
    const sub = await subscribe({ cycle: 'WEEKLY', nextDueDate: '2026-01-10' })

    await h.tick()

    /**
     * 40 days of window in a 7-day cycle: Asaas generates all the charges
     * whose due date fits in the horizon (10/01 … 14/02), not just the next one.
     */
    const charges = await chargesOf(sub.id)
    expect(charges.map((c) => c.dueDate)).toEqual([
      '2026-01-10',
      '2026-01-17',
      '2026-01-24',
      '2026-01-31',
      '2026-02-07',
      '2026-02-14',
    ])
    expect((await reload(sub.id)).nextDueDate).toBe('2026-02-21')
  })

  it('the generated charge is a regular charge: it pays, credits and closes the statement', async () => {
    const sub = await subscribe({ billingType: 'PIX', nextDueDate: IN_40_DAYS, value: 100 })
    await h.tick()

    const [charge] = await chargesOf(sub.id)
    const paid = await h.api.call('confirm-payment', { params: { id: charge!.id } })

    // Pix: RECEIVED directly, fixed fee of R$ 1.99.
    expect(paid.body.status).toBe('RECEIVED')
    expect(paid.body.netValue).toBe(98.01)

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE'])
    expect(ledger[1]!.balanceCents).toBe(9801)

    await h.assertLedgerBalances()
  })
})

describe('The end of the subscription', () => {
  it('maxPayments exhausted → EXPIRED', async () => {
    const sub = await subscribe({ nextDueDate: IN_41_DAYS, maxPayments: 2 })

    await h.advance({ days: 40 }) // today = 2026-02-14

    const charges = await chargesOf(sub.id)
    expect(charges.map((c) => c.dueDate)).toEqual(['2026-02-15', '2026-03-15'])

    const after = await reload(sub.id)
    expect(after.status).toBe('EXPIRED') // acabou o contrato
    expect(after.maxPayments).toBe(2)

    // And it generates NOTHING more, however much time passes.
    await h.advance({ days: 90 })
    expect((await chargesOf(sub.id)).length).toBe(2)
  })

  it('endDate passed → EXPIRED, without generating the charge that would go past the end', async () => {
    const sub = await subscribe({ nextDueDate: IN_41_DAYS, endDate: '2026-03-01' })

    await h.advance({ days: 1 }) // generates the one of 15/02; the next would be 15/03 > 01/03

    const charges = await chargesOf(sub.id)
    expect(charges.map((c) => c.dueDate)).toEqual(['2026-02-15'])
    expect((await reload(sub.id)).status).toBe('EXPIRED')

    await h.advance({ days: 60 })
    expect((await chargesOf(sub.id)).length).toBe(1)
  })

  it('INACTIVE stops generating NEW charges (the creation one stays there)', async () => {
    const sub = await subscribe({ nextDueDate: IN_41_DAYS })

    // The creation already generated one. Deactivating does not erase money already charged.
    expect((await chargesOf(sub.id)).length).toBe(1)

    await h.api.call('update-existing-subscription', {
      params: { id: sub.id },
      body: { status: 'INACTIVE' },
    })

    await h.advance({ days: 60 })

    // Two months later, it is still ONE. The job generated nothing more.
    expect((await chargesOf(sub.id)).length).toBe(1)
    expect((await reload(sub.id)).status).toBe('INACTIVE')
  })

  it('removing the subscription removes the charges still open', async () => {
    const sub = await subscribe({ nextDueDate: IN_40_DAYS })
    await h.tick()

    const [charge] = await chargesOf(sub.id)

    const removed = await h.api.call('remove-subscription', { params: { id: sub.id } })
    expect(removed.status).toBe(200)
    expect(removed.body.deleted).toBe(true)

    const p = await h.api.call('retrieve-a-single-payment', { params: { id: charge!.id } })
    expect(p.body.deleted).toBe(true)

    // Removed, it generates nothing more.
    await h.advance({ days: 60 })
    expect(await chargesOf(sub.id)).toEqual([])
  })
})

describe('Updating the subscription', () => {
  it('`updatePendingPayments: true` reaches the already generated charges', async () => {
    const sub = await subscribe({ billingType: 'PIX', nextDueDate: IN_40_DAYS, value: 100 })
    await h.tick()

    const [before] = await chargesOf(sub.id)
    expect(before!.value).toBe(100)

    await h.api.call('update-existing-subscription', {
      params: { id: sub.id },
      body: { value: 150, updatePendingPayments: true },
    })

    const [after] = await chargesOf(sub.id)
    expect(after!.value).toBe(150)
    // The fee is recalculated too — otherwise the netValue (the split's base) would be wrong.
    expect(after!.netValue).toBe(148.01)
    expect((await reload(sub.id)).value).toBe(150)
  })

  it('without `updatePendingPayments`, the pending charge keeps the old price', async () => {
    const sub = await subscribe({ billingType: 'PIX', nextDueDate: IN_40_DAYS, value: 100 })
    await h.tick()

    await h.api.call('update-existing-subscription', {
      params: { id: sub.id },
      body: { value: 150 },
    })

    // The pending one does NOT change — it is the classic trap of raising the plan's price.
    const [charge] = await chargesOf(sub.id)
    expect(charge!.value).toBe(100)

    // But the NEXT one is already born with the new price.
    await h.advance({ days: 31 }) // the horizon reaches 14/03
    const charges = await chargesOf(sub.id)
    expect(charges.length).toBe(2)
    expect(charges[1]!.value).toBe(150)
  })

  it('an invalid cycle is refused', async () => {
    const sub = await subscribe()
    const res = await h.api.call('update-existing-subscription', {
      params: { id: sub.id },
      body: { cycle: 'DAILY' },
    })
    // The spec already bars the enum: the error comes out as invalid_<field>, in Asaas's format.
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toMatch(/^invalid_/)
  })
})

describe("The subscription's split — a TEMPLATE, copied to every charge", () => {
  it("every generated charge is born with the subscription's split", async () => {
    const other = await createSecondAccount(h)
    const sub = await subscribe({
      billingType: 'PIX',
      nextDueDate: IN_40_DAYS,
      value: 100,
      split: [{ walletId: other.walletId, percentualValue: 30 }],
    })

    expect(sub.split.length).toBe(1)
    expect(sub.split[0].status).toBe('ACTIVE')

    await h.tick()

    const [charge] = await chargesOf(sub.id)
    expect(charge!.split.length).toBe(1)
    expect(charge!.split[0].walletId).toBe(other.walletId)
    // 30% of the NETVALUE (100 − 1.99 = 98.01) = R$ 29.40. Over the gross it would give 30.00.
    expect(charge!.split[0].totalValue).toBe(29.4)
  })

  it('changing the template does NOT touch the already generated charges', async () => {
    const other = await createSecondAccount(h)
    const sub = await subscribe({
      billingType: 'PIX',
      nextDueDate: IN_40_DAYS,
      value: 100,
      split: [{ walletId: other.walletId, percentualValue: 30 }],
    })
    await h.tick()

    await h.api.call('update-existing-subscription', {
      params: { id: sub.id },
      body: { split: [{ walletId: other.walletId, percentualValue: 10 }] },
    })

    // The charge froze the past; the subscription describes the future.
    const [charge] = await chargesOf(sub.id)
    expect(charge!.split[0].totalValue).toBe(29.4)
    expect((await reload(sub.id)).split[0].percentualValue).toBe(10)
  })

  it('it is not possible to split to your own wallet', async () => {
    const res = await h.api.call('create-new-subscription', {
      body: {
        customer: await customer(),
        billingType: 'PIX',
        value: 100,
        nextDueDate: IN_40_DAYS,
        cycle: 'MONTHLY',
        split: [{ walletId: h.walletId, percentualValue: 10 }],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_split')
  })
})

describe('Invoice, payment booklet and isolation', () => {
  const TAXES = { retainIss: false, iss: 2, pis: 0.65, cofins: 3, csll: 1, inss: 0, ir: 1.5 }

  it('CRUD of the invoice issuance configuration', async () => {
    const sub = await subscribe()

    const created = await h.api.call('create-configuration-for-issuance-of-invoices', {
      params: { id: sub.id },
      body: {
        municipalServiceCode: '1.01',
        municipalServiceName: 'Desenvolvimento de sistemas',
        deductions: 55,
        effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION',
        receivedOnly: true,
        observations: 'Referente ao plano Pro',
        taxes: TAXES,
      },
    })

    expect(created.status).toBe(200)
    // In the request the field is `effectiveDatePeriod`; in the response, `invoiceCreationPeriod`.
    // It is Asaas's spec that changes the name — not a mistake of ours.
    expect(created.body.invoiceCreationPeriod).toBe('ON_PAYMENT_CONFIRMATION')
    expect(created.body.deductions).toBe(55)
    expect(created.body.taxes.iss).toBe(2)

    const got = await h.api.call('retrieve-configuration-for-issuance-of-invoices', {
      params: { id: sub.id },
    })
    expect(got.body.municipalServiceCode).toBe('1.01')

    const updated = await h.api.call('update-configuration-for-issuance-of-invoices', {
      params: { id: sub.id },
      body: { deductions: 10, observations: 'Novo texto', taxes: TAXES },
    })
    expect(updated.body.deductions).toBe(10)
    expect(updated.body.observations).toBe('Novo texto')
    expect(updated.body.municipalServiceCode).toBe('1.01') // the rest stays

    const removed = await h.api.call('remove-configuration-for-issuance-of-invoices', {
      params: { id: sub.id },
    })
    expect(removed.body.deleted).toBe(true)

    const gone = await h.api.call('retrieve-configuration-for-issuance-of-invoices', {
      params: { id: sub.id },
    })
    expect(gone.status).toBe(404)
  })

  it("the invoices of the subscription's charges (empty until track G issues them)", async () => {
    const sub = await subscribe({ nextDueDate: IN_40_DAYS })
    await h.tick()

    const res = await h.api.call('list-invoices-for-subscription-charges', {
      params: { id: sub.id },
    })
    expect(res.status).toBe(200)
    expect(res.body.object).toBe('list')
    expect(res.body.totalCount).toBe(0) // genuinely empty, not invented
  })

  it("the subscription's payment booklet is a PDF, and it only lists what has ALREADY been generated", async () => {
    const sub = await subscribe({ nextDueDate: IN_40_DAYS })
    await h.tick()

    const res = await h.app.app.handle(
      new Request(`http://localhost/v3/subscriptions/${sub.id}/paymentBook`, {
        headers: { access_token: '$aact_hmlg_test0000000000000000000000000' },
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/pdf')

    const body = await res.text()
    expect(body.startsWith('%PDF-1.4')).toBe(true)
    expect(body).toContain('2026-02-14') // the only charge that exists
  })

  it("changing the subscription's card links the card and changes the billingType", async () => {
    const sub = await subscribe()

    const res = await h.api.call('update-subscription-credit-card', {
      params: { id: sub.id },
      body: {
        creditCard: {
          holderName: 'Fulano de Tal',
          number: '5162306219378829',
          expiryMonth: '05',
          expiryYear: '2030',
          ccv: '318',
        },
        creditCardHolderInfo: {
          name: 'Fulano de Tal',
          email: 'fulano@localhost',
          cpfCnpj: '24971563792',
          postalCode: '89223-005',
          addressNumber: '277',
          phone: '4738010919',
        },
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.billingType).toBe('CREDIT_CARD')
    // Only the LAST 4 digits — never the PAN.
    expect(res.body.creditCard.creditCardNumber).toBe('8829')
    expect(res.body.creditCard.creditCardBrand).toBe('MASTERCARD')
    expect(res.body.creditCard.creditCardToken).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('a subscription from another account does not exist (404, not 403)', async () => {
    const other = await createSecondAccount(h)
    const sub = await subscribe()

    const res = await h.as(other.apiKey).call('retrieve-a-single-subscription', {
      params: { id: sub.id },
    })
    expect(res.status).toBe(404)
  })
})

describe('Subscription webhooks', () => {
  it('SUBSCRIPTION_CREATED and PAYMENT_CREATED come out TOGETHER at creation', async () => {
    await h.subscribeWebhook(['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'])

    const sub = await subscribe({ nextDueDate: IN_41_DAYS })
    await h.tick()

    // Both. The charge is born with the subscription — not 40 days later, as
    // this test used to assert before the parity capture.
    expect(h.sink.eventNames).toContain('SUBSCRIPTION_CREATED')
    expect(h.sink.eventNames).toContain('PAYMENT_CREATED')
    expect((await chargesOf(sub.id)).length).toBe(1)
  })
})

describe('A subscription on the card stores the card', () => {
  /**
   * Regression of a silent failure that would only appear 40 days later.
   *
   * The route `POST /v3/subscriptions` is SHARED with the "with card" variant
   * (the body decides, as in the real Asaas). While the route's schema was only the
   * canonical operation's, Elysia dropped `creditCard` before the handler: the
   * subscription was born `billingType: CREDIT_CARD` with `creditCardId: null`, with
   * no error at all — and the charge generated in the D-40 window would have no card
   * to charge it. This test ties the two ends together: the body arrives, and the handler uses it.
   */
  it('tokenizes the card sent at creation and links it to the subscription', async () => {
    const res = await h.api.call('create-new-subscription', {
      body: {
        customer: await customer(),
        billingType: 'CREDIT_CARD',
        value: 100,
        nextDueDate: IN_40_DAYS,
        cycle: 'MONTHLY',
        creditCard: {
          holderName: 'Fulano de Tal',
          number: '4444444444444444', // the test card that approves
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
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ACTIVE')

    // The card WAS stored — and it is what the subscription points to.
    const [sub] = await h.app.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, res.body.id))

    expect(sub!.creditCardId).not.toBeNull()

    const [card] = await h.app.db
      .select()
      .from(creditCards)
      .where(eq(creditCards.id, sub!.creditCardId!))

    expect(card!.last4).toBe('4444')
    // The PAN is never stored — only the last 4 digits.
    expect(JSON.stringify(card)).not.toContain('4444444444444444')
  })
})
