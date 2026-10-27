import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { accounts } from './accounts.ts'
import { bool, datetime, epochMs, json } from './_conventions.ts'

/**
 * The notifications Asaas sends to the PAYER (not the webhooks it sends to the
 * application): an e-mail and a WhatsApp template per charge event. Simulated:
 * the e-mail lands in Mailpit, the template in the WhatsApp mock.
 *
 * An outbox, like `webhook_deliveries`: the row is written in the business
 * transaction and delivered by the scheduler (src/notify/dispatcher.ts).
 */
export const notificationDeliveries = sqliteTable(
  'notification_deliveries',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    customerId: text('customer_id').notNull(),
    paymentId: text('payment_id'),
    /** PAYMENT_CREATED, PAYMENT_UPDATED, PAYMENT_OVERDUE, PAYMENT_RECEIVED. */
    event: text('event').notNull(),
    channel: text('channel', { enum: ['EMAIL', 'WHATSAPP'] }).notNull(),
    /** An e-mail address or a phone number (digits, with country code). */
    recipient: text('recipient').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    /** The e-mail's HTML part (the text part is `body`). */
    html: text('html'),
    /** The WhatsApp template and its positional parameters ({{1}}, {{2}}…). */
    template: json<{ name: string; language: string; params: string[] }>('template'),
    /** Sent from the panel's "Enviar agora", whatever the customer's settings. */
    forced: bool('forced').notNull(),
    status: text('status', { enum: ['PENDING', 'SENT', 'FAILED'] }).notNull(),
    attempt: integer('attempt').notNull(),
    lastError: text('last_error'),
    dateCreated: datetime('date_created').notNull(),
    sentAt: datetime('sent_at'),
    createdAtMs: epochMs('created_at_ms').notNull(),
  },
  (t) => [
    index('notification_deliveries_status_idx').on(t.status, t.createdAtMs),
    index('notification_deliveries_payment_idx').on(t.paymentId),
  ],
)
