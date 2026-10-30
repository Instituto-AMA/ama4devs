/**
 * The payer's side of a charge: the invoice page behind `invoiceUrl` and the bank
 * slip behind `bankSlipUrl`. NOT part of the Asaas API; it is the page Asaas hosts
 * for the person who pays.
 *
 *   GET  /i/:token          the invoice: value, due date, status, installments, how to pay
 *   POST /i/:token/pay      the payer pays: { method: PIX | BOLETO | CREDIT_CARD, card? }
 *   GET  /b/pdf/:token      the bank slip: the invoice page on its boleto tab
 *
 * Paying here runs the same paths as the API: PAY through the state machine for
 * Pix and boleto, `payExistingWithCard` (test cards decide the outcome) for a card.
 * So the ledger, the status and the webhooks move exactly as in a real payment.
 * The routes are key-free and sit behind the local guard, like `/_mock`.
 */
import { and, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { AppContext, AuthContext } from '../core/context.ts'
import { badRequest, notFound } from '../core/errors.ts'
import { accounts, customers, payments } from '../db/schema/index.ts'
import { brCodePayload } from '../domain/pix-brcode.ts'
import { qrPng } from '../domain/qrcode.ts'
import { payExistingWithCard } from '../modules/credit-cards/service.ts'
import { loadCardRules } from '../modules/credit-cards/test-cards.ts'
import { applyTransition } from '../modules/payments/apply.ts'
import { serializePayment, type PaymentRow } from '../modules/payments/serializer.ts'
import { renderInvoice, type InvoiceView } from './page.ts'

/** The statuses a payer can still pay. */
const PAYABLE = new Set(['PENDING', 'OVERDUE'])

type Method = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

/**
 * What the payer may choose. UNDEFINED ("ask the customer") offers all three; a
 * bank slip also offers Pix, as the Asaas bank slip carries a Pix QR code.
 */
export function methodsFor(billingType: string): Method[] {
  if (billingType === 'UNDEFINED') return ['PIX', 'BOLETO', 'CREDIT_CARD']
  if (billingType === 'BOLETO') return ['BOLETO', 'PIX']
  if (billingType === 'PIX') return ['PIX']
  if (billingType === 'CREDIT_CARD') return ['CREDIT_CARD']
  return []
}

/** A fake digitable line in the right shape (47 digits), stable for one charge. */
function digitableLine(paymentId: string): string {
  let seed = 0
  for (const ch of paymentId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  let d = ''
  while (d.length < 47) {
    seed = (seed * 1103515245 + 12345) >>> 0
    d += String(seed % 10)
  }
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33, 47)}`
}

const TOKEN = /^\d{6,20}$/

export function invoiceRoutes(ctx: AppContext) {
  const load = async (token: string) => {
    if (!TOKEN.test(token)) throw notFound('Cobrança')
    const [p] = await ctx.db
      .select()
      .from(payments)
      .where(eq(payments.id, `pay_${token}`))
      .limit(1)
    if (!p) throw notFound('Cobrança')
    const [account] = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, p.accountId))
      .limit(1)
    if (!account) throw notFound('Conta')
    return { p: p as PaymentRow, account }
  }

  /** The other installments of the same plan still waiting for payment, in order. */
  const pendingSiblings = async (p: PaymentRow): Promise<PaymentRow[]> => {
    if (!p.installmentId) return []
    const rows = (await ctx.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.installmentId, p.installmentId),
          eq(payments.accountId, p.accountId),
          eq(payments.deleted, false),
        ),
      )) as PaymentRow[]
    return rows
      .filter((r) => r.id !== p.id && PAYABLE.has(r.status))
      .sort((a, b) => Number(a.installmentNumber ?? 0) - Number(b.installmentNumber ?? 0))
  }

  const view = async (token: string): Promise<InvoiceView> => {
    const { p, account } = await load(token)

    const [customer] = p.customerId
      ? await ctx.db.select().from(customers).where(eq(customers.id, p.customerId)).limit(1)
      : []

    const siblings = p.installmentId
      ? await ctx.db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.installmentId, p.installmentId),
              eq(payments.accountId, p.accountId),
              eq(payments.deleted, false),
            ),
          )
      : []

    const payable = PAYABLE.has(p.status) && !p.deleted
    const methods = methodsFor(p.billingType)
    const pendingInPlan = siblings.filter((s) => PAYABLE.has(s.status))
    const cardPlan =
      payable && methods.includes('CREDIT_CARD') && pendingInPlan.length > 1
        ? {
            count: pendingInPlan.length,
            valueCents: pendingInPlan.reduce((sum, s) => sum + s.valueCents, 0),
          }
        : null

    const pixPayload = methods.includes('PIX')
      ? brCodePayload({
          url: `pix.localhost/qr/cobv/${token}`,
          merchantName: account.name,
          merchantCity: account.city ?? 'SAO PAULO',
          postalCode: account.postalCode ?? undefined,
        })
      : null

    return {
      token,
      merchant: { name: account.name, cpfCnpj: account.cpfCnpj },
      customer: customer
        ? { name: customer.name, cpfCnpj: customer.cpfCnpj, email: customer.email }
        : null,
      payment: {
        id: p.id,
        status: p.status,
        billingType: p.billingType,
        valueCents: p.valueCents,
        dueDate: p.dueDate,
        description: p.description,
        invoiceNumber: p.invoiceNumber,
        paymentDate: p.paymentDate ?? p.clientPaymentDate,
        deleted: p.deleted,
      },
      installments: siblings
        .map((s) => ({
          token: s.id.replace('pay_', ''),
          number: s.installmentNumber,
          dueDate: s.dueDate,
          valueCents: s.valueCents,
          status: s.status,
          current: s.id === p.id,
        }))
        .sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0)),
      methods,
      payable,
      cardPlan,
      testCards: (await loadCardRules(ctx.db)).table.map((c) => ({ number: c.number, label: c.label })),
      pix: pixPayload && payable ? { payload: pixPayload, image: qrPng(pixPayload) } : null,
      boletoLine: methods.includes('BOLETO') && payable ? digitableLine(p.id) : null,
      today: ctx.clock.today(),
    }
  }

  const html = (body: string) =>
    new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

  return new Elysia({ name: 'invoice-page' })
    .get('/i/:token', async ({ params }) => {
      const v = await view(params.token)
      // Asaas records when the payer opened the invoice (`invoiceViewedDate`).
      await ctx.db
        .update(payments)
        .set({ lastInvoiceViewedDate: ctx.clock.timestamp() })
        .where(eq(payments.id, v.payment.id))
      return html(renderInvoice(v))
    })
    .get('/b/pdf/:token', async ({ params, redirect }) => {
      const { p } = await load(params.token)
      await ctx.db
        .update(payments)
        .set({ lastBankSlipViewedDate: ctx.clock.timestamp() })
        .where(eq(payments.id, p.id))
      return redirect(`/i/${params.token}`, 302)
    })
    .post(
      '/i/:token/pay',
      async ({ params, body }) => {
        const { p, account } = await load(params.token)
        if (p.deleted) throw badRequest('invalid_action', 'Esta cobrança foi removida.')
        if (!PAYABLE.has(p.status)) {
          throw badRequest('invalid_action', 'Esta cobrança não está mais aguardando pagamento.')
        }
        const method = body.method as Method
        if (!methodsFor(p.billingType).includes(method)) {
          throw badRequest('invalid_billingType', 'Esta forma de pagamento não está disponível para esta cobrança.')
        }

        const auth: AuthContext = {
          accountId: p.accountId,
          walletId: account.walletId,
          apiKeyId: 'invoice-page',
        }

        if (method === 'CREDIT_CARD') {
          const first = (await payExistingWithCard(ctx, auth, p.id, {
            creditCard: body.card ?? {},
            remoteIp: '127.0.0.1',
          })) as Record<string, any>
          // An installment plan paid by card is settled "on the card": the card takes every
          // pending installment at once, each confirmed now and credited in its month.
          for (const sibling of await pendingSiblings(p)) {
            await payExistingWithCard(ctx, auth, sibling.id, {
              creditCardToken: first.creditCard?.creditCardToken,
              remoteIp: '127.0.0.1',
            })
          }
          return first
        }

        // The payer chose how to pay: the charge takes that billing type, as Asaas does.
        if (p.billingType !== method) {
          await ctx.db.update(payments).set({ billingType: method }).where(eq(payments.id, p.id))
        }
        const r = await applyTransition(ctx, p.id, { kind: 'PAY', on: ctx.clock.today() })
        return serializePayment(ctx.db, r.payment)
      },
      {
        body: t.Object({
          method: t.Union([t.Literal('PIX'), t.Literal('BOLETO'), t.Literal('CREDIT_CARD')]),
          card: t.Optional(
            t.Object({
              holderName: t.String(),
              number: t.String(),
              expiryMonth: t.String(),
              expiryYear: t.String(),
              ccv: t.String(),
            }),
          ),
        }),
      },
    )
}
