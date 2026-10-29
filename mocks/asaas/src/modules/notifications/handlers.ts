/**
 * Track G1 — Notification (3 operations: the customer's list and the two PUTs).
 *
 * Notifications are NOT created by this module: they are born with the customer
 * (the eight defaults, notify/settings.ts) and can only be READ and UPDATED.
 *
 * `notifications` has no `account_id`: the owner is the CUSTOMER's account. Every
 * access joins `customers`, or the isolation between accounts would leak through
 * the notification id, which is guessable.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { customers } from '../../db/schema/customers.ts'
import { notifications } from '../../db/schema/misc.ts'
import type { HandlerMap } from '../../http/register.ts'
import { ensureCustomerNotifications, type NotificationRow } from '../../notify/settings.ts'

const SCHEDULE_OFFSETS = new Set([0, 1, 5, 7, 10, 15, 30])

const BOOLEAN_FIELDS = [
  'enabled',
  'emailEnabledForProvider',
  'smsEnabledForProvider',
  'emailEnabledForCustomer',
  'smsEnabledForCustomer',
  'phoneCallEnabledForCustomer',
  'whatsappEnabledForCustomer',
] as const

function serialize(row: NotificationRow, customerId: string) {
  return {
    object: 'notification',
    id: row.id,
    customer: customerId,
    enabled: row.enabled,
    emailEnabledForProvider: row.emailEnabledForProvider,
    smsEnabledForProvider: row.smsEnabledForProvider,
    emailEnabledForCustomer: row.emailEnabledForCustomer,
    smsEnabledForCustomer: row.smsEnabledForCustomer,
    phoneCallEnabledForCustomer: row.phoneCallEnabledForCustomer,
    whatsappEnabledForCustomer: row.whatsappEnabledForCustomer,
    event: row.event,
    scheduleOffset: row.scheduleOffset,
    deleted: row.deleted,
  }
}

/** Takes the patch out of the body, validating what TypeBox does not. */
function buildPatch(body: Record<string, unknown>): Partial<NotificationRow> {
  const patch: Partial<NotificationRow> = {}

  for (const field of BOOLEAN_FIELDS) {
    const v = body[field]
    if (v === undefined || v === null) continue
    if (typeof v !== 'boolean') throw invalid(field, `O campo ${field} deve ser booleano.`)
    ;(patch as Record<string, unknown>)[field] = v
  }

  if (body.scheduleOffset !== undefined && body.scheduleOffset !== null) {
    const offset = Number(body.scheduleOffset)
    if (!SCHEDULE_OFFSETS.has(offset)) {
      throw invalid(
        'scheduleOffset',
        'O agendamento deve ser um destes valores: 0, 1, 5, 7, 10, 15 ou 30.',
      )
    }
    patch.scheduleOffset = offset
  }

  return patch
}

/**
 * The notification exists AND belongs to a customer of THIS account. Both in the
 * same query: the second is the isolation.
 */
async function loadNotification(
  ctx: AppContext,
  accountId: string,
  id: string,
): Promise<{ notification: NotificationRow; customerId: string }> {
  const [row] = await ctx.db
    .select({ notification: notifications, customerId: customers.id })
    .from(notifications)
    .innerJoin(customers, eq(notifications.customerId, customers.id))
    .where(and(eq(notifications.id, id), eq(customers.accountId, accountId)))
    .limit(1)

  if (!row) throw notFound('Notificação')
  return row
}

/** The customer, when it belongs to this account (the id is guessable). */
async function ownCustomer(ctx: AppContext, accountId: string, id: string): Promise<string> {
  const [customer] = await ctx.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.accountId, accountId)))
    .limit(1)
  if (!customer) throw notFound('Cliente')
  return customer.id
}

export const notificationHandlers: HandlerMap = {
  'retrieve-notifications-from-a-customer': async ({ ctx, auth, params, query }) => {
    const { limit, offset } = paginationParams(query)
    const customerId = await ownCustomer(ctx, auth.accountId, params.id!)
    const rows = await ensureCustomerNotifications(ctx.db, ctx.rng, customerId)
    return listEnvelope(
      rows.slice(offset, offset + limit).map((r) => serialize(r, customerId)),
      rows.length,
      limit,
      offset,
    )
  },

  'update-existing-notification': async ({ ctx, auth, params, body }) => {
    const { notification, customerId } = await loadNotification(
      ctx,
      auth.accountId,
      params.id!,
    )
    const patch = buildPatch((body ?? {}) as Record<string, unknown>)

    if (Object.keys(patch).length > 0) {
      await ctx.db.update(notifications).set(patch).where(eq(notifications.id, notification.id))
    }

    return serialize({ ...notification, ...patch }, customerId)
  },

  'update-existing-notifications-in-batch': async ({ ctx, auth, body }) => {
    const b = (body ?? {}) as { customer?: string; notifications?: unknown[] }

    if (!b.customer) {
      throw invalid('customer', 'O cliente é obrigatório.')
    }

    // The customer must belong to THIS account: customer ids are guessable.
    const customer = { id: await ownCustomer(ctx, auth.accountId, b.customer) }
    await ensureCustomerNotifications(ctx.db, ctx.rng, customer.id)

    const items = (b.notifications ?? []) as Record<string, unknown>[]
    const ids = items.map((n) => String(n.id ?? ''))

    if (ids.some((id) => id === '')) {
      throw invalid('id', 'Toda notificação do lote precisa de um id.')
    }

    if (ids.length > 0) {
      // Every notification of the batch must be THIS customer's. A batch applied
      // halfway is worse than a refused batch.
      const owned = await ctx.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(inArray(notifications.id, ids), eq(notifications.customerId, customer.id)),
        )

      const ownedIds = new Set(owned.map((n) => n.id))
      const alien = ids.find((id) => !ownedIds.has(id))
      if (alien) throw notFound(`Notificação ${alien}`)

      for (const item of items) {
        const patch = buildPatch(item)
        if (Object.keys(patch).length === 0) continue
        await ctx.db
          .update(notifications)
          .set(patch)
          .where(eq(notifications.id, String(item.id)))
      }
    }

    const rows = await ensureCustomerNotifications(ctx.db, ctx.rng, customer.id)
    return { notifications: rows.map((r) => serialize(r, customer.id)) }
  },
}
