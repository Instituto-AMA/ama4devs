import { describe, expect, test } from 'bun:test'
import { formatPhone, isAlphaSender, normalizePhone, outcomeFor } from '../src/core/phone.js'

describe('normalizePhone', () => {
  test('BR shapes gain +55', () => {
    expect(normalizePhone('+55 11 91234-5678')).toBe('+5511912345678')
    expect(normalizePhone('(11) 91234-5678')).toBe('+5511912345678')
    expect(normalizePhone('11 91234-5678')).toBe('+5511912345678')
    expect(normalizePhone('005511912345678')).toBe('+5511912345678')
  })

  test('a 12-digit body counts as already international', () => {
    expect(normalizePhone('5511912345678')).toBe('+5511912345678')
  })

  test('a leading + keeps its digits', () => {
    expect(normalizePhone('+14155550123')).toBe('+14155550123')
  })

  test('a different default country code applies to 10–11 digits', () => {
    expect(normalizePhone('4155550123', '1')).toBe('+14155550123')
  })

  test('letters, empty input and too-short numbers give null', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('+1')).toBeNull()
  })
})

describe('isAlphaSender', () => {
  test('a letter first and up to eleven characters', () => {
    expect(isAlphaSender('BANCO')).toBe(true)
    expect(isAlphaSender('AMA4DEVS')).toBe(true)
  })

  test('digits first, too long, or punctuation give false', () => {
    expect(isAlphaSender('12345')).toBe(false)
    expect(isAlphaSender('TOOLONGSENDERID')).toBe(false)
    expect(isAlphaSender('A-B')).toBe(false)
  })
})

describe('formatPhone', () => {
  test('a 13-digit BR number groups 5+4', () => {
    expect(formatPhone('+5511912345678')).toBe('+55 11 91234-5678')
  })

  test('a 12-digit BR number groups 4+4', () => {
    expect(formatPhone('+551132501234')).toBe('+55 11 3250-1234')
  })

  test('other countries take the first two digits then groups of three', () => {
    expect(formatPhone('+14155550123')).toBe('+14 155 550 123')
  })

  test('an alphanumeric sender comes back unchanged', () => {
    expect(formatPhone('AMA4DEVS')).toBe('AMA4DEVS')
  })
})

describe('outcomeFor', () => {
  test('the magic suffixes stage each failure', () => {
    expect(outcomeFor('+5511912340001')).toEqual({
      kind: 'failed',
      errorCode: 30003,
      errorMessage: 'Unreachable destination handset',
    })
    expect(outcomeFor('+5511912340002')).toEqual({
      kind: 'undelivered',
      errorCode: 30005,
      errorMessage: 'Unknown destination handset',
    })
    expect(outcomeFor('+5511912340003')).toEqual({
      kind: 'rejected',
      errorCode: 21211,
      errorMessage: "Invalid 'To' Phone Number",
    })
    expect(outcomeFor('+5511912340004')).toEqual({ kind: 'stuck' })
    expect(outcomeFor('+5511912340005')).toEqual({
      kind: 'filtered',
      errorCode: 30007,
      errorMessage: 'Message filtered by the carrier',
    })
  })

  test('any other number, and an alphanumeric sender, deliver normally', () => {
    expect(outcomeFor('+5511912345678')).toEqual({ kind: 'normal' })
    expect(outcomeFor('AMA4DEVS')).toEqual({ kind: 'normal' })
  })
})
