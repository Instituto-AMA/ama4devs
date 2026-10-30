/**
 * The flows that the real client of the simulator (PartiuRole) exercises.
 *
 * Every test here was born from a call the client MAKES and that the simulator
 * answered wrong. The formats were captured from the real Asaas sandbox on
 * 2026-07-14 — they are not deduced from the documentation.
 *
 * The lesson this file records: the two failures below went through the
 * contract validation without a scratch. Asaas's spec describes neither the
 * installment plan through POST /v3/payments, nor that `creditCard` is dispensable when
 * there is a token. A green contract is not the same as the right API.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { isValidBrCode } from '../../src/domain/pix-brcode.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

const CARD = {
  holderName: 'COMPRADOR TESTE',
  number: '4444444444444444',
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
}
const HOLDER = {
  name: 'Comprador Teste',
  email: 'comprador@localhost.test',
  cpfCnpj: '24971563792',
  postalCode: '14079-452',
  addressNumber: '100',
  phone: '4796321478',
}

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Comprador Teste', cpfCnpj: '24971563792' },
  })
  expect(res.status).toBe(200)
  return res.body.id
}

async function token(cus: string): Promise<string> {
  const res = await h.api.call('credit-card-tokenization', {
    body: { customer: cus, creditCard: CARD, creditCardHolderInfo: HOLDER, remoteIp: '8.8.8.8' },
  })
  expect(res.status).toBe(200)
  return res.body.creditCardToken
}

describe('installment plan through POST /v3/payments', () => {
  /**
   * The door the typical client uses: `installmentCount` in a regular charge,
   * without ever having heard of /v3/installments. The simulator REFUSED, with
   * a 400 "not implemented" — the installment purchase flow did not exist.
   */
  it('returns the FIRST INSTALLMENT, not the plan object', async () => {
    const cus = await customer()

    const res = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'CREDIT_CARD',
        installmentCount: 3,
        totalValue: 300,
        dueDate: '2026-12-31',
        creditCardToken: await token(cus),
        remoteIp: '8.8.8.8',
      },
    })

    expect(res.status).toBe(200)

    // It is a `payment`, and it brings the link to the plan. Returning the plan's
    // installment plan here (as POST /v3/installments does) would break the client.
    expect(res.body.object).toBe('payment')
    expect(res.body.installment).toBeString()
    expect(res.body.installmentNumber).toBe(1)
    expect(res.body.description).toBe('Parcela 1 de 3.')

    // R$ 300 in 3x → an installment of R$ 100, a fee of R$ 3.65 → net R$ 96.35.
    // (sandbox real: value 100.00, netValue 96.35)
    expect(res.body.value).toBe(100)
    expect(res.body.netValue).toBe(96.35)

    // With a card, the installment is already born CONFIRMED — the issuer authorizes the total at
    // once. Leaving it PENDING would be a silent failure: the charge would never
    // happen and nobody would see any error.
    expect(res.body.status).toBe('CONFIRMED')

    await h.assertLedgerBalances()
  })

  it('the 3 installments really exist, and add up to the total', async () => {
    const cus = await customer()

    const first = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        installmentCount: 3,
        totalValue: 100,
        dueDate: '2026-12-31',
      },
    })
    expect(first.status).toBe(200)

    const parts = await h.api.call('list-payments-of-a-installment', {
      params: { id: first.body.installment },
      query: { limit: 100 },
    })
    expect(parts.body.data.length).toBe(3)

    // The rounding remainder goes on the LAST one: 33.33 + 33.33 + 33.34 = 100.00.
    const values = parts.body.data.map((p: any) => p.value)
    expect(values).toEqual([33.33, 33.33, 33.34])
  })

  it('`installmentValue` is the INSTALLMENT amount — not the total', async () => {
    const cus = await customer()

    // In POST /v3/payments the one that carries the installment amount is `installmentValue`.
    // (In POST /v3/installments it is `value`. The names differ between the two doors.)
    const res = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        installmentCount: 4,
        installmentValue: 25,
        dueDate: '2026-12-31',
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.value).toBe(25) // 4 × 25 = 100 in total
  })
})

describe('Pix QR Code', () => {
  /**
   * Without this, a Pix purchase has no way to be paid: the QR and the "copy and paste"
   * are the only things the buyer actually uses. It answered 501.
   */
  it('returns a valid EMV BR Code and the QR image', async () => {
    const cus = await customer()

    const pay = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'PIX', value: 100, dueDate: '2026-12-31' },
    })

    const res = await h.api.call('get-qr-code-for-pix-payments', {
      params: { id: pay.body.id },
    })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // The payload is a real BR Code: Pix TLV + the correct CRC16 at the end.
    // If the CRC is wrong, the bank's app refuses — and it is the kind of thing that
    // is only discovered with the phone in hand. Here it is discovered in CI.
    expect(res.body.payload).toStartWith('000201')
    expect(res.body.payload).toContain('br.gov.bcb.pix')
    expect(isValidBrCode(res.body.payload)).toBe(true)

    // The image is a real PNG (signature \x89PNG\r\n\x1a\n). That the QR
    // inside it really ENCODES this payload — that is, that it scans — is
    // proven in tests/unit/qrcode.test.ts, which decodes the image back.
    const png = Buffer.from(res.body.encodedImage, 'base64')
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    // It expires a YEAR after the due date — not ON the due date. Proven at two
    // points against the real sandbox, and it is counterintuitive enough to lock down.
    expect(res.body.expirationDate).toBe('2027-12-31 23:59:59')

    // Without a description on the charge, Asaas returns this text. Without an accent.
    expect(res.body.description).toBe('Descricao nao informada')
  })

  it('BOLETO also has a QR — Asaas issues a hybrid bank slip', async () => {
    const cus = await customer()

    const pay = await h.api.call('create-new-payment', {
      body: {
        customer: cus,
        billingType: 'BOLETO',
        value: 50,
        dueDate: '2026-08-20',
        description: 'Ingresso',
      },
    })

    const res = await h.api.call('get-qr-code-for-pix-payments', {
      params: { id: pay.body.id },
    })

    expect(res.status).toBe(200)
    expect(isValidBrCode(res.body.payload)).toBe(true)
    expect(res.body.expirationDate).toBe('2027-08-20 23:59:59')
    expect(res.body.description).toBe('Ingresso')
  })
})

describe('paying a charge with an ALREADY TOKENIZED card', () => {
  /**
   * The whole point of tokenization is the PAN not travelling again. Asaas's spec
   * marks `creditCard` and `creditCardHolderInfo` as mandatory; the real Asaas
   * does not require them. While the `required` was in the schema, Elysia refused the body
   * BEFORE the handler — with TypeBox errors in English, that no Asaas client
   * would ever see. See spec/overlays/005.
   */
  it('accepts only the creditCardToken, and confirms', async () => {
    const cus = await customer()
    const tok = await token(cus)

    const pending = await h.api.call('create-new-payment', {
      body: { customer: cus, billingType: 'CREDIT_CARD', value: 150, dueDate: '2026-12-31' },
    })
    expect(pending.body.status).toBe('PENDING')

    const paid = await h.api.call('pay-a-charge-with-credit-card', {
      params: { id: pending.body.id },
      body: { creditCardToken: tok },
    })

    expect(paid.status).toBe(200)
    expect(paid.body.status).toBe('CONFIRMED')

    // The card comes back in the response — masked, and with the same token.
    expect(paid.body.creditCard.creditCardToken).toBe(tok)
    expect(paid.body.creditCard.creditCardNumber).toBe('4444')

    // Confirmed today, but the money only lands at D+32 — `creditDate` points to the
    // the future and `paymentDate` stays NULL. It is the asymmetry that Asaas has and
    // that almost every integration gets wrong: `paymentDate` is only filled when the
    // money actually lands, not when the purchase is approved.
    expect(paid.body.confirmedDate).toBeString()
    expect(paid.body.creditDate > paid.body.confirmedDate).toBe(true)
    expect(paid.body.paymentDate).toBeNull()

    await h.assertLedgerBalances()
  })
})
