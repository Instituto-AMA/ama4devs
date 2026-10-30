/**
 * The lifecycle of the anticipation, through time. (Track D)
 *
 * Three things, in this order:
 *
 *   0. AUTOMATIC ANTICIPATION — if the account turned the flag on, every
 *      confirmed card charge is anticipated on its own.
 *   1. SCHEDULED → CREDITED — the anticipation of a charge that was not paid
 *      yet. When the payer pays (CONFIRMED), the money comes in.
 *   2. CREDITED → DEBITED — the original receivable settled (PAYMENT_RECEIVED
 *      just credited the account), so the advance goes out. It is the entry
 *      that closes the cycle and keeps `balance === SUM(ledger)`.
 *
 * It runs AFTER the `credit-settlement` — and that is semantic, not incidental:
 * the anticipation debit only makes sense after the credit of the receivable
 * came in. Inverting the order would leave the balance negative for one tick.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import type { DB } from '../../db/client.ts'
import { anticipations, payments } from '../../db/schema/index.ts'
import type { AnticipationRow } from '../../modules/anticipations/serializer.ts'
import { serializeAnticipation } from '../../modules/anticipations/serializer.ts'
import {
  emitAnticipation,
  getAutoConfig,
  postCredit,
  postDebit,
  quoteFor,
  requestAnticipation,
} from '../../modules/anticipations/service.ts'
import type { PaymentRow } from '../../modules/payments/serializer.ts'
import type { Job, TickReport } from '../scheduler.ts'

export const anticipationSettlement: Job = {
  name: 'anticipation-settlement',

  async run({ ctx, report }) {
    await autoAnticipate(ctx, report)

    await ctx.db.transaction(async (tx) => {
      const db = tx as unknown as DB
      const open = await db
        .select()
        .from(anticipations)
        .where(inArray(anticipations.status, ['SCHEDULED', 'CREDITED']))

      for (const row of open as AnticipationRow[]) {
        if (!row.paymentId) continue

        const [payment] = await db
          .select()
          .from(payments)
          .where(eq(payments.id, row.paymentId))
          .limit(1)
        if (!payment) continue

        const status = (payment as PaymentRow).status

        if (row.status === 'SCHEDULED') {
          if (status === 'CONFIRMED') {
            await transition(ctx, db, report, row, 'CREDITED', async (after) => {
              await postCredit(ctx, db, after)
              report.ledgerEntries += 2
            })
          } else if (status === 'RECEIVED' || status === 'RECEIVED_IN_CASH') {
            /**
             * The receivable settled before the anticipation was processed — the
             * money already came in through PAYMENT_RECEIVED. There is nothing
             * to advance. We DENY it, without moving a cent: crediting and
             * debiting in the same tick would charge an anticipation fee for a
             * zero-day advance.
             */
            await transition(ctx, db, report, row, 'DENIED', async (after) => {
              await db
                .update(anticipations)
                .set({
                  denialObservation:
                    'O recebível foi liquidado antes de a antecipação ser processada.',
                })
                .where(eq(anticipations.id, after.id))
              await db
                .update(payments)
                .set({ anticipated: false })
                .where(eq(payments.id, after.paymentId!))
            })
          }
          continue
        }

        // CREDITED: waits for the receivable to really settle.
        if (status === 'RECEIVED') {
          await transition(ctx, db, report, row, 'DEBITED', async (after) => {
            await postDebit(ctx, db, after)
            report.ledgerEntries += 1
          })
        }
      }
    })
  },
}

/** COMPARE-AND-SWAP + effect + webhook. A repeated tick changes zero rows. */
async function transition(
  ctx: AppContext,
  db: DB,
  report: TickReport,
  row: AnticipationRow,
  to: 'CREDITED' | 'DEBITED' | 'DENIED',
  effect: (after: AnticipationRow) => Promise<void>,
): Promise<void> {
  const patch: Record<string, unknown> = { status: to }
  if (to === 'CREDITED') patch.anticipationDate = ctx.clock.today()

  const updated = await db
    .update(anticipations)
    .set(patch)
    .where(and(eq(anticipations.id, row.id), eq(anticipations.status, row.status)))
    .returning()

  if (!updated.length) return

  const after = updated[0] as AnticipationRow
  await effect(after)

  report.transitions.push({
    resource: 'anticipation',
    id: after.id,
    from: row.status,
    to,
    job: 'anticipation-settlement',
  })

  const [fresh] = await db
    .select()
    .from(anticipations)
    .where(eq(anticipations.id, after.id))
    .limit(1)

  await emitAnticipation(
    ctx,
    db,
    after.accountId,
    after.id,
    `RECEIVABLE_ANTICIPATION_${to}`,
    serializeAnticipation((fresh ?? after) as AnticipationRow),
  )
}

/**
 * Automatic anticipation of a credit card.
 *
 * The `creditCardAutomaticEnabled` flag (PUT /v3/anticipations/configurations)
 * exists in the Asaas API and turns exactly this on. A persisted boolean that
 * anticipated nothing would produce false confidence — the only thing this
 * project cannot do.
 */
async function autoAnticipate(ctx: AppContext, report: TickReport): Promise<void> {
  const candidates = await ctx.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.status, 'CONFIRMED'),
        eq(payments.billingType, 'CREDIT_CARD'),
        eq(payments.anticipated, false),
        eq(payments.deleted, false),
      ),
    )

  if (!candidates.length) return

  const enabled = new Map<string, boolean>()

  for (const row of candidates as PaymentRow[]) {
    let on = enabled.get(row.accountId)
    if (on === undefined) {
      on = (await getAutoConfig(ctx.db, row.accountId)).creditCardAutomaticEnabled
      enabled.set(row.accountId, on)
    }
    if (!on) continue

    try {
      const created = await requestAnticipation(ctx, row.accountId, {
        payment: row,
        quote: quoteFor(ctx, row),
        creditsNow: true,
      })
      report.created.push({
        resource: 'anticipation',
        id: String(created.id),
        job: 'anticipation-settlement',
      })
      report.ledgerEntries += 2
    } catch (err) {
      // The CAS in `payments.anticipated` already guards against a duplicate; any
      // other refusal is information, not a job error.
      ctx.log('debug', `anticipation-settlement: ${row.id} did not anticipate`, {
        error: String(err),
      })
    }
  }
}
