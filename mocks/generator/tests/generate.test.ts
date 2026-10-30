import { describe, expect, test } from 'bun:test'
import { KINDS, generate, GeneratorError } from '../src/core/index.js'

const KIND_IDS = [
  'person',
  'company',
  'address',
  'cpf',
  'cnpj',
  'cnh',
  'pis',
  'rg',
  'credit-card',
  'bank-account',
  'pix-key',
  'charge',
]

describe('KINDS', () => {
  test('the twelve kinds come in the contract order', () => {
    expect(KINDS.map((kind) => kind.id)).toEqual(KIND_IDS)
  })

  test('every kind carries its English API label', () => {
    const label = (id: string): string | undefined => KINDS.find((kind) => kind.id === id)?.label
    expect(label('person')).toBe('Person')
    expect(label('company')).toBe('Company')
    expect(label('address')).toBe('Address')
    expect(label('credit-card')).toBe('Credit card')
    expect(label('bank-account')).toBe('Bank account')
    expect(label('pix-key')).toBe('Pix key')
    expect(label('charge')).toBe('Charge')
  })
})

describe('generate', () => {
  test('the same seed gives the same batch', () => {
    const first = generate('cpf', { count: 3, seed: 's' })
    const second = generate('cpf', { count: 3, seed: 's' })
    expect(first).toEqual(second)
    expect(first.kind).toBe('cpf')
    expect(first.seed).toBe('s')
    expect(first.count).toBe(3)
    expect(first.items).toHaveLength(3)
    expect(first.items[0]).toHaveProperty('value')
    expect(first.items[0]).toHaveProperty('formatted')
  })

  test('the whole batch comes from one stream', () => {
    const result = generate('cpf', { count: 3, seed: 's' })
    const values = result.items.map((item) => item.value)
    expect(new Set(values).size).toBe(3)
  })

  test('every document kind answers with the digits and the mask', () => {
    for (const kind of ['cpf', 'cnpj', 'cnh', 'pis', 'rg']) {
      const item = generate(kind, { seed: 'd' }).items[0]
      expect(item).toHaveProperty('value')
      expect(item).toHaveProperty('formatted')
      expect(String(item.value).length).toBeGreaterThan(0)
      expect(String(item.formatted).length).toBeGreaterThan(0)
    }
  })

  test('the count is clamped to a thousand', () => {
    expect(generate('cpf', { count: 0 }).count).toBe(1)
    expect(generate('cpf', { count: -3 }).count).toBe(1)
    expect(generate('cpf', { count: 5000 }).count).toBe(1000)
    expect(generate('cpf', { count: 'abc' }).count).toBe(1)
    expect(generate('cpf', { count: 7 }).count).toBe(7)
  })

  test('an unknown kind raises unknown_kind', () => {
    try {
      generate('nope')
      throw new Error('generate should have raised')
    } catch (error) {
      expect(error).toBeInstanceOf(GeneratorError)
      expect((error as GeneratorError).code).toBe('unknown_kind')
      expect((error as GeneratorError).message).toBe('unknown kind: nope')
    }
  })

  test('without a seed the batch carries a fresh one', () => {
    const result = generate('cpf')
    expect(result.seed).toMatch(/^[0-9a-z]{8}$/)
  })

  test('the same seed and the same day give the same person', () => {
    const first = generate('person', { seed: 'x', now: '2026-10-29' })
    const second = generate('person', { seed: 'x', now: '2026-10-29' })
    expect(first).toEqual(second)
    expect(first.items).toHaveLength(1)
  })
})
