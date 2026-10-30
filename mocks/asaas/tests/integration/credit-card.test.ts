/**
 * Credit card — track H.
 *
 * The three facts this file exists to prove, and that Asaas's sandbox
 * does not let you test:
 *
 *   1. A card charge is born CONFIRMED. Not PENDING. The `dueDate` does not postpone
 *      anything — the capture happens at creation time.
 *   2. The money only exists at D+32. Here that takes milliseconds.
 *   3. The declining card answers 400 and the charge is NOT created.
 *
 * And a safety invariant: the full PAN stays nowhere — neither in the
 * response, nor in ANY table of the database.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { creditCards, financialTransactions } from '../../src/db/schema/index.ts'
import { CARD_ERRORS } from '../../src/domain/credit-card.ts'
import { chargebackHandlers } from '../../src/modules/chargebacks/handlers.ts'
import { creditCardHandlers } from '../../src/modules/credit-cards/handlers.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

/** The test cards of Asaas's sandbox. */
const APPROVES = '4444444444444444'
const DECLINES = '5184019740373151'
const DECLINES_TOO = '4916561358240741'
/** Passes Luhn, is not in the test table → it approves. */
const VALID_VISA = '4111111111111111'
/** A valid Diners (14 digits): maximum of 12 installments. */
const VALID_DINERS = '30569309025904'

const card = (number: string) => ({
  holderName: 'John Doe',
  number,
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
})

const holderInfo = {
  name: 'John Doe',
  email: 'john.doe@localhost',
  cpfCnpj: '24971563792',
  postalCode: '89223005',
  addressNumber: '277',
  phone: '4738010919',
}

let h: Harness

beforeEach(async () => {
  // Track H is not in the global HANDLERS yet — the harness registers the handlers
  // of the track and exercises the real server.
  h = await createHarness()
})
afterEach(() => h.close())

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  return res.body.id
}

const ledgerOf = async (accountId: string) =>
  h.app.db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.accountId, accountId))

/** Scans ALL the database tables looking for the card number. */
async function assertPanIsNowhere(pan: string): Promise<void> {
  const tables = (await h.app.db.all(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
  )) as { name: string }[]

  for (const { name } of tables) {
    const rows = await h.app.db.all(sql.raw(`SELECT * FROM "${name}"`))
    expect(JSON.stringify(rows)).not.toContain(pan)
  }
}

// ─────────────────────────────────────────────────────────────
describe('Tokenization', () => {
  it('returns the LAST 4 digits, the brand and a token — and the PAN is gone', async () => {
    const cus = await customer()

    const res = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(200)
    // The last 4 digits — not a mask with asterisks, not the number.
    expect(res.body.creditCardNumber).toBe('4444')
    expect(res.body.creditCardBrand).toBe('VISA')
    expect(res.body.creditCardToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    // Neither in the response…
    expect(JSON.stringify(res.body)).not.toContain(APPROVES)

    // …nor in ANY table of the database.
    await assertPanIsNowhere(APPROVES)

    const [row] = await h.app.db.select().from(creditCards)
    expect(row!.last4).toBe('4444')
    expect(row!.brand).toBe('VISA')
    expect(row!.simulatedOutcome).toBe('APPROVE')
  })

  /**
   * The TOKENIZATION AUTHORIZES — captured from the sandbox (tools/probe-tokenization.ts).
   * This test asserted the opposite ("the refusal happens at use time") and the mock
   * tokenized any card: the app said "card saved!" and only broke on the
   * first charge. It is exactly the bug a saved-card feature
   * must not have.
   */
  it('the declining card does NOT tokenize — the authorization happens on save', async () => {
    const cus = await customer()
    const res = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card(DECLINES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0]).toEqual(CARD_ERRORS.DECLINE)
    // And nothing stayed in the vault: a card that does not authorize is not stored.
    expect(await h.app.db.select().from(creditCards)).toHaveLength(0)
  })

  /**
   * The sandbox hole this mock plugs: in the real Asaas a saved card ALWAYS
   * approves (the bad one never becomes a token), so there is no way to test "the customer's
   * card failed on renewal" — which is the scenario that actually breaks the feature.
   * `4000000000000341` is ours, and it delivers the REAL error.
   */
  it('4000000000000341 tokenizes, and declines when the token is charged', async () => {
    const cus = await customer()
    const tok = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card('4000000000000341'),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })
    expect(tok.status).toBe(200)

    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCardToken: tok.body.creditCardToken,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0]).toEqual(CARD_ERRORS.DECLINE)
  })

  /**
   * Asaas does NOT validate Luhn — captured from the sandbox (tools/probe-cards.ts). This
   * test asserted the opposite and the mock refused: a card that passes in production
   * broke here. It is the dangerous direction of the error, and that is why it became a test.
   */
  it('a number that fails Luhn TOKENIZES — Asaas accepts a wrong check digit', async () => {
    const cus = await customer()
    const res = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card('5184019740373152'), // one digit swapped
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(200)
    expect(await h.app.db.select().from(creditCards)).toHaveLength(1)
  })

  it("a number that is too short → 400 invalid_creditCard, with Asaas's sentence", async () => {
    const cus = await customer()
    const res = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card('411111111111'),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0]).toEqual(CARD_ERRORS.INVALID_NUMBER)
    expect(await h.app.db.select().from(creditCards)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────
describe('Card charge — CONFIRMED right away', () => {
  it('4444444444444444 → 200 and status CONFIRMED, not PENDING', async () => {
    const cus = await customer()

    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        // A due date in the future: on a card that postpones NOTHING. The capture is now.
        dueDate: '2026-02-10',
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(200) // creation is 200, never 201
    expect(res.body.status).toBe('CONFIRMED')

    // The single-payment card fee: R$ 0.49 + 2.99% of R$ 100 = R$ 3.48
    expect(res.body.value).toBe(100)
    expect(res.body.netValue).toBe(96.52)

    // The capture is TODAY (05/01), not on the due date → credit on 06/02.
    // The real Asaas INCLUDES `confirmedDate` in the payload — but only when the
    // billingType is CREDIT_CARD. On a Pix or bank slip the key does not even exist. This
    // test asserted the opposite; the parity capture corrected it.
    expect(res.body.confirmedDate).toBe('2026-01-05')
    expect(res.body.estimatedCreditDate).toBe('2026-02-06')

    expect(res.body.creditCard).toEqual({
      creditCardNumber: '4444',
      creditCardBrand: 'VISA',
      creditCardToken: expect.any(String),
    })
    expect(JSON.stringify(res.body)).not.toContain(APPROVES)

    // CONFIRMED is not money in the account.
    expect(await ledgerOf(h.accountId)).toHaveLength(0)
    await h.assertLedgerBalances()
  })

  it('the money only arrives at D+32 — with PAYMENT_RECEIVED and PAYMENT_FEE in the statement', async () => {
    const cus = await customer()
    await h.subscribeWebhook(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])

    const created = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })
    expect(created.body.status).toBe('CONFIRMED')

    await h.advance({ days: 31 })
    let p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.status).toBe('CONFIRMED')
    expect(await ledgerOf(h.accountId)).toHaveLength(0)

    // O 32º dia.
    await h.advance({ days: 1 })

    p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.status).toBe('RECEIVED')
    expect(p.body.creditDate).toBe('2026-02-06')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE'])
    expect(ledger[0]!.valueCents).toBe(10_000) // +R$ 100,00
    expect(ledger[1]!.valueCents).toBe(-348) // −R$ 3,48 (0,49 + 2,99%)
    expect(ledger[1]!.balanceCents).toBe(9652)

    expect(h.sink.eventNames).toContain('PAYMENT_CONFIRMED')
    expect(h.sink.eventNames).toContain('PAYMENT_RECEIVED')

    await h.assertLedgerBalances()
  })

  it('any valid card (that passes Luhn) also approves', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 50,
        dueDate: '2026-01-10',
        creditCard: card(VALID_VISA),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
  })

  it('charges with an already existing token, without resending the card', async () => {
    const cus = await customer()

    const tok = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCardToken: tok.body.creditCardToken,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
    // Reuses the card: it does not create a second row.
    expect(await h.app.db.select().from(creditCards)).toHaveLength(1)
    expect(res.body.creditCard.creditCardToken).toBe(tok.body.creditCardToken)
  })
})

// ─────────────────────────────────────────────────────────────
describe('Refusal — 400 and the charge does not exist', () => {
  for (const pan of [DECLINES, DECLINES_TOO]) {
    it(`${pan} → 400, and no charge is created`, async () => {
      const cus = await customer()

      const res = await h.api.call('create-new-payment-with-credit-card', {
        body: {
          customer: cus,
          billingType: 'CREDIT_CARD',
          value: 100,
          dueDate: '2026-01-10',
          creditCard: card(pan),
          creditCardHolderInfo: holderInfo,
          remoteIp: '116.213.42.53',
        },
      })

      expect(res.status).toBe(400)
      // The code is `invalid_action`, NOT `invalid_creditCard` — captured from the
      // sandbox. Before this the mock returned the wrong code, and a client that
      // branches on `code` behaved differently here and there.
      expect(res.body.errors[0]).toEqual(CARD_ERRORS.DECLINE)
      // GENERIC message: Asaas does not say the reason for the refusal, and there is no reason
      // field in the body. Inventing one would teach the client to handle fiction.
      expect(res.body.errors[0].description).not.toContain('limite')

      // The charge was NOT created — it is not a "declined" charge.
      const list = await h.api.call('list-payments')
      expect(list.body.totalCount).toBe(0)
      // And the declined card was not stored either.
      expect(await h.app.db.select().from(creditCards)).toHaveLength(0)

      await h.assertLedgerBalances()
    })
  }

  /**
   * The declining card no longer becomes a token (the tokenization authorizes), so
   * "declining by token" is exercised by the simulation card `4000000000000341`,
   * in the Tokenization block. Here we only guarantee that a refusal by token does not leave an
   * orphan charge.
   */
  it('a refusal by token does not create a charge', async () => {
    const cus = await customer()

    const tok = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card('4000000000000341'), // it tokenizes, but it refuses on charge
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCardToken: tok.body.creditCardToken,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    const list = await h.api.call('list-payments')
    expect(list.body.totalCount).toBe(0)
    await h.assertLedgerBalances()
  })

  /**
   * The TOKEN IS BOUND TO THE CUSTOMER — captured. Using customer A's token to charge
   * customer B returns "not found" (Asaas does not even admit the token exists). The mock
   * accepted it, and an app that shuffled tokens between customers would only find out in
   * production.
   */
  it('customer A\'s token does NOT charge customer B', async () => {
    const cusA = await customer()
    const tok = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cusA,
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })
    const token = tok.body.creditCardToken

    const cusB = (
      await h.api.call('create-new-customer', {
        body: { name: 'Another Customer', cpfCnpj: '24971563792' },
      })
    ).body.id

    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cusB,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCardToken: token,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_creditCard')
    expect(res.body.errors[0].description).toBe(`CreditCardToken ${token} não encontrado.`)
  })

  /**
   * The trap of "revalidating the CVV on a repurchase": sending the token TOGETHER with a
   * partial `creditCard` makes Asaas require the whole card — and return an error
   * PER FIELD. The mock used to answer "Expected union value", an internal error of the
   * validator leaking to the client.
   */
  it('partial token + creditCard → one error per missing field', async () => {
    const cus = await customer()
    const tok = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCardToken: tok.body.creditCardToken,
        creditCard: { ccv: '318' }, // only the CVV
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors.map((e: { description: string }) => e.description)).toEqual([
      'Informe o nome do portador.',
      'Informe o número do seu cartão.',
      'Informe o mês de vencimento do seu cartão.',
      'Informe o ano de vencimento do seu cartão.',
    ])
  })
})

// ─────────────────────────────────────────────────────────────
describe('Pre-authorization', () => {
  it('authorizeOnly → AUTHORIZED without credit; capture → CONFIRMED; capturing again → 400', async () => {
    const cus = await customer()

    const created = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
        authorizeOnly: true,
      },
    })

    expect(created.status).toBe(200)
    // AUTHORIZED exists in NO enum of Asaas's spec — it is in overlay 001.
    expect(created.body.status).toBe('AUTHORIZED')
    expect(await ledgerOf(h.accountId)).toHaveLength(0)

    // A pre-authorized charge never credits — not even after 32 days.
    await h.advance({ days: 32 })
    const still = await h.api.call('retrieve-a-single-payment', {
      params: { id: created.body.id },
    })
    expect(still.body.status).toBe('AUTHORIZED')
    expect(await ledgerOf(h.accountId)).toHaveLength(0)

    const captured = await h.api.call('capture-payment-with-pre-authorization', {
      params: { id: created.body.id },
      body: {},
    })
    expect(captured.status).toBe(200)
    expect(captured.body.status).toBe('CONFIRMED')
    // Capture on 06/02 → credit on 10/03 (D+32 from the CAPTURE, not from the creation).
    expect(captured.body.estimatedCreditDate).toBe('2026-03-10')

    // Capturing again: the state machine refuses.
    const again = await h.api.call('capture-payment-with-pre-authorization', {
      params: { id: created.body.id },
      body: {},
    })
    expect(again.status).toBe(400)
    expect(again.body.errors[0].code).toBe('invalid_action')

    // And the money enters 32 days after the capture.
    await h.advance({ days: 32 })
    const settled = await h.api.call('retrieve-a-single-payment', {
      params: { id: created.body.id },
    })
    expect(settled.body.status).toBe('RECEIVED')

    const ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE'])
    await h.assertLedgerBalances()
  })

  it('the pre-authorization configuration is read and stored', async () => {
    const before = await h.api.call('retrieve-pre-authorization-configuration')
    expect(before.status).toBe(200)
    expect(before.body.daysToExpire).toBe(5) // default

    const saved = await h.api.call('save-or-update-pre-authorization-configuration', {
      body: { daysToExpire: 10 },
    })
    expect(saved.body.daysToExpire).toBe(10)

    const after = await h.api.call('retrieve-pre-authorization-configuration')
    expect(after.body.daysToExpire).toBe(10)

    const bad = await h.api.call('save-or-update-pre-authorization-configuration', {
      body: { daysToExpire: 0 },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.errors[0].code).toBe('invalid_daysToExpire')
  })
})

// ─────────────────────────────────────────────────────────────
describe('Paying a charge that already exists', () => {
  it('payWithCreditCard: PENDING → CONFIRMED, and the fee becomes the card\'s', async () => {
    const cus = await customer()

    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'UNDEFINED', value: 100, dueDate: '2026-01-10' },
    })
    expect(created.body.status).toBe('PENDING')
    expect(created.body.netValue).toBe(100) // UNDEFINED has no fee: the method is not known yet

    const paid = await h.api.call('pay-a-charge-with-credit-card', {
      params: { id: created.body.id },
      body: { creditCard: card(APPROVES), creditCardHolderInfo: holderInfo },
    })

    expect(paid.status).toBe(200)
    expect(paid.body.status).toBe('CONFIRMED')
    expect(paid.body.billingType).toBe('CREDIT_CARD')
    // Paid with a card → the fee becomes the card's.
    expect(paid.body.netValue).toBe(96.52)
    expect(paid.body.creditCard.creditCardNumber).toBe('4444')

    await h.advance({ days: 32 })
    const settled = await h.api.call('retrieve-a-single-payment', {
      params: { id: created.body.id },
    })
    expect(settled.body.status).toBe('RECEIVED')
    await h.assertLedgerBalances()
  })

  it('payWithCard (cardType CREDIT) does the same', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'CREDIT_CARD', value: 100, dueDate: '2026-01-10' },
    })

    const paid = await h.api.call('pay-a-charge-with-card', {
      params: { id: created.body.id },
      body: { cardType: 'CREDIT', card: card(APPROVES) },
    })

    expect(paid.status).toBe(200)
    expect(paid.body.status).toBe('CONFIRMED')
  })

  it('payWithCreditCard with a declined card → 400 and the charge stays PENDING', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'CREDIT_CARD', value: 100, dueDate: '2026-01-10' },
    })

    const res = await h.api.call('pay-a-charge-with-credit-card', {
      params: { id: created.body.id },
      body: { creditCard: card(DECLINES), creditCardHolderInfo: holderInfo },
    })

    expect(res.status).toBe(400)
    const p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.status).toBe('PENDING')
    await h.assertLedgerBalances()
  })
})

// ─────────────────────────────────────────────────────────────
describe('Validations', () => {
  it('without remoteIp → 400 invalid_remoteIp', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_remoteIp')
  })

  /** See the explanation in the tokenization block: Asaas does not validate Luhn. */
  it('a number that fails Luhn is CHARGED — Asaas does not validate Luhn', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card('4916561358240742'), // one digit swapped
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
  })

  it("an EXPIRED card → 400, with Asaas's sentence", async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: { ...card(APPROVES), expiryMonth: '05', expiryYear: '2020' },
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0]).toEqual(CARD_ERRORS.EXPIRED)
    const list = await h.api.call('list-payments')
    expect(list.body.totalCount).toBe(0)
  })

  /**
   * The SIMULATION card: it does not exist in Asaas (there it would approve), and it exists here
   * so that the error handling can be exercised by swapping a number.
   */
  it('4000000000000069 forces "expired card" even with a future expiry', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card('4000000000000069'), // valid until 12/2030, and it still expires
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0]).toEqual(CARD_ERRORS.EXPIRED)
  })

  it('15x on Diners (maximum 12) → 400 invalid_installmentCount', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        // `value` is `required` in the spec's schema even in an installment charge
        // (it is the installment plan that uses totalValue) — without it Elysia rejects before
        // the handler sees the body.
        value: 1500,
        totalValue: 1500,
        installmentCount: 15,
        dueDate: '2026-01-10',
        creditCard: card(VALID_DINERS),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_installmentCount')
    expect(res.body.errors[0].description).toContain('12')
    const list = await h.api.call('list-payments')
    expect(list.body.totalCount).toBe(0)
  })

  it('a token from another account is not accepted (isolation)', async () => {
    const cus = await customer()
    const tok = await h.api.call('credit-card-tokenization', {
      body: {
        customer: cus,
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    const { createSecondAccount } = await import('../helpers/harness.ts')
    const other = await createSecondAccount(h)
    const otherApi = h.as(other.apiKey)

    const otherCustomer = await otherApi.call('create-new-customer', {
      body: { name: 'Beltrano', cpfCnpj: '24971563792' },
    })

    const res = await otherApi.call('create-new-payment-with-credit-card', {
      body: {
        customer: otherCustomer.body.id,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCardToken: tok.body.creditCardToken,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    // The code is `invalid_creditCard` and the sentence CARRIES the token — captured.
    // Before it was `invalid_creditCardToken` with a generic sentence, both invented.
    expect(res.body.errors[0].code).toBe('invalid_creditCard')
    expect(res.body.errors[0].description).toBe(
      `CreditCardToken ${tok.body.creditCardToken} não encontrado.`,
    )
  })

  it('a card with a billingType other than CREDIT_CARD → 400', async () => {
    const cus = await customer()
    const res = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_billingType')
  })
})

// ─────────────────────────────────────────────────────────────
describe('Chargeback', () => {
  /**
   * Asaas's API has no operation to OPEN a chargeback (the issuer opens it).
   * The door is administrative — the same place time travel comes from.
   * tempo. Sem ela, nenhum dev conseguiria testar o fluxo.
   */
  const openChargeback = (paymentId: string, reason = 'FRAUD') =>
    h.app.app.handle(
      new Request(`http://localhost/_admin/payments/${paymentId}/chargeback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    )

  /** A card charge that is already RECEIVED (D+32 fulfilled). */
  async function received(): Promise<string> {
    const cus = await customer()
    const created = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })
    await h.advance({ days: 32 })
    return created.body.id
  }

  it('debits the amount from the balance and takes the charge to CHARGEBACK_REQUESTED', async () => {
    const id = await received()

    let ledger = await ledgerOf(h.accountId)
    expect(ledger[ledger.length - 1]!.balanceCents).toBe(9652) // R$ 96,52 em caixa

    const res = await openChargeback(id)
    expect(res.status).toBe(200)

    const p = await h.api.call('retrieve-a-single-payment', { params: { id } })
    expect(p.body.status).toBe('CHARGEBACK_REQUESTED')
    // The chargeback object appears in the charge — with the last 4 digits of the card.
    expect(p.body.chargeback.status).toBe('REQUESTED')
    expect(p.body.chargeback.reason).toBe('FRAUD')
    expect(p.body.chargeback.value).toBe(100)
    expect(p.body.chargeback.creditCard).toEqual({ number: '4444', brand: 'VISA' })

    // The money GOES BACK to the cardholder: a debit of the GROSS amount (the fee does not come back).
    ledger = await ledgerOf(h.accountId)
    expect(ledger.map((l) => l.type)).toEqual(['PAYMENT_RECEIVED', 'PAYMENT_FEE', 'CHARGEBACK'])
    expect(ledger[2]!.valueCents).toBe(-10_000)
    expect(ledger[2]!.balanceCents).toBe(-348) // it stays NEGATIVE because of the retained fee

    await h.assertLedgerBalances()
  })

  it('a CONFIRMED one (that has not credited yet) generates no entry — there is nothing to debit', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment-with-credit-card', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        value: 100,
        dueDate: '2026-01-10',
        creditCard: card(APPROVES),
        creditCardHolderInfo: holderInfo,
        remoteIp: '116.213.42.53',
      },
    })

    await openChargeback(created.body.id)

    const p = await h.api.call('retrieve-a-single-payment', { params: { id: created.body.id } })
    expect(p.body.status).toBe('CHARGEBACK_REQUESTED')
    expect(await ledgerOf(h.accountId)).toHaveLength(0)

    await h.assertLedgerBalances()
  })

  it('lists, retrieves and opens a dispute', async () => {
    const id = await received()
    await openChargeback(id, 'COMMERCIAL_DISAGREEMENT')

    const list = await h.api.call('list-chargebacks')
    expect(list.status).toBe(200)
    expect(list.body.totalCount).toBe(1)
    expect(list.body.data[0].reason).toBe('COMMERCIAL_DISAGREEMENT')

    const one = await h.api.call('retrieve-a-single-chargeback', { params: { id } })
    expect(one.status).toBe(200)
    expect(one.body.status).toBe('REQUESTED')
    expect(one.body.disputeStartDate).toBe('2026-02-06')
    expect(one.body.deadlineToSendDisputeDocuments).toBe('2026-02-26')

    // The dispute is multipart — the ApiClient only speaks JSON, so it goes by hand.
    const form = new FormData()
    form.append('files', new File(['receipt'], 'invoice.pdf'))

    const dispute = await h.app.app.handle(
      new Request(`http://localhost/v3/chargebacks/${one.body.id}/dispute`, {
        method: 'POST',
        headers: { access_token: '$aact_hmlg_test0000000000000000000000000' },
        body: form,
      }),
    )
    expect(dispute.status).toBe(200)
    expect(await dispute.json()).toEqual({
      chargebackId: one.body.id,
      status: 'REQUESTED',
      files: ['invoice.pdf'],
    })

    const after = await h.api.call('retrieve-a-single-chargeback', { params: { id } })
    expect(after.body.status).toBe('IN_DISPUTE')
    expect(after.body.disputeStatus).toBe('REQUESTED')

    await h.assertLedgerBalances()
  })

  it('a charge without a chargeback → 404', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 10, dueDate: '2026-01-10' },
    })

    const res = await h.api.call('retrieve-a-single-chargeback', {
      params: { id: created.body.id },
    })
    expect(res.status).toBe(404)
  })

  it('you cannot open a chargeback on a charge that was not paid', async () => {
    const cus = await customer()
    const created = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'BOLETO', value: 10, dueDate: '2026-01-10' },
    })

    const res = await openChargeback(created.body.id)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { errors: { code: string }[] }
    expect(body.errors[0]!.code).toBe('invalid_action')
  })
})
