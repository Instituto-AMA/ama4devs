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
import { invoices, payments } from '../db/schema/index.ts'
import { brlToCents } from '../domain/money.ts'
import type { Trigger } from '../domain/payment-machine.ts'
import { applyTransition, type TransitionResult } from '../modules/payments/apply.ts'
import { recordWhatsappWebhook } from '../notify/inbound.ts'
import { serializePayment, type PaymentRow } from '../modules/payments/serializer.ts'
import { serializeInvoice, type InvoiceRow } from '../modules/invoices/serializer.ts'
import {
  answerCancellation,
  answerInvoice,
  issueInvoice,
  refuseInvoice,
} from '../modules/invoices/service.ts'
import { badRequest } from '../core/errors.ts'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export function mockRoutes(ctx: AppContext) {
  const app = new Elysia({ name: 'mock-controls', prefix: '/_mock' })

  if (!ctx.config.adminEnabled) return app

  /** 404 in the Asaas error format when the id matches no payment, in any account. */
  const assertExists = async (id: string) => {
    const [row] = await ctx.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1)
    if (!row) throw notFound('Cobrança')
  }

  /**
   * The single shape of a mock action: the payment it ended at, the status it
   * came from, the status it went to and the events it queued. An action with
   * two transitions (`receive`) merges them: the first status, the last one and
   * every event, in order.
   */
  const shape = async (results: TransitionResult[]) => {
    const first = results[0]!
    const last = results[results.length - 1]!
    return {
      payment: await serializePayment(ctx.db, last.payment),
      from: first.from,
      to: last.to,
      events: results.flatMap((r) => r.events),
    }
  }

  /**
   * One action on a payment of any account: the payment must exist, the
   * trigger comes from the body, and the answer is the single mock shape.
   *
   * `settle` is the second transition of the actions that need one: only
   * `receive` has it, and only when the first transition stopped at CONFIRMED.
   */
  const withPayment =
    (build: (body: any) => Trigger, settle?: (first: TransitionResult) => Trigger | null) =>
    async ({ params, body }: { params: { id: string }; body: any }) => {
      await assertExists(params.id)
      const results = [await applyTransition(ctx, params.id, build(body))]

      const second = settle?.(results[0]!)
      if (second) results.push(await applyTransition(ctx, params.id, second))

      return shape(results)
    }

  const today = () => ctx.clock.today()
  const params = t.Object({ id: t.String() })

  // `fail` is an alias of `overdue` for every billing type: the settlement
  // failure the app sees from Asaas is the PAYMENT_OVERDUE event. The mock adds
  // no event Asaas does not have.
  const overdue = withPayment(() => ({ kind: 'OVERDUE', on: today() }))

  /**
   * The city hall's answer to a note, now instead of on the next tick. The
   * note's own transitions (service.ts), so the INVOICE_* events are the same.
   * `wanted` is where the note must be; anything else is a 400.
   */
  const withInvoice =
    (wanted: string[], act: (inv: InvoiceRow, body: any) => Promise<InvoiceRow | null>) =>
    async ({ params, body }: { params: { id: string }; body: any }) => {
      const [inv] = await ctx.db.select().from(invoices).where(eq(invoices.id, params.id)).limit(1)
      if (!inv) throw notFound('Nota fiscal')
      if (!wanted.includes(inv.status)) {
        throw badRequest('invalid_action', `A nota fiscal está ${inv.status}; esta ação pede ${wanted.join(' ou ')}.`)
      }
      const after = await act(inv, body ?? {})
      if (!after) throw badRequest('invalid_action', 'A nota fiscal mudou de situação. Consulte-a de novo.')
      return { invoice: serializeInvoice(after), from: inv.status, to: after.status }
    }
  const reason = t.Optional(t.Object({ description: t.Optional(t.String()) }))

  return app
    // ── Notas fiscais: the city hall, on demand ──────────────────────────────
    // Authorizes regardless of the fiscal information: the outcome is forced.
    .post(
      '/invoices/:id/authorize',
      withInvoice(['SCHEDULED', 'ERROR', 'SYNCHRONIZED'], async (inv) => {
        const sent = inv.status === 'SYNCHRONIZED' ? inv : await issueInvoice(ctx, inv)
        return answerInvoice(ctx, sent, true)
      }),
      { params },
    )
    .post(
      '/invoices/:id/error',
      withInvoice(['SCHEDULED', 'SYNCHRONIZED'], async (inv, body) => {
        const sent = inv.status === 'SYNCHRONIZED' ? inv : await issueInvoice(ctx, inv)
        return refuseInvoice(ctx, sent, body.description ?? 'Rejeitada pela prefeitura: inscrição municipal não encontrada.')
      }),
      { params, body: reason },
    )
    .post(
      '/invoices/:id/confirm-cancellation',
      withInvoice(['PROCESSING_CANCELLATION'], (inv) => answerCancellation(ctx, inv)),
      { params },
    )
    .post(
      '/invoices/:id/deny-cancellation',
      withInvoice(['PROCESSING_CANCELLATION'], (inv, body) =>
        answerCancellation(ctx, inv, body.description ?? 'Cancelamento negado pela prefeitura: prazo de cancelamento expirado.'),
      ),
      { params, body: reason },
    )
    // The sender number's webhook in the WhatsApp mock (registered on boot by
    // src/notify/channels.ts): GET is Meta's verification, POST the statuses and replies.
    .get('/whatsapp/webhook', ({ query }) => String(query['hub.challenge'] ?? 'ok'))
    .post('/whatsapp/webhook', ({ body }) => ({
      received: recordWhatsappWebhook(body, ctx.clock.timestamp()),
    }))
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
      withPayment(
        () => ({ kind: 'PAY', on: today() }),
        // Boleto/card stop at CONFIRMED: settle now, on the payment's own credit date.
        (first) =>
          first.to === 'CONFIRMED'
            ? { kind: 'SETTLE', on: first.payment.creditDate ?? today() }
            : null,
      ),
      { params },
    )
    .post('/payments/:id/overdue', overdue, { params })
    .post('/payments/:id/fail', overdue, { params })
    .post(
      '/payments/:id/refund',
      withPayment((body) => ({
        kind: 'REFUND',
        on: today(),
        ...(body?.value !== undefined ? { value: brlToCents(body.value) } : {}),
      })),
      { params, body: t.Optional(t.Object({ value: t.Optional(t.Number()) })) },
    )
}
