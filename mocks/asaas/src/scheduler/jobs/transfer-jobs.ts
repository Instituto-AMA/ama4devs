/**
 * The settlement of external transfers. (Track D)
 *
 * The real cycle: PENDING → BANK_PROCESSING → DONE. A transfer does not vanish
 * from the account and reappear in the destination at the same instant — it
 * stays "at the bank", and it is exactly that interval that the developer needs
 * to be able to cross without waiting.
 *
 *   PIX → DONE on the same day (the network is 24×7).
 *   TED → DONE on the NEXT BUSINESS DAY. A TED asked for on Friday lands on Monday.
 *
 * An INTERNAL transfer never goes through here: it is born DONE, because the
 * money does not leave the platform.
 *
 * Every mutation is COMPARE-AND-SWAP (`WHERE id = ? AND status = <expected>`): two
 * ticks on the same simulated day change zero rows the second time.
 */
import { and, eq, isNull, lte, ne, or } from 'drizzle-orm'
import type { DB } from '../../db/client.ts'
import { transfers } from '../../db/schema/index.ts'
import { transferEffectiveDate, type TransferOperationType } from '../../domain/transfer.ts'
import {
  emitTransfer,
  isSandboxFailure,
  reverse,
  settlementArtifacts,
} from '../../modules/transfers/service.ts'
import { serializeTransfer, type TransferRow } from '../../modules/transfers/serializer.ts'
import type { Job } from '../scheduler.ts'

export const transferSettlement: Job = {
  name: 'transfer-settlement',

  async run({ ctx, report }) {
    const today = ctx.clock.today()

    await ctx.db.transaction(async (tx) => {
      const db = tx as unknown as DB

      // ── 1. PENDING → BANK_PROCESSING ────────────────────────────────
      // Only the ones that can already go out: a transfer scheduled for three
      // days from now stays PENDING (and the balance was already debited at
      // creation).
      const pending = await db
        .select()
        .from(transfers)
        .where(
          and(
            eq(transfers.status, 'PENDING'),
            ne(transfers.operationType, 'INTERNAL'),
            or(isNull(transfers.scheduleDate), lte(transfers.scheduleDate, today)),
          ),
        )

      for (const row of pending as TransferRow[]) {
        const effectiveDate = transferEffectiveDate(
          row.operationType as TransferOperationType,
          today,
        )

        const updated = await db
          .update(transfers)
          .set({ status: 'BANK_PROCESSING', effectiveDate })
          .where(and(eq(transfers.id, row.id), eq(transfers.status, 'PENDING')))
          .returning()

        if (!updated.length) continue
        const after = updated[0] as TransferRow

        report.transitions.push({
          resource: 'transfer',
          id: after.id,
          from: 'PENDING',
          to: 'BANK_PROCESSING',
          job: 'transfer-settlement',
        })

        await emitTransfer(
          ctx,
          db,
          after.accountId,
          after.id,
          'TRANSFER_IN_BANK_PROCESSING',
          serializeTransfer(after),
        )
      }

      // ── 2. BANK_PROCESSING → DONE (or FAILED) ───────────────────────
      const processing = await db
        .select()
        .from(transfers)
        .where(
          and(
            eq(transfers.status, 'BANK_PROCESSING'),
            lte(transfers.effectiveDate, today),
          ),
        )

      for (const row of processing as TransferRow[]) {
        const failed = isSandboxFailure(row)

        const patch = failed
          ? {
              status: 'FAILED',
              failReason: 'Transferência recusada pela instituição de destino.',
            }
          : { status: 'DONE', ...settlementArtifacts(ctx, row) }

        const updated = await db
          .update(transfers)
          .set(patch)
          .where(and(eq(transfers.id, row.id), eq(transfers.status, 'BANK_PROCESSING')))
          .returning()

        if (!updated.length) continue
        const after = updated[0] as TransferRow

        // The failure GIVES THE MONEY BACK — value and fee. A new entry
        // (TRANSFER_REVERSAL), never the removal of the original debit: the ledger
        // is append-only and the statement has to count what really happened.
        if (failed) {
          await reverse(ctx, db, after, 'Estorno de transferência não realizada')
          report.ledgerEntries += 1
        }

        report.transitions.push({
          resource: 'transfer',
          id: after.id,
          from: 'BANK_PROCESSING',
          to: after.status,
          job: 'transfer-settlement',
        })

        await emitTransfer(
          ctx,
          db,
          after.accountId,
          after.id,
          failed ? 'TRANSFER_FAILED' : 'TRANSFER_DONE',
          serializeTransfer(after),
        )
      }
    })
  },
}
