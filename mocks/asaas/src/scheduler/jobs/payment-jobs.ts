/**
 * Os jobs que movem as cobranças no tempo. (Track A)
 *
 * Ambos passam por `applyTransition` — nunca fazem UPDATE direto. É o que
 * garante que uma cobrança que vence pelo scheduler emita o mesmo webhook e o
 * mesmo lançamento que uma que vence por uma sandbox action.
 */
import { and, eq, isNull, lt, lte, ne, or } from 'drizzle-orm'
import { payments } from '../../db/schema/index.ts'
import { captureDue } from '../../modules/credit-cards/capture.ts'
import { applyTransition } from '../../modules/payments/apply.ts'
import type { Job } from '../scheduler.ts'

/**
 * A recurring card charge on and after its due date: the saved card is tried on
 * Asaas's schedule, and the charge goes OVERDUE only when the schedule runs out.
 * Runs on every tick (attempts fall at hours of the day) and before `overdue`.
 */
export const cardCapture: Job = {
  name: 'card-capture',
  async run({ ctx, report }) {
    await captureDue(ctx, report)
  },
}

/**
 * PENDING com dueDate < hoje → OVERDUE.
 *
 * A partir daqui, juros e multa começam a correr — mas o valor da cobrança só é
 * recalculado no momento do pagamento (é o que o Asaas faz: o `value` no banco
 * continua o original até alguém pagar).
 */
export const overdue: Job = {
  name: 'overdue',
  async run({ ctx, report }) {
    const today = ctx.clock.today()

    const due = await ctx.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'PENDING'),
          eq(payments.deleted, false),
          lt(payments.dueDate, today),
          // A recurring card charge is still being tried: card-capture owns it.
          or(
            ne(payments.billingType, 'CREDIT_CARD'),
            isNull(payments.creditCardId),
            isNull(payments.subscriptionId),
          ),
        ),
      )

    for (const { id } of due) {
      try {
        const r = await applyTransition(ctx, id, { kind: 'OVERDUE', on: today })
        report.transitions.push({
          resource: 'payment',
          id,
          from: r.from,
          to: r.to,
          job: 'overdue',
        })
      } catch (err) {
        // O CAS falha se algo mudou o status no meio — não é erro, é a proteção
        // funcionando. Só registramos.
        ctx.log('debug', `overdue: ${id} não transicionou`, { error: String(err) })
      }
    }
  },
}

/**
 * CONFIRMED cuja creditDate chegou → RECEIVED.
 *
 * É AQUI que o dinheiro vira saldo: a transição lança PAYMENT_RECEIVED (+bruto)
 * e PAYMENT_FEE (−taxa) no ledger, e emite o webhook.
 *
 * O Pix nunca passa por aqui — ele credita na hora do pagamento. Quem chega
 * aqui é o boleto (D+1 útil) e o cartão (D+32).
 */
export const creditSettlement: Job = {
  name: 'credit-settlement',
  async run({ ctx, report }) {
    const today = ctx.clock.today()

    const ready = await ctx.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'CONFIRMED'),
          eq(payments.deleted, false),
          lte(payments.estimatedCreditDate, today),
        ),
      )

    for (const { id } of ready) {
      try {
        const r = await applyTransition(ctx, id, { kind: 'SETTLE', on: today })
        report.transitions.push({
          resource: 'payment',
          id,
          from: r.from,
          to: r.to,
          job: 'credit-settlement',
        })
        report.ledgerEntries += 2 // PAYMENT_RECEIVED + PAYMENT_FEE
      } catch (err) {
        ctx.log('debug', `credit-settlement: ${id} não transicionou`, { error: String(err) })
      }
    }
  },
}
