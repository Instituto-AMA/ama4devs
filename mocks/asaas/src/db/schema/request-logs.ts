import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { datetime, epochMs, json } from './_conventions.ts'

/**
 * "Logs de Requisições": every call to the API (`/v3`) an account made, with what
 * went in and what came back, as the Asaas panel shows them. Written before the
 * response leaves (src/http/request-log.ts), so a test reads it right after the
 * call. Kept to the newest REQUEST_LOG_LIMIT per account (retention-purge).
 *
 * The id is a sequence, not the clock: the virtual clock may go back (a reset),
 * the order of the calls does not.
 */
export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    /** The key that made the call; it may be disabled or expired (a 401). */
    apiKeyId: text('api_key_id'),
    method: text('method').notNull(),
    path: text('path').notNull(),
    /** The query string without the `?`, empty when there is none. */
    query: text('query').notNull(),
    status: integer('status').notNull(),
    requestBody: json<unknown>('request_body'),
    responseBody: json<unknown>('response_body'),
    dateCreated: datetime('date_created').notNull(),
    createdAtMs: epochMs('created_at_ms').notNull(),
  },
  (t) => [index('request_logs_account_idx').on(t.accountId, t.id)],
)
