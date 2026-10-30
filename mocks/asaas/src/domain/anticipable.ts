/**
 * `payment.anticipable` — can the charge be anticipated? PURE.
 *
 * The rule was DEDUCED from 11 data points captured from the real sandbox, and it
 * is subtler than it looks:
 *
 *   anticipable = the payment method is anticipatable
 *              AND the value fits the account's AVAILABLE ANTICIPATION LIMIT
 *              AND the due date is within 90 days
 *
 * What misled us on the way: a SINGLE bank slip of R$ 350 due in 10 days came
 * `false`, while the R$ 29.16 installment of a plan due in the same window came
 * `true`. It looked like only installment plans were anticipatable. They are not —
 * the test account had a bank slip anticipation limit of **R$ 66.66**, and the
 * R$ 350 bank slip simply did not fit. The R$ 29.16 did.
 *
 * The 11 cases, all reproduced by this function:
 *
 *   R$  29.16  D+10   → true      R$ 100.00  D+80   → false  (value > limit)
 *   R$  29.16  D+41   → true      R$  50.00  D+73   → true
 *   R$  29.16  D+72   → true      R$  50.00  D+85   → true
 *   R$  29.16  D+102  → false     R$ 350.00  D+10   → false  (value > limit)
 *   R$  29.24  D+345  → false     R$ 500.00  D+60   → false  (value > limit)
 *
 * ⚠️  THE LIMIT IS NOT REPRODUCIBLE. It comes from Asaas's credit analysis and is
 * account-specific (`GET /v3/anticipations/limits`). No simulator can guess it.
 * That is why it is CONFIGURABLE here, and why `anticipable` is left out of the
 * parity comparison — comparing a number that depends on the customer's credit
 * risk would be comparing noise.
 */
import { addDays, type IsoDate } from './calendar.ts'
import type { BillingType } from './fees.ts'
import type { Cents } from './money.ts'

/** Only bank slip and card are anticipatable. Pix is not — there is no future receivable. */
export function isAnticipatableBillingType(billingType: BillingType): boolean {
  return billingType === 'BOLETO' || billingType === 'CREDIT_CARD'
}

export interface AnticipableInput {
  billingType: BillingType
  status: string
  valueCents: Cents
  dueDate: IsoDate
  today: IsoDate
  /** `GET /v3/anticipations/limits` → `available` of the matching method. */
  availableLimitCents: Cents
  /** 90 in the real Asaas. Configurable because it is their number, not ours. */
  horizonDays: number
}

export function isAnticipable(i: AnticipableInput): boolean {
  if (!isAnticipatableBillingType(i.billingType)) return false

  // A charge already paid, reversed or removed has no receivable to anticipate.
  if (i.status !== 'PENDING' && i.status !== 'OVERDUE' && i.status !== 'CONFIRMED') return false

  if (i.valueCents > i.availableLimitCents) return false

  return i.dueDate <= addDays(i.today, i.horizonDays)
}
