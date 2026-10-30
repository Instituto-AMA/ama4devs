/**
 * Luhn, brand and test cards — pure, table-driven, without booting anything.
 */
import { describe, expect, it } from 'bun:test'
import {
  BRAND_RULES,
  CARD_ERRORS,
  CreditCardError,
  declinesOnCharge,
  declinesOnTokenize,
  detectBrand,
  GENERATED_BRANDS,
  generateCardNumber,
  inspectCard,
  isExpired,
  luhn,
  normalizeCardNumber,
  outcomeFor,
  TEST_CARDS,
  type AuthorizationOutcome,
  type CardBrand,
} from '../../src/domain/credit-card.ts'
import { maxInstallmentsForBrand } from '../../src/domain/installments.ts'

describe('Luhn', () => {
  const cases: [string, boolean][] = [
    ['4111111111111111', true], // the classic Visa
    ['5555555555554444', true], // Mastercard
    ['378282246310005', true], // Amex (15 digits)
    ['30569309025904', true], // Diners (14 digits)
    ['6011111111111117', true], // Discover
    ['5184019740373151', true], // the sandbox's declining card IS valid
    ['4916561358240741', true],
    ['5184019740373152', false], // one digit swapped
    ['1234567890123456', false],
    ['4444444444444444', false], // ← the card that APPROVES in the sandbox fails Luhn
    ['', false],
    ['4111-1111-1111-111a', false],
  ]

  for (const [number, expected] of cases) {
    it(`${number || '(empty)'} → ${expected}`, () => {
      expect(luhn(number)).toBe(expected)
    })
  }
})

describe('brand by the prefix', () => {
  const cases: [string, CardBrand][] = [
    ['4111111111111111', 'VISA'],
    ['4444444444444444', 'VISA'],
    ['5184019740373151', 'MASTERCARD'],
    ['5555555555554444', 'MASTERCARD'],
    ['378282246310005', 'AMEX'],
    ['341111111111111', 'AMEX'],
    ['30569309025904', 'DINERS'],
    ['36700102000000', 'DINERS'],
    ['38520000023237', 'DINERS'],
    ['6011111111111117', 'DISCOVER'],
    ['6362970000457013', 'ELO'],
    ['3530111333300000', 'JCB'],
    ['9999999999999999', 'UNKNOWN'],
  ]

  for (const [number, brand] of cases) {
    it(`${number} → ${brand}`, () => {
      expect(detectBrand(number)).toBe(brand)
    })
  }

  it('the longest prefix wins: 6011 is DISCOVER, not ELO', () => {
    expect(detectBrand('6011111111111117')).toBe('DISCOVER')
    expect(detectBrand('6362970000457013')).toBe('ELO')
  })

  it('the prefix table is data — you can inject another one', () => {
    const rules = [...BRAND_RULES, { brand: 'CABAL', prefixes: ['9'] } as const]
    expect(detectBrand('9999999999999999', rules)).toBe('CABAL')
  })
})

describe("the sandbox's test cards", () => {
  it('4444444444444444 approves', () => {
    expect(outcomeFor('4444444444444444')).toBe('APPROVE')
  })

  it('5184019740373151 and 4916561358240741 decline', () => {
    expect(outcomeFor('5184019740373151')).toBe('DECLINE')
    expect(outcomeFor('4916561358240741')).toBe('DECLINE')
  })

  it('any other number is not in the table', () => {
    expect(outcomeFor('4111111111111111')).toBeNull()
  })

  it('spaces and dashes change nothing', () => {
    expect(normalizeCardNumber('4444 4444-4444 4444')).toBe('4444444444444444')
    expect(outcomeFor('4444 4444 4444 4444')).toBe('APPROVE')
  })

  it('the table is injectable', () => {
    const custom = [
      ...TEST_CARDS,
      { number: '4111111111111111', outcome: 'DECLINE' as const, label: 'x', real: false },
    ]
    expect(outcomeFor('4111111111111111', custom)).toBe('DECLINE')
  })
})

/**
 * NOW is fixed: "expired" is the only rule of this file that depends on time, and a
 * test that used the machine's clock would pass today and break in 2031.
 */
const NOW = new Date('2026-07-14T12:00:00Z')

describe('inspectCard', () => {
  it('returns only the last 4 digits — never the number', () => {
    const info = inspectCard(
      {
        number: '4444444444444444',
        holderName: 'John Doe',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
      },
      NOW,
    )

    expect(info).toEqual({ last4: '4444', brand: 'VISA', outcome: 'APPROVE' })
    // The PAN does not survive: there is no field with 16 digits in the result.
    expect(JSON.stringify(info)).not.toContain('4444444444444444')
  })

  it('any valid card approves', () => {
    expect(inspectCard({ number: '4111111111111111' }, NOW).outcome).toBe('APPROVE')
  })

  it('the declining card returns DECLINE (but it is a well-formed card)', () => {
    const info = inspectCard({ number: '5184019740373151' }, NOW)
    expect(info).toEqual({ last4: '3151', brand: 'MASTERCARD', outcome: 'DECLINE' })
  })

  /**
   * Asaas does NOT validate Luhn — captured from the sandbox. This test is what prevents
   * someone from "fixing" that back: refusing here a number that Asaas
   * approves makes a good card break in the local test and pass in production.
   */
  it('does NOT validate Luhn — Asaas approves a wrong check digit', () => {
    expect(luhn('4111111111111112')).toBe(false)
    expect(inspectCard({ number: '4111111111111112' }, NOW).outcome).toBe('APPROVE')

    expect(luhn('4444444444444444')).toBe(false)
    expect(inspectCard({ number: '4444444444444444' }, NOW).outcome).toBe('APPROVE')
  })

  it('a 1-digit CVV is ACCEPTED — only the empty one is refused', () => {
    expect(inspectCard({ number: '4111111111111111', ccv: '1' }, NOW).outcome).toBe('APPROVE')
  })

  /** Each case: the EXACT (code, description) that the sandbox returned. */
  const rejects = (
    card: Parameters<typeof inspectCard>[0],
    expected: { code: string; description: string },
    why: string,
  ) => {
    it(why, () => {
      expect(() => inspectCard(card, NOW)).toThrow(CreditCardError)
      try {
        inspectCard(card, NOW)
      } catch (err) {
        expect((err as CreditCardError).code).toBe(expected.code)
        expect((err as CreditCardError).description).toBe(expected.description)
      }
    })
  }

  rejects({ number: '411111111111' }, CARD_ERRORS.INVALID_NUMBER, 'number too short')
  rejects({ number: '4111a111111111111' }, CARD_ERRORS.INVALID_NUMBER, 'number with a letter')
  rejects(
    { number: '4111111111111111', expiryMonth: '13' },
    CARD_ERRORS.INVALID_MONTH,
    'month outside 1–12',
  )
  rejects(
    { number: '4111111111111111', expiryMonth: '05', expiryYear: '2020' },
    CARD_ERRORS.EXPIRED,
    'expired card',
  )
  rejects({ number: '4111111111111111', ccv: '' }, CARD_ERRORS.MISSING_CVV, 'empty CVV')
  rejects(
    { number: '4111111111111111', holderName: '' },
    CARD_ERRORS.MISSING_HOLDER,
    'empty holder',
  )

  it('the expiry month is INCLUSIVE — a 07/2026 card is valid on 14/07/2026', () => {
    expect(isExpired(7, 2026, NOW)).toBe(false)
    expect(isExpired(6, 2026, NOW)).toBe(true)
  })
})

describe('simulation cards (our extension, they do not exist in Asaas)', () => {
  it("each simulation card forces ITS error, with Asaas's real message", () => {
    const cases: Array<[string, keyof typeof CARD_ERRORS]> = [
      ['4000000000000069', 'EXPIRED'],
      ['4000000000000101', 'INVALID_NUMBER'],
    ]

    for (const [number, outcome] of cases) {
      try {
        inspectCard({ number, expiryMonth: '12', expiryYear: '2035', ccv: '123' }, NOW)
        throw new Error(`${number} should have been refused`)
      } catch (err) {
        expect(err).toBeInstanceOf(CreditCardError)
        expect((err as CreditCardError).code).toBe(CARD_ERRORS[outcome].code)
        expect((err as CreditCardError).description).toBe(CARD_ERRORS[outcome].description)
      }
    }
  })

  it('4000000000000002 declines at the AUTHORIZATION (it becomes a token, and the token declines)', () => {
    expect(inspectCard({ number: '4000000000000002' }, NOW).outcome).toBe('DECLINE')
  })

  /**
   * The panel's table IS the engine's table. Without this, the screen could announce a
   * card the server does not honour — and the lie looks nice, with a copy button.
   */
  it('every card in the table does what the table promises', () => {
    for (const c of TEST_CARDS) {
      const isAuthOutcome =
        c.outcome === 'APPROVE' || c.outcome === 'DECLINE' || c.outcome === 'DECLINE_ON_CHARGE'

      if (isAuthOutcome) {
        // It survives the validation and decides at charging time. The `isAuthOutcome` already
        // narrowed the value; TS does not follow it through the variable.
        expect(inspectCard({ number: c.number }, NOW).outcome).toBe(
          c.outcome as AuthorizationOutcome,
        )
      } else {
        // It refuses the request at the door.
        expect(() => inspectCard({ number: c.number }, NOW)).toThrow(CreditCardError)
      }
    }
  })

  /**
   * The whole difference between the two DECLINEs: one never becomes a token (it is Asaas's
   * real one), the other becomes one and declines later (it is ours, for the scenario the sandbox
   * cannot produce). The error delivered to the client is the same in both.
   */
  it('DECLINE refuses on save; DECLINE_ON_CHARGE only on charge', () => {
    expect(declinesOnTokenize('DECLINE')).toBe(true)
    expect(declinesOnTokenize('DECLINE_ON_CHARGE')).toBe(false)

    expect(declinesOnCharge('DECLINE')).toBe(true)
    expect(declinesOnCharge('DECLINE_ON_CHARGE')).toBe(true)
    expect(declinesOnCharge('APPROVE')).toBe(false)

    expect(CARD_ERRORS.DECLINE_ON_CHARGE).toEqual(CARD_ERRORS.DECLINE)
  })
})

describe('installments by brand', () => {
  it('Visa and Mastercard accept 21x; the others, 12x', () => {
    expect(maxInstallmentsForBrand('VISA')).toBe(21)
    expect(maxInstallmentsForBrand('MASTERCARD')).toBe(21)
    expect(maxInstallmentsForBrand('DINERS')).toBe(12)
    expect(maxInstallmentsForBrand('ELO')).toBe(12)
    expect(maxInstallmentsForBrand('AMEX')).toBe(12)
  })
})

describe('card policy and panel cards', () => {
  const NOW = new Date('2026-01-05T12:00:00-03:00')
  const card = (number: string) => ({ number, holderName: 'X', expiryMonth: '12', expiryYear: '2030', ccv: '123' })
  const UNLISTED = '4111111111111111'

  it('an unlisted well-formed card approves by default and is refused when only listed cards pass', () => {
    expect(inspectCard(card(UNLISTED), NOW).outcome).toBe('APPROVE')
    expect(inspectCard(card(UNLISTED), NOW, TEST_CARDS, { acceptAny: false }).outcome).toBe('DECLINE')
  })

  it('a listed card keeps its outcome whatever the policy', () => {
    const strict = { acceptAny: false }
    expect(inspectCard(card('4444444444444444'), NOW, TEST_CARDS, strict).outcome).toBe('APPROVE')
    expect(inspectCard(card('5184019740373151'), NOW, TEST_CARDS, strict).outcome).toBe('DECLINE')
  })

  it('a card added to the table forces its outcome', () => {
    const table = [...TEST_CARDS, { number: UNLISTED, outcome: 'EXPIRED' as const, label: 'x', real: false }]
    expect(() => inspectCard(card(UNLISTED), NOW, table)).toThrow(CardErrorMatcher('EXPIRED'))
  })

  it('a generated number has the brand, the length and a valid Luhn digit', () => {
    for (const brand of Object.keys(GENERATED_BRANDS)) {
      const n = generateCardNumber(brand, (len) => '7'.repeat(len))
      expect(n).toHaveLength(GENERATED_BRANDS[brand]!.length)
      expect(luhn(n)).toBe(true)
      expect(detectBrand(n)).toBe(brand as CardBrand)
    }
  })
})

/** The error a CreditCardError carries for an outcome. */
function CardErrorMatcher(outcome: keyof typeof CARD_ERRORS): string {
  return CARD_ERRORS[outcome].description
}
