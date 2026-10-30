import { describe, expect, test } from 'bun:test'
import { analyze } from '../src/core/segments.js'
import { extractCodes } from '../src/core/otp.js'

describe('analyze', () => {
  test('a GSM-7 message of 160 characters fits one segment', () => {
    const info = analyze('a'.repeat(160))
    expect(info.encoding).toBe('GSM-7')
    expect(info.length).toBe(160)
    expect(info.segments).toBe(1)
    expect(info.perSegment).toBe(160)
    expect(info.remaining).toBe(0)
  })

  test('161 characters take two segments of 153', () => {
    const info = analyze('a'.repeat(161))
    expect(info.encoding).toBe('GSM-7')
    expect(info.length).toBe(161)
    expect(info.segments).toBe(2)
    expect(info.perSegment).toBe(153)
    expect(info.remaining).toBe(145)
  })

  test('306 characters still fit two segments', () => {
    const info = analyze('a'.repeat(306))
    expect(info.segments).toBe(2)
    expect(info.perSegment).toBe(153)
    expect(info.remaining).toBe(0)
  })

  test('307 characters take three segments', () => {
    const info = analyze('a'.repeat(307))
    expect(info.segments).toBe(3)
    expect(info.perSegment).toBe(153)
    expect(info.remaining).toBe(152)
  })

  test('a character of the extension table costs two septets', () => {
    const info = analyze('€')
    expect(info.encoding).toBe('GSM-7')
    expect(info.length).toBe(2)
    expect(info.segments).toBe(1)
    expect(info.perSegment).toBe(160)
    expect(info.remaining).toBe(158)
  })

  test('80 extension characters still fit one segment', () => {
    const info = analyze('€'.repeat(80))
    expect(info.encoding).toBe('GSM-7')
    expect(info.length).toBe(160)
    expect(info.segments).toBe(1)
    expect(info.perSegment).toBe(160)
    expect(info.remaining).toBe(0)
  })

  test('81 extension characters take two segments', () => {
    const info = analyze('€'.repeat(81))
    expect(info.length).toBe(162)
    expect(info.segments).toBe(2)
    expect(info.perSegment).toBe(153)
    expect(info.remaining).toBe(144)
  })

  test('a character outside GSM-7 turns the message into UCS-2', () => {
    const info = analyze('olá')
    expect(info.encoding).toBe('UCS-2')
    expect(info.length).toBe(3)
    expect(info.segments).toBe(1)
    expect(info.perSegment).toBe(70)
    expect(info.remaining).toBe(67)
  })

  test('70 UCS-2 units fit one segment', () => {
    const info = analyze('á'.repeat(70))
    expect(info.encoding).toBe('UCS-2')
    expect(info.length).toBe(70)
    expect(info.segments).toBe(1)
    expect(info.perSegment).toBe(70)
    expect(info.remaining).toBe(0)
  })

  test('71 UCS-2 units take two segments of 67', () => {
    const info = analyze('á'.repeat(71))
    expect(info.encoding).toBe('UCS-2')
    expect(info.length).toBe(71)
    expect(info.segments).toBe(2)
    expect(info.perSegment).toBe(67)
    expect(info.remaining).toBe(63)
  })

  test('an emoji counts as two UTF-16 units', () => {
    const info = analyze('😀')
    expect(info.encoding).toBe('UCS-2')
    expect(info.length).toBe(2)
    expect(info.segments).toBe(1)
    expect(info.perSegment).toBe(70)
    expect(info.remaining).toBe(68)
  })

  test('an empty message costs no segment', () => {
    const info = analyze('')
    expect(info.encoding).toBe('GSM-7')
    expect(info.length).toBe(0)
    expect(info.segments).toBe(0)
    expect(info.perSegment).toBe(160)
    expect(info.remaining).toBe(160)
  })
})

describe('extractCodes', () => {
  test('finds the code of a message', () => {
    expect(extractCodes('Seu código é 482913')).toEqual(['482913'])
  })

  test('joins a split group and de-duplicates the result', () => {
    expect(extractCodes('Code: 123-456 ou 123456')).toEqual(['123456'])
  })

  test('ignores a long digit run', () => {
    expect(extractCodes('tel 11912345678')).toEqual([])
  })

  test('keeps the order of the first appearance', () => {
    expect(extractCodes('a 1234 e 5678 e 1234')).toEqual(['1234', '5678'])
  })

  test('finds nothing in an empty message', () => {
    expect(extractCodes('')).toEqual([])
  })
})

describe('analyze: spaces', () => {
  test('a space costs one septet', () => {
    expect(analyze('a b')).toMatchObject({ encoding: 'GSM-7', length: 3, segments: 1 })
  })

  test('160 septets with spaces stay one segment', () => {
    expect(analyze('a '.repeat(80))).toMatchObject({ encoding: 'GSM-7', length: 160, segments: 1, remaining: 0 })
  })
})
