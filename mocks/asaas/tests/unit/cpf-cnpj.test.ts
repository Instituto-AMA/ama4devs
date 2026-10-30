import { describe, expect, it } from 'bun:test'
import { isValidCnpj, isValidCpf, isValidCpfCnpj, personTypeOf } from '../../src/domain/cpf-cnpj.ts'

describe('cpf/cnpj', () => {
  it('validates a CPF by its check digit', () => {
    expect(isValidCpf('24971563792')).toBe(true)
    expect(isValidCpf('249.715.637-92')).toBe(true) // accepts the formatted one
    expect(isValidCpf('24971563793')).toBe(false) // wrong check digit
    expect(isValidCpf('12345678901')).toBe(false)
  })

  it('rejects a CPF with all the same digits', () => {
    // They pass the algorithm but are invalid by convention — and Asaas rejects them.
    expect(isValidCpf('11111111111')).toBe(false)
    expect(isValidCpf('00000000000')).toBe(false)
  })

  it('validates a CNPJ by its check digit', () => {
    expect(isValidCnpj('47960950000121')).toBe(true)
    expect(isValidCnpj('47.960.950/0001-21')).toBe(true)
    expect(isValidCnpj('47960950000122')).toBe(false)
    expect(isValidCnpj('11111111111111')).toBe(false)
  })

  it('rejects a document with an invalid length', () => {
    expect(isValidCpfCnpj('123')).toBe(false)
    expect(isValidCpfCnpj('')).toBe(false)
  })

  it('derives personType from the document length', () => {
    expect(personTypeOf('24971563792')).toBe('FISICA')
    expect(personTypeOf('47960950000121')).toBe('JURIDICA')
  })
})
