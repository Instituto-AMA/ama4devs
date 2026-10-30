import { describe, expect, it } from 'bun:test'
import { smsNumber, whatsappNumber } from '../../src/domain/notification-text.ts'

describe('notification phone numbers', () => {
  it('formats whatsapp number with country code 55', () => {
    expect(whatsappNumber('74999990010')).toBe('5574999990010')
    expect(whatsappNumber('(74) 99999-0010')).toBe('5574999990010')
    expect(whatsappNumber('+5574999990010')).toBe('5574999990010')
    expect(whatsappNumber(null)).toBeNull()
    expect(whatsappNumber('123')).toBeNull()
  })

  it('formats sms number in E.164 and avoids magic failure suffixes 0001-0005', () => {
    // Regular valid number delivers as-is in E.164
    expect(smsNumber('(74) 99999-0010')).toBe('+5574999990010')

    // Magic numbers 0001 to 0005 are rewritten to 0010 so notifications reach the mock
    expect(smsNumber('(74) 99999-0001')).toBe('+5574999990010')
    expect(smsNumber('(87) 99999-0002')).toBe('+5587999990010')
    expect(smsNumber('5511999990003')).toBe('+5511999990010')
    expect(smsNumber('5511999990004')).toBe('+5511999990010')
    expect(smsNumber('5511999990005')).toBe('+5511999990010')
    expect(smsNumber(null)).toBeNull()
  })
})
