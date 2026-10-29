/**
 * Nota fiscal: every change of a note goes through here — the API handlers, the
 * scheduler job, the `/_mock` controls and the profile reset — so each one
 * emits the same INVOICE_* event the same way.
 *
 * A change is compare-and-swap (`WHERE id = ? AND status IN (...)`) and its
 * event is emitted in the same transaction: a second tick on the same note
 * changes nothing and sends nothing.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { badRequest, invalid, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { customers, fiscalInfo, installments, invoices, payments } from '../../db/schema/index.ts'
import { isValidIsoDate } from '../../domain/calendar.ts'
import { calcFee, netValue } from '../../domain/fees.ts'
import {
  ACTIVE,
  CANCEL_AT_CITY_HALL,
  CANCEL_AT_ONCE,
  invalidTaxField,
  ISSUABLE,
  retainedTaxesCents,
  UPDATABLE,
  type InvoiceStatus,
  type InvoiceTaxes,
} from '../../domain/invoice.ts'
import { brlToCents, cents, type Cents } from '../../domain/money.ts'
import { serializePayment, type PaymentRow } from '../payments/serializer.ts'
import { serializeInvoice, type InvoiceRow } from './serializer.ts'

/** Charges whose money came in: the ones a "received only" note waits for. */
export const PAID = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']
const OPEN = ['PENDING', 'OVERDUE']

/** The fields of a schedule or an update, already parsed. */
export interface InvoiceInput {
  payment?: string
  installment?: string
  customer?: string
  serviceDescription?: string
  observations?: string
  externalReference?: string | null
  value?: number
  deductions?: number
  effectiveDate?: string
  municipalServiceId?: string | null
  municipalServiceCode?: string | null
  municipalServiceName?: string | null
  updatePayment?: boolean
  taxes?: InvoiceTaxes
}

export async function findInvoice(ctx: AppContext, accountId: string, id: string): Promise<InvoiceRow> {
  const [row] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.accountId, accountId)))
    .limit(1)
  if (!row) throw notFound('Nota fiscal')
  return row
}

/**
 * Moves a note from one of `from` to `to` and emits `event`, in one
 * transaction. Returns null when the note was no longer in `from`.
 */
async function move(
  ctx: AppContext,
  id: string,
  from: InvoiceStatus[],
  patch: Partial<InvoiceRow> & { status: InvoiceStatus },
  event: string,
): Promise<InvoiceRow | null> {
  return ctx.db.transaction(async (tx) => {
    const db = tx as unknown as DB
    const [after] = await db
      .update(invoices)
      .set(patch)
      .where(and(eq(invoices.id, id), inArray(invoices.status, from)))
      .returning()
    if (!after) return null
    await ctx.emit(db, {
      accountId: after.accountId,
      event,
      resourceType: 'invoice',
      resourceId: after.id,
      resource: serializeInvoice(after),
    })
    return after
  })
}

const moneyOrNull = (v: unknown): Cents | null =>
  v === undefined || v === null ? null : brlToCents(Number(v))

function checkTaxes(taxes: InvoiceTaxes | undefined) {
  if (!taxes) return
  const field = invalidTaxField(taxes)
  if (field) throw invalid(field, `O percentual de ${field.toUpperCase()} deve estar entre 0 e 100.`)
}

function checkValues(valueCents: number, deductionsCents: number | null) {
  if (!(valueCents > 0)) throw invalid('value', 'O valor da nota fiscal deve ser maior que zero.')
  if (deductionsCents !== null && (deductionsCents < 0 || deductionsCents > valueCents)) {
    throw invalid('deductions', 'As deduções não podem ser negativas nem maiores que o valor da nota.')
  }
}

function checkEffectiveDate(date: string, today: string) {
  if (!isValidIsoDate(date)) throw invalid('effectiveDate', 'Informe uma data de emissão válida.')
  // TODO(rule): a note dated in the past is refused, as the panel's date picker does.
  if (date < today) throw invalid('effectiveDate', 'A data de emissão não pode ser anterior a hoje.')
}

/**
 * `updatePayment`: the charge's value goes down by the taxes the payer
 * withholds, while it is still open. Same fee recalculation as
 * `PUT /v3/payments/{id}`, and the same PAYMENT_UPDATED.
 */
async function discountRetainedTaxes(ctx: AppContext, paymentId: string, taxes: InvoiceTaxes) {
  await ctx.db.transaction(async (tx) => {
    const db = tx as unknown as DB
    const [p] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
    if (!p || !OPEN.includes(p.status) || p.deleted) return
    const retained = retainedTaxesCents(cents(p.valueCents), taxes)
    if (retained <= 0) return
    const value = cents(p.valueCents - retained)
    const fee = calcFee(ctx.config.fees, p.billingType as never, value)
    const [after] = await db
      .update(payments)
      .set({ valueCents: value, feeCents: fee, netValueCents: netValue(value, fee) })
      .where(and(eq(payments.id, p.id), inArray(payments.status, OPEN)))
      .returning()
    if (!after) return
    await ctx.emit(db, {
      accountId: after.accountId,
      event: 'PAYMENT_UPDATED',
      resourceType: 'payment',
      resourceId: after.id,
      resource: await serializePayment(db, after as PaymentRow),
    })
  })
}

/** `POST /v3/invoices`, and the subscription's automatic notes. */
export async function scheduleInvoice(
  ctx: AppContext,
  accountId: string,
  input: InvoiceInput,
): Promise<InvoiceRow> {
  let paymentId: string | null = null
  let installmentId: string | null = null
  let customerId: string | null = null

  if (input.payment) {
    const [p] = await ctx.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, input.payment), eq(payments.accountId, accountId)))
      .limit(1)
    if (!p || p.deleted) throw invalid('payment', 'Cobrança inexistente ou removida.')
    const [taken] = await ctx.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.paymentId, p.id), inArray(invoices.status, ACTIVE)))
      .limit(1)
    // TODO(rule): one standing note per charge; a cancelled one frees it.
    if (taken) throw invalid('payment', 'Já existe uma nota fiscal para esta cobrança.')
    paymentId = p.id
    installmentId = p.installmentId
    customerId = p.customerId
  } else if (input.installment) {
    const [i] = await ctx.db
      .select()
      .from(installments)
      .where(and(eq(installments.id, input.installment), eq(installments.accountId, accountId)))
      .limit(1)
    if (!i || i.deleted) throw invalid('installment', 'Parcelamento inexistente ou removido.')
    installmentId = i.id
    customerId = i.customerId
  } else if (input.customer) {
    const [c] = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customer), eq(customers.accountId, accountId)))
      .limit(1)
    if (!c || c.deleted) throw invalid('customer', 'Cliente inexistente ou removido.')
    customerId = c.id
  } else {
    throw invalid('customer', 'Informe a cobrança, o parcelamento ou o cliente da nota fiscal.')
  }

  const valueCents = brlToCents(Number(input.value))
  const deductionsCents = moneyOrNull(input.deductions)
  checkValues(valueCents, deductionsCents)
  checkEffectiveDate(String(input.effectiveDate ?? ''), ctx.clock.today())
  checkTaxes(input.taxes)
  if (!input.municipalServiceName && !input.municipalServiceCode && !input.municipalServiceId) {
    throw invalid('municipalServiceName', 'Informe o serviço municipal da nota fiscal.')
  }

  const id = `inv_${ctx.rng.digits(12)}`
  const row = await ctx.db.transaction(async (tx) => {
    const db = tx as unknown as DB
    const [created] = await db
      .insert(invoices)
      .values({
        id,
        accountId,
        paymentId,
        installmentId,
        customerId,
        status: 'SCHEDULED',
        valueCents,
        deductionsCents,
        serviceDescription: input.serviceDescription ?? null,
        observations: input.observations ?? null,
        externalReference: input.externalReference ?? null,
        effectiveDate: String(input.effectiveDate),
        municipalServiceId: input.municipalServiceId ?? null,
        municipalServiceCode: input.municipalServiceCode ?? null,
        municipalServiceName: input.municipalServiceName ?? input.municipalServiceCode ?? null,
        updatePayment: input.updatePayment ?? false,
        taxes: input.taxes ?? null,
        dateCreated: ctx.clock.timestamp(),
      })
      .returning()
    await ctx.emit(db, {
      accountId,
      event: 'INVOICE_CREATED',
      resourceType: 'invoice',
      resourceId: id,
      resource: serializeInvoice(created!),
    })
    return created!
  })

  if (paymentId && input.updatePayment && input.taxes) {
    await discountRetainedTaxes(ctx, paymentId, input.taxes)
  }
  return row
}

/** `PUT /v3/invoices/{id}`: only before the city hall saw it. A fixed ERROR goes back to SCHEDULED. */
export async function updateInvoice(ctx: AppContext, inv: InvoiceRow, input: InvoiceInput): Promise<InvoiceRow> {
  if (!UPDATABLE.includes(inv.status as InvoiceStatus)) {
    throw badRequest('invalid_action', 'Só é possível alterar notas fiscais agendadas ou com erro.')
  }

  const patch: Partial<InvoiceRow> & { status: InvoiceStatus } = {
    status: 'SCHEDULED',
    statusDescription: null,
  }
  if (input.serviceDescription !== undefined) patch.serviceDescription = input.serviceDescription
  if (input.observations !== undefined) patch.observations = input.observations
  if (input.externalReference !== undefined) patch.externalReference = input.externalReference
  if (input.value !== undefined) patch.valueCents = brlToCents(Number(input.value))
  if (input.deductions !== undefined) patch.deductionsCents = moneyOrNull(input.deductions)
  if (input.effectiveDate !== undefined) {
    checkEffectiveDate(String(input.effectiveDate), ctx.clock.today())
    patch.effectiveDate = String(input.effectiveDate)
  }
  if (input.updatePayment !== undefined) patch.updatePayment = input.updatePayment
  if (input.taxes !== undefined) {
    checkTaxes(input.taxes)
    patch.taxes = input.taxes
  }
  checkValues(patch.valueCents ?? inv.valueCents, patch.deductionsCents ?? inv.deductionsCents)

  const after = await move(ctx, inv.id, UPDATABLE, patch, 'INVOICE_UPDATED')
  if (!after) throw badRequest('invalid_action', 'A nota fiscal mudou de situação. Consulte-a de novo.')

  if (after.paymentId && input.updatePayment && after.taxes) {
    await discountRetainedTaxes(ctx, after.paymentId, after.taxes as InvoiceTaxes)
  }
  return after
}

/** Emitir: the note goes to the city hall now (dated today), or on its effectiveDate by the job. */
export async function issueInvoice(ctx: AppContext, inv: InvoiceRow, now = true): Promise<InvoiceRow> {
  if (!ISSUABLE.includes(inv.status as InvoiceStatus)) {
    throw badRequest('invalid_action', `Esta nota fiscal não pode ser emitida (situação ${inv.status}).`)
  }
  const after = await move(
    ctx,
    inv.id,
    ISSUABLE,
    {
      status: 'SYNCHRONIZED',
      statusDescription: null,
      ...(now ? { effectiveDate: ctx.clock.today() } : {}),
    },
    'INVOICE_SYNCHRONIZED',
  )
  if (!after) throw badRequest('invalid_action', 'A nota fiscal mudou de situação. Consulte-a de novo.')
  return after
}

/** The next number of a series: per account, never reused. */
async function nextNumber(db: DB, name: string): Promise<number> {
  const rows = await db.all<{ value: number }>(sql`
    INSERT INTO sequences (name, value) VALUES (${name}, 1)
    ON CONFLICT(name) DO UPDATE SET value = value + 1
    RETURNING value
  `)
  return rows[0]!.value
}

export async function fiscalInfoOf(db: DB, accountId: string): Promise<Record<string, any> | null> {
  const [row] = await db.select().from(fiscalInfo).where(eq(fiscalInfo.accountId, accountId)).limit(1)
  return (row?.data as Record<string, any>) ?? null
}

/**
 * The city hall's answer to a SYNCHRONIZED note. Without the account's fiscal
 * information there is nothing to send it with: ERROR, with the reason.
 * `force` (the `/_mock` control) authorizes regardless.
 *
 * TODO(rule): which fields the city hall demands varies per municipality; here
 * a configured `POST /v3/fiscalInfo` is enough.
 */
export async function answerInvoice(ctx: AppContext, inv: InvoiceRow, force = false): Promise<InvoiceRow | null> {
  const info = await fiscalInfoOf(ctx.db, inv.accountId)
  if (!info && !force) {
    return move(
      ctx,
      inv.id,
      ['SYNCHRONIZED'],
      {
        status: 'ERROR',
        statusDescription:
          'Informações fiscais não configuradas. Cadastre-as (POST /v3/fiscalInfo) e emita a nota de novo.',
      },
      'INVOICE_ERROR',
    )
  }

  const n = await nextNumber(ctx.db, `invoice_number:${inv.accountId}`)
  const rpsStart = Number(info?.rpsNumber ?? 1)
  const base = ctx.config.invoiceBaseUrl
  return move(
    ctx,
    inv.id,
    ['SYNCHRONIZED'],
    {
      status: 'AUTHORIZED',
      statusDescription: null,
      number: String(n),
      rpsSerie: String(info?.rpsSerie ?? '1'),
      rpsNumber: String(rpsStart + n - 1),
      validationCode: ctx.rng.alphanumeric(8).toUpperCase(),
      pdfUrl: `${base}/nfse/${inv.id}`,
      xmlUrl: `${base}/nfse/${inv.id}/xml`,
    },
    'INVOICE_AUTHORIZED',
  )
}

/** The city hall refuses a note it was sent (the `/_mock` control). */
export async function refuseInvoice(ctx: AppContext, inv: InvoiceRow, reason: string): Promise<InvoiceRow | null> {
  return move(ctx, inv.id, ['SYNCHRONIZED'], { status: 'ERROR', statusDescription: reason }, 'INVOICE_ERROR')
}

/**
 * `POST /v3/invoices/{id}/cancel`. A note never sent ends at once; an issued
 * one asks the city hall (PROCESSING_CANCELLATION) unless `onlyOnAsaas`, which
 * drops it here and leaves the city hall's record as it is.
 */
export async function cancelInvoice(ctx: AppContext, inv: InvoiceRow, onlyOnAsaas = false): Promise<InvoiceRow> {
  const status = inv.status as InvoiceStatus
  let after: InvoiceRow | null = null
  if (CANCEL_AT_ONCE.includes(status) || (onlyOnAsaas && CANCEL_AT_CITY_HALL.includes(status))) {
    after = await move(
      ctx,
      inv.id,
      onlyOnAsaas ? [...CANCEL_AT_ONCE, ...CANCEL_AT_CITY_HALL] : CANCEL_AT_ONCE,
      { status: 'CANCELED', statusDescription: null },
      'INVOICE_CANCELED',
    )
  } else if (CANCEL_AT_CITY_HALL.includes(status)) {
    after = await move(
      ctx,
      inv.id,
      CANCEL_AT_CITY_HALL,
      { status: 'PROCESSING_CANCELLATION', statusDescription: null },
      'INVOICE_PROCESSING_CANCELLATION',
    )
  } else if (status === 'SYNCHRONIZED') {
    throw badRequest('invalid_action', 'A nota fiscal está em processamento na prefeitura. Aguarde o retorno para cancelar.')
  } else {
    throw badRequest('invalid_action', `Esta nota fiscal não pode ser cancelada (situação ${inv.status}).`)
  }
  if (!after) throw badRequest('invalid_action', 'A nota fiscal mudou de situação. Consulte-a de novo.')
  return after
}

/** The city hall's answer to a cancellation: done, or refused with a reason. */
export async function answerCancellation(
  ctx: AppContext,
  inv: InvoiceRow,
  refusal: string | null = null,
): Promise<InvoiceRow | null> {
  return refusal === null
    ? move(ctx, inv.id, ['PROCESSING_CANCELLATION'], { status: 'CANCELED', statusDescription: null }, 'INVOICE_CANCELED')
    : move(
        ctx,
        inv.id,
        ['PROCESSING_CANCELLATION'],
        { status: 'CANCELLATION_DENIED', statusDescription: refusal },
        'INVOICE_CANCELLATION_DENIED',
      )
}
