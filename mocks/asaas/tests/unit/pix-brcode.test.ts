/**
 * The golden here is a REAL BR Code, captured from Asaas's sandbox. Its CRC
 * (`C50D`) is what proves the CRC16 implementation against real data — a wrong
 * CRC generates a "copy and paste" that the bank's app refuses, and no format
 * test would catch that.
 */
import { describe, expect, it } from 'bun:test'
import { brCodePayload, crc16, isValidBrCode } from '../../src/domain/pix-brcode.ts'

/** Captured from Asaas's sandbox. Do not "fix" this value. */
const REAL =
  '00020101021226820014br.gov.bcb.pix2560pix-h.asaas.com/qr/cobv/618c88aa-7beb-4abf-ad17-4213dc8fa3805204000053039865802BR5919Pr Solucoes Sandbox6007Itajuba61083750228062070503***6304C50D'

describe('crc16 (CCITT, poly 0x1021, init 0xFFFF)', () => {
  it('reproduces the CRC of the real sandbox BR Code', () => {
    // Everything up to and including the "6304" goes into the calculation.
    expect(crc16(REAL.slice(0, -4))).toBe('C50D')
  })

  it('validates the whole real payload', () => {
    expect(isValidBrCode(REAL)).toBe(true)
  })

  it('detects a single swapped character', () => {
    const tampered = REAL.replace('Itajuba', 'Itajubb')
    expect(isValidBrCode(tampered)).toBe(false)
  })

  it('always returns 4 uppercase hex digits, zero-padded', () => {
    for (const s of ['', 'a', 'abc', 'x'.repeat(300)]) {
      expect(crc16(s)).toMatch(/^[0-9A-F]{4}$/)
    }
  })
})

describe('brCodePayload', () => {
  it('reproduces the real sandbox payload byte by byte', () => {
    const payload = brCodePayload({
      url: 'https://pix-h.asaas.com/qr/cobv/618c88aa-7beb-4abf-ad17-4213dc8fa380',
      merchantName: 'Pr Soluções Sandbox', // the accent has to be dropped
      merchantCity: 'Itajubá',
      postalCode: '37502-280', // the mask has to be dropped
    })
    expect(payload).toBe(REAL)
  })

  it('generates a payload with a valid CRC for any input', () => {
    const payload = brCodePayload({
      url: 'pix.asaas.com/qr/cobv/abc',
      merchantName: 'Test Store',
      merchantCity: 'Sao Paulo',
    })
    expect(isValidBrCode(payload)).toBe(true)
  })

  it('uses *** as the default txid of the dynamic QR', () => {
    const payload = brCodePayload({ url: 'x.com/a', merchantName: 'N', merchantCity: 'C' })
    expect(payload).toContain('62070503***')
  })

  it('honours an explicit txid', () => {
    const payload = brCodePayload({
      url: 'x.com/a',
      merchantName: 'N',
      merchantCity: 'C',
      txid: 'PAY123',
    })
    expect(payload).toContain('62100506PAY123') // 62 len10 { 05 len06 "PAY123" }
    expect(isValidBrCode(payload)).toBe(true)
  })

  it('does not emit field 54 (amount) — it is a dynamic QR, the amount is in the URL', () => {
    const payload = brCodePayload({ url: 'x.com/a', merchantName: 'N', merchantCity: 'C' })
    // The 53 (currency) is followed directly by the 58 (country).
    expect(payload).toContain('53039865802BR')
  })

  it('truncates the name to 25 and the city to 15 characters', () => {
    const payload = brCodePayload({
      url: 'x.com/a',
      merchantName: 'A'.repeat(40),
      merchantCity: 'B'.repeat(40),
    })
    expect(payload).toContain(`5925${'A'.repeat(25)}`)
    expect(payload).toContain(`6015${'B'.repeat(15)}`)
    expect(isValidBrCode(payload)).toBe(true)
  })

  it('omits field 61 when there is no postal code', () => {
    const payload = brCodePayload({ url: 'x.com/a', merchantName: 'N', merchantCity: 'C' })
    expect(payload).not.toContain('6108')
  })

  it('emits the TLVs with a 2-digit id and a zero-padded size', () => {
    const payload = brCodePayload({ url: 'x.com/a', merchantName: 'N', merchantCity: 'C' })
    expect(payload.startsWith('000201010212')).toBe(true) // 00 len02 "01" · 01 len02 "12"
    expect(payload).toContain('52040000') // 52 len04 "0000"
  })
})
