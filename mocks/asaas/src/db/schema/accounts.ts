import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { bool, cents, datetime } from './_conventions.ts'

/**
 * Each API key belongs to an account. Each account has its own walletId and
 * balance. It is what makes the split truly testable: the money leaves one account
 * and enters the other, and both statements balance.
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(), // UUID
    walletId: text('wallet_id').notNull(), // UUID — the destination of a split
    /** Subaccount created via POST /v3/accounts. null = root account. */
    parentAccountId: text('parent_account_id'),

    name: text('name').notNull(),
    /** The legal name. It only makes sense for a JURIDICA account. */
    companyName: text('company_name'),
    /** The display name. Asaas fills it in by itself from the legal name. */
    tradingName: text('trading_name'),
    email: text('email').notNull(),
    loginEmail: text('login_email'),
    cpfCnpj: text('cpf_cnpj').notNull(),
    personType: text('person_type', { enum: ['FISICA', 'JURIDICA'] }).notNull(),
    companyType: text('company_type'),
    birthDate: text('birth_date'),
    mobilePhone: text('mobile_phone'),
    phone: text('phone'),
    site: text('site'),

    address: text('address'),
    addressNumber: text('address_number'),
    complement: text('complement'),
    province: text('province'),
    postalCode: text('postal_code'),
    city: text('city'),
    state: text('state'),
    country: text('country').notNull(),

    incomeCents: cents('income_cents'),

    /** PENDING | APPROVED | REJECTED — in the sandbox it approves itself. */
    status: text('status').notNull(),

    /**
     * The materialized balance. Written in the SAME transaction as the ledger entry.
     * The invariant the tests check:
     *   balanceCents === SUM(financial_transactions.value_cents WHERE accountId)
     */
    balanceCents: cents('balance_cents').notNull(),

    accountNumber: text('account_number'),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [
    uniqueIndex('accounts_wallet_id_uq').on(t.walletId),
    index('accounts_parent_idx').on(t.parentAccountId),
  ],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    /** `$aact_hmlg_…` — the value of the `access_token` header. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    active: bool('active').notNull(),
    dateCreated: datetime('date_created').notNull(),
    expirationDate: text('expiration_date'),
  },
  (t) => [
    uniqueIndex('api_keys_key_uq').on(t.key), // hot path: every request
    index('api_keys_account_idx').on(t.accountId),
  ],
)
