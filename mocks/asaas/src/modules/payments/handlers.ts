import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { badRequest, invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { accounts, payments, paymentRefunds } from '../../db/schema/index.ts'
import { addMonths } from '../../domain/calendar.ts'
import type { BillingType } from '../../domain/fees.ts'
import { calcOverdueTotals } from '../../domain/interest.ts'
import * as ids from '../../domain/ids.ts'
import { brlToCents, cents, centsToBrl } from '../../domain/money.ts'
import { brCodePayload } from '../../domain/pix-brcode.ts'
import { qrPng } from '../../domain/qrcode.ts'
import { simulate, type SimulatedBilling } from '../../domain/simulator.ts'
import type { HandlerMap } from '../../http/register.ts'
import { createPaymentWithCard, hasCreditCard } from '../credit-cards/service.ts'
import { createInstallmentFlow, installmentInputFromPaymentBody } from '../installments/service.ts'
import { applyTransition } from './apply.ts'
import { serializePayment, type PaymentRow } from './serializer.ts'
import { createPayment, parseCreateBody } from './service.ts'

async function findOwned(ctx: AppContext, auth: AuthContext, id: string): Promise<PaymentRow> {
  const [row] = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.accountId, auth.accountId)))
    .limit(1)
  if (!row) throw notFound('Cobrança')
  return row as PaymentRow
}

export const paymentHandlers: HandlerMap = {
  /**
   * It serves ALSO `create-new-payment-with-credit-card` — in Asaas's spec the
   * two operations share POST /v3/payments, and the BODY decides which one it is.
   *
   * With a card (`creditCard` or `creditCardToken`), the charge is not born
   * PENDING: the capture happens at creation time and it already goes to CONFIRMED
   * (or AUTHORIZED, with `authorizeOnly`). If the issuer declines, the charge does
   * not even come to exist — 400. That whole path lives in track H.
   */
  'create-new-payment': async ({ ctx, auth, body }) => {
    const b = body as Record<string, any>

    /**
     * Installment plan through the POST /v3/payments door — Asaas accepts it, and
     * it is what the typical client uses (giving `installmentCount` in a regular
     * charge, without knowing /v3/installments).
     *
     * What it returns is the FIRST INSTALLMENT — a `payment` object with
     * `installment` filled in, `installmentNumber: 1` and the generated description
     * ("Parcela 1 de 3.") — and NOT the plan object. Proven against the real
     * sandbox. The engine is the same as /v3/installments; only the response differs.
     */
    if (Number(b.installmentCount ?? 1) > 1) {
      const { payments: parts } = await createInstallmentFlow(
        ctx,
        auth,
        b,
        installmentInputFromPaymentBody(b),
      )
      return serializePayment(ctx.db, parts[0]!)
    }

    if (hasCreditCard(b)) return createPaymentWithCard(ctx, auth, b)

    const row = await ctx.db.transaction(async (tx) =>
      createPayment(ctx, tx as never, auth.accountId, auth.walletId, parseCreateBody(b)),
    )

    return serializePayment(ctx.db, row)
  },

  'list-payments': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)

    const filters = [eq(payments.accountId, auth.accountId), eq(payments.deleted, false)]
    if (query.customer) filters.push(eq(payments.customerId, String(query.customer)))
    if (query.billingType) filters.push(eq(payments.billingType, String(query.billingType)))
    if (query.status) filters.push(eq(payments.status, String(query.status)))
    if (query.subscription) {
      filters.push(eq(payments.subscriptionId, String(query.subscription)))
    }
    if (query.installment) filters.push(eq(payments.installmentId, String(query.installment)))
    if (query.externalReference) {
      filters.push(eq(payments.externalReference, String(query.externalReference)))
    }
    if (query.paymentDate) filters.push(eq(payments.paymentDate, String(query.paymentDate)))
    if (query['dueDate[ge]']) filters.push(gte(payments.dueDate, String(query['dueDate[ge]'])))
    if (query['dueDate[le]']) filters.push(lte(payments.dueDate, String(query['dueDate[le]'])))
    if (query['dateCreated[ge]']) {
      filters.push(gte(payments.dateCreated, String(query['dateCreated[ge]'])))
    }
    if (query['dateCreated[le]']) {
      filters.push(lte(payments.dateCreated, String(query['dateCreated[le]'])))
    }

    const where = and(...filters)

    const [total] = await ctx.db.select({ n: count() }).from(payments).where(where)

    /**
     * FROM THE NEWEST TO THE OLDEST. Proven against the real sandbox: listing the
     * installments of a 12x plan returns #12 first.
     *
     * We sort by `rowid` (the physical insertion order), not by `dateCreated`:
     * the 12 installments are born on the SAME day — and, under the frozen virtual
     * clock, in the same millisecond. Any time-based ordering would tie the 12 and
     * the order would be SQLite's, that is, undefined.
     */
    const rows = await ctx.db
      .select()
      .from(payments)
      .where(where)
      .orderBy(desc(sql`rowid`))
      .limit(limit)
      .offset(offset)

    const data = await Promise.all(rows.map((r) => serializePayment(ctx.db, r as PaymentRow)))
    return listEnvelope(data, total?.n ?? 0, limit, offset)
  },

  /**
   * `POST /v3/payments/simulate` — how much is left if I charge X through each method.
   * It creates nothing, it does not touch the database.
   *
   * Each method exposes a DIFFERENT set of fields, and it is not by chance — it is
   * what the real sandbox returns:
   *
   *   creditCard → feePercentage + operationFee   (without feeValue)
   *   bankSlip   → feeValue                       (without feePercentage)
   *   pix        → feeValue + feePercentage: null (o campo existe, sempre nulo)
   */
  'sales-simulator': async ({ ctx, body }) => {
    const b = body as Record<string, any>

    if (b.value === undefined || b.value === null || Number(b.value) <= 0) {
      throw invalid('value', 'O valor da simulação deve ser maior que zero.')
    }
    if (!Array.isArray(b.billingTypes) || b.billingTypes.length === 0) {
      throw invalid('billingTypes', 'Informe ao menos um meio de pagamento.')
    }

    const sim = simulate(ctx.config.fees, {
      valueCents: brlToCents(Number(b.value)),
      billingTypes: b.billingTypes as BillingType[],
      installmentCount: b.installmentCount ?? null,
    })

    const parcels = (i: SimulatedBilling['installment']) =>
      i && {
        paymentNetValue: centsToBrl(i.paymentNetValueCents),
        paymentValue: centsToBrl(i.paymentValueCents),
      }

    return {
      value: centsToBrl(sim.valueCents),
      creditCard: sim.creditCard && {
        netValue: centsToBrl(sim.creditCard.netValueCents),
        feePercentage: sim.creditCard.feeBp! / 100,
        operationFee: centsToBrl(sim.creditCard.feeFixedCents),
        installment: parcels(sim.creditCard.installment),
      },
      bankSlip: sim.bankSlip && {
        netValue: centsToBrl(sim.bankSlip.netValueCents),
        feeValue: centsToBrl(sim.bankSlip.feeFixedCents),
        installment: parcels(sim.bankSlip.installment),
      },
      pix: sim.pix && {
        netValue: centsToBrl(sim.pix.netValueCents),
        feePercentage: null,
        feeValue: centsToBrl(sim.pix.feeFixedCents),
        installment: parcels(sim.pix.installment),
      },
    }
  },

  /**
   * `GET /v3/payments/{id}/pixQrCode` — the "copy and paste" and the QR image.
   *
   * Without this, a Pix purchase has no way to be paid: it is the only thing the
   * buyer actually uses. The `payload` is a real EMV BR Code, with CRC16 —
   * point the camera and the phone reads it.
   *
   * BOLETO also answers: Asaas issues a hybrid bank slip, with Pix embedded.
   * Restricting it to PIX would be stricter than the real API.
   *
   * `expirationDate` = dueDate + 1 YEAR, at 23:59:59. It is not the charge's due
   * date, and it is not Pix's deadline — it is a year later. Proven at two points
   * against the sandbox (2026-12-31 → 2027-12-31; 2026-08-20 → 2027-08-20).
   */
  'get-qr-code-for-pix-payments': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)

    const [account] = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, auth.accountId))
      .limit(1)

    const payload = brCodePayload({
      url: `pix.localhost/qr/cobv/${p.id.replace('pay_', '')}`,
      merchantName: account?.name ?? 'ASAAS',
      merchantCity: account?.city ?? 'SAO PAULO',
      postalCode: account?.postalCode ?? undefined,
    })

    return {
      success: true,
      encodedImage: qrPng(payload),
      payload,
      expirationDate: `${addMonths(p.dueDate, 12)} 23:59:59`,
      // Without an accent, and that is exactly how Asaas writes it.
      description: p.description ?? 'Descricao nao informada',
    }
  },

  'retrieve-a-single-payment': async ({ ctx, auth, params }) =>
    serializePayment(ctx.db, await findOwned(ctx, auth, params.id!)),

  'retrieve-status-of-a-payment': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    return { status: p.status }
  },

  'update-existing-payment': async ({ ctx, auth, params, body }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const b = body as Record<string, any>

    // Only a charge that has not been paid yet can be edited.
    if (p.status !== 'PENDING' && p.status !== 'OVERDUE') {
      throw badRequest(
        'invalid_action',
        'Só é possível alterar cobranças aguardando pagamento ou vencidas.',
      )
    }

    const patch: Record<string, unknown> = {}
    if (b.value !== undefined) {
      const value = brlToCents(Number(b.value))
      if (value <= 0) throw invalid('value', 'O valor da cobrança deve ser maior que zero.')
      const { calcFee, netValue } = await import('../../domain/fees.ts')
      const fee = calcFee(ctx.config.fees, p.billingType as never, value)
      patch.valueCents = value
      patch.feeCents = fee
      patch.netValueCents = netValue(value, fee)
    }
    if (b.dueDate !== undefined) patch.dueDate = String(b.dueDate)
    if (b.description !== undefined) patch.description = b.description
    if (b.externalReference !== undefined) patch.externalReference = b.externalReference
    if (b.billingType !== undefined) patch.billingType = b.billingType
    if (b.discount !== undefined) patch.discount = b.discount
    if (b.fine !== undefined) patch.fine = b.fine
    if (b.interest !== undefined) patch.interest = b.interest

    /**
     * `customer` does NOT exist in the spec's update schema — Asaas does not allow
     * changing the customer of a charge, and the field is simply discarded.
     * There is nothing to validate here: Elysia has already removed it from the body.
     */

    await ctx.db.transaction(async (tx) => {
      await tx.update(payments).set(patch).where(eq(payments.id, p.id))
      const [after] = await tx.select().from(payments).where(eq(payments.id, p.id)).limit(1)

      await ctx.emit(tx as never, {
        accountId: auth.accountId,
        event: 'PAYMENT_UPDATED',
        resourceType: 'payment',
        resourceId: p.id,
        resource: await serializePayment(tx as never, after as PaymentRow),
      })
    })

    return serializePayment(ctx.db, await findOwned(ctx, auth, p.id))
  },

  'delete-payment': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    await applyTransition(ctx, p.id, { kind: 'DELETE' })
    return { deleted: true, id: p.id }
  },

  'restore-removed-payment': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const r = await applyTransition(ctx, p.id, { kind: 'RESTORE' })
    return serializePayment(ctx.db, r.payment)
  },

  /**
   * Manual write-off. It does NOT create balance nor an entry — the money came in
   * outside the platform. It is easy to get this wrong and credit the account.
   */
  'confirm-cash-receipt': async ({ ctx, auth, params, body }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const b = body as Record<string, any>

    const on = b.paymentDate ? String(b.paymentDate) : ctx.clock.today()
    const value = b.value !== undefined ? brlToCents(Number(b.value)) : cents(p.valueCents)

    const r = await applyTransition(ctx, p.id, { kind: 'RECEIVE_IN_CASH', on, value })
    return serializePayment(ctx.db, r.payment)
  },

  'undo-cash-receipt-confirmation': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const r = await applyTransition(ctx, p.id, { kind: 'UNDO_RECEIVE_IN_CASH' })
    return serializePayment(ctx.db, r.payment)
  },

  'refund-payment': async ({ ctx, auth, params, body }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const b = (body ?? {}) as Record<string, any>

    const value = b.value !== undefined ? brlToCents(Number(b.value)) : cents(p.valueCents)
    if (value > p.valueCents) {
      throw invalid('value', 'O valor do estorno não pode ser maior que o valor da cobrança.')
    }

    const r = await applyTransition(ctx, p.id, {
      kind: 'REFUND',
      on: ctx.clock.today(),
      value,
    })

    await ctx.db.insert(paymentRefunds).values({
      id: ids.genericId(ctx.rng),
      paymentId: p.id,
      status: 'DONE',
      valueCents: value,
      description: b.description ?? null,
      // The fees are NOT refunded — Asaas keeps them.
      refundedFeeCents: 0,
      effectiveDate: ctx.clock.today(),
      transactionReceiptUrl: null,
      dateCreated: ctx.clock.timestamp(),
    })

    return serializePayment(ctx.db, r.payment)
  },

  /**
   * `POST /v3/payments/{id}/bankSlip/refund` — the refund of a PAID bank slip
   * (`refund-bank-slip`). The Hub calls it to give a paid boleto's money back.
   *
   * The spec's 200 response is NOT the payment: it is a single `requestUrl`
   * field, the "solicitar estorno" link the real Asaas returns. The payment
   * state still moves the same way — through `applyTransition`, which emits the
   * webhook and (when the money had already credited) reverses the ledger.
   */
  'refund-bank-slip': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)

    // Bank slip gateway only. Pix and card go through `refund-payment`.
    if (p.billingType !== 'BOLETO') {
      throw badRequest(
        'invalid_action',
        'O estorno por bankSlip só é possível para cobranças do tipo BOLETO.',
      )
    }

    // A status the machine cannot refund (PENDING, RECEIVED_IN_CASH, …) already
    // leaves here as 400 invalid_action: `plan()` rejects and `applyTransition`
    // converts that into the error — no need to duplicate the PAID list here.
    await applyTransition(ctx, p.id, { kind: 'REFUND', on: ctx.clock.today() })

    // Same shape as the transactionReceiptUrl built in apply.ts: the id
    // without the `pay_` prefix, on the public base URL.
    return {
      requestUrl: `${ctx.config.publicBaseUrl}/solicitar-estorno/${p.id.replace('pay_', '')}`,
    }
  },

  'get-digitable-bill-line': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    if (p.billingType !== 'BOLETO' && p.billingType !== 'UNDEFINED') {
      throw badRequest(
        'invalid_action',
        'A linha digitável só existe para cobranças com boleto.',
      )
    }
    // A fictional identification line, with the right format (47 digits in 5 blocks).
    const d = ctx.rng.digits(47)
    return {
      identificationField: `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33, 47)}`,
      nossoNumero: p.nossoNumero,
      barCode: ctx.rng.digits(44),
    }
  },

  'payment-viewing-information': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    return {
      invoiceViewedDate: p.lastInvoiceViewedDate,
      boletoViewedDate: p.lastBankSlipViewedDate,
    }
  },

  /**
   * How much is paid for this charge TODAY — with interest and fine if it is
   * overdue, with the discount if it is within the window.
   */
  'retrieve-payment-billing-information': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const totals = calcOverdueTotals(
      {
        originalValueCents: cents(p.originalValueCents ?? p.valueCents),
        dueDate: p.dueDate,
        fine: p.fine,
        interest: p.interest,
      },
      ctx.clock.today(),
    )

    return {
      creditCard: null,
      pix: null,
      bankSlip:
        p.billingType === 'BOLETO' || p.billingType === 'UNDEFINED'
          ? {
              identificationField: null,
              nossoNumero: p.nossoNumero,
              barCode: null,
              bankSlipUrl: p.bankSlipUrl,
              daysAfterDueDateToRegistrationCancellation:
                p.daysAfterDueDateToRegistrationCancellation,
            }
          : null,
      value: centsToBrl(cents(totals.value)),
    }
  },
}

/**
 * Actions that only exist in the sandbox — and that are the reason this simulator is
 * usable: without them you would have no way to "pay" a charge.
 */
export const sandboxHandlers: HandlerMap = {
  'confirm-payment': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    // PAY goes through the state machine: Pix goes straight to RECEIVED (with the
    // balance and the fee in the statement); bank slip and card stop at CONFIRMED and credit later.
    const r = await applyTransition(ctx, p.id, { kind: 'PAY', on: ctx.clock.today() })
    return serializePayment(ctx.db, r.payment)
  },

  'force-expire': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const r = await applyTransition(ctx, p.id, { kind: 'OVERDUE', on: ctx.clock.today() })
    return serializePayment(ctx.db, r.payment)
  },
}
