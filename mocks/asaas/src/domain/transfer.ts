/**
 * Transfers. PURE.
 *
 * Two rules, and both are the ones that break integrations when they are wrong:
 *
 *   PIX  → lands on the SAME DAY (the Pix network is 24×7; there is no business day here).
 *   TED  → lands on the NEXT BUSINESS DAY. Asking for a TED on Friday credits on Monday.
 *
 * An INTERNAL transfer (between two Asaas accounts) is instantaneous and free —
 * it does not leave the platform, so there is no TED or Pix in the middle.
 */
import { addBusinessDays, type IsoDate } from './calendar.ts'
import type { FeeTable } from '../core/config.ts'
import { cents, type Cents } from './money.ts'

/** What the `operation_type` column stores. */
export type TransferOperationType = 'PIX' | 'TED' | 'INTERNAL'
/** What the `type` column stores. It is not the same thing — see the serializer. */
export type TransferKind = 'BANK_ACCOUNT' | 'PIX' | 'INTERNAL'

/**
 * The transfer fee.
 *
 * TODO(rule): `config.fees.transfer.monthlyWithoutFee` (30 free transfers per
 * month) is NOT applied. Asaas does not document what counts towards the
 * allowance (Pix and TED together? per account or per subaccount? is the month the
 * competence month or the last 30 days?), and inventing an answer would make the
 * fee appear or vanish from the statement in a way nobody could check.
 */
export function transferFee(fees: FeeTable, operationType: TransferOperationType): Cents {
  switch (operationType) {
    case 'PIX':
      return fees.transfer.pix
    case 'TED':
      return fees.transfer.ted
    case 'INTERNAL':
      return cents(0)
  }
}

/**
 * When the money arrives in the destination account, given the day the bank
 * started processing it.
 */
export function transferEffectiveDate(
  operationType: TransferOperationType,
  processingOn: IsoDate,
): IsoDate {
  return operationType === 'TED' ? addBusinessDays(processingOn, 1) : processingOn
}
