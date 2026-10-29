/**
 * Resetting a profile: the account stays — same id, wallet, API keys, KYC and
 * settings, so the integrating app's configuration keeps working — and what it
 * accumulated goes, group by group. NOT an Asaas operation: Asaas has no way to
 * empty an account, so this lives under /_admin with the rest of the
 * simulator's controls.
 *
 * Each group empties its tables for the profile AND its subaccounts: a split
 * leaves money in both statements, and zeroing only one would leave the other
 * pointing at charges that no longer exist.
 *
 * `cancelCharges` first takes the open charges, the subscriptions and the notes
 * through the same path as `DELETE /v3/payments/{id}`,
 * `DELETE /v3/subscriptions/{id}` and `POST /v3/invoices/{id}/cancel`, and sends
 * the webhooks that path sends, BEFORE anything is deleted: the app on the other
 * side hears PAYMENT_DELETED, SUBSCRIPTION_DELETED and INVOICE_CANCELED and can
 * close its own records, as it would at Asaas.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AppContext } from '../core/context.ts'
import { badRequest, notFound } from '../core/errors.ts'
import {
  accounts,
  installments,
  invoices,
  payments,
  subscriptions,
  webhookDeliveries,
  webhookEvents,
} from '../db/schema/index.ts'
import { answerCancellation, cancelInvoice } from '../modules/invoices/service.ts'
import { applyTransition } from '../modules/payments/apply.ts'
import { removeSubscription } from '../modules/subscriptions/service.ts'
import { familyOf, purgeRows, tableShapes } from './profiles.ts'

export const RESET_GROUPS = [
  'customers',
  'subaccounts',
  'charges',
  'invoices',
  'webhooks',
  'logs',
] as const
export type ResetGroup = (typeof RESET_GROUPS)[number]

/**
 * The tables each group empties. Tables of the same parent go together: the
 * splits of a payment, the images of a payment link and the notifications of a
 * customer have no `account_id` and leave with the row they hang from.
 */
export const GROUP_TABLES: Record<Exclude<ResetGroup, 'subaccounts'>, string[]> = {
  customers: ['customers', 'credit_cards'],
  // The charges and the money they moved: a statement line names its charge,
  // so the two leave together and every balance goes back to zero.
  charges: [
    'payments',
    'installments',
    'subscriptions',
    'subscription_invoice_configs',
    'payment_links',
    'checkouts',
    'pix_qr_codes',
    'pix_transactions',
    'chargebacks',
    'payment_dunnings',
    'payment_documents',
    'credit_bureau_reports',
    'financial_transactions',
    'transfers',
    'anticipations',
    'bills',
    'mobile_phone_recharges',
  ],
  invoices: ['invoices'],
  // A delivery points at its webhook, so it leaves with it.
  webhooks: ['webhooks', 'webhook_deliveries'],
  logs: ['webhook_events', 'webhook_deliveries', 'request_logs', 'notification_deliveries'],
}

/** What a reset never touches: the account as Asaas opened it. */
export const KEPT_TABLES = [
  'api_keys',
  'account_checkout_configs',
  'account_disablements',
  'account_document_groups',
  'account_documents',
  'fiscal_info',
  'pix_keys',
]

/**
 * The groups a chosen one cannot leave behind: a charge, a subscription and a
 * saved card name their customer, and an invoice names its charge.
 */
const IMPLIES: Partial<Record<ResetGroup, ResetGroup[]>> = {
  customers: ['charges', 'invoices'],
  charges: ['invoices'],
}

export interface ResetInput {
  /** Removes the open charges and subscriptions through the API path first, with their webhooks. */
  cancelCharges?: boolean
  remove?: Partial<Record<ResetGroup, boolean>>
}

export interface ResetResult {
  id: string
  /** The groups emptied, the implied ones included. */
  removed: ResetGroup[]
  cancelled: {
    payments: number
    subscriptions: number
    installments: number
    invoices: number
    /** Webhook deliveries of the cancellation events, by outcome. */
    webhooks: { delivered: number; notDelivered: number }
  } | null
  /** Subaccounts closed, with everything they owned. */
  subaccounts: number
  rows: number
}

/** The chosen groups plus what they drag along, in the declared order. */
export function resolveGroups(remove: ResetInput['remove']): ResetGroup[] {
  const chosen = new Set(RESET_GROUPS.filter((g) => remove?.[g]))
  for (const g of [...chosen]) for (const i of IMPLIES[g] ?? []) chosen.add(i)
  return RESET_GROUPS.filter((g) => chosen.has(g))
}

export async function resetProfile(
  ctx: AppContext,
  accountId: string,
  input: ResetInput,
  /** Sends the deliveries already due (the scheduler's `dispatchNow`). */
  dispatch: () => Promise<void>,
): Promise<ResetResult> {
  const [account] = await ctx.db
    .select({ id: accounts.id, parentAccountId: accounts.parentAccountId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
  if (!account) throw notFound('Perfil')
  if (account.parentAccountId) {
    throw badRequest('invalid_account', 'Só um perfil (conta raiz) pode ser zerado.')
  }

  const groups = resolveGroups(input.remove)
  if (groups.length === 0 && !input.cancelCharges) {
    throw badRequest('invalid_reset', 'Escolha o que cancelar ou apagar.')
  }

  const family = await familyOf(ctx, account.id)
  const cancelled = input.cancelCharges
    ? await cancelCharges(ctx, family, dispatch, groups.includes('invoices'))
    : null

  const subs = family.filter((id) => id !== account.id)
  const closing = groups.includes('subaccounts') ? subs : []
  const kept = family.filter((id) => !closing.includes(id))

  const shapes = await tableShapes(ctx)
  const owned = new Set(shapes.filter((s) => s.ownedByAccount).map((s) => s.name))
  const tables = new Set(
    groups.flatMap((g) => (g === 'subaccounts' ? [] : GROUP_TABLES[g])).filter((t) => owned.has(t)),
  )

  // Synchronous on purpose, like `deleteProfile`: an async body would commit at
  // its first `await` and lose the deferred foreign-key check.
  let rows = 0
  ctx.db.transaction((tx) => {
    tx.run(sql`PRAGMA defer_foreign_keys = ON`)

    if (closing.length > 0) {
      rows += purgeRows(tx, shapes, owned, closing)
      tx.delete(accounts).where(inArray(accounts.id, closing)).run()
    }

    if (tables.size > 0) rows += purgeRows(tx, shapes, tables, kept)

    // The statement is gone, so the balance it summed is zero.
    if (groups.includes('charges')) {
      tx.update(accounts).set({ balanceCents: 0 as never }).where(inArray(accounts.id, kept)).run()
    }
  })

  ctx.log('info', `Perfil ${account.id} zerado: ${groups.join(', ') || 'só cancelamento'}`)
  return { id: account.id, removed: groups, cancelled, subaccounts: closing.length, rows }
}

/**
 * Removes the open subscriptions, installments and charges of the family the way
 * the API does, cancels its notes, then sends the deliveries those removals
 * queued. Paid charges stay: Asaas does not remove a charge whose money came in.
 *
 * A note issued at the city hall asks for its cancellation (PROCESSING_CANCELLATION);
 * when the notes are about to be deleted (`settle`), the city hall's answer is
 * taken now, so INVOICE_CANCELED goes out before the delete. A note still at the
 * city hall (SYNCHRONIZED) cannot be cancelled and is left as it is.
 */
async function cancelCharges(
  ctx: AppContext,
  family: string[],
  dispatch: () => Promise<void>,
  settle: boolean,
): Promise<NonNullable<ResetResult['cancelled']>> {
  // The events this cancellation emits are the ones after this row.
  const [mark] = await ctx.db.all<{ n: number | null }>(
    sql`select max(rowid) as n from webhook_events`,
  )
  const after = mark?.n ?? 0

  const subs = await ctx.db
    .select()
    .from(subscriptions)
    .where(and(inArray(subscriptions.accountId, family), eq(subscriptions.deleted, false)))
  const notes = await ctx.db
    .select()
    .from(invoices)
    .where(
      and(
        inArray(invoices.accountId, family),
        inArray(invoices.status, ['SCHEDULED', 'ERROR', 'AUTHORIZED', 'CANCELLATION_DENIED']),
      ),
    )
  for (const note of notes) {
    const after = await cancelInvoice(ctx, note)
    if (settle && after.status === 'PROCESSING_CANCELLATION') await answerCancellation(ctx, after)
  }

  let subscriptionCharges = 0
  for (const sub of subs) subscriptionCharges += await removeSubscription(ctx, sub)

  const open = await ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        inArray(payments.accountId, family),
        eq(payments.deleted, false),
        inArray(payments.status, ['PENDING', 'OVERDUE']),
      ),
    )
  for (const p of open) await applyTransition(ctx, p.id, { kind: 'DELETE' })

  const removedInstallments = await ctx.db
    .update(installments)
    .set({ deleted: true })
    .where(and(inArray(installments.accountId, family), eq(installments.deleted, false)))
    .returning({ id: installments.id })

  // Out before the delete that follows can take the queue with it.
  await dispatch()

  const outcomes = await ctx.db
    .select({ status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
    .where(
      and(
        inArray(webhookEvents.accountId, family),
        sql`webhook_events.rowid > ${after}`,
      ),
    )
  const delivered = outcomes.filter((o) => o.status === 'DELIVERED').length

  return {
    payments: subscriptionCharges + open.length,
    subscriptions: subs.length,
    installments: removedInstallments.length,
    invoices: notes.length,
    webhooks: { delivered, notDelivered: outcomes.length - delivered },
  }
}
