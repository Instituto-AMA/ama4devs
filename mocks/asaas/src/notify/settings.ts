/**
 * A customer's notification settings: the eight rows Asaas creates with the
 * customer (domain/notification-defaults.ts).
 *
 * Written when the customer is created. A customer from before this existed has
 * none, and gets them the first time anything reads them (the list, a PUT, a
 * charge event), so every customer answers with the same eight rows.
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Rng } from '../core/rng.ts'
import type { DB } from '../db/client.ts'
import { notifications } from '../db/schema/index.ts'
import { DEFAULT_NOTIFICATIONS } from '../domain/notification-defaults.ts'
import { notificationId } from '../domain/ids.ts'

export type NotificationRow = typeof notifications.$inferSelect

/** Writes the default rows of a customer that has none; returns its rows. */
export async function ensureCustomerNotifications(
  tx: DB,
  rng: Rng,
  customerId: string,
): Promise<NotificationRow[]> {
  const existing = await customerNotifications(tx, customerId)
  if (existing.length > 0) return existing
  for (const d of DEFAULT_NOTIFICATIONS) {
    await tx.insert(notifications).values({
      id: notificationId(rng),
      customerId,
      event: d.event,
      enabled: true,
      emailEnabledForProvider: d.emailEnabledForProvider,
      smsEnabledForProvider: false,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: true,
      phoneCallEnabledForCustomer: d.phoneCallEnabledForCustomer,
      whatsappEnabledForCustomer: true,
      scheduleOffset: d.scheduleOffset,
      deleted: false,
    })
  }
  return customerNotifications(tx, customerId)
}

/** In creation order, the order Asaas lists them in. */
export function customerNotifications(tx: DB, customerId: string): Promise<NotificationRow[]> {
  return tx
    .select()
    .from(notifications)
    .where(and(eq(notifications.customerId, customerId), eq(notifications.deleted, false)))
    .orderBy(sql`rowid`)
}
