/**
 * The automatic invoice issuance configuration of a subscription. (Track E)
 *
 * One row per subscription — the API is a CRUD of a single resource
 * (`/v3/subscriptions/{id}/invoiceSettings`), not a collection.
 *
 * `taxes` stays as JSON: they are PERCENTAGES (ISS, PIS, COFINS…), not money — the
 * cents rule does not apply. `deductions`, on the other hand, IS money, and that
 * is why it is an integer in cents as the convention demands.
 *
 * The NF itself (issuance, PDF, XML) belongs to track G; here we only store the
 * policy of when to issue it.
 */
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { subscriptions } from './recurrence.ts'
import { bool, cents, datetime, json } from './_conventions.ts'

/** The invoice's percentages. It mirrors the spec's InvoiceTaxesRequest. */
export interface InvoiceTaxesConfig {
  retainIss: boolean
  iss: number
  pis: number
  cofins: number
  csll: number
  inss: number
  ir: number
  [extra: string]: unknown
}

export const subscriptionInvoiceConfigs = sqliteTable('subscription_invoice_configs', {
  subscriptionId: text('subscription_id')
    .primaryKey()
    .references(() => subscriptions.id),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),

  municipalServiceId: text('municipal_service_id'),
  municipalServiceCode: text('municipal_service_code'),
  municipalServiceName: text('municipal_service_name'),

  /** Money → cents. Deductions do not change the invoice's amount, they change the ISS base. */
  deductionsCents: cents('deductions_cents'),

  /**
   * In the request the field is called `effectiveDatePeriod`; in the response,
   * `invoiceCreationPeriod`. It is the same data — the Asaas spec changes the name.
   * ON_PAYMENT_CONFIRMATION | ON_PAYMENT_DUE_DATE | BEFORE_PAYMENT_DUE_DATE |
   * ON_DUE_DATE_MONTH | ON_NEXT_MONTH
   */
  invoiceCreationPeriod: text('invoice_creation_period'),
  daysBeforeDueDate: cents('days_before_due_date'),
  receivedOnly: bool('received_only'),
  /** Updates the charge's amount already discounting the invoice's taxes. */
  updatePayment: bool('update_payment'),
  observations: text('observations'),

  taxes: json<InvoiceTaxesConfig>('taxes'),

  dateCreated: datetime('date_created').notNull(),
})
