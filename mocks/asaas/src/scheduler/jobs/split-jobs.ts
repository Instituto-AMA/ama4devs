/**
 * The split jobs. (Track F)
 *
 * It is HERE that the money actually crosses the boundary between two accounts —
 * the rest of the split (the calculation, the status) already existed; what was
 * missing was the movement. A split that changes status but does not move a
 * balance is exactly the kind of subtly wrong mock this project cannot be.
 *
 * THE RULES THAT LIVE HERE:
 *
 * 1. The split applies to the **netValue** (value − Asaas fee), never to the
 *    gross amount. The calculation is `computeSplits` (pure, src/domain/split.ts)
 *    — and it is REDONE at credit time, over the FINAL netValue of the charge. A
 *    charge paid late is worth more (interest + fine), so the netValue is larger
 *    and the percentage split follows. It is what the Asaas docs mean by "the
 *    displayed values may be updated after the payment is confirmed".
 *
 * 2. The balance only changes through `postEntries()`, and BOTH statements
 *    close: INTERNAL_TRANSFER_DEBIT (−) in the origin, INTERNAL_TRANSFER_CREDIT
 *    (+) in the destination, both stamped with splitId and paymentId.
 *
 * 3. Compare-and-swap on every mutation (`UPDATE … WHERE status = 'AWAITING_CREDIT'`).
 *    A duplicated run of the job changes zero rows — and it is that layer, not
 *    the mutex, that prevents the double credit.
 */
import { and, eq, inArray, lt } from 'drizzle-orm'
import { postEntries } from '../../core/ledger.ts'
import type { DB } from '../../db/client.ts'
import { payments, paymentSplits } from '../../db/schema/index.ts'
import { addBusinessDays } from '../../domain/calendar.ts'
import { cents } from '../../domain/money.ts'
import { computeSplits, type SplitSpec } from '../../domain/split.ts'
import { serializePayment, type PaymentRow } from '../../modules/payments/serializer.ts'
import type { Job } from '../scheduler.ts'

type SplitRow = typeof paymentSplits.$inferSelect

/** The database row becomes the input of the pure function. */
function toSpec(s: SplitRow): SplitSpec {
  return {
    walletId: s.walletId,
    fixedValueCents: s.fixedValueCents === null ? null : cents(s.fixedValueCents),
    percentualValueE4:
      s.percentualValueE4 === null ? null : (s.percentualValueE4 as SplitSpec['percentualValueE4']),
    externalReference: s.externalReference,
    description: s.description,
  }
}

/**
 * Job 4 — splits AWAITING_CREDIT of already RECEIVED charges → DONE, moving the
 * money between the accounts.
 *
 * It runs AFTER the credit-settlement (job 3) on purpose: there is only a split
 * of what already came in. A card paid today only releases the split at D+32, in
 * the same tick in which the charge settles — and that is what the time travel
 * test proves.
 */
export const splitRelease: Job = {
  name: 'split-release',
  async run({ ctx, report }) {
    const today = ctx.clock.today()

    /**
     * Only a RECEIVED charge releases a split. CONFIRMED does not do: the money
     * is not the origin account's yet, and you cannot transfer what you do not
     * have.
     */
    const pending = await ctx.db
      .select({ split: paymentSplits, payment: payments })
      .from(paymentSplits)
      .innerJoin(payments, eq(paymentSplits.paymentId, payments.id))
      .where(
        and(
          eq(paymentSplits.status, 'AWAITING_CREDIT'),
          eq(payments.status, 'RECEIVED'),
          eq(payments.deleted, false),
        ),
      )

    // Groups by charge: the value divergence is a property of the WHOLE SET of
    // splits, not of an isolated split.
    const byPayment = new Map<string, { payment: PaymentRow; splits: SplitRow[] }>()
    for (const row of pending) {
      const entry = byPayment.get(row.payment.id) ?? {
        payment: row.payment as PaymentRow,
        splits: [],
      }
      entry.splits.push(row.split)
      byPayment.set(row.payment.id, entry)
    }

    for (const { payment, splits } of byPayment.values()) {
      try {
        await ctx.db.transaction(async (t) => {
          const tx = t as unknown as DB

          // Recalculated over the FINAL netValue — see the comment at the top.
          const computed = computeSplits(cents(payment.netValueCents), splits.map(toSpec))

          /**
           * The sum went over the netValue (the charge was edited down after it
           * was created, for example). It does not credit: it blocks, and the
           * divergence job takes over from here.
           */
          if (computed.divergent) {
            const blockedUntil = addBusinessDays(
              today,
              ctx.config.rules.splitDivergenceGraceBusinessDays,
            )

            const blocked = await tx
              .update(paymentSplits)
              .set({ status: 'BLOCKED_BY_VALUE_DIVERGENCE', blockedUntil })
              .where(
                and(
                  inArray(
                    paymentSplits.id,
                    splits.map((s) => s.id),
                  ),
                  eq(paymentSplits.status, 'AWAITING_CREDIT'),
                ),
              )
              .returning()

            if (!blocked.length) return // another tick already handled it

            for (const s of blocked) {
              report.transitions.push({
                resource: 'split',
                id: s.id,
                from: 'AWAITING_CREDIT',
                to: 'BLOCKED_BY_VALUE_DIVERGENCE',
                job: 'split-release',
              })
            }

            await emitSplitEvent(ctx, tx, payment, 'PAYMENT_SPLIT_DIVERGENCE_BLOCK')
            return
          }

          for (const [i, split] of splits.entries()) {
            const total = computed.splits[i]!.totalValueCents

            /**
             * COMPARE-AND-SWAP. It is what prevents the double credit if the job
             * runs twice: the second run changes zero rows and falls out BEFORE
             * touching the ledger.
             */
            const updated = await tx
              .update(paymentSplits)
              .set({ status: 'DONE', creditDate: today, totalValueCents: total })
              .where(
                and(
                  eq(paymentSplits.id, split.id),
                  eq(paymentSplits.status, 'AWAITING_CREDIT'),
                ),
              )
              .returning()

            if (!updated.length) continue

            /**
             * EXTERNAL WALLET: the walletId belongs to no account of this
             * server, so `recipientAccountId` is null and THERE IS NO ACCOUNT TO
             * CREDIT.
             *
             * It is marked DONE (the split "happened"), but not a cent moves —
             * not even from the origin. It is a DELIBERATE DIVERGENCE from the
             * real Asaas, where the money would leave your account towards the
             * wallet of another Asaas client. Here the money simply has nowhere
             * to go, and debiting the origin without crediting anyone would make
             * the statement "lose" the value without a counterpart — something
             * nobody could check.
             *
             * To see the money really move, create a subaccount
             * (POST /v3/accounts) and use its walletId.
             */
            if (!split.recipientAccountId) {
              report.transitions.push({
                resource: 'split',
                id: split.id,
                from: 'AWAITING_CREDIT',
                to: 'DONE',
                job: 'split-release',
              })
              continue
            }

            /**
             * The movement. Debit in the origin, credit in the destination, in
             * the SAME transaction — the two statements close or neither of them
             * closes.
             */
            await postEntries(tx, { clock: ctx.clock, rng: ctx.rng }, [
              {
                accountId: payment.accountId,
                type: 'INTERNAL_TRANSFER_DEBIT',
                valueCents: cents(-total),
                description: `Split da cobrança ${payment.id}`,
                paymentId: payment.id,
                splitId: split.id,
              },
              {
                accountId: split.recipientAccountId,
                type: 'INTERNAL_TRANSFER_CREDIT',
                valueCents: total,
                description: `Split recebido da cobrança ${payment.id}`,
                paymentId: payment.id,
                splitId: split.id,
              },
            ])

            report.ledgerEntries += 2
            report.transitions.push({
              resource: 'split',
              id: split.id,
              from: 'AWAITING_CREDIT',
              to: 'DONE',
              job: 'split-release',
            })
          }
        })
      } catch (err) {
        ctx.log('debug', `split-release: charge ${payment.id} did not release`, {
          error: String(err),
        })
      }
    }
  },
}

/**
 * Job 5 — the grace period of a split blocked by divergence expired.
 *
 * Asaas blocks the split when the sum goes over the netValue and gives 2
 * BUSINESS DAYS (`SPLIT_DIVERGENCE_GRACE_BUSINESS_DAYS`) for the integrator to
 * fix the values. Once the period is over, the split dies: CANCELLED with
 * `VALUE_DIVERGENCE_BLOCK`.
 *
 * `blockedUntil` is the LAST day on which it is still possible to adjust — which
 * is why the predicate is `blockedUntil < today`, and not `<=`. TODO(rule): the
 * docs do not say whether the period ends at the end of the last day or at its
 * beginning.
 */
export const splitDivergenceExpiry: Job = {
  name: 'split-divergence-expiry',
  async run({ ctx, report }) {
    const today = ctx.clock.today()

    const expired = await ctx.db
      .select({ split: paymentSplits, payment: payments })
      .from(paymentSplits)
      .innerJoin(payments, eq(paymentSplits.paymentId, payments.id))
      .where(
        and(
          eq(paymentSplits.status, 'BLOCKED_BY_VALUE_DIVERGENCE'),
          lt(paymentSplits.blockedUntil, today),
        ),
      )

    for (const { split, payment } of expired) {
      try {
        await ctx.db.transaction(async (t) => {
          const tx = t as unknown as DB

          // CAS: if someone adjusted the split in the meantime, nothing happens.
          const updated = await tx
            .update(paymentSplits)
            .set({ status: 'CANCELLED', cancellationReason: 'VALUE_DIVERGENCE_BLOCK' })
            .where(
              and(
                eq(paymentSplits.id, split.id),
                eq(paymentSplits.status, 'BLOCKED_BY_VALUE_DIVERGENCE'),
              ),
            )
            .returning()

          if (!updated.length) return

          report.transitions.push({
            resource: 'split',
            id: split.id,
            from: 'BLOCKED_BY_VALUE_DIVERGENCE',
            to: 'CANCELLED',
            job: 'split-divergence-expiry',
          })

          /**
           * Two events, and it is not redundancy: the block ended
           * (DIVERGENCE_BLOCK_FINISHED) AND the split was cancelled (SPLIT_CANCELLED).
           * TODO(rule): the docs list both events but do not say whether Asaas
           * emits both on this path.
           */
          await emitSplitEvent(
            ctx,
            tx,
            payment as PaymentRow,
            'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED',
          )
          await emitSplitEvent(ctx, tx, payment as PaymentRow, 'PAYMENT_SPLIT_CANCELLED')
        })
      } catch (err) {
        ctx.log('debug', `split-divergence-expiry: split ${split.id} did not cancel`, {
          error: String(err),
        })
      }
    }
  },
}

/**
 * The payload of a split event.
 *
 * TODO(rule): the spec does not declare a "split" `resourceType` — the 111 events
 * carry `payment`, `subscription`, `transfer`… We send the CHARGE, whose `split[]`
 * field already brings each split with its status, value and cancellation
 * reason. It is the most defensible reading: the client receives everything it
 * needs, in the format it already knows how to read.
 */
async function emitSplitEvent(
  ctx: Parameters<Job['run']>[0]['ctx'],
  tx: DB,
  payment: PaymentRow,
  event: string,
): Promise<void> {
  const [fresh] = await tx.select().from(payments).where(eq(payments.id, payment.id)).limit(1)

  await ctx.emit(tx, {
    accountId: payment.accountId,
    event,
    resourceType: 'payment',
    resourceId: payment.id,
    resource: await serializePayment(tx, (fresh ?? payment) as PaymentRow),
  })
}
