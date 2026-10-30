/**
 * Money. An integer in cents, always.
 *
 * The conversion to reais happens ONLY at the edge (response serialization). All
 * arithmetic is integer: Asaas's rules are exact-remainder rules ("the remainder
 * goes to the last installment") and they only express themselves that way.
 */

/** A monetary amount in cents. R$ 1.99 → 199. */
export type Cents = number & { readonly __brand: 'Cents' }

/** Percentage in the 1e4 scale (4 decimal places). 92.3444% → 923444. */
export type PercentE4 = number & { readonly __brand: 'PercentE4' }

/** Basis points: 1 bp = 0.01%. 2.99% → 299. */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' }

export const cents = (n: number): Cents => n as Cents
export const percentE4 = (n: number): PercentE4 => n as PercentE4
export const bp = (n: number): BasisPoints => n as BasisPoints

/**
 * HALF-UP rounding (0.5 goes up), not banker's rounding.
 * `Math.round` is already half-up for positives, but it is wrong for negatives
 * (Math.round(-0.5) === -0), so we handle the sign explicitly.
 */
export function roundCents(x: number): Cents {
  const r = Math.sign(x) * Math.round(Math.abs(x))
  return (r === 0 ? 0 : r) as Cents // normalizes -0
}

/** R$ 129.90 → 12990. Only to read API input. */
export function brlToCents(reais: number): Cents {
  return roundCents(reais * 100)
}

/**
 * 12990 → 129.9. Only to write the response.
 *
 * Safe even though 129.9 is not exact in binary: JS prints the shortest decimal
 * that round-trips, so JSON.stringify(12990/100) === "129.9". The danger is in the
 * ARITHMETIC, and it never leaves cents.
 */
export function centsToBrl(c: Cents): number {
  return c / 100
}

/** 299 bp → 2.99. Only to write the response (the account's fee table). */
export function bpToPercent(rate: BasisPoints): number {
  return rate / 100
}

/** Applies a percentage in basis points. 10000 cents × 299bp = 299 cents. */
export function applyBp(value: Cents, rate: BasisPoints): Cents {
  return roundCents((value * rate) / 10_000)
}

/** Applies a percentage in the 1e4 scale. Used by the split (4 decimal places). */
export function applyPercentE4(value: Cents, pct: PercentE4): Cents {
  return roundCents((value * pct) / 1_000_000)
}

export const sumCents = (list: readonly Cents[]): Cents =>
  list.reduce<Cents>((a, b) => cents(a + b), cents(0))
