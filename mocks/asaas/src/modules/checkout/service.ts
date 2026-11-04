/**
 * The life of a hosted checkout after its creation: the payer pays it, or it
 * expires. Asaas has no API call for either — they happen on its hosted page
 * and on its clock — so here they are reached by the checkout page
 * (`src/checkout/routes.ts`), by `/_mock/checkouts/:id/*` and by the scheduler.
 *
 * Paying runs the same paths as the API: a RECURRENT checkout becomes a card
 * subscription (`createSubscription`) whose first charge is paid on the spot; a
 * DETACHED one becomes a single charge (`createPayment`) paid by Pix or card.
 * So the ledger, the statuses and the webhooks move exactly as in a real payment.
 *
 * What is known about the real flow, and from where:
 *   - the subscription and the charges carry `checkoutSession: <checkout id>`;
 *     neither carries the checkout's `externalReference`, and CHECKOUT_PAID does
 *     not carry the subscription id. Observed by an integration against the real
 *     sandbox (Plano+ Hub, `checkout_subscription_binding.go`), not documented.
 *   - the order of CHECKOUT_PAID against the subscription and payment events is
 *     not fixed: the same integration received both orders. `eventOrder` picks.
 *   - TODO(rule): a refused card on the hosted page. Assumed: nothing is created,
 *     no webhook, the checkout stays ACTIVE and the payer may try again.
 *   - TODO(rule): INSTALLMENT checkouts are not paid by the simulator yet.
 */
import { and, eq, lte } from 'drizzle-orm'
import { toBusinessTimestamp } from '../../core/clock.ts'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { badRequest, invalid, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { accounts, checkouts, creditCards, customers, payments } from '../../db/schema/index.ts'
import { isValidIsoDate, type Cycle } from '../../domain/calendar.ts'
import { declinesOnCharge } from '../../domain/credit-card.ts'
import type { BillingType } from '../../domain/fees.ts'
import { cents, centsToBrl } from '../../domain/money.ts'
import { validateSplits } from '../../domain/split.ts'
import { getOperation } from '../../generated/operations.ts'
import type { TickReport } from '../../scheduler/scheduler.ts'
import { DECLINED, inspect, payExistingWithCard } from '../credit-cards/service.ts'
import { customerHandlers } from '../customers/handlers.ts'
import { applyTransition } from '../payments/apply.ts'
import { serializePayment, type PaymentRow } from '../payments/serializer.ts'
import { createPayment, parseSplits } from '../payments/service.ts'
import { serializeSubscription } from '../subscriptions/serializer.ts'
import { createSubscription, CYCLES } from '../subscriptions/handlers.ts'

export type CheckoutRow = typeof checkouts.$inferSelect

export interface CheckoutPayload {
  billingTypes: string[]
  chargeTypes: string[]
  minutesToExpire: number
  externalReference: string | null
  callback: Record<string, unknown>
  items: Record<string, unknown>[]
  /** An existing customer (overlay 009); filled with the payer's customer once paid. */
  customer: string | null
  customerData: Record<string, unknown> | null
  subscription: Record<string, unknown> | null
  installment: Record<string, unknown> | null
  split: Record<string, unknown>[] | null
}

export function serializeCheckout(row: CheckoutRow) {
  const p = row.payload as unknown as CheckoutPayload
  return {
    id: row.id,
    link: row.link,
    status: row.status,
    billingTypes: p.billingTypes,
    chargeTypes: p.chargeTypes,
    minutesToExpire: p.minutesToExpire,
    externalReference: p.externalReference,
    callback: p.callback,
    items: p.items,
    customer: p.customer ?? null,
    customerData: p.customerData,
    subscription: p.subscription,
    installment: p.installment,
    split: p.split,
  }
}

/** The card the simulator pays with when the caller sends none: a test card that approves. */
const DEFAULT_CARD = {
  holderName: 'TITULAR TESTE',
  number: '5162306219378829',
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
}

export type CheckoutEventOrder = 'CHECKOUT_FIRST' | 'PAYMENT_FIRST'

export interface PayCheckoutInput {
  /** One of the checkout's `chargeTypes`; the first one when omitted. */
  chargeType?: string
  /** One of the checkout's `billingTypes`; the first one when omitted. */
  billingType?: string
  creditCard?: Record<string, unknown>
  creditCardHolderInfo?: Record<string, unknown>
  /** The payer, when the checkout has neither `customer` nor `customerData`. */
  customerData?: Record<string, unknown>
  /** Where CHECKOUT_PAID goes in the webhook queue. Default: CHECKOUT_FIRST. */
  eventOrder?: CheckoutEventOrder
}

/** A checkout by id, in any account: the payer's page and `/_mock` carry no key. */
export async function loadCheckout(ctx: AppContext, id: string): Promise<CheckoutRow> {
  const [row] = await ctx.db.select().from(checkouts).where(eq(checkouts.id, id)).limit(1)
  if (!row) throw notFound('Checkout')
  return row
}

/** Has its `minutesToExpire` run out on the (possibly virtual) clock? */
export function isPastExpiration(ctx: AppContext, row: CheckoutRow): boolean {
  return row.expirationDate !== null && row.expirationDate <= ctx.clock.timestamp()
}

/**
 * ACTIVE → `to`, with compare-and-swap, emitting CHECKOUT_<to> in the same
 * transaction. Returns the row as it ended, or `null` when another caller got
 * there first.
 */
async function transition(
  ctx: AppContext,
  row: CheckoutRow,
  to: 'PAID' | 'EXPIRED',
  payload: CheckoutPayload = row.payload as unknown as CheckoutPayload,
): Promise<CheckoutRow | null> {
  return ctx.db.transaction(async (t) => {
    const tx = t as unknown as DB
    const claimed = await tx
      .update(checkouts)
      .set({ status: to, payload: payload as unknown as Record<string, unknown> })
      .where(and(eq(checkouts.id, row.id), eq(checkouts.status, 'ACTIVE')))
      .returning()
    const ended = claimed[0] as CheckoutRow | undefined
    if (!ended) return null

    await ctx.emit(tx, {
      accountId: row.accountId,
      event: `CHECKOUT_${to}`,
      resourceType: 'checkout',
      resourceId: row.id,
      resource: serializeCheckout(ended),
    })
    return ended
  })
}

/** ACTIVE → EXPIRED and CHECKOUT_EXPIRED, once. False when it was no longer ACTIVE. */
export async function expireCheckout(ctx: AppContext, row: CheckoutRow): Promise<boolean> {
  return (await transition(ctx, row, 'EXPIRED')) !== null
}

/** The scheduler's pass: every ACTIVE checkout whose expiration passed. */
export async function expireDue(ctx: AppContext, report?: TickReport): Promise<void> {
  const due = await ctx.db
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.status, 'ACTIVE'), lte(checkouts.expirationDate, ctx.clock.timestamp())))

  for (const row of due) {
    if (await expireCheckout(ctx, row)) {
      report?.transitions.push({
        resource: 'checkout',
        id: row.id,
        from: 'ACTIVE',
        to: 'EXPIRED',
        job: 'checkout-expiry',
      })
    }
  }
}

/** The account that issued the checkout, as the API would authenticate it. */
async function issuerAuth(ctx: AppContext, accountId: string): Promise<AuthContext> {
  const [account] = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1)
  if (!account) throw notFound('Conta')
  return { accountId, walletId: account.walletId, apiKeyId: 'checkout-page' }
}

/**
 * The payer: the checkout's customer, or a new one from `customerData` (the
 * checkout's, or what the payer typed on the page), through the same handler as
 * POST /v3/customers so the CPF/CNPJ is checked the same way.
 */
async function resolvePayer(
  ctx: AppContext,
  auth: AuthContext,
  payload: CheckoutPayload,
  input: PayCheckoutInput,
): Promise<string> {
  if (payload.customer) {
    const [owned] = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, payload.customer), eq(customers.accountId, auth.accountId)))
      .limit(1)
    if (!owned) throw notFound('Cliente')
    return owned.id
  }

  const data = payload.customerData ?? input.customerData
  if (!data) {
    throw invalid('customerData', 'Informe os dados do pagador (nome e CPF/CNPJ).')
  }
  const created = (await customerHandlers['create-new-customer']!({
    ctx,
    auth,
    body: data,
    params: {},
    query: {},
    headers: {},
    operation: getOperation('create-new-customer'),
  })) as { id: string }
  return created.id
}

function pick(options: string[], chosen: string | undefined, field: string): string {
  const value = chosen ?? options[0]
  if (!value || !options.includes(value)) {
    throw invalid(field, `Este checkout aceita apenas: ${options.join(', ')}.`)
  }
  return value
}

/**
 * The checks `createSubscription` and `generateOne` make, made before the
 * checkout is claimed: a CHECKOUT_PAID already queued cannot be taken back when
 * the subscription fails, or is born expired with no charge to pay.
 */
function assertSubscriptionTerms(payload: CheckoutPayload): void {
  const terms = payload.subscription ?? {}
  if (!CYCLES.includes(String(terms.cycle ?? '') as Cycle)) {
    throw invalid('cycle', `Ciclo inválido. Use um de: ${CYCLES.join(', ')}.`)
  }
  const nextDueDate = String(terms.nextDueDate ?? '')
  if (!isValidIsoDate(nextDueDate)) {
    throw invalid('nextDueDate', 'A data do próximo vencimento é inválida.')
  }
  if (terms.endDate === undefined || terms.endDate === null) return
  const endDate = String(terms.endDate)
  if (!isValidIsoDate(endDate)) {
    throw invalid('endDate', 'A data de término é inválida.')
  }
  // TODO(rule): what Asaas answers is not captured; without this the
  // subscription would expire before its first charge and nothing would be paid.
  if (endDate < nextDueDate) {
    throw invalid('endDate', 'A data de término não pode ser anterior ao primeiro vencimento.')
  }
}

/**
 * The checkout's `split` in the shape the subscription and charge parsers read.
 * The checkout calls the percentage `percentageValue`, the charge `percentualValue`
 * (both from the spec); `totalFixedValue` belongs to installments, not paid here.
 */
function checkoutSplits(payload: CheckoutPayload): Record<string, unknown>[] {
  return (payload.split ?? []).map((s) => ({
    walletId: s.walletId,
    fixedValue: s.fixedValue ?? undefined,
    percentualValue: s.percentageValue ?? undefined,
  }))
}

/** The split checks `createPayment` and `createSubscription` make, made before the claim. */
function assertSplits(splits: Record<string, unknown>[], ownWalletId: string): void {
  const errors = validateSplits(parseSplits(splits), ownWalletId)
  if (errors.length) throw invalid('split', errors[0]!.description)
}

function describe(payload: CheckoutPayload): string {
  return payload.items.map((i) => String(i.name ?? '')).filter(Boolean).join(', ')
}

/** The subscription's first charge, generated by `createSubscription`. */
async function firstCharge(ctx: AppContext, subscriptionId: string): Promise<PaymentRow> {
  const [row] = await ctx.db
    .select()
    .from(payments)
    .where(eq(payments.subscriptionId, subscriptionId))
    .limit(1)
  if (!row) throw notFound('Cobrança')
  return row as PaymentRow
}

async function cardTokenOf(ctx: AppContext, creditCardId: string | null): Promise<string> {
  const [card] = creditCardId
    ? await ctx.db.select().from(creditCards).where(eq(creditCards.id, creditCardId)).limit(1)
    : []
  if (!card) throw notFound('Cartão')
  return card.creditCardToken
}

/**
 * Pays the checkout as its payer would on the hosted page. Every check runs
 * before anything is created, so a refusal leaves the checkout ACTIVE and payable.
 */
export async function payCheckout(ctx: AppContext, id: string, input: PayCheckoutInput = {}) {
  const row = await loadCheckout(ctx, id)
  if (row.status === 'ACTIVE' && isPastExpiration(ctx, row)) {
    await expireCheckout(ctx, row)
    throw badRequest('invalid_action', 'Este checkout expirou e não pode mais ser pago.')
  }
  if (row.status !== 'ACTIVE') {
    throw badRequest('invalid_action', `Não é possível pagar um checkout com status ${row.status}.`)
  }

  const payload = row.payload as unknown as CheckoutPayload
  const chargeType = pick(payload.chargeTypes, input.chargeType, 'chargeType')
  if (chargeType === 'INSTALLMENT') {
    throw badRequest('invalid_chargeType', 'O simulador ainda não paga checkouts parcelados (INSTALLMENT).')
  }
  const billingType = pick(payload.billingTypes, input.billingType, 'billingType')
  if (chargeType === 'RECURRENT' && billingType !== 'CREDIT_CARD') {
    throw invalid('billingType', 'Uma assinatura no checkout só pode ser paga com cartão de crédito.')
  }

  if (chargeType === 'RECURRENT') assertSubscriptionTerms(payload)

  const card = { ...DEFAULT_CARD, ...(input.creditCard ?? {}) }
  if (billingType === 'CREDIT_CARD') {
    const info = await inspect(ctx.db, card as never, ctx.clock.now())
    if (declinesOnCharge(info.outcome)) throw DECLINED
  }

  const auth = await issuerAuth(ctx, row.accountId)
  const splits = checkoutSplits(payload)
  assertSplits(splits, auth.walletId)

  const customerId = await resolvePayer(ctx, auth, payload, input)
  const paidPayload: CheckoutPayload = { ...payload, customer: customerId }
  const order: CheckoutEventOrder = input.eventOrder ?? 'CHECKOUT_FIRST'

  // CHECKOUT_FIRST claims and announces the payment before the charge exists;
  // PAYMENT_FIRST claims nothing until the charge is paid. Everything that can
  // refuse ran above, so neither order is left half done. The re-check below
  // keeps a checkout from being paid twice: this path never yields to another
  // request (bun:sqlite is synchronous), so only two processes sharing one
  // database file could interleave here.
  let paid: CheckoutRow | null = null
  if (order === 'CHECKOUT_FIRST') {
    paid = await transition(ctx, row, 'PAID', paidPayload)
    if (!paid) throw badRequest('invalid_action', 'Este checkout já não está mais ativo.')
  } else if ((await loadCheckout(ctx, id)).status !== 'ACTIVE') {
    throw badRequest('invalid_action', 'Este checkout já não está mais ativo.')
  }

  const result =
    chargeType === 'RECURRENT'
      ? await paySubscription(ctx, auth, row, payload, customerId, card, splits, input)
      : await payDetached(ctx, auth, row, payload, customerId, billingType, card, splits, input)

  if (order === 'PAYMENT_FIRST') {
    paid = await transition(ctx, row, 'PAID', paidPayload)
    if (!paid) throw badRequest('invalid_action', 'Este checkout já não está mais ativo.')
  }

  return { checkout: serializeCheckout(paid!), ...result }
}

async function paySubscription(
  ctx: AppContext,
  auth: AuthContext,
  row: CheckoutRow,
  payload: CheckoutPayload,
  customerId: string,
  card: Record<string, unknown>,
  splits: Record<string, unknown>[],
  input: PayCheckoutInput,
) {
  const terms = payload.subscription ?? {}
  const sub = await createSubscription(
    ctx,
    auth,
    {
      customer: customerId,
      billingType: 'CREDIT_CARD',
      value: centsToBrl(cents(row.valueCents ?? 0)),
      cycle: terms.cycle,
      nextDueDate: terms.nextDueDate,
      endDate: terms.endDate ?? null,
      description: describe(payload),
      creditCard: card,
      creditCardHolderInfo: input.creditCardHolderInfo ?? null,
      split: splits,
    },
    { checkoutSession: row.id },
  )

  // The payer is at the page now: the first charge is paid on the spot, with
  // the card the subscription just saved (the same one later charges use).
  const charge = await firstCharge(ctx, sub.id)
  const payment = await payExistingWithCard(ctx, auth, charge.id, {
    creditCardToken: await cardTokenOf(ctx, sub.creditCardId),
  })
  return { subscription: await serializeSubscription(ctx.db, sub), payment }
}

async function payDetached(
  ctx: AppContext,
  auth: AuthContext,
  row: CheckoutRow,
  payload: CheckoutPayload,
  customerId: string,
  billingType: string,
  card: Record<string, unknown>,
  splits: Record<string, unknown>[],
  input: PayCheckoutInput,
) {
  const charge = await createPayment(ctx, ctx.db, auth.accountId, auth.walletId, {
    customerId,
    billingType: billingType as BillingType,
    valueCents: cents(row.valueCents ?? 0),
    dueDate: ctx.clock.today(),
    description: describe(payload),
    splits: parseSplits(splits),
    checkoutSession: row.id,
  })

  if (billingType === 'CREDIT_CARD') {
    const payment = await payExistingWithCard(ctx, auth, charge.id, {
      creditCard: card,
      creditCardHolderInfo: input.creditCardHolderInfo ?? null,
    })
    return { payment }
  }

  const r = await applyTransition(ctx, charge.id, { kind: 'PAY', on: ctx.clock.today() })
  return { payment: await serializePayment(ctx.db, r.payment) }
}

/** `expirationDate` for a checkout created now: in SIMULATED time. */
export function expirationFor(ctx: AppContext, minutesToExpire: number): string {
  return toBusinessTimestamp(new Date(ctx.clock.nowMs() + minutesToExpire * 60_000))
}
