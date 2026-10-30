/**
 * Interest, fine and discount. PURE.
 *
 * Asaas rules:
 *
 *   FINE  — applied ONCE, on the first day of lateness. FIXED or PERCENTAGE.
 *   INTEREST — pro-rata die over a 30-DAY COMMERCIAL MONTH, from the 1st day of
 *            lateness:  interest = value × (rate/100) / 30 × daysLate
 *            `interest` only has the `value` field — it is always a monthly percentage.
 *            There is NO `interest.type` (old SDKs that send it are outdated).
 *
 *   interestValue = fine + interest
 *   value (payable) = originalValue + interestValue
 *
 * NOT DOCUMENTED by Asaas: whether the interest applies to the original value or
 * to (value + fine). We chose the ORIGINAL value — we do not compound interest
 * over the fine. It is recorded in progress.md as an unconfirmed rule.
 */
import { daysBetween, type IsoDate } from './calendar.ts'
import type { DiscountConfig, FineConfig, InterestConfig } from '../db/schema/payments.ts'
import { applyBp, bp, cents, roundCents, type Cents } from './money.ts'

/** Converts a "human" percentage (2.5 = 2.5%) into basis points. */
const pctToBp = (pct: number) => bp(Math.round(pct * 100))

export function calcFine(fine: FineConfig | null | undefined, originalValue: Cents): Cents {
  if (!fine || fine.value <= 0) return cents(0)
  if (fine.type === 'FIXED') return roundCents(fine.value * 100)
  return applyBp(originalValue, pctToBp(fine.value))
}

/** Pro-rata die interest, 30-day commercial month. */
export function calcInterest(
  interest: InterestConfig | null | undefined,
  originalValue: Cents,
  daysLate: number,
): Cents {
  if (!interest || interest.value <= 0 || daysLate <= 0) return cents(0)
  return roundCents((originalValue * (interest.value / 100) * daysLate) / 30)
}

export interface OverdueTotals {
  /** Days of lateness. 0 = not late. */
  daysLate: number
  /** The value before the lateness. */
  originalValue: Cents
  /** fine + interest. */
  interestValue: Cents
  /** The value payable today: originalValue + interestValue. */
  value: Cents
  fine: Cents
  interest: Cents
}

/**
 * How much is paid for an overdue charge, on the date `on`.
 *
 * `on` is the date the payment is being made — not "today". It is what allows
 * simulating a retroactive payment and checking the calculation.
 */
export function calcOverdueTotals(
  payment: {
    originalValueCents: Cents
    dueDate: IsoDate
    fine: FineConfig | null
    interest: InterestConfig | null
  },
  on: IsoDate,
): OverdueTotals {
  const daysLate = Math.max(0, daysBetween(on, payment.dueDate))
  const original = payment.originalValueCents

  if (daysLate === 0) {
    return {
      daysLate: 0,
      originalValue: original,
      interestValue: cents(0),
      value: original,
      fine: cents(0),
      interest: cents(0),
    }
  }

  const fine = calcFine(payment.fine, original)
  const interest = calcInterest(payment.interest, original, daysLate)
  const interestValue = cents(fine + interest)

  return {
    daysLate,
    originalValue: original,
    interestValue,
    value: cents(original + interestValue),
    fine,
    interest,
  }
}

/**
 * Discount for early payment.
 *
 * It holds until `dueDateLimitDays` BEFORE the due date. With
 * `dueDateLimitDays = 0` (the default), it holds until the due date itself.
 */
export function calcDiscount(
  discount: DiscountConfig | null | undefined,
  value: Cents,
  dueDate: IsoDate,
  on: IsoDate,
): Cents {
  if (!discount || discount.value <= 0) return cents(0)

  const daysBeforeDue = daysBetween(dueDate, on)
  const limit = discount.dueDateLimitDays ?? 0

  // Paid after the due date, or after the discount window.
  if (daysBeforeDue < limit) return cents(0)

  if (discount.type === 'FIXED') return roundCents(discount.value * 100)
  return applyBp(value, pctToBp(discount.value))
}
