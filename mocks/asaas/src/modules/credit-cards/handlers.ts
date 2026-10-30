/**
 * Track H — credit card.
 *
 * Tokenization, capture of a pre-authorization, payment of an existing charge
 * with a card and the pre-authorization configuration.
 *
 * The creation of a charge with a card (`create-new-payment-with-credit-card`)
 * is NOT here: it shares the route `POST /v3/payments` with `create-new-payment`,
 * and whoever decides by the body is the canonical handler, in
 * `../payments/handlers.ts` — which calls `createPaymentWithCard()` of this
 * module. It is how the real Asaas does it.
 */
import { and, eq } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { invalid, notFound } from '../../core/errors.ts'
import { payments, settings } from '../../db/schema/index.ts'
import type { HandlerMap } from '../../http/register.ts'
import { applyTransition } from '../payments/apply.ts'
import { serializePayment, type PaymentRow } from '../payments/serializer.ts'
import { payExistingWithCard, tokenize } from './service.ts'

async function findOwned(ctx: AppContext, auth: AuthContext, id: string): Promise<PaymentRow> {
  const [row] = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.accountId, auth.accountId)))
    .limit(1)
  if (!row) throw notFound('Cobrança')
  return row as PaymentRow
}

/**
 * The pre-authorization configuration is ONE row per account, and it has no
 * table of its own: it lives in `settings`, which exists exactly for this.
 * Namespaced by account — isolation is an invariant, not a detail.
 */
const PRE_AUTH_KEY = (accountId: string) => `credit_card.pre_authorization:${accountId}`

/**
 * TODO(rule): the docs do not publish the default of `daysToExpire` nor the
 * accepted range. We use 5 (the example of the spec). A pre-authorization that
 * EXPIRES on its own after N days does not exist yet — it would need a job in
 * the scheduler; today an AUTHORIZED charge stays AUTHORIZED until someone
 * captures it. It is in progress.md.
 */
const DEFAULT_DAYS_TO_EXPIRE = 5

interface PreAuthConfig {
  daysToExpire: number
}

export const creditCardHandlers: HandlerMap = {
  /**
   * `POST /v3/creditCard/tokenizeCreditCard`
   *
   * It returns the LAST 4 digits — not a mask with asterisks, not the number.
   * The full PAN is not stored anywhere (not even in a log): `inspectCard`
   * (pure) already discards it.
   */
  'credit-card-tokenization': async ({ ctx, auth, body }) => {
    const card = await tokenize(ctx, auth, body as Record<string, any>)
    return {
      creditCardNumber: card.last4,
      creditCardBrand: card.brand,
      creditCardToken: card.creditCardToken,
    }
  },

  /**
   * `POST /v3/payments/{id}/captureAuthorizedPayment`
   *
   * It only works in AUTHORIZED. Capturing twice → 400 (the second one finds the
   * charge already CONFIRMED and the state machine refuses). It is the machine
   * that says no, not an `if` in this handler — that is why there is no way for
   * the two to diverge.
   */
  'capture-payment-with-pre-authorization': async ({ ctx, auth, params }) => {
    const p = await findOwned(ctx, auth, params.id!)
    const r = await applyTransition(ctx, p.id, { kind: 'CAPTURE', on: ctx.clock.today() })
    return serializePayment(ctx.db, r.payment)
  },

  /** `POST /v3/payments/{id}/payWithCreditCard` — pay an existing charge. */
  'pay-a-charge-with-credit-card': async ({ ctx, auth, params, body }) =>
    payExistingWithCard(ctx, auth, params.id!, body as Record<string, any>),

  /**
   * `POST /v3/payments/{id}/payWithCard` — the new version of the endpoint
   * above. The body is `{ cardType, card, cardToken }` instead of
   * `{ creditCard, creditCardToken }`; we translate it and fall into the same
   * path.
   */
  'pay-a-charge-with-card': async ({ ctx, auth, params, body }) => {
    const b = (body ?? {}) as Record<string, any>

    if (b.cardType !== undefined && b.cardType !== 'CREDIT') {
      throw invalid(
        'cardType',
        'Apenas cartão de crédito (CREDIT) é aceito. VOUCHER ainda não é simulado.',
      )
    }

    return payExistingWithCard(ctx, auth, params.id!, {
      creditCard: b.card ?? undefined,
      creditCardHolderInfo: b.card?.holder ?? undefined,
      creditCardToken: b.cardToken ?? undefined,
    })
  },

  'retrieve-pre-authorization-configuration': async ({ ctx, auth }) => {
    const [row] = await ctx.db
      .select()
      .from(settings)
      .where(eq(settings.key, PRE_AUTH_KEY(auth.accountId)))
      .limit(1)

    const config = (row?.value as PreAuthConfig | undefined) ?? {
      daysToExpire: DEFAULT_DAYS_TO_EXPIRE,
    }
    return { daysToExpire: config.daysToExpire }
  },

  'save-or-update-pre-authorization-configuration': async ({ ctx, auth, body }) => {
    const b = (body ?? {}) as Record<string, any>
    const days = Number(b.daysToExpire)

    if (!Number.isInteger(days) || days < 1) {
      throw invalid('daysToExpire', 'O prazo de expiração deve ser um número inteiro de dias.')
    }

    const key = PRE_AUTH_KEY(auth.accountId)
    const value: PreAuthConfig = { daysToExpire: days }
    const updatedAt = ctx.clock.timestamp()

    await ctx.db
      .insert(settings)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })

    return { daysToExpire: days }
  },
}

/** Re-exported for whoever needs the same refusal text. */
export { DECLINED } from './service.ts'
