import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { customers } from './customers.ts'
import type { DiscountConfig, FineConfig, InterestConfig } from './payments.ts'
import { bool, cents, date, datetime, json } from './_conventions.ts'

/**
 * Installment plan. The N charges are ALL born at creation (unlike the
 * subscription, which generates on demand). The rounding remainder goes to the LAST
 * installment: R$ 350 in 12x → 11 × R$ 29.16 + R$ 29.24.
 */
export const installments = sqliteTable(
  'installments',
  {
    id: text('id').primaryKey(), // A plain UUID, no prefix
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),

    billingType: text('billing_type').notNull(),
    installmentCount: cents('installment_count').notNull(),
    /** The value of each installment (the last one may differ by the remainder). */
    installmentValueCents: cents('installment_value_cents').notNull(),
    /** The sum of all the installments. */
    totalValueCents: cents('total_value_cents').notNull(),
    netValueCents: cents('net_value_cents').notNull(),

    /** The day of the month each installment is due. */
    expirationDay: cents('expiration_day').notNull(),
    description: text('description'),
    paymentLinkId: text('payment_link_id'),
    checkoutSession: text('checkout_session'),
    transactionReceiptUrl: text('transaction_receipt_url'),

    deleted: bool('deleted').notNull(),
    dateCreated: date('date_created').notNull(),
  },
  (t) => [index('installments_account_idx').on(t.accountId, t.deleted)],
)

/**
 * Subscription. The next charge is NOT created on the spot: Asaas generates it
 * SUBSCRIPTION_LOOKAHEAD_DAYS (40 by default) before the nextDueDate.
 */
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(), // sub_<alfanum>
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),

    billingType: text('billing_type').notNull(),
    /** WEEKLY BIWEEKLY MONTHLY BIMONTHLY QUARTERLY SEMIANNUALLY YEARLY */
    cycle: text('cycle').notNull(),
    /** ACTIVE | INACTIVE | EXPIRED */
    status: text('status').notNull(),

    valueCents: cents('value_cents').notNull(),
    nextDueDate: date('next_due_date').notNull(),
    endDate: date('end_date'),
    maxPayments: cents('max_payments'),
    /** How many charges were already generated — to honour maxPayments. */
    paymentsGenerated: cents('payments_generated').notNull(),

    description: text('description'),
    externalReference: text('external_reference'),
    paymentLinkId: text('payment_link_id'),
    checkoutSession: text('checkout_session'),
    creditCardId: text('credit_card_id'),

    discount: json<DiscountConfig>('discount'),
    fine: json<FineConfig>('fine'),
    interest: json<InterestConfig>('interest'),

    deleted: bool('deleted').notNull(),
    dateCreated: date('date_created').notNull(),
  },
  (t) => [
    // The predicate of the subscription charge generation job.
    index('subscriptions_generation_idx').on(t.status, t.nextDueDate),
    index('subscriptions_account_idx').on(t.accountId, t.deleted),
  ],
)

/**
 * The subscription's split: it serves as a TEMPLATE, copied for each generated charge.
 * Changing it here does not touch the charges already created.
 */
export const subscriptionSplits = sqliteTable(
  'subscription_splits',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    walletId: text('wallet_id').notNull(),
    fixedValueCents: cents('fixed_value_cents'),
    percentualValueE4: cents('percentual_value_e4'),
    /** ACTIVE | DISABLED */
    status: text('status').notNull(),
    disabledReason: text('disabled_reason'),
    externalReference: text('external_reference'),
    description: text('description'),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [index('subscription_splits_sub_idx').on(t.subscriptionId)],
)
