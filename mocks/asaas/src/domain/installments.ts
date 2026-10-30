/**
 * Installment division. PURE.
 *
 * THE RULE: the rounding remainder goes to the LAST installment.
 *
 *   R$ 350.00 in 12x → 11 × R$ 29.16 + 1 × R$ 29.24
 *
 * (350/12 = 29.1666… → 29.16 per installment; 11 × 29.16 = 320.76; 350 − 320.76 =
 * 29.24 on the last one.) It is why money is integer cents here: this is an exact
 * remainder rule and it does not survive a floating point.
 *
 * This is line 1 of the golden test — if one day it diverges from the real Asaas,
 * it is discovered here.
 */
import { addMonths, type IsoDate } from './calendar.ts'
import { cents, type Cents } from './money.ts'

/**
 * Divides `total` into `count` installments. The remainder goes to the last one.
 * The sum of the result is ALWAYS exactly `total`.
 */
export function splitTotal(total: Cents, count: number): Cents[] {
  if (count < 1) throw new Error('installmentCount must be >= 1')
  if (count === 1) return [total]

  const base = Math.floor(total / count)
  const parts: Cents[] = Array.from({ length: count - 1 }, () => cents(base))
  const last = cents(total - base * (count - 1))
  parts.push(last)
  return parts
}

/**
 * The reverse path: the client gives the value OF THE INSTALLMENT and the count.
 * There is no remainder here — the total is simply value × count.
 */
export function totalFromInstallmentValue(installmentValue: Cents, count: number): Cents {
  return cents(installmentValue * count)
}

/** The due dates: monthly, from the due date of the 1st installment. */
export function installmentDueDates(firstDueDate: IsoDate, count: number): IsoDate[] {
  return Array.from({ length: count }, (_, i) => addMonths(firstDueDate, i))
}

/**
 * Credit card: Visa/Mastercard accept up to 21x; the other brands, 12x.
 * (Asaas's rule, not the acquirer's.)
 */
export function maxInstallmentsForBrand(brand: string): number {
  return brand === 'VISA' || brand === 'MASTERCARD' ? 21 : 12
}
