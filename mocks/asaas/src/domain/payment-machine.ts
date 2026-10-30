/**
 * The charge state machine. PURE — it touches no database, no clock and no HTTP.
 *
 * `plan()` receives the current state and a trigger, and returns DATA: the new
 * status, the field patch, and the list of EFFECTS (webhook to emit, ledger entry,
 * split status change). What executes it is `applyTransition()`, in a
 * transaction.
 *
 * WHY IT IS LIKE THIS: the webhook and the financial entry are *effects of the
 * transition*, not something each handler remembers to do. A `receiveInCash`, a
 * scheduler tick and a sandbox action all go through here — so it is impossible for
 * one of them to forget to emit the PAYMENT_RECEIVED or to debit the fee. That
 * class of bug simply does not exist in this design.
 *
 * And because it is pure, the whole matrix (status × trigger) is testable without
 * booting anything.
 */
import type { FeeTable } from '../core/config.ts'
import type { DiscountConfig, FineConfig, InterestConfig } from '../db/schema/payments.ts'
import type { IsoDate } from './calendar.ts'
import { calcFee, calcInstallmentFee, type BillingType } from './fees.ts'
import { calcDiscount, calcOverdueTotals } from './interest.ts'
import { cents, type Cents } from './money.ts'
import { creditDateFor, skipsConfirmed, type SettlementRules } from './settlement.ts'

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'CONFIRMED'
  | 'RECEIVED'
  | 'OVERDUE'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'REFUNDED'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'

/** The state of the charge the machine needs. */
export interface PaymentState {
  id: string
  status: PaymentStatus
  billingType: BillingType
  valueCents: Cents
  originalValueCents: Cents | null
  netValueCents: Cents
  feeCents: Cents
  dueDate: IsoDate
  confirmedDate: IsoDate | null
  creditDate: IsoDate | null
  discount: DiscountConfig | null
  fine: FineConfig | null
  interest: InterestConfig | null
  installmentCount: number
  /**
   * Which installment this charge is (1 = first, or a single-payment charge).
   *
   * It is not decoration: in an installment plan on the card the N installments
   * ALL confirm on the same day, but they credit STAGGERED at D+32×n. Without this
   * number they would all credit together — and the merchant's statement would be
   * wrong for months.
   */
  installmentNumber: number
  /**
   * The TOTAL of the plan, when this charge is an installment.
   *
   * Without it, the confirmation RECALCULATED the fee with `calcFee` over the
   * INSTALLMENT's value — throwing away the correct fee (which comes from the
   * total) that creation had already computed. The netValue of a card installment
   * came out wrong only after being confirmed, which is the worst place for a
   * money error to show up.
   */
  installmentTotalCents: Cents | null
  deleted: boolean
}

export type Trigger =
  /** The payer paid (Pix/boleto at the bank, or the sandbox's confirm action). */
  | { kind: 'PAY'; on: IsoDate }
  /** Card authorized and captured. */
  | { kind: 'CONFIRM'; on: IsoDate }
  /** Pre-authorization (authorizeOnly). */
  | { kind: 'AUTHORIZE' }
  /** Capture of a pre-authorized charge. */
  | { kind: 'CAPTURE'; on: IsoDate }
  /** Scheduler: creditDate has arrived. The money becomes balance. */
  | { kind: 'SETTLE'; on: IsoDate }
  /** Scheduler: the due date has passed. */
  | { kind: 'OVERDUE'; on: IsoDate }
  /** Manual write-off. It does NOT create balance nor move the statement. */
  | { kind: 'RECEIVE_IN_CASH'; on: IsoDate; value: Cents }
  | { kind: 'UNDO_RECEIVE_IN_CASH' }
  | { kind: 'REFUND'; on: IsoDate; value?: Cents }
  | { kind: 'CHARGEBACK' }
  | { kind: 'DELETE' }
  | { kind: 'RESTORE' }

export type LedgerEffectEntry = {
  type: string
  valueCents: Cents
  description: string
}

export type Effect =
  | { t: 'WEBHOOK'; event: string }
  | { t: 'LEDGER'; entries: LedgerEffectEntry[] }
  /** The splits of this charge change status (PENDING → AWAITING_CREDIT → DONE…). */
  | { t: 'SPLIT'; to: string; reason?: string }

export interface Plan {
  to: PaymentStatus
  patch: Partial<PaymentState> & Record<string, unknown>
  effects: Effect[]
}

export class TransitionError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
  ) {
    super(description)
  }
}

export interface MachineDeps {
  fees: FeeTable
  rules: SettlementRules
}

/** Statuses in which the charge has already been paid in some way. */
const PAID: PaymentStatus[] = ['CONFIRMED', 'RECEIVED']
/** Statuses in which payment is still expected. */
const OPEN: PaymentStatus[] = ['PENDING', 'OVERDUE']

/**
 * The plan of the transition. It returns data; it executes nothing.
 * It throws TransitionError when the trigger is not valid for the current status.
 */
export function plan(p: PaymentState, trigger: Trigger, deps: MachineDeps): Plan {
  const reject = (action: string): never => {
    throw new TransitionError(
      'invalid_action',
      `Não é possível executar "${action}" em uma cobrança com status ${p.status}.`,
    )
  }

  switch (trigger.kind) {
    // ─────────────────────────────────────────────────────────
    case 'PAY':
    case 'CONFIRM':
    case 'CAPTURE': {
      if (trigger.kind === 'CAPTURE' && p.status !== 'AUTHORIZED') reject('capturar')
      if (trigger.kind !== 'CAPTURE' && !OPEN.includes(p.status) && p.status !== 'AUTHORIZED') {
        /**
         * Paying an ALREADY PAID charge has its own sentence in Asaas — it was
         * captured (tools/probe-pix.ts). It is the error a duplicated webhook, a
         * button clicked twice or a retry produces, so it is the error a client sees
         * most. We used to return the generic sentence of the state machine.
         */
        if (PAID.includes(p.status)) {
          throw new TransitionError('invalid_action', 'Cobrança já confirmada.')
        }
        reject('confirmar pagamento')
      }

      const on = trigger.on

      /**
       * What is actually paid:
       *   overdue → value + fine + interest
       *   on time → value − discount (if there is one and it is within the window)
       */
      const overdue = calcOverdueTotals(
        {
          originalValueCents: p.originalValueCents ?? p.valueCents,
          dueDate: p.dueDate,
          fine: p.fine,
          interest: p.interest,
        },
        on,
      )

      const discount =
        overdue.daysLate > 0
          ? cents(0)
          : calcDiscount(p.discount, p.valueCents, p.dueDate, on)

      const paidValue = cents(overdue.value - discount)

      /**
       * The fee is recalculated over the amount effectively paid (interest and fine
       * enter the base; the discount leaves it).
       *
       * In an INSTALLMENT, the base is the total of the plan — not the installment.
       * See `calcInstallmentFee`: Asaas charges the card fee once over the total
       * and divides it among the N installments.
       */
      const fee =
        p.installmentTotalCents !== null && p.installmentCount > 1
          ? calcInstallmentFee(
              deps.fees,
              p.billingType,
              p.installmentTotalCents,
              p.installmentCount,
            )
          : calcFee(deps.fees, p.billingType, paidValue, p.installmentCount)
      const net = cents(paidValue - fee)

      // The installment `n` of a card credits at D+32×n — they all confirm together,
      // but the money lands staggered. Proven against the real sandbox.
      const creditDate = creditDateFor(p.billingType, on, deps.rules, p.installmentNumber)

      const patch: Plan['patch'] = {
        valueCents: paidValue,
        originalValueCents: overdue.daysLate > 0 ? overdue.originalValue : null,
        feeCents: fee,
        netValueCents: net,
        confirmedDate: on,
        /**
         * `creditDate` is filled IN AT THE CONFIRMATION, pointing to the future —
         * not on the day the money lands. Proven against the real sandbox: a card
         * confirmed today already returns a `creditDate` 32 days from now.
         *
         * We used to leave it `null` until the settlement, which meant the merchant
         * could not know WHEN they would receive — which is exactly the question
         * the field answers. What tells "will land" from "landed" is the `status`.
         */
        creditDate,
        estimatedCreditDate: creditDate,
        /**
         * `clientPaymentDate` and `paymentDate` are NOT the same date, and we used
         * to treat them as if they were:
         *
         *   clientPaymentDate → when the CUSTOMER paid
         *   paymentDate       → when the money entered the MERCHANT's account
         *
         * A CONFIRMED card has `clientPaymentDate` filled and `paymentDate`
         * **null** — the customer has paid, but the merchant has not received yet.
         * We filled both at the confirmation. Proven against the real sandbox.
         */
        clientPaymentDate: on,
        interestValueCents: overdue.interestValue > 0 ? overdue.interestValue : null,
      }

      /**
       * HERE is the divergence between payment methods, and it lives in one place.
       *
       * Pix does not go through CONFIRMED — it falls straight to RECEIVED, with the
       * money already in the balance. Bank slip and card go through CONFIRMED and
       * only credit later (D+1 business day / D+32).
       */
      if (skipsConfirmed(p.billingType)) {
        return {
          to: 'RECEIVED',
          // Received NOW: the money came in, so `paymentDate` exists.
          patch: { ...patch, creditDate, paymentDate: on },
          effects: [
            { t: 'WEBHOOK', event: 'PAYMENT_RECEIVED' },
            {
              t: 'LEDGER',
              entries: [
                {
                  type: 'PAYMENT_RECEIVED',
                  valueCents: paidValue,
                  description: `Cobrança recebida — ${p.id}`,
                },
                {
                  type: 'PAYMENT_FEE',
                  valueCents: cents(-fee),
                  description: `Taxa de cobrança — ${p.id}`,
                },
              ],
            },
            { t: 'SPLIT', to: 'AWAITING_CREDIT' },
          ],
        }
      }

      return {
        to: 'CONFIRMED',
        patch,
        effects: [
          { t: 'WEBHOOK', event: 'PAYMENT_CONFIRMED' },
          { t: 'SPLIT', to: 'AWAITING_CREDIT' },
        ],
      }
    }

    // ─────────────────────────────────────────────────────────
    case 'SETTLE': {
      // Only the scheduler triggers this, when creditDate arrives.
      if (p.status !== 'CONFIRMED') reject('liquidar')

      return {
        to: 'RECEIVED',
        patch: {
          creditDate: trigger.on,
          /**
           * The money came in NOW — this is where `paymentDate` is born, and not at
           * the confirmation. While the charge was CONFIRMED it had
           * `clientPaymentDate` (the customer paid) but `paymentDate: null` (the
           * merchant had not received). See the comment in the PAY/CONFIRM trigger.
           */
          paymentDate: p.confirmedDate ?? trigger.on,
        },
        effects: [
          { t: 'WEBHOOK', event: 'PAYMENT_RECEIVED' },
          {
            t: 'LEDGER',
            entries: [
              {
                type: 'PAYMENT_RECEIVED',
                valueCents: p.valueCents,
                description: `Cobrança recebida — ${p.id}`,
              },
              {
                type: 'PAYMENT_FEE',
                valueCents: cents(-p.feeCents),
                description: `Taxa de cobrança — ${p.id}`,
              },
            ],
          },
        ],
      }
    }

    // ─────────────────────────────────────────────────────────
    case 'AUTHORIZE': {
      if (!OPEN.includes(p.status)) reject('autorizar')
      return {
        to: 'AUTHORIZED',
        patch: {},
        effects: [{ t: 'WEBHOOK', event: 'PAYMENT_AUTHORIZED' }],
      }
    }

    // ─────────────────────────────────────────────────────────
    case 'OVERDUE': {
      if (p.status !== 'PENDING') reject('vencer')
      return {
        to: 'OVERDUE',
        patch: {},
        effects: [{ t: 'WEBHOOK', event: 'PAYMENT_OVERDUE' }],
      }
    }

    // ─────────────────────────────────────────────────────────
    case 'RECEIVE_IN_CASH': {
      if (!OPEN.includes(p.status)) reject('receber em dinheiro')

      /**
       * Manual write-off: Asaas does NOT credit balance nor generate a financial
       * movement — the money went into the merchant's pocket, outside the platform.
       * That is why there is no LEDGER effect here. It is easy to get this wrong.
       *
       * But the receipt DID happen, and real Asaas tells the integrator: the
       * webhook is PAYMENT_RECEIVED carrying status RECEIVED_IN_CASH in the
       * payload (the Hub derives received_in_cash from it). Without this
       * effect the money lands on the charge and no webhook ever leaves —
       * whoever waits for the provider's fact only learns of it through the
       * GET reconciliation.
       */
      return {
        to: 'RECEIVED_IN_CASH',
        patch: {
          valueCents: trigger.value,
          paymentDate: trigger.on,
          clientPaymentDate: trigger.on,
        },
        effects: [
          { t: 'WEBHOOK', event: 'PAYMENT_RECEIVED' },
          { t: 'SPLIT', to: 'CANCELLED', reason: 'PAYMENT_RECEIVED_IN_CASH' },
        ],
      }
    }

    case 'UNDO_RECEIVE_IN_CASH': {
      if (p.status !== 'RECEIVED_IN_CASH') reject('desfazer recebimento em dinheiro')
      return {
        to: 'PENDING',
        patch: { paymentDate: null, clientPaymentDate: null },
        effects: [{ t: 'WEBHOOK', event: 'PAYMENT_RECEIVED_IN_CASH_UNDONE' }],
      }
    }

    // ─────────────────────────────────────────────────────────
    case 'REFUND': {
      if (!PAID.includes(p.status)) reject('estornar')

      const value = trigger.value ?? p.valueCents
      const partial = value < p.valueCents

      /**
       * THE FEES ARE NOT REFUNDED. Asaas keeps the compensation fee and the
       * notification fee even on a full refund — that is why the debit is the gross
       * amount, and the account goes negative by the fee when the balance was only
       * that.
       */
      const entries: LedgerEffectEntry[] =
        p.status === 'RECEIVED'
          ? [
              {
                type: 'PAYMENT_REVERSAL',
                valueCents: cents(-value),
                description: `Estorno de cobrança — ${p.id}`,
              },
            ]
          : [] // it has not credited yet: there is nothing to refund from the balance

      if (partial) {
        return {
          to: p.status, // continua RECEIVED/CONFIRMED
          patch: {},
          effects: [
            { t: 'WEBHOOK', event: 'PAYMENT_PARTIALLY_REFUNDED' },
            ...(entries.length ? [{ t: 'LEDGER' as const, entries }] : []),
          ],
        }
      }

      return {
        to: 'REFUNDED',
        patch: {},
        effects: [
          { t: 'WEBHOOK', event: 'PAYMENT_REFUNDED' },
          ...(entries.length ? [{ t: 'LEDGER' as const, entries }] : []),
          { t: 'SPLIT', to: 'REFUNDED', reason: 'PAYMENT_REFUNDED' },
        ],
      }
    }

    // ─────────────────────────────────────────────────────────
    case 'CHARGEBACK': {
      if (!PAID.includes(p.status)) reject('abrir chargeback')

      /**
       * The amount is DEBITED from the balance as soon as the chargeback arrives —
       * the money goes back to the cardholder before any dispute. But there is only
       * something to debit if the charge had already credited (RECEIVED); a
       * CONFIRMED one has not become balance yet. It is the same asymmetry as the
       * REFUND, and for the same reason.
       *
       * THE FEE IS NOT REFUNDED (same as the reversal): the debit is the gross
       * amount.
       */
      const entries: LedgerEffectEntry[] =
        p.status === 'RECEIVED'
          ? [
              {
                type: 'CHARGEBACK',
                valueCents: cents(-p.valueCents),
                description: `Chargeback — ${p.id}`,
              },
            ]
          : []

      return {
        to: 'CHARGEBACK_REQUESTED',
        patch: {},
        effects: [
          { t: 'WEBHOOK', event: 'PAYMENT_CHARGEBACK_REQUESTED' },
          ...(entries.length ? [{ t: 'LEDGER' as const, entries }] : []),
        ],
      }
    }

    // ─────────────────────────────────────────────────────────
    case 'DELETE': {
      // Only a charge that has not been paid yet can be removed.
      if (!OPEN.includes(p.status)) reject('remover')
      return {
        to: p.status,
        patch: { deleted: true },
        effects: [
          { t: 'WEBHOOK', event: 'PAYMENT_DELETED' },
          { t: 'SPLIT', to: 'CANCELLED', reason: 'PAYMENT_DELETED' },
        ],
      }
    }

    case 'RESTORE': {
      if (!p.deleted) {
        throw new TransitionError('invalid_action', 'A cobrança não está removida.')
      }
      return {
        to: p.status,
        patch: { deleted: false },
        effects: [{ t: 'WEBHOOK', event: 'PAYMENT_RESTORED' }],
      }
    }
  }
}
