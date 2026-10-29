import { describe, expect, test } from 'bun:test'
import { createRng } from '../src/core/rng.js'
import { creditCard, bankAccount, pixKey, charge, isLuhnValid } from '../src/core/finance.js'

const NOW = new Date('2026-10-29T12:00:00Z')
const SEED = 'fin'

describe('creditCard', () => {
  test('the two sandbox numbers are exact', () => {
    const rng = createRng(SEED)

    const approve = creditCard(rng, { outcome: 'APPROVE', now: NOW })
    expect(approve.number).toBe('4444444444444444')
    expect(approve.brand).toBe('VISA')
    expect(approve.outcome).toBe('APPROVE')

    const decline = creditCard(rng, { outcome: 'DECLINE', now: NOW })
    expect(decline.number).toBe('5184019740373151')
    expect(decline.brand).toBe('MASTERCARD')
    expect(decline.outcome).toBe('DECLINE')
  })

  test('a random card passes the Luhn check', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 500; i++) {
      const card = creditCard(rng, { outcome: 'RANDOM', now: NOW })
      expect(isLuhnValid(card.number)).toBe(true)
      expect(card.outcome).toBe('UNKNOWN')
      if (card.brand === 'AMEX') {
        expect(card.number).toMatch(/^\d{15}$/)
        expect(card.ccv).toMatch(/^\d{4}$/)
      } else {
        expect(card.number).toMatch(/^\d{16}$/)
        expect(card.ccv).toMatch(/^\d{3}$/)
      }
    }
  })

  test('the card expires between one and six years from now', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 200; i++) {
      const card = creditCard(rng, { outcome: 'RANDOM', now: NOW })
      expect(card.expiryMonth).toMatch(/^(0[1-9]|1[0-2])$/)
      const year = Number(card.expiryYear)
      expect(year).toBeGreaterThanOrEqual(2027)
      expect(year).toBeLessThanOrEqual(2032)
    }
  })

  test('the holder name is upper case and without accents', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 50; i++) {
      const card = creditCard(rng, { now: NOW })
      expect(card.holderName).toMatch(/^[A-Z ]+$/)
    }
  })
})

describe('bankAccount', () => {
  test('the bank, the agency and the account carry the right digits', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 50; i++) {
      const account = bankAccount(rng)
      expect(account.bank.code).toMatch(/^\d{3}$/)
      expect(account.bank.name.length).toBeGreaterThan(0)
      expect(account.agency).toMatch(/^\d{4}$/)
      expect(account.agencyDigit).toMatch(/^\d$/)
      expect(account.account).toMatch(/^\d{5,8}$/)
      expect(account.accountDigit).toMatch(/^\d$/)
      expect(['CONTA_CORRENTE', 'CONTA_POUPANCA']).toContain(account.type)
    }
  })

  test('the checking account is the common one', () => {
    const rng = createRng(SEED)
    let corrente = 0
    for (let i = 0; i < 500; i++) if (bankAccount(rng).type === 'CONTA_CORRENTE') corrente++
    expect(corrente).toBeGreaterThan(300)
    expect(corrente).toBeLessThan(500)
  })
})

describe('pixKey', () => {
  test('the EVP key is a uuid version 4', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 20; i++) {
      const key = pixKey(rng, { type: 'EVP' })
      expect(key.type).toBe('EVP')
      expect(key.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  test('the phone key carries the country code, the DDD and the nine', () => {
    const rng = createRng(SEED)
    const key = pixKey(rng, { type: 'PHONE' })
    expect(key.type).toBe('PHONE')
    expect(key.key).toMatch(/^\+55(11|21|31|41|51|61|71|81|85|91)9\d{8}$/)
  })

  test('the email key stays on an example domain', () => {
    const rng = createRng(SEED)
    const key = pixKey(rng, { type: 'EMAIL' })
    expect(key.key).toMatch(/^pix\.\d{6}@(example\.com|example\.org|example\.net)$/)
  })

  test('the cpf key is a bare cpf', () => {
    const rng = createRng(SEED)
    const key = pixKey(rng, { type: 'CPF' })
    expect(key.type).toBe('CPF')
    expect(key.key).toMatch(/^\d{11}$/)
  })
})

describe('charge', () => {
  test('the value is the amount in cents', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 100; i++) {
      const bill = charge(rng, { now: NOW })
      expect(bill.value).toBe(bill.valueCents / 100)
      expect(bill.valueCents).toBeGreaterThanOrEqual(1000)
      expect(bill.valueCents).toBeLessThanOrEqual(500000)
      expect(['PIX', 'BOLETO', 'CREDIT_CARD']).toContain(bill.billingType)
      expect(bill.externalReference).toMatch(/^GEN-[0-9A-Z]{8}$/)
      expect(bill.description.length).toBeGreaterThan(0)
    }
  })

  test('the due date falls inside the next thirty days', () => {
    const rng = createRng(SEED)
    for (let i = 0; i < 100; i++) {
      const bill = charge(rng, { now: NOW })
      expect(bill.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const due = new Date(`${bill.dueDate}T12:00:00Z`).getTime()
      const days = (due - NOW.getTime()) / 86400000
      expect(days).toBeGreaterThanOrEqual(0)
      expect(days).toBeLessThanOrEqual(30)
    }
  })

  test('the billing type asked for is the one answered', () => {
    const rng = createRng(SEED)
    expect(charge(rng, { billingType: 'BOLETO', now: NOW }).billingType).toBe('BOLETO')
  })
})
