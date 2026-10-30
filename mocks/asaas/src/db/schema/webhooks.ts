import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { bool, cents, datetime, epochMs, json } from './_conventions.ts'

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(), // A plain UUID
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),

    name: text('name').notNull(),
    url: text('url').notNull(),
    email: text('email').notNull(),
    enabled: bool('enabled').notNull(),
    /** It becomes true after WEBHOOK_MAX_ATTEMPTS consecutive failures. It freezes the queue. */
    interrupted: bool('interrupted').notNull(),
    /** Sent in the `asaas-access-token` header. 32–255 chars. */
    authToken: text('auth_token'),
    apiVersion: cents('api_version').notNull(),
    /** SEQUENTIALLY does real head-of-line blocking. */
    sendType: text('send_type', {
      enum: ['SEQUENTIALLY', 'NON_SEQUENTIALLY'],
    }).notNull(),
    events: json<string[]>('events').notNull(),

    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [index('webhooks_account_idx').on(t.accountId)],
)

/**
 * The domain event. One per occurrence, no matter how many webhooks
 * are subscribed.
 *
 * `payload` is FROZEN at the moment of the emit. A retry 3 hours later does not
 * send the current state of the resource — the event describes an instant.
 */
export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(), // evt_<hex32>&<n>
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    event: text('event').notNull(), // PAYMENT_RECEIVED, …
    resourceType: text('resource_type').notNull(), // payment, subscription, transfer…
    resourceId: text('resource_id').notNull(),
    payload: json<Record<string, unknown>>('payload').notNull(),
    dateCreated: datetime('date_created').notNull(),
    createdAtMs: epochMs('created_at_ms').notNull(),
  },
  (t) => [index('webhook_events_account_idx').on(t.accountId, t.createdAtMs)],
)

/** One delivery per (event × subscribed and enabled webhook). */
export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id),
    eventId: text('event_id')
      .notNull()
      .references(() => webhookEvents.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),

    /** Monotonic per webhook. It is what gives the SEQUENTIALLY mode its order. */
    sequence: epochMs('sequence').notNull(),

    /** PENDING | DELIVERED | FAILED | INTERRUPTED | EXPIRED */
    status: text('status').notNull(),
    attempt: cents('attempt').notNull(),
    nextAttemptAtMs: epochMs('next_attempt_at_ms'),
    lastAttemptAt: datetime('last_attempt_at'),
    /** Only HTTP 200 counts as a success in Asaas. 201 and 204 are a failure. */
    lastStatusCode: cents('last_status_code'),
    lastError: text('last_error'),
    /** createdAt + WEBHOOK_RETENTION_DAYS (simulated days). */
    expiresAtMs: epochMs('expires_at_ms').notNull(),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [
    // The dispatcher scans this index on every tick.
    index('webhook_deliveries_due_idx').on(t.webhookId, t.status, t.nextAttemptAtMs),
    // Strict order for SEQUENTIALLY.
    uniqueIndex('webhook_deliveries_seq_uq').on(t.webhookId, t.sequence),
    index('webhook_deliveries_event_idx').on(t.eventId),
  ],
)
