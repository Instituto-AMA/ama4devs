/**
 * Mock control routes. NOT part of the Asaas API.
 *
 * One POST per payment outcome, no `access_token`, the payment found by id in
 * any account. Every action goes through `applyTransition`, so the ledger and
 * the webhook queue move exactly as in the real flows.
 *
 * Mounted next to `/_admin`, behind the same `adminEnabled` gate.
 */
import { and, count, desc, eq, type SQL } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { AppContext } from '../core/context.ts'
import { notFound } from '../core/errors.ts'
import { payments } from '../db/schema/index.ts'
import { brlToCents } from '../domain/money.ts'
import type { Trigger } from '../domain/payment-machine.ts'
import { applyTransition, type TransitionResult } from '../modules/payments/apply.ts'
import { serializePayment, type PaymentRow } from '../modules/payments/serializer.ts'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export function mockRoutes(ctx: AppContext) {
  const app = new Elysia({ name: 'mock-controls', prefix: '/_mock' })

  if (!ctx.config.adminEnabled) return app

  /** Runs one transition on a payment of any account and shapes the response. */
  const act = async (id: string, trigger: Trigger) => shape(await applyTransition(ctx, id, trigger))

  const shape = async (r: TransitionResult) => {
    return {
      payment: await serializePayment(ctx.db, r.payment),
      from: r.from,
      to: r.to,
      events: r.events,
    }
  }

  /** 404 in the Asaas error format when the id matches no payment, in any account. */
  const assertExists = async (id: string) => {
    const [row] = await ctx.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1)
    if (!row) throw notFound('Cobrança')
  }

  const withPayment =
    (build: (id: string, body: any) => Trigger) =>
    async ({ params, body }: { params: { id: string }; body: any }) => {
      await assertExists(params.id)
      return act(params.id, build(params.id, body))
    }

  const today = () => ctx.clock.today()
  const params = t.Object({ id: t.String() })

  // `fail` is an alias of `overdue` for every billing type: the settlement
  // failure the app sees from Asaas is the PAYMENT_OVERDUE event.
  const overdue = withPayment(() => ({ kind: 'OVERDUE', on: today() }))

  return app
    .get(
      '/payments',
      async ({ query }) => {
        const asked = Number(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT
        const limit = Math.min(Math.max(asked, 1), MAX_LIMIT)
        const offset = Math.max(Number(query.offset ?? 0) || 0, 0)

        const conds: SQL[] = [eq(payments.deleted, false)]
        if (query.status) conds.push(eq(payments.status, query.status))
        const where = and(...conds)

        const [counted] = await ctx.db.select({ total: count() }).from(payments).where(where)
        const total = counted?.total ?? 0
        const rows = await ctx.db
          .select()
          .from(payments)
          .where(where)
          .orderBy(desc(payments.createdAtMs), desc(payments.id))
          .limit(limit)
          .offset(offset)

        return {
          object: 'list',
          hasMore: offset + rows.length < total,
          totalCount: total,
          limit,
          offset,
          data: await Promise.all(rows.map((r) => serializePayment(ctx.db, r as PaymentRow))),
        }
      },
      {
        query: t.Object({
          status: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      },
    )
    .post(
      '/payments/:id/confirm',
      withPayment(() => ({ kind: 'PAY', on: today() })),
      { params },
    )
    .post(
      '/payments/:id/receive',
      async ({ params: p }) => {
        await assertExists(p.id)
        const paid = await applyTransition(ctx, p.id, { kind: 'PAY', on: today() })
        if (paid.to !== 'CONFIRMED') return shape(paid)

        // Boleto/card stop at CONFIRMED: settle now, on the payment's own credit date.
        const settled = await applyTransition(ctx, p.id, {
          kind: 'SETTLE',
          on: paid.payment.creditDate ?? today(),
        })
        return shape({ ...settled, from: paid.from, events: [...paid.events, ...settled.events] })
      },
      { params },
    )
    .post('/payments/:id/overdue', overdue, { params })
    .post('/payments/:id/fail', overdue, { params })
    .post(
      '/payments/:id/refund',
      withPayment((_id, body) => ({
        kind: 'REFUND',
        on: today(),
        ...(body?.value !== undefined ? { value: brlToCents(body.value) } : {}),
      })),
      { params, body: t.Optional(t.Object({ value: t.Optional(t.Number()) })) },
    )
}
