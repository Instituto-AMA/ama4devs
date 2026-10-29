/**
 * Nota fiscal de serviço (NFS-e): as regras que não dependem de banco nem de
 * relógio. Pure, like the rest of src/domain: every function takes its dates.
 *
 * The life of a note, as Asaas reports it through INVOICE_* events:
 *
 *   SCHEDULED ──emitir / effectiveDate──▶ SYNCHRONIZED ──prefeitura──▶ AUTHORIZED
 *       │                                      └──────────────────────▶ ERROR
 *       └──cancelar──▶ CANCELED                AUTHORIZED ──cancelar──▶ PROCESSING_CANCELLATION
 *                                              PROCESSING_CANCELLATION ─▶ CANCELED | CANCELLATION_DENIED
 *
 * SYNCHRONIZED is the note at the city hall, waiting for its answer: the next
 * tick of the scheduler is that answer (`/_mock/invoices/*` forces it).
 */
import type { Cents } from './money.ts'
import { addDays, type IsoDate } from './calendar.ts'

export type InvoiceStatus =
  | 'SCHEDULED'
  | 'SYNCHRONIZED'
  | 'AUTHORIZED'
  | 'PROCESSING_CANCELLATION'
  | 'CANCELED'
  | 'CANCELLATION_DENIED'
  | 'ERROR'

/** The percentages of a note (InvoiceTaxesRequestDTO). Percent, not money. */
export interface InvoiceTaxes {
  retainIss: boolean
  iss: number
  pis: number
  cofins: number
  csll: number
  inss: number
  ir: number
  [extra: string]: unknown
}

/** What can still be edited: nothing has reached the city hall yet. */
export const UPDATABLE: InvoiceStatus[] = ['SCHEDULED', 'ERROR']

/** What "emitir" accepts: a scheduled note, or one the city hall refused and was fixed. */
export const ISSUABLE: InvoiceStatus[] = ['SCHEDULED', 'ERROR']

/** Never sent: cancelling ends it at once, with no city hall involved. */
export const CANCEL_AT_ONCE: InvoiceStatus[] = ['SCHEDULED', 'ERROR']

/** Issued: cancelling asks the city hall, which may refuse. */
export const CANCEL_AT_CITY_HALL: InvoiceStatus[] = ['AUTHORIZED', 'CANCELLATION_DENIED']

/** A note that still stands for its charge: a second one would duplicate it. */
export const ACTIVE: InvoiceStatus[] = [
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELLATION_DENIED',
  'ERROR',
]

/** Percent → basis points, so 2.5% sums without float drift. */
const bp = (percent: unknown) => Math.round(Number(percent ?? 0) * 100)

/**
 * The taxes the payer withholds: PIS, COFINS, CSLL, INSS and IR always, ISS
 * only when `retainIss`. It is what `updatePayment` takes off the charge.
 *
 * TODO(rule): researched from the field descriptions ("o valor da cobrança com
 * os impostos da nota já descontados"), not proven against the sandbox.
 */
export function retainedTaxesCents(valueCents: Cents, taxes: InvoiceTaxes): Cents {
  const rate =
    bp(taxes.pis) + bp(taxes.cofins) + bp(taxes.csll) + bp(taxes.inss) + bp(taxes.ir) +
    (taxes.retainIss ? bp(taxes.iss) : 0)
  return Math.round((valueCents * rate) / 10_000) as Cents
}

/** Every percentage present and within 0–100; returns the field at fault. */
export function invalidTaxField(taxes: InvoiceTaxes): string | null {
  for (const k of ['iss', 'pis', 'cofins', 'csll', 'inss', 'ir'] as const) {
    const v = Number(taxes[k])
    if (!Number.isFinite(v) || v < 0 || v > 100) return k
  }
  return null
}

export type InvoiceCreationPeriod =
  | 'ON_PAYMENT_CONFIRMATION'
  | 'ON_PAYMENT_DUE_DATE'
  | 'BEFORE_PAYMENT_DUE_DATE'
  | 'ON_DUE_DATE_MONTH'
  | 'ON_NEXT_MONTH'

/**
 * When the note of a subscription charge is issued, from the subscription's
 * `invoiceSettings`. `null` means "not yet": ON_PAYMENT_CONFIRMATION waits for
 * the money, and `paidOn` is when it came. A date already past becomes today:
 * a note is never issued in the past.
 *
 * TODO(rule): the month periods (first day of the due date's month, first day
 * of the next month) are read from the enum names, not proven.
 */
export function subscriptionInvoiceDate(
  period: InvoiceCreationPeriod | string | null,
  dueDate: IsoDate,
  daysBefore: number | null,
  paidOn: IsoDate | null,
  today: IsoDate,
): IsoDate | null {
  let date: IsoDate | null
  switch (period) {
    case 'ON_PAYMENT_CONFIRMATION':
      date = paidOn
      break
    case 'BEFORE_PAYMENT_DUE_DATE':
      date = addDays(dueDate, -(daysBefore ?? 0))
      break
    case 'ON_DUE_DATE_MONTH':
      date = `${dueDate.slice(0, 7)}-01` as IsoDate
      break
    case 'ON_NEXT_MONTH': {
      const [y, m] = dueDate.split('-').map(Number) as [number, number]
      date = (m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`) as IsoDate
      break
    }
    default: // ON_PAYMENT_DUE_DATE, and a config without a period
      date = dueDate
  }
  if (date === null) return null
  return date < today ? today : date
}
