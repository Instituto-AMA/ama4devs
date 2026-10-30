/**
 * KYC / onboarding: the documents an account has to send to be approved.
 *
 * There are TWO tables because the Asaas API exposes two levels: the client reads
 * the GROUPS (`GET /v3/myAccount/documents`) and sends a file for a DOCUMENT
 * (`POST /v3/myAccount/documents/{id}`, where `{id}` is the id of the document that
 * came inside the group). A group only becomes APPROVED when all of its documents
 * are APPROVED.
 *
 * Persisted, and not assembled on every request, because the upload CHANGES the
 * status — a group generated on-the-fly would be born pending again after every
 * upload.
 */
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { datetime } from './_conventions.ts'

export const accountDocumentGroups = sqliteTable(
  'account_document_groups',
  {
    id: text('id').primaryKey(), // UUID
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),

    /** IDENTIFICATION | SOCIAL_CONTRACT | CUSTOM … (AccountDocumentType) */
    type: text('type').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** NOT_SENT | PENDING | APPROVED | REJECTED | IGNORED */
    status: text('status').notNull(),

    /** Who has to send the document. `name` is the account's name. */
    responsibleName: text('responsible_name'),
    /** INDIVIDUAL_COMPANY | LIMITED_COMPANY | MEI | ASAAS_ACCOUNT_OWNER … */
    responsibleType: text('responsible_type'),

    /** The upload link. It goes away (null) when the group is approved. */
    onboardingUrl: text('onboarding_url'),
    onboardingUrlExpirationDate: datetime('onboarding_url_expiration_date'),

    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [index('account_document_groups_account_idx').on(t.accountId)],
)

export const accountDocuments = sqliteTable(
  'account_documents',
  {
    id: text('id').primaryKey(), // UUID — it is the `{id}` of the upload POST
    groupId: text('group_id')
      .notNull()
      .references(() => accountDocumentGroups.id),
    /** Redundant with the group, but it is what lets the authenticated account's
     * document be found in ONE query — the per-account isolation cannot depend on
     * a JOIN somebody forgets to write. */
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),

    /** NOT_SENT | PENDING | APPROVED | REJECTED */
    status: text('status').notNull(),

    fileName: text('file_name'),
    sentAt: datetime('sent_at'),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [index('account_documents_group_idx').on(t.groupId)],
)
