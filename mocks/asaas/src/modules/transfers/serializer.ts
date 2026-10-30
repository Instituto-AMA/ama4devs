/**
 * Transfer serialization. The boundary where cents become reais.
 *
 * TRAP OF THE SPEC: the `type` field of the ANSWER is `PIX | TED | INTERNAL` — it
 * is the type of the OPERATION, not of the destination. The `transfers.type`
 * column holds `BANK_ACCOUNT | PIX | INTERNAL` (the destination). Serializing the
 * column directly would return "BANK_ACCOUNT", which is not in the enum of the
 * spec and would break the contract.
 */
import type { transfers } from '../../db/schema/index.ts'
import { cents, centsToBrl } from '../../domain/money.ts'

export type TransferRow = typeof transfers.$inferSelect

const money = (v: number | null): number | null => (v === null ? null : centsToBrl(cents(v)))

export function serializeTransfer(t: TransferRow): Record<string, unknown> {
  const internal = t.operationType === 'INTERNAL'

  return {
    object: 'transfer',
    id: t.id,
    type: t.operationType, // PIX | TED | INTERNAL — see the comment at the top
    operationType: t.operationType,
    dateCreated: t.dateCreated,

    value: money(t.valueCents),
    netValue: money(t.netValueCents),
    transferFee: money(t.transferFeeCents),

    status: t.status,
    effectiveDate: t.effectiveDate,
    scheduleDate: t.scheduleDate,
    endToEndIdentifier: t.endToEndIdentifier,
    authorized: t.authorized,
    failReason: t.failReason,
    externalReference: t.externalReference,
    transactionReceiptUrl: t.transactionReceiptUrl,
    description: t.description,
    recurring: null,

    // An internal transfer returns `walletId` + `account`; the external one,
    // `bankAccount`. Both schemas of the spec are all-optional, so sending the
    // field of the other side as null is safe — and it is what Asaas does.
    walletId: internal ? t.destinationWalletId : null,
    bankAccount: internal ? null : serializeBankAccount(t),
  }
}

function serializeBankAccount(t: TransferRow): Record<string, unknown> | null {
  const b = t.bankAccount
  if (!b && !t.pixAddressKey) return null

  return {
    bank: b?.bank
      ? { ispb: b.bank.ispb ?? null, code: b.bank.code ?? null, name: b.bank.name ?? null }
      : null,
    accountName: b?.accountName ?? null,
    ownerName: b?.ownerName ?? null,
    cpfCnpj: b?.cpfCnpj ?? null,
    agency: b?.agency ?? null,
    agencyDigit: b?.agencyDigit ?? null,
    account: b?.account ?? null,
    accountDigit: b?.accountDigit ?? null,
    pixAddressKey: t.pixAddressKey,
  }
}

/**
 * The answer of the internal transfer adds the basic data of the destination
 * account. `name`/`cpfCnpj` come from the account resolved by the walletId.
 */
export function serializeInternalTransfer(
  t: TransferRow,
  destination: { name: string; cpfCnpj: string; accountNumber: string | null },
): Record<string, unknown> {
  return {
    ...serializeTransfer(t),
    account: {
      name: destination.name,
      cpfCnpj: destination.cpfCnpj,
      agency: '0001',
      account: destination.accountNumber,
      accountDigit: null,
    },
  }
}
