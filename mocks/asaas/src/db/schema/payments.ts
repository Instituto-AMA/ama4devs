import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { customers } from './customers.ts'
import { bool, cents, date, datetime, json } from './_conventions.ts'

/** The discount/fine/interest rules embedded in the charge. */
export interface DiscountConfig {
  value: number
  dueDateLimitDays: number
  type: 'FIXED' | 'PERCENTAGE'
}
export interface FineConfig {
  value: number
  type: 'FIXED' | 'PERCENTAGE'
}
/** `interest` only has `value` — it is always a MONTHLY percentage. There is no `type`. */
export interface InterestConfig {
  value: number
}
export interface CallbackConfig {
  successUrl: string
  autoRedirect?: boolean
}

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(), // pay_<12 digits>
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),

    /** The groupers. A payment belongs to at most one of each. */
    subscriptionId: text('subscription_id'),
    installmentId: text('installment_id'),
    installmentNumber: text('installment_number'),
    paymentLinkId: text('payment_link_id'),
    checkoutSession: text('checkout_session'),

    billingType: text('billing_type').notNull(),
    status: text('status').notNull(),

    /**
     * `value` is the amount TO PAY: once overdue, it starts to include interest and fine.
     * `originalValue` holds the value from before the charge went overdue (null if it never did).
     * `interestValue` = fine + interest.
     * `netValue` = value − Asaas's fee. It is the split's base.
     */
    valueCents: cents('value_cents').notNull(),
    netValueCents: cents('net_value_cents').notNull(),
    originalValueCents: cents('original_value_cents'),
    interestValueCents: cents('interest_value_cents'),
    /** The fee Asaas charges on this charge. It is only debited if it is paid. */
    feeCents: cents('fee_cents').notNull(),

    description: text('description'),
    externalReference: text('external_reference'),

    dueDate: date('due_date').notNull(),
    /** The due date at the moment of creation. Immutable. */
    originalDueDate: date('original_due_date').notNull(),
    /** The date Asaas settled the charge. */
    paymentDate: date('payment_date'),
    /** The date the payer actually paid. */
    clientPaymentDate: date('client_payment_date'),
    confirmedDate: date('confirmed_date'),
    /** When the money became balance. Filled when it enters RECEIVED. */
    creditDate: date('credit_date'),
    estimatedCreditDate: date('estimated_credit_date'),

    discount: json<DiscountConfig>('discount'),
    fine: json<FineConfig>('fine'),
    interest: json<InterestConfig>('interest'),
    callback: json<CallbackConfig>('callback'),

    creditCardId: text('credit_card_id'),
    /**
     * How many times the saved card was tried for this charge on its due date
     * (src/domain/card-capture.ts). Only recurring card charges move it.
     */
    captureAttempts: cents('capture_attempts').notNull().default(0),
    pixQrCodeId: text('pix_qr_code_id'),
    pixTransactionId: text('pix_transaction_id'),

    invoiceUrl: text('invoice_url'),
    bankSlipUrl: text('bank_slip_url'),
    transactionReceiptUrl: text('transaction_receipt_url'),
    invoiceNumber: text('invoice_number'),
    nossoNumero: text('nosso_numero'),

    /** 0 = the bank slip record is cancelled when it expires. null = the account's default. */
    daysAfterDueDateToRegistrationCancellation: cents(
      'days_after_due_date_to_registration_cancellation',
    ),
    postalService: bool('postal_service').notNull(),
    canBePaidAfterDueDate: bool('can_be_paid_after_due_date').notNull(),

    anticipated: bool('anticipated').notNull(),
    anticipable: bool('anticipable').notNull(),
    deleted: bool('deleted').notNull(),

    lastInvoiceViewedDate: datetime('last_invoice_viewed_date'),
    lastBankSlipViewedDate: datetime('last_bank_slip_viewed_date'),
    dateCreated: date('date_created').notNull(),
    createdAtMs: cents('created_at_ms').notNull(), // stable ordering
  },
  (t) => [
    // The scheduler jobs' predicates — these two indexes are what keeps the
    // tick cheap when the database grows.
    index('payments_overdue_idx').on(t.status, t.dueDate),
    index('payments_credit_idx').on(t.status, t.creditDate),

    index('payments_account_idx').on(t.accountId, t.status),
    index('payments_customer_idx').on(t.accountId, t.customerId),
    index('payments_subscription_idx').on(t.subscriptionId),
    index('payments_installment_idx').on(t.installmentId),
    index('payments_external_ref_idx').on(t.accountId, t.externalReference),
  ],
)

export const paymentSplits = sqliteTable(
  'payment_splits',
  {
    id: text('id').primaryKey(), // UUID
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    /** The destination wallet. It may belong to an account that does not exist here. */
    walletId: text('wallet_id').notNull(),
    /** Resolved when the walletId belongs to an account of this server. */
    recipientAccountId: text('recipient_account_id'),

    fixedValueCents: cents('fixed_value_cents'),
    /** 4 decimal places → 1e4 scale. 92.3444% = 923444. */
    percentualValueE4: cents('percentual_value_e4'),
    totalFixedValueCents: cents('total_fixed_value_cents'),

    /** The amount actually computed over the charge's netValue. */
    totalValueCents: cents('total_value_cents'),

    /** PENDING PROCESSING PROCESSING_REFUND AWAITING_CREDIT CANCELLED DONE REFUNDED BLOCKED_BY_VALUE_DIVERGENCE */
    status: text('status').notNull(),
    cancellationReason: text('cancellation_reason'),
    refusalReason: text('refusal_reason'),

    /** The deadline to fix a split blocked by a divergence (2 business days). */
    blockedUntil: date('blocked_until'),
    creditDate: date('credit_date'),

    externalReference: text('external_reference'),
    description: text('description'),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [
    index('payment_splits_payment_idx').on(t.paymentId),
    index('payment_splits_status_idx').on(t.status, t.blockedUntil),
    index('payment_splits_wallet_idx').on(t.walletId),
  ],
)

export const paymentRefunds = sqliteTable(
  'payment_refunds',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    /** PENDING | AWAITING_CRITICAL_ACTION_AUTHORIZATION | CANCELLED | DONE */
    status: text('status').notNull(),
    valueCents: cents('value_cents').notNull(),
    description: text('description'),
    /** The fees are NOT refunded on a reversal — Asaas keeps them. */
    refundedFeeCents: cents('refunded_fee_cents').notNull(),
    effectiveDate: date('effective_date'),
    transactionReceiptUrl: text('transaction_receipt_url'),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [index('payment_refunds_payment_idx').on(t.paymentId)],
)

export const creditCards = sqliteTable(
  'credit_cards',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    customerId: text('customer_id').references(() => customers.id),

    creditCardToken: text('credit_card_token').notNull(), // UUID
    /** Only the last 4 digits — we never store the PAN. */
    last4: text('last4').notNull(),
    brand: text('brand').notNull(),
    holderName: text('holder_name').notNull(),
    expiryMonth: text('expiry_month').notNull(),
    expiryYear: text('expiry_year').notNull(),

    /**
     * The AUTHORIZATION outcome, decided at the tokenization and carried by the token —
     * it is what makes a declined card keep declining when charged by the
     * token, as in Asaas.
     *
     * Only the authorization outcomes get here. The validation ones (expired, missing
     * CVV…) refuse the request at the door and no token is born.
     * See `src/domain/credit-card.ts`.
     */
    simulatedOutcome: text('simulated_outcome', {
      enum: ['APPROVE', 'DECLINE'],
    }).notNull(),

    /**
     * Ours, not Asaas's: how many more charges this saved card approves before it
     * starts declining (null = no limit). It plays the card that works for months
     * and then hits its limit or gets cancelled, which the sandbox cannot produce.
     * Set from the panel or PUT /_admin/credit-cards/:token.
     */
    approvalsLeft: cents('approvals_left'),

    holderInfo: json<Record<string, unknown>>('holder_info'),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [
    index('credit_cards_token_idx').on(t.creditCardToken),
    index('credit_cards_account_idx').on(t.accountId),
  ],
)
