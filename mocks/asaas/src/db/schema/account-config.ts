/**
 * The account state the `accounts` table does not model: the checkout
 * personalization (GET/POST /v3/myAccount/paymentCheckoutConfig) and the disabling
 * of the white label subaccount (DELETE /v3/myAccount).
 *
 * They live here, and not in `accounts`, because they are optional and have their
 * own lifecycle — an account may never have a personalization, and the disabling is
 * a dated fact, not a field.
 */
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { bool, datetime } from './_conventions.ts'

/** One row per account. Checkout/invoice screen personalization. */
export const accountCheckoutConfigs = sqliteTable('account_checkout_configs', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  logoBackgroundColor: text('logo_background_color'),
  infoBackgroundColor: text('info_background_color'),
  fontColor: text('font_color'),
  enabled: bool('enabled').notNull(),
  logoUrl: text('logo_url'),
  /** AWAITING_APPROVAL | APPROVED | REJECTED — em sandbox aprova sozinho. */
  status: text('status').notNull(),
  observations: text('observations'),
  updatedAt: datetime('updated_at').notNull(),
})

/** Subconta white label desabilitada via DELETE /v3/myAccount. */
export const accountDisablements = sqliteTable('account_disablements', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  removeReason: text('remove_reason'),
  disabledAt: datetime('disabled_at').notNull(),
})
