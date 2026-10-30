/**
 * The ledger. Append-only, with a running balance.
 *
 * INVARIANT, checked in the tests after every scenario:
 *   accounts.balanceCents === SUM(financial_transactions.valueCents) per account.
 *
 * That is why `postEntries` is the ONLY path to touch a balance — it writes the
 * entry and updates the materialized balance in the same transaction. Never run
 * `UPDATE accounts SET balance_cents = …` anywhere else.
 */
import { eq, sql } from 'drizzle-orm'
import type { DB } from '../db/client.ts'
import { accounts, financialTransactions } from '../db/schema/index.ts'
import type { Cents } from '../domain/money.ts'
import type { Clock } from './clock.ts'
import type { Rng } from './rng.ts'

/** The Asaas statement entry types the engine uses. */
export type FinancialTransactionType =
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FEE'
  | 'PAYMENT_REVERSAL'
  | 'PAYMENT_FEE_REVERSAL'
  | 'PAYMENT_REFUND_CANCELLED'
  | 'TRANSFER'
  | 'TRANSFER_FEE'
  | 'TRANSFER_REVERSAL'
  | 'INTERNAL_TRANSFER_CREDIT'
  | 'INTERNAL_TRANSFER_DEBIT'
  | 'INTERNAL_TRANSFER_REVERSAL'
  | 'RECEIVABLE_ANTICIPATION_GROSS_CREDIT'
  | 'RECEIVABLE_ANTICIPATION_FEE'
  | 'RECEIVABLE_ANTICIPATION_DEBIT'
  | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK'
  | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK_REVERSAL'
  | 'CHARGEBACK'
  | 'CHARGEBACK_REVERSAL'
  | 'BILL_PAYMENT'
  | 'BILL_PAYMENT_FEE'
  | 'INVOICE_FEE'
  | 'CREDIT'
  | 'DEBIT'

export interface LedgerEntry {
  accountId: string
  type: FinancialTransactionType
  /** SIGNED: credit positive, debit negative. */
  valueCents: Cents
  description: string
  paymentId?: string
  splitId?: string
  transferId?: string
  anticipationId?: string
  billId?: string
  invoiceId?: string
}

export interface LedgerDeps {
  clock: Clock
  rng: Rng
}

/**
 * Writes the entries and updates the balance. Call it INSIDE a transaction.
 *
 * The order matters: the `balanceCents` of each row is the balance AFTER it, so a
 * receipt generates PAYMENT_RECEIVED (+gross) and then PAYMENT_FEE (−fee), exactly
 * as the Asaas statement shows.
 */
export async function postEntries(
  tx: DB,
  deps: LedgerDeps,
  entries: readonly LedgerEntry[],
): Promise<void> {
  if (!entries.length) return

  const today = deps.clock.today()
  const now = deps.clock.timestamp()

  for (const entry of entries) {
    const [account] = await tx
      .select({ balanceCents: accounts.balanceCents })
      .from(accounts)
      .where(eq(accounts.id, entry.accountId))
      .limit(1)

    if (!account) throw new Error(`Ledger: account ${entry.accountId} does not exist`)

    const balanceAfter = account.balanceCents + entry.valueCents

    const [next] = await tx
      .select({ seq: sql<number>`COALESCE(MAX(${financialTransactions.seq}), 0) + 1` })
      .from(financialTransactions)
    const seq = next?.seq ?? 1

    await tx.insert(financialTransactions).values({
      id: deps.rng.uuid(),
      seq,
      accountId: entry.accountId,
      type: entry.type,
      valueCents: entry.valueCents,
      balanceCents: balanceAfter,
      description: entry.description,
      date: today,
      paymentId: entry.paymentId ?? null,
      splitId: entry.splitId ?? null,
      transferId: entry.transferId ?? null,
      anticipationId: entry.anticipationId ?? null,
      billId: entry.billId ?? null,
      invoiceId: entry.invoiceId ?? null,
      dateCreated: now,
    })

    await tx
      .update(accounts)
      .set({ balanceCents: balanceAfter })
      .where(eq(accounts.id, entry.accountId))
  }
}
