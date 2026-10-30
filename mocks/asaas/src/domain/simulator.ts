/**
 * Sales simulator — `POST /v3/payments/simulate`. PURE.
 *
 * It answers "if I charge R$ X through this method, how much is left for me?"
 * without creating anything.
 *
 * The three keys (`creditCard`, `bankSlip`, `pix`) ALWAYS come out; the ones that
 * were not asked for in `billingTypes` come out `null`. Proven against the real
 * sandbox — omitting the keys would break a client that does `res.pix.netValue`
 * without checking.
 *
 * The installment arithmetic, captured from the sandbox (100 in 3x, 100 in 1x, 350 in 12x):
 *
 *   paymentValue     = TRUNC(value / N)          → 350/12 = 29.16 (not 29.17)
 *   fee per installment = see below, and it TRUNCATES
 *   paymentNetValue  = paymentValue − feePerInstallment
 *   netValue         = value − N × feePerInstallment
 *
 * And the two methods behave in OPPOSITE ways on the fee, which is the trap:
 *
 *   CARD — fee computed ONCE over the total (0.49 + pct% × value) and DIVIDED
 *          among the installments.  100 in 3x → 3.98/3 = 1.32 per installment.
 *   BANK SLIP/PIX — fixed fee PER INSTALLMENT, not divided. Each installment is an
 *          issued bank slip, and each bank slip costs R$ 1.99.  100 in 3x → 1.99 per installment.
 *
 * `netValue` drops from 100 to 94.03 on the bank slip in 3x, but only to 96.04 on the card.
 * Splitting on a bank slip is more expensive than on a card — it is counterintuitive, and it is real.
 */
import type { FeeTable } from '../core/config.ts'
import { calcFee, calcInstallmentFee, type BillingType } from './fees.ts'
import { cents, type Cents } from './money.ts'

export interface SimulationInput {
  valueCents: Cents
  billingTypes: readonly BillingType[]
  installmentCount?: number | null
}

export interface SimulatedInstallment {
  paymentNetValueCents: Cents
  paymentValueCents: Cents
}

export interface SimulatedBilling {
  netValueCents: Cents
  /** Only the card has a percentage bracket; bank slip and Pix charge a fixed amount. */
  feeBp: number | null
  feeFixedCents: Cents
  installment: SimulatedInstallment | null
}

export interface Simulation {
  valueCents: Cents
  creditCard: SimulatedBilling | null
  bankSlip: SimulatedBilling | null
  pix: SimulatedBilling | null
}

/** The card's percentage bracket, in basis points, for N installments. */
function creditCardBp(fees: FeeTable, n: number): number {
  if (n <= 1) return fees.creditCard.oneInstallment
  if (n <= 6) return fees.creditCard.upToSix
  if (n <= 12) return fees.creditCard.upToTwelve
  return fees.creditCard.upToTwentyOne
}

function simulateOne(
  fees: FeeTable,
  billingType: BillingType,
  value: Cents,
  count: number,
): SimulatedBilling {
  const isCard = billingType === 'CREDIT_CARD'

  const feeBp = isCard ? creditCardBp(fees, count) : null
  const feeFixed = isCard ? cents(fees.creditCard.fixed) : calcFee(fees, billingType, value, count)

  // Single payment: one charge only, the full fee over the full amount.
  if (count <= 1) {
    const fee = calcFee(fees, billingType, value, 1)
    return {
      netValueCents: cents(value - fee),
      feeBp,
      feeFixedCents: feeFixed,
      installment: null,
    }
  }

  const perInstallmentFee = calcInstallmentFee(fees, billingType, value, count)
  const paymentValue = cents(Math.floor(value / count))

  return {
    // The truncation remainder stays with the merchant — it is not redistributed.
    netValueCents: cents(value - perInstallmentFee * count),
    feeBp,
    feeFixedCents: feeFixed,
    installment: {
      paymentValueCents: paymentValue,
      paymentNetValueCents: cents(paymentValue - perInstallmentFee),
    },
  }
}

export function simulate(fees: FeeTable, input: SimulationInput): Simulation {
  const count = Math.max(1, Number(input.installmentCount ?? 1))
  const wanted = new Set(input.billingTypes)

  const of = (t: BillingType) =>
    wanted.has(t) ? simulateOne(fees, t, input.valueCents, count) : null

  return {
    valueCents: input.valueCents,
    creditCard: of('CREDIT_CARD'),
    bankSlip: of('BOLETO'),
    pix: of('PIX'),
  }
}
