import { and, count, eq, inArray, sum } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { anticipations, payments } from '../../db/schema/index.ts'
import { cents, centsToBrl } from '../../domain/money.ts'
import type { HandlerMap } from '../../http/register.ts'
import { serializeAnticipation, type AnticipationRow } from './serializer.ts'
import {
  ANTICIPATION_LIMIT_CENTS,
  cancelAnticipation,
  getAutoConfig,
  requestAnticipation,
  resolveTarget,
  setAutoConfig,
} from './service.ts'

async function findOwned(
  ctx: AppContext,
  auth: AuthContext,
  id: string,
): Promise<AnticipationRow> {
  const [row] = await ctx.db
    .select()
    .from(anticipations)
    .where(and(eq(anticipations.id, id), eq(anticipations.accountId, auth.accountId)))
    .limit(1)
  if (!row) throw notFound('Antecipação')
  return row as AnticipationRow
}

/** How much of this account is already anticipated and has not settled yet. */
async function usedLimitCents(
  ctx: AppContext,
  accountId: string,
  billingType: string,
): Promise<number> {
  const [row] = await ctx.db
    .select({ total: sum(anticipations.valueCents) })
    .from(anticipations)
    .innerJoin(payments, eq(anticipations.paymentId, payments.id))
    .where(
      and(
        eq(anticipations.accountId, accountId),
        eq(payments.billingType, billingType),
        inArray(anticipations.status, ['PENDING', 'SCHEDULED', 'CREDITED']),
      ),
    )
  return Number(row?.total ?? 0)
}

export const anticipationHandlers: HandlerMap = {
  /**
   * POST /v3/anticipations — anticipate.
   *
   * The money comes in NOW if the charge is already confirmed. If it is still
   * pending (the payer did not pay), the anticipation is born SCHEDULED and
   * `anticipation-settlement` credits it when the payment is confirmed.
   */
  'request-anticipation': async ({ ctx, auth, body }) => {
    const target = await resolveTarget(ctx, auth, body, { simulate: false })
    return requestAnticipation(ctx, auth.accountId, target)
  },

  /**
   * POST /v3/anticipations/simulate — the same account, without writing anything.
   *
   * It is the endpoint the integrator calls to show the fee on the screen before
   * the merchant decides. If it diverged from the real POST, the integration
   * would lie to the user — that is why both go through the SAME quoting
   * function.
   */
  'simulate-anticipation': async ({ ctx, auth, body }) => {
    const { payment, quote } = await resolveTarget(ctx, auth, body, { simulate: true })

    return {
      installment: payment.installmentId,
      payment: payment.id,
      anticipationDate: ctx.clock.today(),
      dueDate: payment.estimatedCreditDate ?? payment.dueDate,
      fee: centsToBrl(quote.feeCents),
      anticipationDays: quote.anticipationDays,
      netValue: centsToBrl(quote.netValueCents),
      totalValue: centsToBrl(quote.totalValueCents),
      value: centsToBrl(quote.valueCents),
      // TODO(rule): the docs do not define when the document is required. A
      // confirmed credit card is certain money (the issuer already authorized
      // it); a pending bank slip depends on the payer paying, and that is where
      // Asaas asks for a fiscal note or a contract.
      isDocumentationRequired: payment.billingType !== 'CREDIT_CARD',
    }
  },

  'list-anticipations': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)

    const filters = [eq(anticipations.accountId, auth.accountId)]
    if (query.payment) filters.push(eq(anticipations.paymentId, String(query.payment)))
    if (query.installment) {
      filters.push(eq(anticipations.installmentId, String(query.installment)))
    }
    if (query.status) filters.push(eq(anticipations.status, String(query.status)))

    const where = and(...filters)

    const [total] = await ctx.db.select({ n: count() }).from(anticipations).where(where)
    const rows = await ctx.db
      .select()
      .from(anticipations)
      .where(where)
      .limit(limit)
      .offset(offset)

    return listEnvelope(
      rows.map((r) => serializeAnticipation(r as AnticipationRow)),
      total?.n ?? 0,
      limit,
      offset,
    )
  },

  'retrieve-a-single-anticipation': async ({ ctx, auth, params }) =>
    serializeAnticipation(await findOwned(ctx, auth, params.id!)),

  'cancel-anticipation': async ({ ctx, auth, params }) => {
    await findOwned(ctx, auth, params.id!) // 404 before 400
    return cancelAnticipation(ctx, auth, params.id!)
  },

  /**
   * GET /v3/anticipations/limits — how much can still be anticipated.
   *
   * TODO(rule): the real limit is a credit analysis of Asaas, with no public
   * formula. We use a fixed ceiling per type of receivable and subtract what is
   * already anticipated and has not settled yet. See progress.md.
   */
  'retrieve-anticipation-limits': async ({ ctx, auth }) => {
    const total = centsToBrl(ANTICIPATION_LIMIT_CENTS)

    const [creditCardUsed, bankSlipUsed] = await Promise.all([
      usedLimitCents(ctx, auth.accountId, 'CREDIT_CARD'),
      usedLimitCents(ctx, auth.accountId, 'BOLETO'),
    ])

    return {
      creditCard: {
        total,
        available: centsToBrl(cents(Math.max(0, ANTICIPATION_LIMIT_CENTS - creditCardUsed))),
      },
      bankSlip: {
        total,
        available: centsToBrl(cents(Math.max(0, ANTICIPATION_LIMIT_CENTS - bankSlipUsed))),
      },
    }
  },

  'retrieve-status-of-automatic-anticipation': async ({ ctx, auth }) =>
    getAutoConfig(ctx.db, auth.accountId),

  /**
   * PUT /v3/anticipations/configurations — turns the automatic credit card
   * anticipation on and off. The flag is NOT decorative: with it on,
   * `anticipation-settlement` anticipates on its own every card charge that
   * gets confirmed. A boolean that does nothing would be false confidence.
   */
  'update-status-of-automatic-anticipation': async ({ ctx, auth, body }) => {
    const b = (body ?? {}) as Record<string, any>
    return setAutoConfig(ctx, auth.accountId, b.creditCardAutomaticEnabled === true)
  },
}
