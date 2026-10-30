/**
 * Installment plan serialization. The boundary where cents become reais.
 *
 * Mind the three "values" of the installment plan, which the spec names badly:
 *   value        → the TOTAL of the installment plan (R$ 350,00)
 *   paymentValue → the value of the LAST installment, with the remainder  (R$ 29,24)
 *   netValue     → the NET total, with the fees of all the installments already deducted
 */
import { desc, eq, inArray } from 'drizzle-orm'
import type { DB } from '../../db/client.ts'
import { creditCards, paymentRefunds, payments } from '../../db/schema/index.ts'
import { cents, centsToBrl } from '../../domain/money.ts'
import type { InstallmentRow } from './service.ts'

const money = (v: number | null): number | null => (v === null ? null : centsToBrl(cents(v)))

export async function serializeInstallment(
  db: DB,
  row: InstallmentRow,
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({
      id: payments.id,
      creditCardId: payments.creditCardId,
      confirmedDate: payments.confirmedDate,
      transactionReceiptUrl: payments.transactionReceiptUrl,
    })
    .from(payments)
    .where(eq(payments.installmentId, row.id))

  const paymentIds = rows.map((p) => p.id)

  const refunds = paymentIds.length
    ? await db
        .select()
        .from(paymentRefunds)
        .where(inArray(paymentRefunds.paymentId, paymentIds))
        .orderBy(desc(paymentRefunds.dateCreated))
    : []

  // The card is the same for all the installments — the one of the first that has
  // it is enough.
  let card = null
  const withCard = rows.find((p) => p.creditCardId)
  if (withCard?.creditCardId) {
    const [c] = await db
      .select()
      .from(creditCards)
      .where(eq(creditCards.id, withCard.creditCardId))
      .limit(1)
    if (c) {
      card = {
        // Only the LAST 4 digits — not a mask with asterisks.
        creditCardNumber: c.last4,
        creditCardBrand: c.brand,
        creditCardToken: c.creditCardToken,
      }
    }
  }

  /**
   * The `paymentDate` and `transactionReceiptUrl` of the INSTALLMENT PLAN come
   * from the installments: on the card, the issuer authorizes everything at once
   * and the whole plan counts as "paid today". We used to return `null` in both.
   *
   * Notice that the source is the `confirmedDate` of the installment, not its
   * `paymentDate`: a CONFIRMED installment has `paymentDate: null` (the merchant
   * has not received it yet), but the whole plan already counts as paid by the
   * customer. The two things have the same name and different meanings — it is
   * from Asaas, not from us.
   */
  const paid = rows.find((p) => p.confirmedDate)

  return {
    object: 'installment',
    id: row.id,
    value: money(row.totalValueCents),
    netValue: money(row.netValueCents),
    paymentValue: money(row.installmentValueCents),
    installmentCount: row.installmentCount,
    billingType: row.billingType,
    paymentDate: paid?.confirmedDate ?? null,
    description: row.description,
    expirationDay: row.expirationDay,
    dateCreated: row.dateCreated,
    customer: row.customerId,
    paymentLink: row.paymentLinkId,
    checkoutSession: row.checkoutSession,
    transactionReceiptUrl: row.transactionReceiptUrl ?? paid?.transactionReceiptUrl ?? null,
    creditCard: card,
    deleted: row.deleted,
    // `null` when there is no refund — not `[]`. The `installment` object of Asaas
    // also does NOT have the `chargeback` key (the payment has it; this one
    // does not).
    refunds: refunds.length
      ? refunds.map((r) => ({
          dateCreated: r.dateCreated,
          status: r.status,
          value: money(r.valueCents),
          endToEndIdentifier: null,
          description: r.description,
          effectiveDate: r.effectiveDate,
          transactionReceiptUrl: r.transactionReceiptUrl,
          refundedSplits: [],
          paymentId: r.paymentId,
        }))
      : null,
  }
}
