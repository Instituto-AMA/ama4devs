import { describe, expect, it } from 'bun:test'
import {
  applyBp,
  applyPercentE4,
  bp,
  brlToCents,
  cents,
  centsToBrl,
  percentE4,
  roundCents,
} from '../../src/domain/money.ts'

describe('money', () => {
  it('rounds HALF-UP, including for negatives', () => {
    expect(roundCents(0.5)).toBe(1 as never)
    expect(roundCents(1.5)).toBe(2 as never)
    expect(roundCents(2.5)).toBe(3 as never) // banker's rounding would give 2
    expect(roundCents(-0.5)).toBe(-1 as never)
    expect(roundCents(-2.5)).toBe(-3 as never)
  })

  it('does not return -0', () => {
    expect(Object.is(roundCents(-0.2), -0)).toBe(false)
    expect(roundCents(-0.2)).toBe(0 as never)
  })

  it('converts reais to cents without a floating-point error', () => {
    expect(brlToCents(129.9)).toBe(12990 as never)
    expect(brlToCents(0.1 + 0.2)).toBe(30 as never) // 0.30000000000000004
    expect(brlToCents(1.99)).toBe(199 as never)
  })

  it('serializes cents as an exact decimal', () => {
    // 129.9 is not exact in binary, but JS prints the shortest decimal that
    // round-trips — that is why the JSON output is correct.
    expect(JSON.stringify(centsToBrl(cents(12990)))).toBe('129.9')
    expect(JSON.stringify(centsToBrl(cents(3524)))).toBe('35.24')
    expect(JSON.stringify(centsToBrl(cents(0)))).toBe('0')
  })

  it('applies basis points (the card fee)', () => {
    // R$ 100.00 × 2.99% = R$ 2.99
    expect(applyBp(cents(10_000), bp(299))).toBe(299 as never)
    // R$ 129.90 × 2.99% = R$ 3.88 (3.8840… → 388)
    expect(applyBp(cents(12_990), bp(299))).toBe(388 as never)
  })

  it('applies a split percentage with 4 decimal places', () => {
    // Asaas's split accepts 92.3444% — the 1e4 scale preserves it.
    expect(applyPercentE4(cents(10_000), percentE4(923_444))).toBe(9234 as never)
    expect(applyPercentE4(cents(10_000), percentE4(100_000))).toBe(1000 as never) // 10%
  })
})
