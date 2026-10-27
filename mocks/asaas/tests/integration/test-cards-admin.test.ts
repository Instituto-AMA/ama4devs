/**
 * The test-card table as the panel manages it under /_admin/test-cards.
 *
 * What this file proves: a card added with a refusal reason (typed or generated)
 * forces that outcome on a real card charge; the "accept any card" switch decides
 * an unlisted number (approved on, refused off) while listed cards keep theirs;
 * duplicates and built-in removals are refused; and the invoice page offers the
 * added cards.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { luhn } from '../../src/domain/credit-card.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
afterEach(() => h?.close())

async function admin(path: string, method = 'GET', body?: unknown) {
  const res = await h.app.app.handle(
    new Request(`http://localhost/_admin${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

/** A card charge paid at creation with `number`; the status code and body. */
async function chargeWith(number: string) {
  const cus = await h.api.call('create-new-customer', { body: { name: 'Fulano', cpfCnpj: '24971563792' } })
  return h.api.call('create-new-payment', {
    body: {
      customer: cus.body.id,
      billingType: 'CREDIT_CARD',
      value: 100,
      dueDate: '2026-01-20',
      creditCard: { holderName: 'TESTE', number, expiryMonth: '12', expiryYear: '2030', ccv: '123' },
      creditCardHolderInfo: {
        name: 'Fulano',
        email: 'fulano@localhost',
        cpfCnpj: '24971563792',
        postalCode: '89223005',
        addressNumber: '10',
        phone: '4738010919',
      },
      remoteIp: '127.0.0.1',
    },
  })
}

const UNLISTED = '4111111111111111'

describe('test cards admin', () => {
  it('a typed card with a refusal reason forces it on a real charge, and can be removed', async () => {
    h = await createHarness()
    const added = await admin('/test-cards', 'POST', {
      number: UNLISTED,
      outcome: 'DECLINE',
      label: 'Limite estourado',
    })
    expect(added.status).toBe(200)
    expect(added.body.label).toBe('Limite estourado')

    const list = await admin('/test-cards')
    const mine = list.body.cards.find((c: any) => c.number === UNLISTED)
    expect(mine.custom).toBe(true)
    expect(mine.brand).toBe('VISA')

    const refused = await chargeWith(UNLISTED)
    expect(refused.status).toBe(400)
    expect(refused.body.errors[0].code).toBe('invalid_action')

    expect((await admin(`/test-cards/${UNLISTED}`, 'DELETE')).status).toBe(200)
    expect((await chargeWith(UNLISTED)).status).toBe(200)
  })

  it('generates a valid number of the brand when none is typed', async () => {
    h = await createHarness()
    const added = await admin('/test-cards', 'POST', { brand: 'MASTERCARD', outcome: 'EXPIRED' })
    expect(added.status).toBe(200)
    expect(added.body.number).toMatch(/^5\d{15}$/)
    expect(luhn(added.body.number)).toBe(true)
    expect(added.body.label).toBe('Cartão expirado')

    const res = await chargeWith(added.body.number)
    expect(res.status).toBe(400)
    expect(res.body.errors[0].description).toBe('O cartão informado está expirado.')
  })

  it('"accept any card" off refuses an unlisted number; listed cards keep their outcome', async () => {
    h = await createHarness()
    expect((await admin('/test-cards')).body.acceptAny).toBe(true)
    expect((await chargeWith(UNLISTED)).status).toBe(200)

    const off = await admin('/test-cards/policy', 'PUT', { acceptAny: false })
    expect(off.body.acceptAny).toBe(false)

    const refused = await chargeWith(UNLISTED)
    expect(refused.status).toBe(400)
    expect(refused.body.errors[0].code).toBe('invalid_action')
    expect((await chargeWith('4444444444444444')).status).toBe(200)

    await admin('/test-cards/policy', 'PUT', { acceptAny: true })
    expect((await chargeWith(UNLISTED)).status).toBe(200)
  })

  it('refuses a duplicate, a bad outcome and removing a built-in card', async () => {
    h = await createHarness()
    expect((await admin('/test-cards', 'POST', { number: '4444444444444444', outcome: 'DECLINE' })).body.errors[0].code).toBe('duplicated_number')
    expect((await admin('/test-cards', 'POST', { number: UNLISTED, outcome: 'MISSING_CVV' })).body.errors[0].code).toBe('invalid_outcome')
    expect((await admin('/test-cards', 'POST', { number: '123', outcome: 'DECLINE' })).body.errors[0].code).toBe('invalid_number')
    expect((await admin('/test-cards/4444444444444444', 'DELETE')).status).toBe(400)
  })

  it('the invoice page offers the added cards', async () => {
    h = await createHarness()
    await admin('/test-cards', 'POST', { number: UNLISTED, outcome: 'DECLINE', label: 'Sem limite' })
    const cus = await h.api.call('create-new-customer', { body: { name: 'Fulano', cpfCnpj: '24971563792' } })
    const p = await h.api.call('create-new-payment', {
      body: { customer: cus.body.id, billingType: 'CREDIT_CARD', value: 50, dueDate: '2026-01-20' },
    })
    const res = await h.app.app.handle(
      new Request(`http://localhost/i/${p.body.id.replace('pay_', '')}`, { headers: { host: 'localhost:45445' } }),
    )
    expect(await res.text()).toContain('Sem limite')
  })
})
