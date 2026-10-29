import { describe, expect, test } from 'bun:test'
import { createRng } from '../src/core/rng.js'
import {
  cnh,
  cnpj,
  cpf,
  formatCep,
  formatCnpj,
  formatCpf,
  formatPhone,
  isValidCnh,
  isValidCpf,
  isValidCpfCnpj,
  isValidCnpj,
  isValidPis,
  onlyDigits,
  pis,
  rg,
} from '../src/core/documents.js'

const REPEATED = /^(\d)\1+$/

describe('onlyDigits', () => {
  test('drops every mask of a value', () => {
    expect(onlyDigits('529.982.247-25')).toBe('52998224725')
    expect(onlyDigits('11.444.777/0001-61')).toBe('11444777000161')
    expect(onlyDigits('')).toBe('')
    expect(onlyDigits('abc')).toBe('')
  })
})

describe('cpf', () => {
  test('1000 draws are valid, long and not all the same digit', () => {
    const rng = createRng('docs')
    for (let i = 0; i < 1000; i++) {
      const value = cpf(rng)
      expect(value).toMatch(/^\d{11}$/)
      expect(value).not.toMatch(REPEATED)
      expect(isValidCpf(value)).toBe(true)
    }
  })

  test('the formatted answer carries the mask', () => {
    const rng = createRng('docs')
    expect(cpf(rng, { formatted: true })).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/)
  })

  test('the same seed yields the same sequence', () => {
    const a = createRng('same')
    const b = createRng('same')
    const first = Array.from({ length: 10 }, () => cpf(a))
    const second = Array.from({ length: 10 }, () => cpf(b))
    expect(first).toEqual(second)
  })
})

describe('cnpj', () => {
  test('1000 draws are valid, long and not all the same digit', () => {
    const rng = createRng('docs')
    for (let i = 0; i < 1000; i++) {
      const value = cnpj(rng)
      expect(value).toMatch(/^\d{14}$/)
      expect(value).not.toMatch(REPEATED)
      expect(isValidCnpj(value)).toBe(true)
    }
  })

  test('the formatted answer carries the mask and the 0001 branch', () => {
    const rng = createRng('docs')
    expect(cnpj(rng, { formatted: true })).toMatch(/^\d{2}\.\d{3}\.\d{3}\/0001-\d{2}$/)
  })
})

describe('cnh', () => {
  test('1000 draws are valid, long and not all the same digit', () => {
    const rng = createRng('docs')
    for (let i = 0; i < 1000; i++) {
      const value = cnh(rng)
      expect(value).toMatch(/^\d{11}$/)
      expect(value).not.toMatch(REPEATED)
      expect(isValidCnh(value)).toBe(true)
    }
  })

  test('CNH has no mask, so both options answer the same digits', () => {
    const a = createRng('docs')
    const b = createRng('docs')
    expect(cnh(a, { formatted: true })).toBe(cnh(b))
  })

  test('a wrong check digit is rejected', () => {
    const rng = createRng('docs')
    const value = cnh(rng)
    const wrong = value.slice(0, 10) + (value[10] === '0' ? '1' : '0')
    expect(isValidCnh(wrong)).toBe(false)
  })
})

describe('pis', () => {
  test('1000 draws are valid, long and not all the same digit', () => {
    const rng = createRng('docs')
    for (let i = 0; i < 1000; i++) {
      const value = pis(rng)
      expect(value).toMatch(/^\d{11}$/)
      expect(value).not.toMatch(REPEATED)
      expect(isValidPis(value)).toBe(true)
    }
  })

  test('the formatted answer carries the mask', () => {
    const rng = createRng('docs')
    expect(pis(rng, { formatted: true })).toMatch(/^\d{3}\.\d{5}\.\d{2}-\d$/)
  })

  test('a wrong check digit is rejected', () => {
    const rng = createRng('docs')
    const value = pis(rng)
    const wrong = value.slice(0, 10) + (value[10] === '0' ? '1' : '0')
    expect(isValidPis(wrong)).toBe(false)
  })
})

describe('rg', () => {
  test('the formatted answer carries the mask', () => {
    const rng = createRng('docs')
    expect(rg(rng, { formatted: true })).toMatch(/^\d{2}\.\d{3}\.\d{3}-[\dX]$/)
    expect(rg(rng)).toMatch(/^\d{8}[\dX]$/)
  })
})

describe('known documents', () => {
  test('the known CPFs and CNPJs are valid', () => {
    expect(isValidCpf('11144477735')).toBe(true)
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCnpj('11222333000181')).toBe(true)
    expect(isValidCnpj('11.444.777/0001-61')).toBe(true)
  })

  test('the known CPFs and CNPJs pass the shared validator', () => {
    expect(isValidCpfCnpj('11144477735')).toBe(true)
    expect(isValidCpfCnpj('529.982.247-25')).toBe(true)
    expect(isValidCpfCnpj('11222333000181')).toBe(true)
    expect(isValidCpfCnpj('11.444.777/0001-61')).toBe(true)
  })
})

describe('invalid documents', () => {
  test('repeated digits and wrong check digits are rejected', () => {
    expect(isValidCpf('11111111111')).toBe(false)
    expect(isValidCpf('11144477736')).toBe(false)
    expect(isValidCnpj('00000000000000')).toBe(false)
    expect(isValidCnpj('11222333000182')).toBe(false)
  })

  test('wrong lengths are rejected', () => {
    expect(isValidCpf('')).toBe(false)
    expect(isValidCpf('123')).toBe(false)
    expect(isValidCnpj('')).toBe(false)
    expect(isValidCnpj('123')).toBe(false)
    expect(isValidCnh('')).toBe(false)
    expect(isValidCnh('123')).toBe(false)
    expect(isValidPis('')).toBe(false)
    expect(isValidPis('123')).toBe(false)
    expect(isValidCpfCnpj('')).toBe(false)
    expect(isValidCpfCnpj('123')).toBe(false)
  })

  test('the shared validator follows the length', () => {
    expect(isValidCpfCnpj('11111111111')).toBe(false)
    expect(isValidCpfCnpj('00000000000000')).toBe(false)
    expect(isValidCpfCnpj('11144477736')).toBe(false)
    expect(isValidCpfCnpj('11222333000182')).toBe(false)
  })
})

describe('formatters', () => {
  test('CPF and CNPJ wear their masks', () => {
    expect(formatCpf('12345678909')).toBe('123.456.789-09')
    expect(formatCnpj('12345678000195')).toBe('12.345.678/0001-95')
  })

  test('a CEP wears its mask', () => {
    expect(formatCep('01310100')).toBe('01310-100')
  })

  test('a phone wears its mask, ten or eleven digits', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321')
    expect(formatPhone('1134567890')).toBe('(11) 3456-7890')
  })

  test('any other length answers the bare digits', () => {
    expect(formatPhone('123')).toBe('123')
    expect(formatCep('123')).toBe('123')
    expect(formatCpf('123')).toBe('123')
    expect(formatCnpj('123')).toBe('123')
  })
})
