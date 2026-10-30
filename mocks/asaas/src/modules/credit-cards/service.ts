/**
 * Credit card — the impure layer: tokenization, token resolution and the
 * card charging flow.
 *
 * TWO ASAAS RULES THAT ARE EASY TO GET WRONG AND THAT LIVE HERE:
 *
 * 1. **The card charge is already born CONFIRMED.** The capture happens at
 *    creation time, INDEPENDENT of the `dueDate` — sending a `dueDate` 30 days
 *    from now postpones nothing. What the `dueDate` does is... nothing, on a card.
 *    The money credits at D+32 from the confirmation (job `credit-settlement`).
 *
 * 2. **A declined card → HTTP 400 and the charge DOES NOT exist.** It is not a
 *    charge with a "declined" status: it is not created at all. And the message is
 *    generic on purpose — telling the merchant (who passes it on to the buyer)
 *    "card over the limit" or "card blocked" is a stolen-card enumeration
 *    vector. Asaas does not say it, and neither do we.
 *
 * The full PAN never reaches the database: `inspectCard` (pure) returns only
 * `last4`, the brand and the outcome. There is no path here that persists the number.
 */
import { and, eq } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { AsaasError, badRequest, invalid, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { creditCards, customers, payments } from '../../db/schema/index.ts'
import {
  CARD_ERRORS,
  CreditCardError,
  declinesOnCharge,
  declinesOnTokenize,
  inspectCard,
  type CardInfo,
  type CardInput,
} from '../../domain/credit-card.ts'
import * as ids from '../../domain/ids.ts'
import { maxInstallmentsForBrand } from '../../domain/installments.ts'
import { applyTransition } from '../payments/apply.ts'
import { serializePayment, type PaymentRow } from '../payments/serializer.ts'
import { createPayment, parseCreateBody } from '../payments/service.ts'
import { cardApproves } from './capture.ts'
import { loadCardRules } from './test-cards.ts'

export type CreditCardRow = typeof creditCards.$inferSelect

/**
 * The refusal. Generic ON PURPOSE: Asaas does not say the reason — there is no
 * reason field in the body, and the two declining cards return the SAME sentence.
 * A mock that invented "insufficient funds" would teach the client to handle an
 * error production never sends.
 *
 * Code and sentence captured from the sandbox (tools/probe-cards.ts). Before this it
 * was `invalid_creditCard` with another text — invented, and wrong.
 */
export const DECLINED = badRequest(CARD_ERRORS.DECLINE.code, CARD_ERRORS.DECLINE.description)

/** Translates the pure domain error into Asaas's error format. */
function toApiError(err: unknown): never {
  if (err instanceof CreditCardError) throw badRequest(err.code, err.description)
  throw err
}

/** Inspects against the panel's table and policy (built-in plus added cards). */
export async function inspect(db: DB, card: CardInput, now: Date): Promise<CardInfo> {
  const rules = await loadCardRules(db)
  try {
    return inspectCard(card, now, rules.table, rules.policy)
  } catch (err) {
    return toApiError(err)
  }
}

/** `remoteIp` is mandatory in every card transaction. Asaas refuses without it. */
export function requireRemoteIp(body: Record<string, unknown>): string {
  const ip = String(body.remoteIp ?? '').trim()
  if (!ip) {
    throw invalid(
      'remoteIp',
      'O IP de origem da compra (remoteIp) é obrigatório em transações com cartão de crédito.',
    )
  }
  return ip
}

/** Does the body carry a card? (it is what decides between `create-new-payment` and the variant) */
export function hasCreditCard(body: Record<string, unknown>): boolean {
  return Boolean(body.creditCard) || Boolean(body.creditCardToken)
}

/**
 * A card ready to use: already tokenized (it came as `creditCardToken`) or raw
 * (it came as `creditCard`). In both cases we know the brand, last4 and outcome —
 * and in neither of them does the PAN survive this function.
 */
export interface ResolvedCard {
  info: CardInfo
  /** Filled in when it came by token: the card already exists in the database. */
  existing: CreditCardRow | null
  /** Filled in when it came raw: what is missing to store it. */
  raw: {
    holderName: string
    expiryMonth: string
    expiryYear: string
    holderInfo: Record<string, unknown> | null
  } | null
}

/**
 * Token not found — or found, but from ANOTHER customer. Asaas does not
 * distinguish the two cases: for it, a token that is not the charge's customer
 * simply "does not exist". Captured (tools/probe-tokenization.ts).
 *
 * Note the code: `invalid_creditCard`, not `invalid_creditCardToken`. And the
 * description CARRIES the token — we used to return a generic sentence.
 */
const tokenNotFound = (token: string) =>
  badRequest('invalid_creditCard', `CreditCardToken ${token} não encontrado.`)

/**
 * The fields Asaas requires when a `creditCard` object is PRESENT — and it
 * requires them even when a `creditCardToken` comes along. Captured: sending
 * `{creditCardToken, creditCard: {ccv}}` returns FOUR errors, one per field that
 * was missing. It is the trap of "revalidating the CVV on the repeat purchase":
 * the client thinks it is reinforcing security and Asaas rejects the whole request.
 */
const REQUIRED_CARD_FIELDS: ReadonlyArray<[key: string, description: string]> = [
  ['holderName', 'Informe o nome do portador.'],
  ['number', 'Informe o número do seu cartão.'],
  ['expiryMonth', 'Informe o mês de vencimento do seu cartão.'],
  ['expiryYear', 'Informe o ano de vencimento do seu cartão.'],
  ['ccv', 'Informe o código de segurança do seu cartão.'],
]

/**
 * Validates the PRESENCE of the fields and returns ALL the errors at once — Asaas
 * does not stop at the first. A client that only looks at `errors[0]` keeps
 * working; so does one that lists the missing fields.
 */
function assertCompleteCard(card: Record<string, any>): void {
  const missing = REQUIRED_CARD_FIELDS.filter(
    ([key]) => String(card[key] ?? '').trim() === '',
  ).map(([, description]) => ({ code: 'invalid_creditCard', description }))

  if (missing.length > 0) throw new AsaasError(400, missing)
}

/**
 * Resolves the card from the body WITHOUT storing anything. Pure from the
 * database's point of view (it only reads) — it is what lets a card be refused
 * without leaving junk persisted.
 *
 * `customerId` is the charge's OWNER customer. It is there because, in Asaas,
 * **the token is bound to the customer who created it**: using customer A's token
 * to charge B returns "not found". Without that parameter the mock accepted it
 * (and an app that shuffled tokens between customers would only find out in production).
 */
export async function resolveCard(
  ctx: AppContext,
  db: DB,
  accountId: string,
  body: Record<string, any>,
  customerId: string | null,
): Promise<ResolvedCard> {
  const token = body.creditCardToken ? String(body.creditCardToken) : null
  const card = body.creditCard as Record<string, any> | undefined

  // The PRESENCE of the `creditCard` key rules, even with a token along: Asaas
  // validates the whole object. `creditCard: {}` with a valid token is 400, not 200.
  if (card !== undefined) assertCompleteCard(card)

  if (token && card === undefined) {
    const [row] = await db
      .select()
      .from(creditCards)
      .where(and(eq(creditCards.creditCardToken, token), eq(creditCards.accountId, accountId)))
      .limit(1)

    // The token exists, but it belongs to another customer → for Asaas, it does not exist.
    if (!row || (row.customerId !== null && row.customerId !== customerId)) {
      throw tokenNotFound(token)
    }

    return {
      info: {
        last4: row.last4,
        brand: row.brand as CardInfo['brand'],
        // A card whose approvals ran out (panel, /_admin/credit-cards) declines.
        outcome: cardApproves(row) ? row.simulatedOutcome : 'DECLINE',
      },
      existing: row,
      raw: null,
    }
  }

  if (!card) {
    throw invalid(
      'creditCard',
      'Informe os dados do cartão de crédito (creditCard) ou um creditCardToken.',
    )
  }

  // The `now` from the CLOCK, not the system's: advancing 5 years in the panel has to
  // expire a 05/2027 card, otherwise time travel lies about the card.
  const info = await inspect(
    db,
    {
      number: String(card.number ?? ''),
      holderName: card.holderName,
      expiryMonth: card.expiryMonth === undefined ? undefined : String(card.expiryMonth),
      expiryYear: card.expiryYear === undefined ? undefined : String(card.expiryYear),
      ccv: card.ccv === undefined ? undefined : String(card.ccv),
    },
    ctx.clock.now(),
  )

  return {
    info,
    existing: null,
    raw: {
      holderName: String(card.holderName ?? ''),
      expiryMonth: String(card.expiryMonth ?? ''),
      expiryYear: String(card.expiryYear ?? ''),
      holderInfo: (body.creditCardHolderInfo as Record<string, unknown>) ?? null,
    },
  }
}

/**
 * Stores the card (or reuses the already tokenized one) and returns the row id.
 * Only the `last4` goes to the database — the PAN no longer exists at this point.
 */
export async function persistCard(
  ctx: AppContext,
  db: DB,
  accountId: string,
  customerId: string | null,
  resolved: ResolvedCard,
): Promise<CreditCardRow> {
  if (resolved.existing) return resolved.existing

  const raw = resolved.raw!
  const row: CreditCardRow = {
    id: ids.genericId(ctx.rng),
    accountId,
    customerId,
    creditCardToken: ids.creditCardToken(ctx.rng),
    last4: resolved.info.last4,
    brand: resolved.info.brand,
    holderName: raw.holderName,
    expiryMonth: raw.expiryMonth,
    expiryYear: raw.expiryYear,
    simulatedOutcome: declinesOnCharge(resolved.info.outcome) ? 'DECLINE' : 'APPROVE',
    approvalsLeft: null,
    holderInfo: raw.holderInfo,
    dateCreated: ctx.clock.timestamp(),
  }

  await db.insert(creditCards).values(row)
  return row
}

/** Does the customer exist and belong to this account? (per-account isolation) */
export async function assertOwnedCustomer(
  ctx: AppContext,
  db: DB,
  accountId: string,
  customerId: string,
): Promise<void> {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.accountId, accountId)))
    .limit(1)
  if (!customer) throw notFound('Cliente')
}

/** `POST /v3/creditCard/tokenizeCreditCard` */
export async function tokenize(
  ctx: AppContext,
  auth: AuthContext,
  body: Record<string, any>,
): Promise<CreditCardRow> {
  requireRemoteIp(body)

  const customerId = String(body.customer ?? '')
  await assertOwnedCustomer(ctx, ctx.db, auth.accountId, customerId)

  const resolved = await resolveCard(ctx, ctx.db, auth.accountId, body, customerId)

  /**
   * The TOKENIZATION AUTHORIZES. Captured: tokenizing `5184019740373151` (the
   * declining card) returns **400 invalid_action** in the real sandbox — not a token.
   *
   * It makes sense: Asaas does a zero-amount authorization to prove that the card
   * is alive before storing it. And it changes the "save the card" feature: the bad
   * card is rejected AT THE MOMENT of saving, and not on the first charge, three
   * weeks later. We used to tokenize anything and only refuse at charging time —
   * the app showed "card saved!" and failed on the next purchase.
   */
  if (declinesOnTokenize(resolved.info.outcome)) throw DECLINED

  return ctx.db.transaction(async (tx) =>
    persistCard(ctx, tx as unknown as DB, auth.accountId, customerId, resolved),
  )
}

/**
 * The brand limits the installments: Visa/Mastercard up to 21x, the others up to 12x.
 * (Asaas's rule, not the acquirer's.)
 */
export function assertInstallmentsAllowed(brand: string, count: number): void {
  const max = maxInstallmentsForBrand(brand)
  if (count > max) {
    throw invalid(
      'installmentCount',
      `A bandeira ${brand} aceita no máximo ${max} parcelas no cartão de crédito.`,
    )
  }
}

/**
 * `POST /v3/payments` with a card — the `create-new-payment-with-credit-card` variant.
 *
 * Approved → the charge is born and goes to CONFIRMED right away (CONFIRM trigger).
 * `authorizeOnly` → it stops at AUTHORIZED (AUTHORIZE trigger), without credit.
 * Declined → 400, and nothing is stored (neither the charge nor the card).
 */
export async function createPaymentWithCard(
  ctx: AppContext,
  auth: AuthContext,
  body: Record<string, any>,
): Promise<Record<string, unknown>> {
  const input = parseCreateBody(body)

  if (input.billingType !== 'CREDIT_CARD') {
    throw invalid(
      'billingType',
      'Para pagar com cartão de crédito, billingType deve ser CREDIT_CARD.',
    )
  }

  requireRemoteIp(body)
  await assertOwnedCustomer(ctx, ctx.db, auth.accountId, input.customerId)

  // Resolves (and VALIDATES) the card before storing anything.
  const resolved = await resolveCard(ctx, ctx.db, auth.accountId, body, input.customerId)

  // An installment plan does not get here: `create-new-payment` diverts to the
  // installments flow before calling us. This is the door of the single-payment charge.
  assertInstallmentsAllowed(resolved.info.brand, 1)

  // The refusal happens BEFORE any write: the charge does not come to exist.
  if (declinesOnCharge(resolved.info.outcome)) throw DECLINED

  const authorizeOnly = body.authorizeOnly === true
  const on = ctx.clock.today()

  const row = await ctx.db.transaction(async (t) => {
    const tx = t as unknown as DB

    const card = await persistCard(ctx, tx, auth.accountId, input.customerId, resolved)

    const created = await createPayment(ctx, tx, auth.accountId, auth.walletId, {
      ...input,
      creditCardId: card.id,
    })

    /**
     * EVERY status change goes through here. Never `UPDATE payments SET status`.
     * AUTHORIZE → pre-authorization (it does not credit).
     * CONFIRM   → captured now; it credits at D+32 by the scheduler.
     */
    const r = await applyTransition(
      ctx,
      created.id,
      authorizeOnly ? { kind: 'AUTHORIZE' } : { kind: 'CONFIRM', on },
      tx,
    )

    return r.payment
  })

  return serializePayment(ctx.db, row)
}

/**
 * `POST /v3/payments/{id}/payWithCreditCard` and `/payWithCard` — paying a charge
 * that ALREADY EXISTS with a card.
 *
 * Mind the `billingType`: a charge created as UNDEFINED (or bank slip) and paid
 * with a card BECOMES a card charge — and therefore the fee charged becomes the
 * card's one and the credit goes to D+32. That is a change of `billingType`, not
 * of status: it is still `applyTransition` who moves the status.
 */
export async function payExistingWithCard(
  ctx: AppContext,
  auth: AuthContext,
  paymentId: string,
  body: Record<string, any>,
): Promise<Record<string, unknown>> {
  const [payment] = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.accountId, auth.accountId)))
    .limit(1)

  if (!payment) throw notFound('Cobrança')
  if (payment.deleted) {
    throw badRequest('invalid_action', 'Não é possível pagar uma cobrança removida.')
  }

  const resolved = await resolveCard(ctx, ctx.db, auth.accountId, body, payment.customerId)
  if (declinesOnCharge(resolved.info.outcome)) throw DECLINED

  const on = ctx.clock.today()

  const row = await ctx.db.transaction(async (t) => {
    const tx = t as unknown as DB

    const card = await persistCard(ctx, tx, auth.accountId, payment.customerId, resolved)

    // billingType and creditCardId — NOT status. The status is applyTransition's.
    await tx
      .update(payments)
      .set({ billingType: 'CREDIT_CARD', creditCardId: card.id })
      .where(eq(payments.id, payment.id))

    const r = await applyTransition(ctx, payment.id, { kind: 'CONFIRM', on }, tx)
    return r.payment as PaymentRow
  })

  return serializePayment(ctx.db, row)
}
