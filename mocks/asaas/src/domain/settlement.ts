/**
 * When the money becomes balance. PURE.
 *
 * It is the most important divergence between payment methods, and it lives HERE,
 * in a single place — so that no handler has to remember it:
 *
 *   PIX          → RECEIVED right away. SKIPS the CONFIRMED state. Immediate credit.
 *   BOLETO       → CONFIRMED → RECEIVED on the next business day (D+1 business day).
 *   CREDIT_CARD  → CONFIRMED → RECEIVED at D+32 (calendar days).
 *   DEBIT_CARD   → CONFIRMED → RECEIVED at D+3.
 *
 * The card's D+32 is the number from the technical documentation. Asaas's marketing
 * says "30 days" — the technical doc says 32, and that is the one that counts. It is
 * in the config, adjustable.
 */
import { addBusinessDays, addDays, nextBusinessDay, type IsoDate } from './calendar.ts'
import type { BillingType } from './fees.ts'

export interface SettlementRules {
  creditCardSettlementDays: number // 32
  debitCardSettlementDays: number // 3
}

/**
 * Pix does not go through CONFIRMED: it goes straight from PENDING/OVERDUE to RECEIVED.
 * Everything else goes through it.
 */
export function skipsConfirmed(billingType: BillingType): boolean {
  return billingType === 'PIX'
}

/**
 * The date the credit becomes available, given the confirmation day.
 *
 * For the bank slip, "next business day" — if the payment lands on a Friday, it
 * credits on Monday. Asaas does not publish the time cutoff, so we do not model one:
 * confirmed today, credits on the next business day.
 */
export function creditDateFor(
  billingType: BillingType,
  confirmedOn: IsoDate,
  rules: SettlementRules,
  /**
   * The installment number (1 = first, or a single-payment charge).
   *
   * PROVEN against the real sandbox: in an installment plan on the card, the issuer
   * authorizes everything at once (all installments confirm on the same day), but the
   * money lands STAGGERED — installment `n` credits at **D+32×n** from the
   * confirmation, rolled to the next business day.
   *
   *   confirmed on 14/07/2026, 6x:
   *   #1 +32d  = 15/08 (Sat) → 17/08     #4 +128d = 19/11
   *   #2 +64d  = 16/09                   #5 +160d = 21/12
   *   #3 +96d  = 18/10 (Sun) → 19/10     #6 +192d = 22/01/2027
   *
   * All 6 dates match exactly. The intuitive reading — "D+32 from each installment's
   * due date" — is wrong and would give different numbers.
   */
  installmentNumber = 1,
): IsoDate {
  switch (billingType) {
    case 'PIX':
      return confirmedOn // immediate

    case 'BOLETO':
      return addBusinessDays(confirmedOn, 1)

    case 'CREDIT_CARD':
      return nextBusinessDay(
        addDays(confirmedOn, rules.creditCardSettlementDays * Math.max(1, installmentNumber)),
      )

    case 'DEBIT_CARD':
      return addDays(confirmedOn, rules.debitCardSettlementDays)

    default:
      return confirmedOn
  }
}

/**
 * `estimatedCreditDate`.
 *
 * PROVEN against the real sandbox: **it is `null` while the charge is PENDING.**
 * Asaas does not promise a credit date for money that has not come in yet — it
 * only fills this field when the charge confirms, and then with the SAME value as
 * `creditDate`. We used to fill it at creation (from the due date), which invented a
 * date the real API does not give.
 *
 * It stays here, returning `null`, instead of disappearing: the field exists in the
 * contract, and a reader looking for "where do we compute estimatedCreditDate"
 * needs to find this explanation, not a silence.
 */
export function estimatedCreditDateFor(): null {
  return null
}
