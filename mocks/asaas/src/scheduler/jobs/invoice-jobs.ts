/**
 * Notas fiscais: the city hall's side and the calendar's. Every tick, in this
 * order, so each step of a note takes its own tick — the interval a real city
 * hall takes, which the integration has to live through:
 *
 *   1. PROCESSING_CANCELLATION → CANCELED          (the city hall cancels)
 *   2. SYNCHRONIZED → AUTHORIZED | ERROR           (the city hall answers)
 *   3. SCHEDULED of a removed charge → CANCELED    (nothing left to bill)
 *   4. subscription charges get their note         (from `invoiceSettings`)
 *   5. SCHEDULED due today → SYNCHRONIZED          (sent to the city hall)
 *
 * A note scheduled for today is therefore SYNCHRONIZED on the first tick and
 * AUTHORIZED on the next; `/_mock/invoices/:id/authorize` skips the wait.
 */
import { and, eq, inArray, lte, notExists } from 'drizzle-orm'
import {
  invoices,
  payments,
  subscriptionInvoiceConfigs,
  subscriptions,
} from '../../db/schema/index.ts'
import { ACTIVE, subscriptionInvoiceDate, type InvoiceTaxes } from '../../domain/invoice.ts'
import { cents, centsToBrl } from '../../domain/money.ts'
import {
  answerCancellation,
  answerInvoice,
  cancelInvoice,
  issueInvoice,
  PAID,
  scheduleInvoice,
} from '../../modules/invoices/service.ts'
import type { InvoiceRow } from '../../modules/invoices/serializer.ts'
import type { Job } from '../scheduler.ts'

export const invoiceIssuing: Job = {
  name: 'invoice-issuing',

  async run({ ctx, report }) {
    const today = ctx.clock.today()
    const moved = (row: InvoiceRow | null, from: string) => {
      if (row) {
        report.transitions.push({ resource: 'invoice', id: row.id, from, to: row.status, job: 'invoice-issuing' })
      }
    }

    // ── 1 and 2: the city hall answers what it was sent on an earlier tick ──
    const cancelling = await ctx.db.select().from(invoices).where(eq(invoices.status, 'PROCESSING_CANCELLATION'))
    for (const inv of cancelling) moved(await answerCancellation(ctx, inv), inv.status)

    const sent = await ctx.db.select().from(invoices).where(eq(invoices.status, 'SYNCHRONIZED'))
    for (const inv of sent) moved(await answerInvoice(ctx, inv), inv.status)

    // ── 3: a scheduled note of a removed charge has nothing left to bill ────
    // TODO(rule): researched — Asaas cancels the scheduled note with the charge.
    const orphaned = await ctx.db
      .select({ invoice: invoices })
      .from(invoices)
      .innerJoin(payments, eq(invoices.paymentId, payments.id))
      .where(and(eq(invoices.status, 'SCHEDULED'), eq(payments.deleted, true)))
    for (const { invoice } of orphaned) moved(await cancelInvoice(ctx, invoice), invoice.status)

    // ── 4: the subscription's automatic notes ───────────────────────────────
    const standing = ctx.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.paymentId, payments.id), inArray(invoices.status, ACTIVE)))
    const uncovered = await ctx.db
      .select({ payment: payments, config: subscriptionInvoiceConfigs, subscription: subscriptions })
      .from(payments)
      .innerJoin(subscriptionInvoiceConfigs, eq(subscriptionInvoiceConfigs.subscriptionId, payments.subscriptionId))
      .innerJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
      .where(and(eq(payments.deleted, false), notExists(standing)))

    for (const { payment: p, config: c, subscription: s } of uncovered) {
      const paid = PAID.includes(p.status)
      const paidOn = paid ? (p.clientPaymentDate ?? p.paymentDate ?? p.confirmedDate ?? today) : null
      const date = subscriptionInvoiceDate(c.invoiceCreationPeriod, p.dueDate, c.daysBeforeDueDate, paidOn, today)
      // A cancelled note of this charge stays cancelled: only charges never covered get one.
      const [cancelled] = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.paymentId, p.id), eq(invoices.status, 'CANCELED')))
        .limit(1)
      if (!date || cancelled) continue

      // One charge the city's rules refuse must not stop the others.
      const inv = await scheduleInvoice(ctx, p.accountId, {
        payment: p.id,
        serviceDescription: s.description ?? p.description ?? 'Assinatura',
        observations: c.observations ?? '',
        value: centsToBrl(cents(p.valueCents)),
        deductions: c.deductionsCents === null ? 0 : centsToBrl(cents(c.deductionsCents)),
        effectiveDate: date,
        municipalServiceId: c.municipalServiceId,
        municipalServiceCode: c.municipalServiceCode,
        municipalServiceName: c.municipalServiceName ?? c.municipalServiceCode ?? 'Serviço',
        updatePayment: c.updatePayment ?? false,
        taxes: (c.taxes as InvoiceTaxes | null) ?? { retainIss: false, iss: 0, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
      }).catch((err) => {
        ctx.log('warn', `Nota fiscal automática da cobrança ${p.id} recusada`, { error: String(err?.description ?? err) })
        return null
      })
      if (inv) report.created.push({ resource: 'invoice', id: inv.id, job: 'invoice-issuing' })
    }

    // ── 5: scheduled notes due today go to the city hall ────────────────────
    const due = await ctx.db
      .select({ invoice: invoices, paymentStatus: payments.status, receivedOnly: subscriptionInvoiceConfigs.receivedOnly })
      .from(invoices)
      .leftJoin(payments, eq(invoices.paymentId, payments.id))
      .leftJoin(subscriptionInvoiceConfigs, eq(subscriptionInvoiceConfigs.subscriptionId, payments.subscriptionId))
      .where(and(eq(invoices.status, 'SCHEDULED'), lte(invoices.effectiveDate, today)))
    for (const { invoice, paymentStatus, receivedOnly } of due) {
      // "Emitir somente após o pagamento": the note waits for the money.
      if (receivedOnly && !PAID.includes(paymentStatus ?? '')) continue
      moved(await issueInvoice(ctx, invoice, false), invoice.status)
    }
  },
}
