/**
 * Webhook event emission.
 *
 * One domain event → one row in `webhook_events` → N rows in
 * `webhook_deliveries` (one per subscribed and enabled webhook of the account).
 *
 * The PAYLOAD IS FROZEN HERE, at the moment the fact happened. A retry three
 * hours later resends this payload, not the current state of the resource — the
 * event describes an instant, it is not a query.
 *
 * The DELIVERY does not happen here. The dispatcher runs on the scheduler (the
 * last job of the tick), which keeps the emission cheap and inside the business
 * transaction.
 */
import { and, eq, sql } from 'drizzle-orm'
import type { DB } from '../db/client.ts'
import { webhookDeliveries, webhookEvents, webhooks } from '../db/schema/index.ts'
import { webhookEventId } from '../domain/ids.ts'
import { NOTIFICATION_FOR_WEBHOOK } from '../domain/notification-text.ts'
import { enqueuePaymentNotifications, type PaymentFacts } from '../notify/enqueue.ts'
import type { Clock } from './clock.ts'
import { DAY_MS } from './clock.ts'
import type { Config } from './config.ts'
import type { Rng } from './rng.ts'

/** The resource that accompanies the event in the payload. */
export type ResourceType =
  | 'payment'
  | 'subscription'
  | 'invoice'
  | 'transfer'
  | 'bill'
  | 'anticipation'
  | 'mobilePhoneRecharge'
  | 'accountStatus'
  | 'checkout'
  | 'balance'
  | 'internalTransferData'

export interface DomainEvent {
  accountId: string
  /** PAYMENT_RECEIVED, SUBSCRIPTION_CREATED, … (one of the 111 events). */
  event: string
  resourceType: ResourceType
  resourceId: string
  /** The resource SERIALIZED in the API response format. Frozen now. */
  resource: Record<string, unknown>
}

export interface EmitDeps {
  clock: Clock
  rng: Rng
  config: Config
}

async function nextSequence(tx: DB, name: string): Promise<number> {
  const rows = await tx.all<{ value: number }>(sql`
    INSERT INTO sequences (name, value) VALUES (${name}, 1)
    ON CONFLICT(name) DO UPDATE SET value = value + 1
    RETURNING value
  `)
  return rows[0]!.value
}

export function createEmitter(deps: EmitDeps) {
  return async function emit(tx: DB, event: DomainEvent): Promise<void> {
    const seq = await nextSequence(tx, 'webhook_event')
    const id = webhookEventId(deps.rng, seq)
    const nowMs = deps.clock.nowMs()
    const timestamp = deps.clock.timestamp()

    /**
     * The exact Asaas envelope. The resource key varies with the type of the event
     * (`payment`, `subscription`, `transfer`…), and that is what the client reads.
     */
    const payload = {
      id,
      event: event.event,
      dateCreated: timestamp,
      account: { id: event.accountId, ownerId: null },
      [event.resourceType]: event.resource,
    }

    await tx.insert(webhookEvents).values({
      id,
      accountId: event.accountId,
      event: event.event,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      payload,
      dateCreated: timestamp,
      createdAtMs: nowMs,
    })

    // Fan-out: only the enabled webhooks of this account that subscribed to this event.
    const configs = await tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.accountId, event.accountId), eq(webhooks.enabled, true)))

    const expiresAtMs = nowMs + deps.config.webhook.retentionDays * DAY_MS

    for (const cfg of configs) {
      if (!cfg.events.includes(event.event)) continue

      // Strict order per webhook. It is what gives SEQUENTIALLY its meaning.
      const sequence = await nextSequence(tx, `webhook_delivery:${cfg.id}`)

      await tx.insert(webhookDeliveries).values({
        id: deps.rng.uuid(),
        webhookId: cfg.id,
        eventId: id,
        accountId: event.accountId,
        sequence,
        status: 'PENDING',
        attempt: 0,
        // The first attempt is immediate (offset 0 of the backoff table).
        nextAttemptAtMs: nowMs,
        expiresAtMs,
        dateCreated: timestamp,
      })
    }

    // The payer hears about it too: an e-mail and a WhatsApp template, when those
    // channels are configured. Same transaction: the notification exists iff the fact does.
    const notification =
      event.resourceType === 'payment' ? NOTIFICATION_FOR_WEBHOOK[event.event] : undefined
    const { mailpitUrl, whatsappUrl, smsUrl } = deps.config.notify
    if (notification && (mailpitUrl || whatsappUrl || smsUrl)) {
      await enqueuePaymentNotifications(tx, deps, {
        accountId: event.accountId,
        event: notification,
        payment: event.resource as unknown as PaymentFacts,
      })
    }
  }
}
