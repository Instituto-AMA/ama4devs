import { describe, expect, it } from 'bun:test'
import { invalidTaxField, retainedTaxesCents, subscriptionInvoiceDate } from '../../src/domain/invoice.ts'
import { cents } from '../../src/domain/money.ts'

const TAXES = { retainIss: false, iss: 2, pis: 0.65, cofins: 3, csll: 1, inss: 0, ir: 1.5 }

describe('retainedTaxesCents', () => {
  it.each([
    ['without ISS', TAXES, 30_000, 1_845],
    ['with ISS retained', { ...TAXES, retainIss: true }, 30_000, 2_445],
    ['nothing retained', { retainIss: false, iss: 5, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 }, 30_000, 0],
    ['rounds half up', { ...TAXES, pis: 0, cofins: 0, csll: 0, ir: 0, inss: 1.5 }, 333, 5],
  ])('%s', (_, taxes, value, expected) => {
    expect(retainedTaxesCents(cents(value), taxes)).toBe(expected as never)
  })
})

describe('invalidTaxField', () => {
  it('names the first percentage out of 0–100', () => {
    expect(invalidTaxField(TAXES)).toBeNull()
    expect(invalidTaxField({ ...TAXES, cofins: -1 })).toBe('cofins')
    expect(invalidTaxField({ ...TAXES, ir: 101 })).toBe('ir')
    expect(invalidTaxField({ ...TAXES, iss: Number.NaN })).toBe('iss')
  })
})

describe('subscriptionInvoiceDate', () => {
  const today = '2026-01-05'
  it.each([
    ['ON_PAYMENT_DUE_DATE', '2026-03-10', null, null, '2026-03-10'],
    ['BEFORE_PAYMENT_DUE_DATE', '2026-03-10', 5, null, '2026-03-05'],
    ['ON_DUE_DATE_MONTH', '2026-03-10', null, null, '2026-03-01'],
    ['ON_NEXT_MONTH', '2026-03-10', null, null, '2026-04-01'],
    ['ON_NEXT_MONTH', '2026-12-10', null, null, '2027-01-01'],
    ['ON_PAYMENT_CONFIRMATION', '2026-03-10', null, null, null],
    ['ON_PAYMENT_CONFIRMATION', '2026-03-10', null, '2026-02-01', '2026-02-01'],
    // A date already past becomes today: never issued in the past.
    ['ON_DUE_DATE_MONTH', '2026-01-20', null, null, today],
    ['BEFORE_PAYMENT_DUE_DATE', '2026-01-07', 10, null, today],
    [null, '2026-03-10', null, null, '2026-03-10'],
  ])('%s due %s (%p days, paid %p) → %p', (period, due, days, paid, expected) => {
    expect(subscriptionInvoiceDate(period, due, days, paid, today)).toBe(expected)
  })
})
