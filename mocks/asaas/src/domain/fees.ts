/**
 * Asaas fees. PURE.
 *
 * The fee is only charged when the charge is PAID — issuing a bank slip/Pix/charge
 * costs nothing. That is why `feeCents` is computed at creation (so the
 * `netValue` can be reported) but is only debited from the balance on settlement.
 *
 * The amounts come from the public price list and are CONFIGURABLE
 * (src/core/config). They were researched in the documentation, not proven against
 * the real API — when we find a divergence, the correction is to change the
 * config, not this code.
 */
import type { FeeTable } from '../core/config.ts'
import { applyBp, cents, type Cents } from './money.ts'

export type BillingType =
  | 'BOLETO'
  | 'PIX'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'UNDEFINED'
  | 'TRANSFER'
  | 'DEPOSIT'

/** The credit card percentage bracket depends on the number of installments. */
function creditCardRate(fees: FeeTable, installments: number) {
  if (installments <= 1) return fees.creditCard.oneInstallment
  if (installments <= 6) return fees.creditCard.upToSix
  if (installments <= 12) return fees.creditCard.upToTwelve
  return fees.creditCard.upToTwentyOne
}

/**
 * The fee charged for ONE charge.
 *
 * `installments` is the total number of installments of the plan (1 = single
 * payment) — it is used only to choose the card's percentage bracket. The fee
 * applies to the value of THIS charge (the installment), not to the total of the
 * plan.
 *
 * For an INSTALMENT PLAN this is NOT the right function — use
 * `calcInstallmentFee`. PROVEN against the real sandbox: Asaas charges the card
 * fee ONCE over the TOTAL and divides it among the installments. Charging
 * `fixed + pct` per installment (what this function would do) gives a larger and
 * wrong number.
 */
export function calcFee(
  fees: FeeTable,
  billingType: BillingType,
  value: Cents,
  installments = 1,
): Cents {
  switch (billingType) {
    case 'BOLETO':
      return fees.boleto

    case 'PIX':
      // A FIXED amount, not a percentage. It is counterintuitive and people get it wrong.
      return fees.pix

    case 'CREDIT_CARD':
      return cents(fees.creditCard.fixed + applyBp(value, creditCardRate(fees, installments)))

    case 'DEBIT_CARD':
      return cents(fees.debitCard.fixed + applyBp(value, fees.debitCard.pct))

    // The charge does not know yet how it will be paid: no fee until the
    // settlement defines the actual payment method.
    case 'UNDEFINED':
    case 'TRANSFER':
    case 'DEPOSIT':
      return cents(0)
  }
}

/**
 * The fee of EACH installment of a plan. PROVEN against the real sandbox.
 *
 * The two payment methods behave in opposite ways, and it is easy to get wrong:
 *
 *   BOLETO — the fee is PER BANK SLIP ISSUED. R$ 350 in 12x → 12 × R$ 1.99 = R$ 23.88.
 *            (plan netValue: 350 − 23.88 = 326.12 ✓ sandbox)
 *
 *   CARD — the fee is computed ONCE over the TOTAL and then DIVIDED among the
 *            installments. R$ 600 in 6x → (0.49 + 3.49% × 600) = 21.43; 21.43/6 =
 *            3.5716 → R$ 3.57 per installment. (netValue: 6 × 96.43 = 578.58 ✓ sandbox)
 *
 *            Note that 6 × 3.57 = 21.42, one cent LESS than the 21.43 computed.
 *            Asaas does NOT redistribute that leftover — it simply stays with the
 *            merchant. We reproduce that: rounding up or throwing the remainder
 *            into the last installment would give a netValue different from the real one.
 *
 * The division TRUNCATES, it does not round — and the difference is observable:
 *
 *   R$ 350 in 12x → total fee = 0.49 + 3.99% × 350 = R$ 14.455 → 1446 cents.
 *   1446/12 = 120.5. Rounding gives 121; truncating gives 120.
 *   The real sandbox returns netValue 27.96 over an installment of 29.16 → a fee
 *   of R$ 1.20. It is TRUNCATION. With Math.round we were off by a cent per installment.
 *
 * The card's percentage bracket is chosen by the NUMBER OF INSTALLMENTS (2-6 → 3.49%),
 * and it applies to the total — not to the installment value.
 */
export function calcInstallmentFee(
  fees: FeeTable,
  billingType: BillingType,
  totalValue: Cents,
  installmentCount: number,
): Cents {
  if (billingType !== 'CREDIT_CARD') {
    // Bank slip, Pix and debit: the fee is per charge, and each installment is a charge.
    return calcFee(fees, billingType, totalValue, installmentCount)
  }

  const total = fees.creditCard.fixed + applyBp(totalValue, creditCardRate(fees, installmentCount))
  return cents(Math.floor(total / installmentCount))
}

/** netValue = value − the Asaas fee. It is the base the split applies to. */
export function netValue(value: Cents, fee: Cents): Cents {
  return cents(value - fee)
}
