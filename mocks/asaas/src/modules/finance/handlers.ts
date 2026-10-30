/**
 * Finance — balance, statement and statistics. (Track D)
 *
 * Nothing here WRITES. This module is the window to what the ledger already
 * recorded: `accounts.balanceCents` is a materialized balance, written only by
 * `postEntries()`, and `financial_transactions` is append-only. If a number looks
 * wrong, the bug is in whoever posted it — not here.
 */
import { and, asc, count, desc, eq, gte, inArray, lte, sum } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import {
  accounts,
  financialTransactions,
  payments,
  paymentSplits,
} from '../../db/schema/index.ts'
import { isValidIsoDate } from '../../domain/calendar.ts'
import { cents, centsToBrl } from '../../domain/money.ts'
import type { HandlerMap } from '../../http/register.ts'

type FinancialTransactionRow = typeof financialTransactions.$inferSelect

const money = (v: number | null): number | null => (v === null ? null : centsToBrl(cents(v)))

/** Splits that are still going to move. A DONE split already became an entry in the statement. */
const OPEN_SPLIT_STATUSES = ['PENDING', 'PROCESSING', 'AWAITING_CREDIT'] as const

async function balanceOf(ctx: AppContext, accountId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ balanceCents: accounts.balanceCents })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
  if (!row) throw notFound('Conta')
  return row.balanceCents
}

/**
 * One line of the statement, in the exact format of Asaas.
 *
 * `balance` is the balance AFTER this entry — not the current balance of the
 * account. It is what makes it possible to audit the statement line by line, and
 * it is the reason `balanceCents` is written along with the entry instead of
 * being recalculated on the read.
 */
function serializeTransaction(t: FinancialTransactionRow): Record<string, unknown> {
  return {
    object: 'financialTransaction',
    id: t.id,
    value: money(t.valueCents),
    balance: money(t.balanceCents),
    type: t.type,
    date: t.date,
    description: t.description,
    paymentId: t.paymentId,
    splitId: t.splitId,
    transferId: t.transferId,
    anticipationId: t.anticipationId,
    billId: t.billId,
    invoiceId: t.invoiceId,
    paymentDunningId: t.paymentDunningId,
    creditBureauReportId: t.creditBureauReportId,
  }
}

function isoDateParam(query: Record<string, unknown>, key: string): string | undefined {
  const raw = query[key]
  if (raw === undefined || raw === '') return undefined
  const s = String(raw)
  if (!isValidIsoDate(s)) throw invalid(key, `A data informada em "${key}" é inválida.`)
  return s
}

export const financeHandlers: HandlerMap = {
  /**
   * GET /v3/finance/balance → { "balance": 5210.96 }
   *
   * ONLY the `balance` field. It is the simplest endpoint of the API and the
   * easiest to decorate by mistake — one field more here and the client that
   * does `Object.keys(res).length === 1` breaks.
   */
  'retrieve-account-balance': async ({ ctx, auth }) => ({
    balance: centsToBrl(cents(await balanceOf(ctx, auth.accountId))),
  }),

  /**
   * GET /v3/financialTransactions — the statement.
   *
   * Ordered by `seq` (insertion order), not by `date`: two entries of the same
   * day — PAYMENT_RECEIVED and PAYMENT_FEE — have the same date, and ordering by
   * date would leave the `balance` column out of order, which is exactly what
   * the statement exists to show.
   *
   * The DEFAULT order is `desc` — the newest first. The docs do not say, and we
   * had chosen `asc` because it looked more logical (the `balance` column reads
   * better from top to bottom). The capture (tools/probe-pix.ts) showed the
   * opposite: the real statement returns today's fee before the entry from May.
   *
   * It is not cosmetic: whoever reads `data[0]` to get "the latest entry" — and
   * that is what one does with a statement — would get the FIRST of the life of
   * the account here, and the most recent one in Asaas.
   */
  'retrieve-extract': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)

    const startDate = isoDateParam(query, 'startDate')
    const finishDate = isoDateParam(query, 'finishDate')

    const order = String(query.order ?? 'desc').toLowerCase()
    if (order !== 'asc' && order !== 'desc') {
      throw invalid('order', 'A ordenação deve ser "asc" ou "desc".')
    }

    const filters = [eq(financialTransactions.accountId, auth.accountId)]
    if (startDate) filters.push(gte(financialTransactions.date, startDate))
    if (finishDate) filters.push(lte(financialTransactions.date, finishDate))

    const where = and(...filters)

    const [total] = await ctx.db
      .select({ n: count() })
      .from(financialTransactions)
      .where(where)

    const rows = await ctx.db
      .select()
      .from(financialTransactions)
      .where(where)
      .orderBy(
        order === 'desc' ? desc(financialTransactions.seq) : asc(financialTransactions.seq),
      )
      .limit(limit)
      .offset(offset)

    return listEnvelope(rows.map(serializeTransaction), total?.n ?? 0, limit, offset)
  },

  /**
   * GET /v3/finance/payment/statistics — quantity and sum of the charges that
   * match the filter. The same filters as GET /v3/payments.
   */
  'billing-statistics': async ({ ctx, auth, query }) => {
    const filters = [
      eq(payments.accountId, auth.accountId),
      eq(payments.deleted, false),
    ]

    if (query.customer) filters.push(eq(payments.customerId, String(query.customer)))
    if (query.billingType) filters.push(eq(payments.billingType, String(query.billingType)))
    if (query.status) filters.push(eq(payments.status, String(query.status)))
    if (query.anticipated !== undefined && query.anticipated !== '') {
      filters.push(eq(payments.anticipated, String(query.anticipated) === 'true'))
    }
    if (query.externalReference) {
      filters.push(eq(payments.externalReference, String(query.externalReference)))
    }

    const ranges = [
      ['dueDate', payments.dueDate],
      ['dateCreated', payments.dateCreated],
      ['estimatedCreditDate', payments.estimatedCreditDate],
    ] as const

    for (const [name, column] of ranges) {
      const ge = isoDateParam(query, `${name}[ge]`)
      const le = isoDateParam(query, `${name}[le]`)
      if (ge) filters.push(gte(column, ge))
      if (le) filters.push(lte(column, le))
    }

    const [row] = await ctx.db
      .select({
        quantity: count(),
        value: sum(payments.valueCents),
        netValue: sum(payments.netValueCents),
      })
      .from(payments)
      .where(and(...filters))

    // SUM() of zero rows is NULL in SQLite — it becomes 0, not null.
    return {
      quantity: row?.quantity ?? 0,
      value: centsToBrl(cents(Number(row?.value ?? 0))),
      netValue: centsToBrl(cents(Number(row?.netValue ?? 0))),
    }
  },

  /**
   * GET /v3/finance/split/statistics — the splits that are still going to move.
   *
   * TODO(rule): the spec gives only two fields and two one-line descriptions
   * ("Amounts receivable" and "Values to be sent"), without saying which statuses
   * go into the count. We read it as:
   *   income → what THIS account has to RECEIVE from splits of other charges;
   *   value  → what THIS account has to PAY from splits of its own charges.
   * In both, only the splits still open (PENDING/PROCESSING/AWAITING_CREDIT): a
   * DONE split already became an entry in the statement, and counting it here
   * would count the same money twice.
   */
  'retrieve-split-values': async ({ ctx, auth }) => {
    const [income] = await ctx.db
      .select({ total: sum(paymentSplits.totalValueCents) })
      .from(paymentSplits)
      .where(
        and(
          eq(paymentSplits.recipientAccountId, auth.accountId),
          inArray(paymentSplits.status, [...OPEN_SPLIT_STATUSES]),
        ),
      )

    const [outcome] = await ctx.db
      .select({ total: sum(paymentSplits.totalValueCents) })
      .from(paymentSplits)
      .innerJoin(payments, eq(paymentSplits.paymentId, payments.id))
      .where(
        and(
          eq(payments.accountId, auth.accountId),
          inArray(paymentSplits.status, [...OPEN_SPLIT_STATUSES]),
        ),
      )

    return {
      income: centsToBrl(cents(Number(income?.total ?? 0))),
      value: centsToBrl(cents(Number(outcome?.total ?? 0))),
    }
  },
}
