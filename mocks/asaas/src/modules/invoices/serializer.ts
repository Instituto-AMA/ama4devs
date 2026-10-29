/**
 * A nota fiscal no formato de resposta da API (InvoiceGetResponseDTO). The
 * same shape answers `/v3/invoices`, `/v3/subscriptions/{id}/invoices` and the
 * `invoice` key of the INVOICE_* webhooks.
 */
import { invoices } from '../../db/schema/index.ts'
import { cents, centsToBrl } from '../../domain/money.ts'

export type InvoiceRow = typeof invoices.$inferSelect

/** The pt-BR line Asaas shows under each status. */
const STATUS_DESCRIPTION: Record<string, string> = {
  SCHEDULED: 'Nota fiscal agendada.',
  SYNCHRONIZED: 'Nota fiscal enviada para a prefeitura. Aguardando retorno.',
  AUTHORIZED: 'Nota fiscal autorizada pela prefeitura.',
  PROCESSING_CANCELLATION: 'Cancelamento enviado para a prefeitura. Aguardando retorno.',
  CANCELED: 'Nota fiscal cancelada.',
}

export function serializeInvoice(row: InvoiceRow): Record<string, unknown> {
  return {
    object: 'invoice',
    id: row.id,
    status: row.status,
    customer: row.customerId,
    payment: row.paymentId,
    installment: row.installmentId,
    type: 'NFS-e',
    // ERROR and CANCELLATION_DENIED carry the city hall's own reason.
    statusDescription: row.statusDescription ?? STATUS_DESCRIPTION[row.status] ?? null,
    serviceDescription: row.serviceDescription,
    pdfUrl: row.pdfUrl,
    xmlUrl: row.xmlUrl,
    rpsSerie: row.rpsSerie,
    rpsNumber: row.rpsNumber,
    number: row.number,
    validationCode: row.validationCode,
    value: centsToBrl(cents(row.valueCents)),
    deductions: row.deductionsCents === null ? 0 : centsToBrl(cents(row.deductionsCents)),
    effectiveDate: row.effectiveDate,
    observations: row.observations,
    estimatedTaxesDescription: null,
    externalReference: row.externalReference,
    taxes: row.taxes ?? null,
    municipalServiceId: row.municipalServiceId,
    municipalServiceCode: row.municipalServiceCode,
    municipalServiceName: row.municipalServiceName,
  }
}
