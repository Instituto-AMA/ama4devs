/**
 * Charge serialization in the EXACT format of Asaas's response.
 *
 * The boundary where cents become reais. No arithmetic from here outwards.
 */
import { desc, eq } from 'drizzle-orm'
import type { DB } from '../../db/client.ts'
import { chargebacks, creditCards, paymentRefunds, payments, paymentSplits } from '../../db/schema/index.ts'
import { centsToBrl, cents } from '../../domain/money.ts'

export type PaymentRow = typeof payments.$inferSelect
export type SplitRow = typeof paymentSplits.$inferSelect

const money = (v: number | null): number | null => (v === null ? null : centsToBrl(cents(v)))

function serializeSplit(s: SplitRow) {
  return {
    id: s.id,
    walletId: s.walletId,
    fixedValue: money(s.fixedValueCents),
    // The percentage is stored at the 1e4 scale (4 places). 923444 → 92.3444
    percentualValue: s.percentualValueE4 === null ? null : s.percentualValueE4 / 10_000,
    totalValue: money(s.totalValueCents),
    status: s.status,
    cancellationReason: s.cancellationReason,
    refusalReason: s.refusalReason,
    externalReference: s.externalReference,
    description: s.description,
  }
}

export async function serializePayment(
  db: DB,
  p: PaymentRow,
): Promise<Record<string, unknown>> {
  const splits = await db.select().from(paymentSplits).where(eq(paymentSplits.paymentId, p.id))
  const refunds = await db
    .select()
    .from(paymentRefunds)
    .where(eq(paymentRefunds.paymentId, p.id))
    .orderBy(desc(paymentRefunds.dateCreated))

  /**
   * The chargeback, when it exists. A charge in CHARGEBACK_REQUESTED that
   * returned `chargeback: null` would be a lie that is hard to debug: the
   * status says there was a dispute and the object says there was not.
   */
  let chargeback: Record<string, unknown> | null = null
  const [cb] = await db.select().from(chargebacks).where(eq(chargebacks.paymentId, p.id)).limit(1)
  if (cb) {
    const { serializeChargeback } = await import('../chargebacks/handlers.ts')
    chargeback = await serializeChargeback(db, cb)
  }

  let card = null
  if (p.creditCardId) {
    const [row] = await db
      .select()
      .from(creditCards)
      .where(eq(creditCards.id, p.creditCardId))
      .limit(1)
    if (row) {
      card = {
        // Asaas returns only the LAST 4 digits — not a mask with asterisks.
        creditCardNumber: row.last4,
        creditCardBrand: row.brand,
        creditCardToken: row.creditCardToken,
      }
    }
  }

  /**
   * The SET OF KEYS of Asaas's `payment` object is not fixed — it was mapped field
   * by field against the real sandbox, and it has two rules you cannot guess:
   *
   *   1. The relational fields are OMITTED when null, not returned as
   *      `null`. A single charge does not have the `installment` key — it does not
   *      come with a null value, it is simply not there. It matters: a client that
   *      tests `'installment' in payment` behaves differently in the two cases.
   *
   *   2. Some fields only exist for certain payment methods:
   *        BOLETO      → gains `canBePaidAfterDueDate`
   *        CREDIT_CARD → gains `confirmedDate` and `creditCard`
   *      Yes: a PENDING Pix **does not have** the `confirmedDate` key. It makes no
   *      obvious sense, but it is what the API returns, and it is what we reproduce.
   */
  const out: Record<string, unknown> = {
    object: 'payment',
    id: p.id,
    dateCreated: p.dateCreated,
    customer: p.customerId,
    checkoutSession: p.checkoutSession,
    paymentLink: p.paymentLinkId,

    value: money(p.valueCents),
    netValue: money(p.netValueCents),
    originalValue: money(p.originalValueCents),
    interestValue: money(p.interestValueCents),

    description: p.description,
    billingType: p.billingType,
    pixTransaction: p.pixTransactionId,
    status: p.status,

    dueDate: p.dueDate,
    originalDueDate: p.originalDueDate,
    paymentDate: p.paymentDate,
    clientPaymentDate: p.clientPaymentDate,
    installmentNumber: p.installmentNumber === null ? null : Number(p.installmentNumber),

    invoiceUrl: p.invoiceUrl,
    invoiceNumber: p.invoiceNumber,
    externalReference: p.externalReference,
    deleted: p.deleted,
    anticipated: p.anticipated,
    anticipable: p.anticipable,
    creditDate: p.creditDate,
    estimatedCreditDate: p.estimatedCreditDate,
    transactionReceiptUrl: p.transactionReceiptUrl,
    nossoNumero: p.nossoNumero,
    bankSlipUrl: p.bankSlipUrl,
    lastInvoiceViewedDate: p.lastInvoiceViewedDate ?? null,
    lastBankSlipViewedDate: p.lastBankSlipViewedDate ?? null,

    /**
     * `limitDate` — and not `limitedDate`, which is what we wrote at first.
     *
     * Asaas's spec declares NEITHER of the two (the response's `discount` object
     * does not have that field there), so the contract validation would not catch
     * the error. What caught it was the capture against the real sandbox. It is the exact
     * illustration of why parity exists: the contract proves the FORM, only the real API
     * proves the CONTENT.
     */
    discount: p.discount
      ? {
          value: p.discount.value,
          dueDateLimitDays: p.discount.dueDateLimitDays,
          limitDate: null,
          type: p.discount.type,
        }
      : { value: 0, dueDateLimitDays: 0, limitDate: null, type: 'FIXED' },
    fine: p.fine
      ? { value: p.fine.value, type: p.fine.type }
      : { value: 0, type: 'FIXED' },
    // `interest` has no `type` in the request, but Asaas's response returns
    // PERCENTAGE — it is always a monthly percentage. Confirmed in the real sandbox.
    interest: p.interest
      ? { value: p.interest.value, type: 'PERCENTAGE' }
      : { value: 0, type: 'PERCENTAGE' },

    postalService: p.postalService,
    escrow: null,
    // `null`, not `[]` — even when there is no refund. Confirmed in the sandbox.
    // With refunds, the list of them (same shape as the installment's), so a
    // client that reads `payment.refunds` sees the refund it asked for.
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

  // ── Rule 2: fields per payment method ──
  if (p.billingType === 'BOLETO') out.canBePaidAfterDueDate = p.canBePaidAfterDueDate
  if (p.billingType === 'CREDIT_CARD') {
    // The card ALWAYS has the key — even PENDING, and then it is `null`.
    out.confirmedDate = p.confirmedDate
    out.creditCard = card
  } else if (p.confirmedDate) {
    /**
     * And ANY method gains the key after being confirmed. We only emitted it for
     * the card, so a PAID Pix returned `confirmedDate: undefined` — and the client
     * that reads that field to know when the payment was acknowledged got nothing
     * here and a date on Asaas.
     *
     * The real rule, captured (tools/probe-pix.ts):
     *   PIX/BOLETO PENDING   → key ABSENT
     *   PIX/BOLETO RECEIVED  → key present, with the date
     *   CREDIT_CARD          → key always present (null while PENDING)
     */
    out.confirmedDate = p.confirmedDate
  }

  // ── Rule 1: relationals only appear when they exist ──
  if (p.subscriptionId) out.subscription = p.subscriptionId
  if (p.installmentId) out.installment = p.installmentId
  if (p.pixQrCodeId) out.pixQrCodeId = p.pixQrCodeId
  if (splits.length) out.split = splits.map(serializeSplit)
  if (chargeback) out.chargeback = chargeback
  if (p.daysAfterDueDateToRegistrationCancellation !== null) {
    out.daysAfterDueDateToRegistrationCancellation = p.daysAfterDueDateToRegistrationCancellation
  }

  return out
}

/** The "lean" version (/v3/lean/payments): the same data without the nested objects. */
export function serializeLeanPayment(p: PaymentRow): Record<string, unknown> {
  return {
    object: 'payment',
    id: p.id,
    dateCreated: p.dateCreated,
    customer: p.customerId,
    installment: p.installmentId,
    subscription: p.subscriptionId,
    value: money(p.valueCents),
    netValue: money(p.netValueCents),
    originalValue: money(p.originalValueCents),
    interestValue: money(p.interestValueCents),
    description: p.description,
    billingType: p.billingType,
    status: p.status,
    dueDate: p.dueDate,
    originalDueDate: p.originalDueDate,
    paymentDate: p.paymentDate,
    clientPaymentDate: p.clientPaymentDate,
    installmentNumber: p.installmentNumber === null ? null : Number(p.installmentNumber),
    invoiceUrl: p.invoiceUrl,
    invoiceNumber: p.invoiceNumber,
    externalReference: p.externalReference,
    deleted: p.deleted,
    anticipated: p.anticipated,
    anticipable: p.anticipable,
    creditDate: p.creditDate,
    estimatedCreditDate: p.estimatedCreditDate,
    transactionReceiptUrl: p.transactionReceiptUrl,
    nossoNumero: p.nossoNumero,
    bankSlipUrl: p.bankSlipUrl,
    postalService: p.postalService,
  }
}
