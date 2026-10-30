/**
 * The queries of the splits. (Track F)
 *
 * Two views of the SAME record, and the difference is the point:
 *
 *   /v3/payments/splits/paid      → what LEFT this account (I am the origin)
 *   /v3/payments/splits/received  → what ARRIVED in this account (I am the destination)
 *
 * The same row of `payment_splits` shows up in the two lists — in the account of
 * the origin as "paid" and in the one of the destination as "received". That is
 * why the subaccount with an API key of its own is not a detail of
 * convenience: without it, `received` would always be empty and half of the
 * resource would have no way to be tested.
 */
import { and, count, eq, gte, lte, type SQL } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { payments, paymentSplits } from '../../db/schema/index.ts'
import { cents, centsToBrl } from '../../domain/money.ts'
import type { HandlerMap } from '../../http/register.ts'

type SplitRow = typeof paymentSplits.$inferSelect
type PaymentRow = typeof payments.$inferSelect

const money = (v: number | null): number | null => (v === null ? null : centsToBrl(cents(v)))

/**
 * The boundary: cents become reais, and the percentage comes out of the 1e4
 * scale. 923444 → 92.3444 (four decimal places, as in Asaas).
 */
function serializeSplit(s: SplitRow, p: PaymentRow): Record<string, unknown> {
  return {
    id: s.id,
    walletId: s.walletId,
    fixedValue: money(s.fixedValueCents),
    percentualValue: s.percentualValueE4 === null ? null : s.percentualValueE4 / 10_000,
    totalValue: money(s.totalValueCents),
    cancellationReason: s.cancellationReason,
    status: s.status,
    externalReference: s.externalReference,
    description: s.description,

    // Who paid and who received. `destinationAccountId` is null when the walletId
    // belongs to an external wallet — in that case there is no account on this
    // server.
    originAccountId: p.accountId,
    destinationAccountId: s.recipientAccountId,

    creditDate: s.creditDate,
    payment: {
      confirmedDate: p.confirmedDate,
      invoiceNumber: p.invoiceNumber,
      externalReference: p.externalReference,
    },
  }
}

/** The filters the spec declares in the two listings. */
function splitFilters(query: Record<string, unknown>): SQL[] {
  const filters: SQL[] = []

  if (query.paymentId) filters.push(eq(paymentSplits.paymentId, String(query.paymentId)))
  if (query.status) filters.push(eq(paymentSplits.status, String(query.status)))

  if (query['creditDate[ge]']) {
    filters.push(gte(paymentSplits.creditDate, String(query['creditDate[ge]'])))
  }
  if (query['creditDate[le]']) {
    filters.push(lte(paymentSplits.creditDate, String(query['creditDate[le]'])))
  }
  if (query['paymentConfirmedDate[ge]']) {
    filters.push(gte(payments.confirmedDate, String(query['paymentConfirmedDate[ge]'])))
  }
  if (query['paymentConfirmedDate[le]']) {
    filters.push(lte(payments.confirmedDate, String(query['paymentConfirmedDate[le]'])))
  }

  return filters
}

async function listSplits(
  ctx: AppContext,
  query: Record<string, unknown>,
  scope: SQL,
): Promise<unknown> {
  const { limit, offset } = paginationParams(query)
  const where = and(scope, ...splitFilters(query))

  const [total] = await ctx.db
    .select({ n: count() })
    .from(paymentSplits)
    .innerJoin(payments, eq(paymentSplits.paymentId, payments.id))
    .where(where)

  const rows = await ctx.db
    .select({ split: paymentSplits, payment: payments })
    .from(paymentSplits)
    .innerJoin(payments, eq(paymentSplits.paymentId, payments.id))
    .where(where)
    .limit(limit)
    .offset(offset)

  const data = rows.map((r) => serializeSplit(r.split, r.payment))
  return listEnvelope(data, total?.n ?? 0, limit, offset)
}

async function findSplit(ctx: AppContext, id: string, scope: SQL): Promise<unknown> {
  const [row] = await ctx.db
    .select({ split: paymentSplits, payment: payments })
    .from(paymentSplits)
    .innerJoin(payments, eq(paymentSplits.paymentId, payments.id))
    .where(and(eq(paymentSplits.id, id), scope))
    .limit(1)

  // 404, not 403: a split of another account simply DOES NOT EXIST for you —
  // the API neither confirms nor denies. It is what Asaas does.
  if (!row) throw notFound('Split')
  return serializeSplit(row.split, row.payment)
}

/** I am the ORIGIN: the split left from one of my charges. */
const paidScope = (auth: AuthContext): SQL => eq(payments.accountId, auth.accountId)

/** I am the DESTINATION: the wallet of the split is the one of my account. */
const receivedScope = (auth: AuthContext): SQL =>
  eq(paymentSplits.recipientAccountId, auth.accountId)

export const splitHandlers: HandlerMap = {
  'list-paid-splits': ({ ctx, auth, query }) => listSplits(ctx, query, paidScope(auth)),

  'retrieve-a-single-paid-split': ({ ctx, auth, params }) =>
    findSplit(ctx, params.id!, paidScope(auth)),

  'list-received-splits': ({ ctx, auth, query }) => listSplits(ctx, query, receivedScope(auth)),

  'retrieve-a-single-received-split': ({ ctx, auth, params }) =>
    findSplit(ctx, params.id!, receivedScope(auth)),
}
