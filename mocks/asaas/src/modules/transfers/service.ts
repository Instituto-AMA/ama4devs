/**
 * The transfer engine. (Track D)
 *
 * The money leaves the account HERE, at the creation — not at the settlement. It
 * is what allows refusing the transfer for insufficient balance on the spot, and
 * it is what makes the statement match what the merchant sees on the screen.
 *
 * TODO(rule): the docs do not say WHEN Asaas debits a SCHEDULED transfer
 * (`scheduleDate`) — at the creation, reserving the balance, or on the scheduled
 * date? We debit at the creation: it is the conservative reading (the balance
 * cannot be spent twice) and the only one that keeps `GET /v3/finance/balance`
 * honest.
 *
 * No balance is touched outside `postEntries()`. If you are about to write
 * `UPDATE accounts SET balance_cents`, stop.
 */
import { and, eq } from 'drizzle-orm'
import type { AppContext, AuthContext } from '../../core/context.ts'
import { badRequest, invalid, notFound } from '../../core/errors.ts'
import { postEntries, type LedgerEntry } from '../../core/ledger.ts'
import type { DB } from '../../db/client.ts'
import { accounts, transfers, type BankAccountInfo } from '../../db/schema/index.ts'
import { isValidIsoDate } from '../../domain/calendar.ts'
import * as ids from '../../domain/ids.ts'
import { brlToCents, cents, type Cents } from '../../domain/money.ts'
import {
  transferEffectiveDate,
  transferFee,
  type TransferKind,
  type TransferOperationType,
} from '../../domain/transfer.ts'
import { serializeInternalTransfer, serializeTransfer, type TransferRow } from './serializer.ts'

/**
 * TODO(rule): the Asaas sandbox does not document how to force a transfer to
 * FAIL — and without that nobody can test the reversal path
 * (TRANSFER_REVERSAL), which is exactly what the developer needs to exercise.
 * We define a deterministic trigger: the Pix key below, or
 * `externalReference: "FAIL"`.
 */
export const SANDBOX_FAIL_PIX_KEY = 'fail@asaas.com.br'
export const SANDBOX_FAIL_EXTERNAL_REFERENCE = 'FAIL'

export function isSandboxFailure(t: TransferRow): boolean {
  return (
    t.pixAddressKey === SANDBOX_FAIL_PIX_KEY ||
    t.externalReference === SANDBOX_FAIL_EXTERNAL_REFERENCE
  )
}

export interface TransferInput {
  valueCents: Cents
  kind: TransferKind
  operationType: TransferOperationType
  destinationWalletId: string | null
  bankAccount: BankAccountInfo | null
  pixAddressKey: string | null
  pixAddressKeyType: string | null
  description: string | null
  externalReference: string | null
  scheduleDate: string | null
}

/**
 * The body decides the type — exactly as in the real Asaas, where
 * `transfer-to-asaas-account` shares POST /v3/transfers with the canonical
 * operation.
 *
 *   walletId       → INTERNAL (another account of this server)
 *   pixAddressKey  → PIX
 *   bankAccount    → TED (or PIX, if operationType = PIX)
 */
export function parseTransferBody(body: unknown, today: string): TransferInput {
  const b = (body ?? {}) as Record<string, any>

  if (b.value === undefined || b.value === null) {
    throw invalid('value', 'O valor da transferência é obrigatório.')
  }
  const valueCents = brlToCents(Number(b.value))
  if (!Number.isFinite(valueCents) || valueCents <= 0) {
    throw invalid('value', 'O valor da transferência deve ser maior que zero.')
  }

  let scheduleDate: string | null = null
  if (b.scheduleDate) {
    scheduleDate = String(b.scheduleDate)
    if (!isValidIsoDate(scheduleDate)) {
      throw invalid('scheduleDate', 'A data de agendamento é inválida.')
    }
    if (scheduleDate < today) {
      throw invalid('scheduleDate', 'A data de agendamento não pode estar no passado.')
    }
  }

  const common = {
    valueCents,
    description: b.description ?? null,
    externalReference: b.externalReference ?? null,
    scheduleDate,
  }

  if (b.walletId) {
    return {
      ...common,
      kind: 'INTERNAL',
      operationType: 'INTERNAL',
      destinationWalletId: String(b.walletId),
      bankAccount: null,
      pixAddressKey: null,
      pixAddressKeyType: null,
    }
  }

  if (b.pixAddressKey) {
    return {
      ...common,
      kind: 'PIX',
      operationType: 'PIX',
      destinationWalletId: null,
      bankAccount: null,
      pixAddressKey: String(b.pixAddressKey),
      pixAddressKeyType: b.pixAddressKeyType ?? null,
    }
  }

  if (b.bankAccount) {
    const raw = b.bankAccount as Record<string, any>
    const operationType: TransferOperationType = b.operationType === 'PIX' ? 'PIX' : 'TED'

    return {
      ...common,
      kind: 'BANK_ACCOUNT',
      operationType,
      destinationWalletId: null,
      bankAccount: {
        bank: raw.bank
          ? { ispb: raw.ispb ?? undefined, code: String(raw.bank.code), name: undefined }
          : undefined,
        accountName: raw.accountName ?? undefined,
        ownerName: raw.ownerName ?? undefined,
        cpfCnpj: raw.cpfCnpj ?? undefined,
        agency: raw.agency ?? undefined,
        agencyDigit: raw.agencyDigit ?? undefined,
        account: raw.account ?? undefined,
        accountDigit: raw.accountDigit ?? undefined,
        bankAccountType: raw.bankAccountType ?? undefined,
      },
      pixAddressKey: null,
      pixAddressKeyType: null,
    }
  }

  throw invalid(
    'bankAccount',
    'Informe a conta bancária de destino, a chave Pix ou o walletId da conta Asaas.',
  )
}

/** Insufficient balance is 400, not 402 — Asaas does not use 402. */
function assertBalance(balanceCents: number, needed: Cents): void {
  if (balanceCents < needed) {
    throw badRequest(
      'invalid_value',
      'Saldo insuficiente para realizar a transferência.',
    )
  }
}

export async function createTransfer(
  ctx: AppContext,
  auth: AuthContext,
  input: TransferInput,
): Promise<{ row: TransferRow; body: Record<string, unknown> }> {
  const today = ctx.clock.today()
  const feeCents = transferFee(ctx.config.fees, input.operationType)
  const totalCents = cents(input.valueCents + feeCents)

  return ctx.db.transaction(async (tx) => {
    const db = tx as unknown as DB

    const [origin] = await db
      .select({ balanceCents: accounts.balanceCents })
      .from(accounts)
      .where(eq(accounts.id, auth.accountId))
      .limit(1)
    if (!origin) throw notFound('Conta')

    assertBalance(origin.balanceCents, totalCents)

    // ── INTERNAL transfer: instant, free, and BOTH statements close.
    if (input.kind === 'INTERNAL') {
      const [destination] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.walletId, input.destinationWalletId!))
        .limit(1)

      if (!destination) {
        throw invalid('walletId', 'A carteira informada não pertence a nenhuma conta Asaas.')
      }
      if (destination.id === auth.accountId) {
        throw invalid('walletId', 'Não é possível transferir para a própria conta.')
      }

      const row = await insert(ctx, db, auth, input, {
        feeCents: cents(0),
        status: 'DONE',
        effectiveDate: today,
        destinationAccountId: destination.id,
      })

      await postEntries(db, ctx, [
        {
          accountId: auth.accountId,
          type: 'INTERNAL_TRANSFER_DEBIT',
          valueCents: cents(-input.valueCents),
          description: `Transferência para a conta ${destination.name}`,
          transferId: row.id,
        },
        {
          accountId: destination.id,
          type: 'INTERNAL_TRANSFER_CREDIT',
          valueCents: input.valueCents,
          description: `Transferência recebida da conta ${auth.accountId}`,
          transferId: row.id,
        },
      ])

      const body = serializeInternalTransfer(row, {
        name: destination.name,
        cpfCnpj: destination.cpfCnpj,
        accountNumber: destination.accountNumber,
      })

      await emitTransfer(ctx, db, auth.accountId, row.id, 'TRANSFER_CREATED', body)
      await emitTransfer(ctx, db, auth.accountId, row.id, 'TRANSFER_DONE', body)

      return { row, body }
    }

    // ── EXTERNAL transfer: debits now, settles in the scheduler.
    const row = await insert(ctx, db, auth, input, {
      feeCents,
      status: 'PENDING',
      effectiveDate: null,
      destinationAccountId: null,
    })

    const entries: LedgerEntry[] = [
      {
        accountId: auth.accountId,
        type: 'TRANSFER',
        valueCents: cents(-input.valueCents),
        description:
          input.operationType === 'PIX'
            ? 'Transferência via Pix'
            : 'Transferência para conta bancária',
        transferId: row.id,
      },
    ]
    if (feeCents > 0) {
      entries.push({
        accountId: auth.accountId,
        type: 'TRANSFER_FEE',
        valueCents: cents(-feeCents),
        description: 'Taxa de transferência para conta bancária',
        transferId: row.id,
      })
    }
    await postEntries(db, ctx, entries)

    const body = serializeTransfer(row)
    await emitTransfer(ctx, db, auth.accountId, row.id, 'TRANSFER_CREATED', body)
    await emitTransfer(ctx, db, auth.accountId, row.id, 'TRANSFER_PENDING', body)

    return { row, body }
  })
}

async function insert(
  ctx: AppContext,
  db: DB,
  auth: AuthContext,
  input: TransferInput,
  o: {
    feeCents: Cents
    status: string
    effectiveDate: string | null
    destinationAccountId: string | null
  },
): Promise<TransferRow> {
  const [row] = await db
    .insert(transfers)
    .values({
      id: ids.transferId(ctx.rng), // A plain UUID — do not "standardize" it with a prefix
      accountId: auth.accountId,
      type: input.kind,
      operationType: input.operationType,
      status: o.status,
      valueCents: input.valueCents,
      netValueCents: cents(input.valueCents - o.feeCents),
      transferFeeCents: o.feeCents,
      destinationWalletId: input.destinationWalletId,
      destinationAccountId: o.destinationAccountId,
      bankAccount: input.bankAccount,
      pixAddressKey: input.pixAddressKey,
      pixAddressKeyType: input.pixAddressKeyType,
      endToEndIdentifier: null,
      description: input.description,
      externalReference: input.externalReference,
      scheduleDate: input.scheduleDate,
      effectiveDate: o.effectiveDate,
      failReason: null,
      authorized: true,
      transactionReceiptUrl: null,
      dateCreated: ctx.clock.today(),
    })
    .returning()

  return row as TransferRow
}

export async function emitTransfer(
  ctx: AppContext,
  db: DB,
  accountId: string,
  transferId: string,
  event: string,
  resource: Record<string, unknown>,
): Promise<void> {
  await ctx.emit(db, {
    accountId,
    event,
    resourceType: 'transfer',
    resourceId: transferId,
    resource,
  })
}

/**
 * Cancellation. Only what has not reached the bank yet can be cancelled — after
 * BANK_PROCESSING the money is already gone and there is nothing to undo here.
 *
 * The reversal is a NEW entry (TRANSFER_REVERSAL), not the removal of the
 * original one. The ledger is append-only: deleting the debit would make the
 * statement lie about what happened.
 */
export async function cancelTransfer(
  ctx: AppContext,
  auth: AuthContext,
  id: string,
): Promise<Record<string, unknown>> {
  return ctx.db.transaction(async (tx) => {
    const db = tx as unknown as DB

    const [row] = await db
      .select()
      .from(transfers)
      .where(and(eq(transfers.id, id), eq(transfers.accountId, auth.accountId)))
      .limit(1)
    if (!row) throw notFound('Transferência')

    if (row.status !== 'PENDING') {
      throw badRequest(
        'invalid_action',
        `Não é possível cancelar uma transferência com status ${row.status}.`,
      )
    }

    // COMPARE-AND-SWAP: two simultaneous cancellations, only one reversal.
    const updated = await db
      .update(transfers)
      .set({ status: 'CANCELLED' })
      .where(and(eq(transfers.id, id), eq(transfers.status, 'PENDING')))
      .returning()

    if (!updated.length) {
      throw badRequest('conflict', 'A transferência mudou de status durante a operação.')
    }

    const after = updated[0] as TransferRow
    await reverse(ctx, db, after, 'Estorno de transferência cancelada')

    const body = serializeTransfer(after)
    await emitTransfer(ctx, db, auth.accountId, after.id, 'TRANSFER_CANCELLED', body)
    return body
  })
}

/** Returns the value AND the fee. A transfer that did not happen costs nothing. */
export async function reverse(
  ctx: AppContext,
  db: DB,
  t: TransferRow,
  description: string,
): Promise<void> {
  await postEntries(db, ctx, [
    {
      accountId: t.accountId,
      type: 'TRANSFER_REVERSAL',
      valueCents: cents(t.valueCents + t.transferFeeCents),
      description,
      transferId: t.id,
    },
  ])
}

/** The receipt and the E2E only exist after the transfer settles. */
export function settlementArtifacts(
  ctx: AppContext,
  t: TransferRow,
): { endToEndIdentifier: string | null; transactionReceiptUrl: string } {
  return {
    endToEndIdentifier:
      t.operationType === 'PIX'
        ? `E${ctx.rng.digits(8)}${ctx.clock.today().replace(/-/g, '')}${ctx.rng.alphanumeric(11)}`
        : null,
    transactionReceiptUrl: `${ctx.config.publicBaseUrl}/comprovantes/${t.id}`,
  }
}

export { transferEffectiveDate }
