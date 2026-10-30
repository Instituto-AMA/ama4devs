/**
 * Anticipation of receivables. (Track D)
 *
 * What really happens when you anticipate:
 *
 *   TODAY            RECEIVABLE_ANTICIPATION_GROSS_CREDIT  +net of the charge
 *                    RECEIVABLE_ANTICIPATION_FEE           −anticipation fee
 *   D+32 (settled)   PAYMENT_RECEIVED                      +gross
 *                    PAYMENT_FEE                           −charge fee
 *                    RECEIVABLE_ANTICIPATION_DEBIT         −net (already paid out)
 *
 * Sum them all: the merchant keeps the net of the charge MINUS the anticipation
 * fee — and the money came in today, not at D+32. The four entries of the
 * future cancel each other out, and that is why the statement keeps matching
 * the balance.
 *
 * Getting this wrong is easy and expensive: crediting the GROSS in the
 * anticipation would hand the charge fee back to the merchant, and the balance
 * would diverge forever.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { badRequest, invalid, notFound } from '../../core/errors.ts'
import { postEntries, type LedgerEntry } from '../../core/ledger.ts'
import type { DB } from '../../db/client.ts'
import { anticipations, payments, settings } from '../../db/schema/index.ts'
import { isAnticipableBillingType, quoteAnticipation } from '../../domain/anticipation.ts'
import type { AnticipationQuote } from '../../domain/anticipation.ts'
import type { BillingType } from '../../domain/fees.ts'
import * as ids from '../../domain/ids.ts'
import { cents } from '../../domain/money.ts'
import type { PaymentRow } from '../payments/serializer.ts'
import { serializeAnticipation, type AnticipationRow } from './serializer.ts'

/** Anticipations that still "occupy" the receivable. */
const OPEN_STATUSES = ['PENDING', 'SCHEDULED', 'CREDITED'] as const

/**
 * TODO(rule): the anticipation limit is a credit analysis of Asaas — there is
 * no public formula, and there could not be. We use a fixed ceiling,
 * configurable per environment, and subtract from it what is already anticipated
 * and has not settled yet. The number (R$ 50.000,00) is the one of the spec's
 * own example.
 */
export const ANTICIPATION_LIMIT_CENTS = cents(5_000_000)

export interface AnticipationTarget {
  payment: PaymentRow
  quote: AnticipationQuote
  /** Confirmed charge → the money is certain, it credits now. */
  creditsNow: boolean
}

/**
 * Resolves the charge of the body and validates whether it can be anticipated.
 *
 * `simulate` relaxes only what is about the state of the anticipation (a
 * simulation does not care whether there is a request in progress) — the
 * receivable rules still hold.
 */
export async function resolveTarget(
  ctx: AppContext,
  auth: AuthContext,
  body: unknown,
  opts: { simulate: boolean },
): Promise<AnticipationTarget> {
  const b = (body ?? {}) as Record<string, any>

  if (b.installment) {
    // Being honest means saying we do not know: an installment plan is track E,
    // and anticipating an installment plan has its own rule (the whole set of
    // installments is anticipated, not a single installment). Returning an
    // invented number here would be the worst outcome.
    throw badRequest(
      'not_implemented',
      'A antecipação de parcelamento ainda não foi implementada neste simulador. ' +
        'Use `payment`.',
    )
  }
  if (!b.payment) {
    throw invalid('payment', 'Informe a cobrança a ser antecipada.')
  }

  const [row] = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.id, String(b.payment)), eq(payments.accountId, auth.accountId)))
    .limit(1)
  if (!row || row.deleted) throw notFound('Cobrança')

  const payment = row as PaymentRow
  const billingType = payment.billingType as BillingType

  if (!isAnticipableBillingType(billingType)) {
    throw invalid(
      'payment',
      'Só é possível antecipar cobranças de cartão de crédito ou boleto.',
    )
  }

  // PIX and cash in hand do not get here. What is left are the receivable states:
  //   PENDING   → the payer has not paid yet   → SCHEDULED anticipation
  //   CONFIRMED → paid, waiting for the credit  → CREDITED anticipation now
  //   the rest  → there is no future receivable to anticipate
  if (payment.status !== 'PENDING' && payment.status !== 'CONFIRMED') {
    throw invalid(
      'payment',
      `Não é possível antecipar uma cobrança com status ${payment.status}.`,
    )
  }

  if (!opts.simulate) {
    if (payment.anticipated) {
      throw invalid('payment', 'Esta cobrança já foi antecipada.')
    }
    const [open] = await ctx.db
      .select({ id: anticipations.id })
      .from(anticipations)
      .where(
        and(
          eq(anticipations.paymentId, payment.id),
          inArray(anticipations.status, [...OPEN_STATUSES]),
        ),
      )
      .limit(1)
    if (open) {
      throw invalid('payment', 'Já existe uma antecipação em andamento para esta cobrança.')
    }
  }

  const quote = quoteFor(ctx, payment)

  return { payment, quote, creditsNow: payment.status === 'CONFIRMED' }
}

/** The quote. Pure inside — here we only gather the arguments. */
export function quoteFor(ctx: AppContext, payment: PaymentRow): AnticipationQuote {
  return quoteAnticipation({
    fees: ctx.config.fees,
    billingType: payment.billingType as BillingType,
    // TODO(rule): an installment plan is track E. With a single installment, the
    // fee is the one of a "one-off" card — the most expensive of the two, so we
    // do not underestimate.
    installmentCount: 1,
    totalValueCents: cents(payment.valueCents),
    paymentFeeCents: cents(payment.feeCents),
    // `estimatedCreditDate` is filled at the creation of the charge and rewritten
    // at the confirmation. It is the day the money would fall without the
    // anticipation.
    expectedCreditDate: payment.estimatedCreditDate ?? payment.dueDate,
    today: ctx.clock.today(),
  })
}

/**
 * Creates the anticipation. If the receivable is already confirmed, the money
 * comes in NOW.
 */
export async function requestAnticipation(
  ctx: AppContext,
  accountId: string,
  target: AnticipationTarget,
): Promise<Record<string, unknown>> {
  const { payment, quote, creditsNow } = target
  const today = ctx.clock.today()

  return ctx.db.transaction(async (tx) => {
    const db = tx as unknown as DB

    /**
     * COMPARE-AND-SWAP on the `anticipated` of the charge: of two simultaneous
     * requests for the same charge only one passes. It is the lock that stops
     * the same receivable from being anticipated twice — the most expensive
     * defect this module can have.
     */
    const claimed = await db
      .update(payments)
      .set({ anticipated: true })
      .where(and(eq(payments.id, payment.id), eq(payments.anticipated, false)))
      .returning({ id: payments.id })

    if (!claimed.length) {
      throw invalid('payment', 'Esta cobrança já foi antecipada.')
    }

    const [row] = await db
      .insert(anticipations)
      .values({
        id: ids.anticipationId(ctx.rng), // UUID puro
        accountId,
        paymentId: payment.id,
        installmentId: payment.installmentId,
        status: creditsNow ? 'CREDITED' : 'SCHEDULED',
        totalValueCents: quote.totalValueCents,
        valueCents: quote.valueCents,
        feeCents: quote.feeCents,
        netValueCents: quote.netValueCents,
        anticipationDays: quote.anticipationDays,
        requestDate: today,
        anticipationDate: creditsNow ? today : null,
        dueDate: payment.estimatedCreditDate ?? payment.dueDate,
        denialObservation: null,
        dateCreated: today,
      })
      .returning()

    const anticipation = row as AnticipationRow

    if (creditsNow) {
      await postCredit(ctx, db, anticipation)
    }

    const body = serializeAnticipation(anticipation)
    await emitAnticipation(
      ctx,
      db,
      accountId,
      anticipation.id,
      creditsNow ? 'RECEIVABLE_ANTICIPATION_CREDITED' : 'RECEIVABLE_ANTICIPATION_SCHEDULED',
      body,
    )

    return body
  })
}

/** The two entries of the credit. Call it INSIDE the transaction. */
export async function postCredit(
  ctx: AppContext,
  db: DB,
  a: AnticipationRow,
): Promise<void> {
  const entries: LedgerEntry[] = [
    {
      accountId: a.accountId,
      type: 'RECEIVABLE_ANTICIPATION_GROSS_CREDIT',
      valueCents: cents(a.valueCents),
      description: 'Antecipação de recebível',
      anticipationId: a.id,
      paymentId: a.paymentId ?? undefined,
    },
  ]
  // Anticipating zero days costs nothing — and a R$ 0,00 entry in the statement
  // would be noise.
  if (a.feeCents > 0) {
    entries.push({
      accountId: a.accountId,
      type: 'RECEIVABLE_ANTICIPATION_FEE',
      valueCents: cents(-a.feeCents),
      description: 'Taxa de antecipação de recebível',
      anticipationId: a.id,
      paymentId: a.paymentId ?? undefined,
    })
  }
  await postEntries(db, ctx, entries)
}

/**
 * The debit of the settlement. The original receivable just came into the
 * account (PAYMENT_RECEIVED) — but the merchant already received that money
 * advanced, so it goes out now.
 */
export async function postDebit(ctx: AppContext, db: DB, a: AnticipationRow): Promise<void> {
  await postEntries(db, ctx, [
    {
      accountId: a.accountId,
      type: 'RECEIVABLE_ANTICIPATION_DEBIT',
      valueCents: cents(-a.valueCents),
      description: 'Liquidação de antecipação de recebível',
      anticipationId: a.id,
      paymentId: a.paymentId ?? undefined,
    },
  ])
}

export async function emitAnticipation(
  ctx: AppContext,
  db: DB,
  accountId: string,
  anticipationId: string,
  event: string,
  resource: Record<string, unknown>,
): Promise<void> {
  await ctx.emit(db, {
    accountId,
    event,
    resourceType: 'anticipation',
    resourceId: anticipationId,
    resource,
  })
}

export async function cancelAnticipation(
  ctx: AppContext,
  auth: AuthContext,
  id: string,
): Promise<Record<string, unknown>> {
  return ctx.db.transaction(async (tx) => {
    const db = tx as unknown as DB

    const [row] = await db
      .select()
      .from(anticipations)
      .where(and(eq(anticipations.id, id), eq(anticipations.accountId, auth.accountId)))
      .limit(1)
    if (!row) throw notFound('Antecipação')

    /**
     * A CREDITED anticipation is not cancelled: the money is already in the
     * account. Undoing it would mean returning the credit and the fee, and Asaas
     * does not offer that — what exists is the debit on the settlement of the
     * receivable, which is already scheduled.
     */
    if (row.status !== 'PENDING' && row.status !== 'SCHEDULED') {
      throw badRequest(
        'invalid_action',
        `Não é possível cancelar uma antecipação com status ${row.status}.`,
      )
    }

    const updated = await db
      .update(anticipations)
      .set({ status: 'CANCELLED' })
      .where(and(eq(anticipations.id, id), eq(anticipations.status, row.status)))
      .returning()

    if (!updated.length) {
      throw badRequest('conflict', 'A antecipação mudou de status durante a operação.')
    }

    const after = updated[0] as AnticipationRow

    // Releases the receivable: the charge can be anticipated again.
    if (after.paymentId) {
      await db
        .update(payments)
        .set({ anticipated: false })
        .where(eq(payments.id, after.paymentId))
    }

    const body = serializeAnticipation(after)
    await emitAnticipation(
      ctx,
      db,
      auth.accountId,
      after.id,
      'RECEIVABLE_ANTICIPATION_CANCELLED',
      body,
    )
    return body
  })
}

// ── The configuration of the automatic anticipation ───────────────────────────
//
// One row per account in the `settings` table (key/value JSON). A new table is
// not worth it: it is a single boolean, and `settings` exists exactly for this.

export interface AutoAnticipationConfig {
  creditCardAutomaticEnabled: boolean
}

export const autoConfigKey = (accountId: string) => `anticipation:auto:${accountId}`

export async function getAutoConfig(
  db: DB,
  accountId: string,
): Promise<AutoAnticipationConfig> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, autoConfigKey(accountId)))
    .limit(1)

  const value = row?.value as AutoAnticipationConfig | undefined
  return { creditCardAutomaticEnabled: value?.creditCardAutomaticEnabled ?? false }
}

export async function setAutoConfig(
  ctx: AppContext,
  accountId: string,
  enabled: boolean,
): Promise<AutoAnticipationConfig> {
  const value: AutoAnticipationConfig = { creditCardAutomaticEnabled: enabled }

  await ctx.db
    .insert(settings)
    .values({ key: autoConfigKey(accountId), value, updatedAt: ctx.clock.timestamp() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: ctx.clock.timestamp() },
    })

  return value
}
