/**
 * Payment splits. PURE.
 *
 * THE RULE EVERYONE GETS WRONG: the split applies to the **netValue** — the value
 * of the charge ALREADY DISCOUNTED by Asaas's fee — not to the gross amount.
 *
 *   R$ 100.00 charge on Pix (R$ 1.99 fee) → netValue = R$ 98.01
 *   Split of 30%  → R$ 29.40  (30% of 98.01), NOT R$ 30.00.
 *
 * That is: whoever issues the charge pays the fee; the split divides what is left.
 *
 * Precisions (from Asaas):
 *   fixedValue      2 decimal places → cents
 *   percentualValue 4 decimal places → 1e4 scale (92.3444% = 923444)
 */
import { applyPercentE4, cents, sumCents, type Cents, type PercentE4 } from './money.ts'
import { splitTotal } from './installments.ts'

export interface SplitSpec {
  walletId: string
  fixedValueCents?: Cents | null
  percentualValueE4?: PercentE4 | null
  externalReference?: string | null
  description?: string | null
}

export interface ComputedSplit {
  spec: SplitSpec
  totalValueCents: Cents
}

export interface SplitComputation {
  splits: ComputedSplit[]
  /** The sum of all the splits. */
  totalCents: Cents
  /**
   * The sum exceeds the netValue. Asaas BLOCKS the amount and gives 2 business
   * days to adjust; if it is not adjusted, it cancels the splits.
   */
  divergent: boolean
  /** What is left for whoever issued the charge. */
  remainderCents: Cents
}

/**
 * Computes the splits over the netValue.
 *
 * Fixed and percentage can coexist in the same charge and there is no priority
 * rule — Asaas simply adds them up.
 */
export function computeSplits(netValue: Cents, specs: readonly SplitSpec[]): SplitComputation {
  const splits: ComputedSplit[] = specs.map((spec) => {
    const fixed = spec.fixedValueCents ?? cents(0)
    const percentual = spec.percentualValueE4
      ? applyPercentE4(netValue, spec.percentualValueE4)
      : cents(0)

    return { spec, totalValueCents: cents(fixed + percentual) }
  })

  const totalCents = sumCents(splits.map((s) => s.totalValueCents))

  return {
    splits,
    totalCents,
    divergent: totalCents > netValue,
    remainderCents: cents(netValue - totalCents),
  }
}

/**
 * `totalFixedValue` in an installment plan: the amount is distributed EQUALLY among
 * the installments, with the remainder on the last one — the same rule as the
 * installment division.
 *
 *   R$ 300 in 3x with totalFixedValue = R$ 100
 *     → R$ 33.33 | R$ 33.33 | R$ 33.34
 *
 * `fixedValue` (without "total"), on the other hand, is applied to EACH
 * installment: R$ 10 in 4x = R$ 40 in total. They are different things and the
 * naming does not help.
 */
export function distributeTotalFixedValue(totalFixed: Cents, installments: number): Cents[] {
  return splitTotal(totalFixed, installments)
}

export interface SplitValidationError {
  code: string
  description: string
}

/** The validations Asaas performs when creating/updating the split. */
export function validateSplits(
  specs: readonly SplitSpec[],
  ownWalletId: string,
): SplitValidationError[] {
  const errors: SplitValidationError[] = []

  for (const spec of specs) {
    if (!spec.walletId) {
      errors.push({
        code: 'invalid_split',
        description: 'O walletId é obrigatório para cada split.',
      })
      continue
    }

    // Asaas throws if you try to split to yourself.
    if (spec.walletId === ownWalletId) {
      errors.push({
        code: 'invalid_split',
        description: 'Não é possível informar a própria carteira no split.',
      })
    }

    const hasFixed = (spec.fixedValueCents ?? 0) > 0
    const hasPercentual = (spec.percentualValueE4 ?? 0) > 0

    if (!hasFixed && !hasPercentual) {
      errors.push({
        code: 'invalid_split',
        description: 'Informe fixedValue ou percentualValue no split.',
      })
    }

    if ((spec.percentualValueE4 ?? 0) > 1_000_000) {
      errors.push({
        code: 'invalid_split',
        description: 'O percentualValue não pode ser maior que 100.',
      })
    }
  }

  return errors
}
