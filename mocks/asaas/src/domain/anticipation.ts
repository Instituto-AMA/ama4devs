/**
 * Anticipation of receivables. PURE.
 *
 * TODO(rule): **THE FEE FORMULA IS NOT DOCUMENTED BY ASAAS.** The docs publish the
 * commercial rates ("from 1.99% a.m.") but do not say how the fee amount is derived
 * from them. We chose the formula below — the same one Asaas uses for late
 * interest, and the only defensible one without access to the real engine:
 *
 *     fee = value × (monthlyRateBp / 10000) / 30 × daysAnticipated
 *
 * That is: pro-rata die over the MONTHLY rate, with a 30-day commercial month.
 * Without capitalization (simple interest) and without a minimum fee.
 *
 * The consequence an integrator needs to know: anticipating a 32-day card
 * receivable costs ≈ the full monthly rate; anticipating 5 days costs 1/6 of it.
 *
 * It is recorded in progress.md, in the table "Rules the documentation does not
 * define", and the numbers live in `config.fees.anticipation` (environment
 * variables `FEE_ANTICIPATION_*`) precisely so that the correction, when we
 * discover the real formula, is a configuration change — not a code change.
 */
import type { FeeTable } from '../core/config.ts'
import { daysBetween, type IsoDate } from './calendar.ts'
import type { BillingType } from './fees.ts'
import { cents, roundCents, type BasisPoints, type Cents } from './money.ts'

/** Days in the "commercial month" used in the pro-rata. */
export const COMMERCIAL_MONTH_DAYS = 30

/** Only credit card and bank slip have a receivable to anticipate. */
export function isAnticipableBillingType(billingType: BillingType): boolean {
  return billingType === 'CREDIT_CARD' || billingType === 'BOLETO'
}

/**
 * The applicable MONTHLY rate. An installment card has a lower rate than a
 * single-payment card (the risk is diluted over time) — that is what Asaas's
 * public table shows.
 */
export function anticipationRateBp(
  fees: FeeTable,
  billingType: BillingType,
  installmentCount: number,
): BasisPoints {
  if (billingType === 'CREDIT_CARD') {
    return installmentCount > 1
      ? fees.anticipation.creditCardInstallment
      : fees.anticipation.creditCardDetached
  }
  return fees.anticipation.bankSlip
}

export interface AnticipationQuoteInput {
  fees: FeeTable
  billingType: BillingType
  installmentCount: number
  /** The GROSS value of the charge. */
  totalValueCents: Cents
  /** The fee Asaas already charges for the charge itself (the bank slip's R$ 1.99, etc.). */
  paymentFeeCents: Cents
  /** When the receivable would land without the anticipation. */
  expectedCreditDate: IsoDate
  today: IsoDate
}

export interface AnticipationQuote {
  /** The days being anticipated. Never negative. */
  anticipationDays: number
  /** The gross value of the charge. */
  totalValueCents: Cents
  /** The anticipation base: the net of the charge (gross − the charge's fee). */
  valueCents: Cents
  /** The anticipation fee. */
  feeCents: Cents
  /** What actually lands in the account today. */
  netValueCents: Cents
  monthlyRateBp: BasisPoints
}

/**
 * The whole calculation, in one place.
 *
 * Note that the base is NOT the gross amount: it is the net of the charge.
 * Anticipating does not give back the charge's fee — it keeps being charged when
 * the receivable settles. That is what the spec's own examples show
 * (totalValue 80 → value 76.01 → fee 2.33 → netValue 73.68).
 */
export function quoteAnticipation(input: AnticipationQuoteInput): AnticipationQuote {
  const days = Math.max(0, daysBetween(input.expectedCreditDate, input.today))
  const monthlyRateBp = anticipationRateBp(
    input.fees,
    input.billingType,
    input.installmentCount,
  )

  const valueCents = cents(input.totalValueCents - input.paymentFeeCents)

  const feeCents = roundCents(
    (valueCents * monthlyRateBp) / 10_000 / COMMERCIAL_MONTH_DAYS * days,
  )

  return {
    anticipationDays: days,
    totalValueCents: input.totalValueCents,
    valueCents,
    feeCents,
    netValueCents: cents(valueCents - feeCents),
    monthlyRateBp,
  }
}
