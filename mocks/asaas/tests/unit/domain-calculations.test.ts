/**
 * The financial calculations. It is where 90% of a gateway's real bugs live.
 *
 * Everything here is table-driven and counts as a GOLDEN TEST: each line is a number we
 * assert is Asaas's. When the parity suite runs against the real sandbox
 * and finds a divergence, the correction enters as a new line here.
 */
import { describe, expect, it } from 'bun:test'
import { loadConfig } from '../../src/core/config.ts'
import {
  addBusinessDays,
  addMonths,
  advanceCycle,
  daysBetween,
  isBusinessDay,
  nextBusinessDay,
} from '../../src/domain/calendar.ts'
import { calcFee, netValue } from '../../src/domain/fees.ts'
import { installmentDueDates, splitTotal } from '../../src/domain/installments.ts'
import { calcDiscount, calcFine, calcInterest, calcOverdueTotals } from '../../src/domain/interest.ts'
import { cents, percentE4 } from '../../src/domain/money.ts'
import { computeSplits, distributeTotalFixedValue } from '../../src/domain/split.ts'
import { creditDateFor, skipsConfirmed } from '../../src/domain/settlement.ts'

const fees = loadConfig().fees
const rules = { creditCardSettlementDays: 32, debitCardSettlementDays: 3 }

describe('fees', () => {
  it('bank slip: R$ 1.99 fixed, regardless of the amount', () => {
    expect(calcFee(fees, 'BOLETO', cents(10_000))).toBe(199 as never)
    expect(calcFee(fees, 'BOLETO', cents(1_000_000))).toBe(199 as never)
  })

  it('Pix: R$ 1.99 FIXED — it is not a percentage', () => {
    // It is counterintuitive and people get it wrong: Asaas's Pix does not charge %.
    expect(calcFee(fees, 'PIX', cents(10_000))).toBe(199 as never)
    expect(calcFee(fees, 'PIX', cents(1_000_000))).toBe(199 as never)
  })

  it('single-payment card: R$ 0.49 + 2.99%', () => {
    // R$ 100.00 → 49 + 299 = R$ 3.48
    expect(calcFee(fees, 'CREDIT_CARD', cents(10_000), 1)).toBe(348 as never)
  })

  it('card: the percentage bracket changes with the number of installments', () => {
    const v = cents(10_000) // R$ 100.00
    expect(calcFee(fees, 'CREDIT_CARD', v, 1)).toBe(348 as never) // 0.49 + 2.99%
    expect(calcFee(fees, 'CREDIT_CARD', v, 6)).toBe(398 as never) // 0.49 + 3.49%
    expect(calcFee(fees, 'CREDIT_CARD', v, 12)).toBe(448 as never) // 0.49 + 3.99%
    expect(calcFee(fees, 'CREDIT_CARD', v, 18)).toBe(478 as never) // 0.49 + 4.29%
  })

  it('UNDEFINED has no fee: the payment method has not been chosen yet', () => {
    expect(calcFee(fees, 'UNDEFINED', cents(10_000))).toBe(0 as never)
  })

  it('netValue = value − fee', () => {
    // Pix of R$ 100.00, fee R$ 1.99 → net R$ 98.01
    expect(netValue(cents(10_000), calcFee(fees, 'PIX', cents(10_000)))).toBe(9801 as never)
  })
})

describe('fine and interest', () => {
  const fine = { value: 2, type: 'PERCENTAGE' as const } // 2%
  const interest = { value: 1 } // 1% a month

  it('a percentage fine is applied once', () => {
    expect(calcFine(fine, cents(10_000))).toBe(200 as never) // 2% of R$100
  })

  it('a fixed fine is the amount in reais', () => {
    expect(calcFine({ value: 5, type: 'FIXED' }, cents(10_000))).toBe(500 as never)
  })

  it('the interest is pro-rata die over a 30-day commercial month', () => {
    // R$ 100.00 × 1% / 30 × 30 days = R$ 1.00
    expect(calcInterest(interest, cents(10_000), 30)).toBe(100 as never)
    // 15 days = half
    expect(calcInterest(interest, cents(10_000), 15)).toBe(50 as never)
    // 1 day = 1/30 of 1% of 100 = R$ 0.0333 → R$ 0.03
    expect(calcInterest(interest, cents(10_000), 1)).toBe(3 as never)
  })

  it('without lateness there is no interest nor fine', () => {
    expect(calcInterest(interest, cents(10_000), 0)).toBe(0 as never)
  })

  it('a charge 10 days overdue: value = original + fine + interest', () => {
    const totals = calcOverdueTotals(
      {
        originalValueCents: cents(10_000),
        dueDate: '2026-01-05',
        fine,
        interest,
      },
      '2026-01-15', // 10 days later
    )

    expect(totals.daysLate).toBe(10)
    expect(totals.fine).toBe(200 as never) // 2% applied ONCE
    expect(totals.interest).toBe(33 as never) // 100 × 1% / 30 × 10 = 0.333…
    expect(totals.interestValue).toBe(233 as never) // fine + interest
    expect(totals.value).toBe(10_233 as never) // R$ 102.33
    expect(totals.originalValue).toBe(10_000 as never)
  })

  it('the interest grows one day at a time', () => {
    const at = (on: string) =>
      calcOverdueTotals(
        { originalValueCents: cents(10_000), dueDate: '2026-01-05', fine: null, interest },
        on,
      ).value

    expect(at('2026-01-05')).toBe(10_000 as never) // on the day: no interest
    expect(at('2026-01-06')).toBe(10_003 as never)
    expect(at('2026-01-07')).toBe(10_007 as never)
    expect(at('2026-02-04')).toBe(10_100 as never) // 30 days → a full 1%
  })
})

describe('discount', () => {
  const discount = { value: 10, dueDateLimitDays: 0, type: 'PERCENTAGE' as const }

  it('holds until the due date', () => {
    expect(calcDiscount(discount, cents(10_000), '2026-01-10', '2026-01-05')).toBe(1000 as never)
    expect(calcDiscount(discount, cents(10_000), '2026-01-10', '2026-01-10')).toBe(1000 as never)
  })

  it('does not hold after the due date', () => {
    expect(calcDiscount(discount, cents(10_000), '2026-01-10', '2026-01-11')).toBe(0 as never)
  })

  it('dueDateLimitDays shortens the window', () => {
    // It only holds up to 5 days BEFORE the due date.
    const d = { value: 10, dueDateLimitDays: 5, type: 'PERCENTAGE' as const }
    expect(calcDiscount(d, cents(10_000), '2026-01-10', '2026-01-05')).toBe(1000 as never) // 5 days before: it holds
    expect(calcDiscount(d, cents(10_000), '2026-01-10', '2026-01-06')).toBe(0 as never) // 4 days before: no
  })

  it('fixed discount', () => {
    const d = { value: 7.5, dueDateLimitDays: 0, type: 'FIXED' as const }
    expect(calcDiscount(d, cents(10_000), '2026-01-10', '2026-01-05')).toBe(750 as never)
  })
})

describe('installment division — the remainder goes to the LAST one', () => {
  it('R$ 350 in 12x → 11 × R$ 29.16 + R$ 29.24  (the official Asaas example)', () => {
    const parts = splitTotal(cents(35_000), 12)

    expect(parts.length).toBe(12)
    expect(parts.slice(0, 11)).toEqual(Array(11).fill(2916))
    expect(parts[11]).toBe(2924 as never)
  })

  it('the sum of the installments is ALWAYS exactly the total', () => {
    for (const total of [35_000, 10_000, 9999, 1, 100_003, 777]) {
      for (const n of [1, 2, 3, 7, 12, 21]) {
        const parts = splitTotal(cents(total), n)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      }
    }
  })

  it('an exact division produces no remainder', () => {
    expect(splitTotal(cents(30_000), 3)).toEqual([10_000, 10_000, 10_000] as never)
  })

  it('the due dates are monthly from the first installment', () => {
    expect(installmentDueDates('2026-01-15', 3)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ])
  })

  it('the 31st does not slip through the calendar: it lands on the last day of the month', () => {
    // Without this, someone who subscribes on January 31 would see February's charge
    // land on March 3.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(installmentDueDates('2026-01-31', 3)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ])
  })
})

describe('split — it applies to the netValue, not to the gross amount', () => {
  it('30% of a R$ 100 Pix charge is R$ 29.40, not R$ 30.00', () => {
    // The fee (R$ 1.99) comes out first. The split divides what is left.
    const value = cents(10_000)
    const fee = calcFee(fees, 'PIX', value) // 199
    const net = netValue(value, fee) // 9801

    const result = computeSplits(net, [
      { walletId: 'w1', percentualValueE4: percentE4(300_000) }, // 30%
    ])

    expect(result.splits[0]!.totalValueCents).toBe(2940 as never) // 30% of 98.01
    expect(result.divergent).toBe(false)
    expect(result.remainderCents).toBe(6861 as never) // what is left for the merchant
  })

  it('fixed and percentage coexist and simply add up', () => {
    const result = computeSplits(cents(10_000), [
      { walletId: 'w1', fixedValueCents: cents(2000) },
      { walletId: 'w2', percentualValueE4: percentE4(100_000) }, // 10%
    ])
    expect(result.totalCents).toBe(3000 as never) // R$ 20 + R$ 10
  })

  it('a sum above the netValue is a DIVERGENCE (Asaas blocks it)', () => {
    const result = computeSplits(cents(10_000), [
      { walletId: 'w1', fixedValueCents: cents(6000) },
      { walletId: 'w2', fixedValueCents: cents(5000) },
    ])
    expect(result.divergent).toBe(true)
  })

  it('a percentage with 4 decimal places is preserved', () => {
    const result = computeSplits(cents(10_000), [
      { walletId: 'w1', percentualValueE4: percentE4(923_444) }, // 92.3444%
    ])
    expect(result.splits[0]!.totalValueCents).toBe(9234 as never)
  })

  it('totalFixedValue divides among the installments, with the remainder on the last one', () => {
    // R$ 100 in 3 installments → 33.33 | 33.33 | 33.34
    expect(distributeTotalFixedValue(cents(10_000), 3)).toEqual([3333, 3333, 3334] as never)
  })
})

describe('settlement — when the money becomes balance', () => {
  it('Pix skips CONFIRMED and credits right away', () => {
    expect(skipsConfirmed('PIX')).toBe(true)
    expect(creditDateFor('PIX', '2026-01-05', rules)).toBe('2026-01-05')
  })

  it('bank slip, card and debit go through CONFIRMED', () => {
    expect(skipsConfirmed('BOLETO')).toBe(false)
    expect(skipsConfirmed('CREDIT_CARD')).toBe(false)
    expect(skipsConfirmed('DEBIT_CARD')).toBe(false)
  })

  it('the bank slip credits on the next business day', () => {
    // Monday 05/01 → Tuesday 06/01
    expect(creditDateFor('BOLETO', '2026-01-05', rules)).toBe('2026-01-06')
    // Friday 09/01 → Monday 12/01 (skips the weekend)
    expect(creditDateFor('BOLETO', '2026-01-09', rules)).toBe('2026-01-12')
  })

  it('the credit card credits at D+32', () => {
    expect(creditDateFor('CREDIT_CARD', '2026-01-05', rules)).toBe('2026-02-06')
  })

  it('the debit card credits at D+3', () => {
    expect(creditDateFor('DEBIT_CARD', '2026-01-05', rules)).toBe('2026-01-08')
  })
})

describe('calendar', () => {
  it('recognizes the weekend', () => {
    expect(isBusinessDay('2026-01-10')).toBe(false) // Saturday
    expect(isBusinessDay('2026-01-11')).toBe(false) // Sunday
    expect(isBusinessDay('2026-01-12')).toBe(true) // Monday
  })

  it('recognizes fixed holidays', () => {
    expect(isBusinessDay('2026-01-01')).toBe(false) // Universal Confraternization
    expect(isBusinessDay('2026-12-25')).toBe(false) // Christmas
    expect(isBusinessDay('2026-09-07')).toBe(false) // Independence Day
  })

  it('recognizes the movable holidays (they depend on Easter)', () => {
    // Easter 2026: 05/04. Good Friday: 03/04. Carnival: 16 and 17/02.
    expect(isBusinessDay('2026-04-03')).toBe(false)
    expect(isBusinessDay('2026-02-16')).toBe(false)
    expect(isBusinessDay('2026-02-17')).toBe(false)
    expect(isBusinessDay('2026-06-04')).toBe(false) // Corpus Christi
  })

  it('nextBusinessDay returns the same date if it is already a business day', () => {
    expect(nextBusinessDay('2026-01-05')).toBe('2026-01-05')
    expect(nextBusinessDay('2026-01-10')).toBe('2026-01-12') // Saturday → Monday
  })

  it('addBusinessDays skips the weekend and the holiday', () => {
    expect(addBusinessDays('2026-01-09', 1)).toBe('2026-01-12') // Friday +1 business day = Monday
    expect(addBusinessDays('2026-12-24', 1)).toBe('2026-12-28') // skips Christmas and the weekend
  })

  it('daysBetween counts whole days', () => {
    expect(daysBetween('2026-01-15', '2026-01-05')).toBe(10)
    expect(daysBetween('2026-01-05', '2026-01-05')).toBe(0)
  })

  it('subscription cycles', () => {
    expect(advanceCycle('2026-01-15', 'WEEKLY')).toBe('2026-01-22')
    expect(advanceCycle('2026-01-15', 'BIWEEKLY')).toBe('2026-01-29')
    expect(advanceCycle('2026-01-15', 'MONTHLY')).toBe('2026-02-15')
    expect(advanceCycle('2026-01-15', 'BIMONTHLY')).toBe('2026-03-15')
    expect(advanceCycle('2026-01-15', 'QUARTERLY')).toBe('2026-04-15')
    expect(advanceCycle('2026-01-15', 'SEMIANNUALLY')).toBe('2026-07-15')
    expect(advanceCycle('2026-01-15', 'YEARLY')).toBe('2027-01-15')
  })
})
