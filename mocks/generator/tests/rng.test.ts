import { describe, expect, test } from 'bun:test'
import { createRng, randomSeed } from '../src/core/rng.js'

describe('createRng', () => {
  test('the same seed yields the same stream', () => {
    const a = createRng('ama')
    const b = createRng('ama')
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()))
  })

  test('different seeds diverge', () => {
    expect(createRng('a').next()).not.toBe(createRng('b').next())
  })

  test('int stays inside both ends and reaches them', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const n = rng.int(1, 6)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(6)
      seen.add(n)
    }
    expect(seen.size).toBe(6)
  })

  test('digits has the asked length', () => {
    expect(createRng('d').digits(11)).toMatch(/^\d{11}$/)
  })
})

describe('randomSeed', () => {
  test('is 8 base-36 characters', () => {
    expect(randomSeed()).toMatch(/^[0-9a-z]{8}$/)
  })
})
