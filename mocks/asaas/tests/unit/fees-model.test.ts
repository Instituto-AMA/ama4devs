/**
 * The fee sheet of the panel, without a browser.
 *
 * The screen is where the developer types a price; the server only accepts a
 * non-negative integer, in cents and in basis points. Everything between the two —
 * the Brazilian decimal the developer types and the integer the mock reasons in —
 * lives in `panel/src/pages/sim/fees-model.ts`, and it is the part that can be
 * wrong in a silent way: a fee that arrives multiplied by a hundred, or a fee
 * that arrives as `null`, breaks the application under test instead of the panel.
 */
import { describe, expect, it } from 'bun:test'
import {
  applyFees,
  feeGroups,
  feeKey,
  feeTexts,
  formatFee,
  parseFee,
  type FeeTree,
} from '../../panel/src/pages/sim/fees-model.ts'

const TABLE: FeeTree = {
  boleto: 199,
  pix: 199,
  creditCard: {
    fixed: 49,
    oneInstallment: 299,
    upToSix: 349,
    upToTwelve: 399,
    upToTwentyOne: 429,
  },
  debitCard: { fixed: 35, pct: 189 },
  transfer: { ted: 500, pix: 0, monthlyWithoutFee: 30 },
  creditBureauReport: { naturalPerson: 1699, legalPerson: 1699 },
  notification: { phoneCall: 55, whatsApp: 55, messaging: 99 },
  invoice: 99,
  paymentDunning: 990,
  anticipation: { creditCardDetached: 249, creditCardInstallment: 200, bankSlip: 499 },
}

describe('the fee sheet of the panel', () => {
  it('shows the table in the scale the developer reads', () => {
    expect(formatFee(199, 'brl')).toBe('1,99')
    expect(formatFee(299, 'pct')).toBe('2,99')
    expect(formatFee(0, 'brl')).toBe('0,00')
    expect(formatFee(30, 'count')).toBe('30')
    expect(formatFee(200, 'pct')).toBe('2,00')
  })

  it('reads the Brazilian decimal the developer types', () => {
    expect(parseFee('2,50', 'brl')).toBe(250)
    expect(parseFee('2.50', 'brl')).toBe(250)
    expect(parseFee('1.234,56', 'brl')).toBe(123456)
    expect(parseFee('0,35', 'brl')).toBe(35)
    expect(parseFee('2,99', 'pct')).toBe(299)
    expect(parseFee('30', 'count')).toBe(30)
  })

  it('refuses what is not a price instead of sending a broken one', () => {
    for (const text of ['', 'abc', '-1', '1,2,3', 'R$ 2,00', ' ']) {
      expect(parseFee(text, 'brl')).toBeNull()
    }
    expect(parseFee('-1', 'brl')).toBeNull()
  })

  it('groups every fee of the table and keeps the unknown ones visible', () => {
    const groups = feeGroups(TABLE)
    expect(groups.map((group) => group.title)).toEqual([
      'Recebimento',
      'Cartão de crédito',
      'Cartão de débito',
      'Transferências',
      'Consulta de crédito',
      'Notificações',
      'Serviços',
      'Antecipação',
    ])
    const fields = groups.flatMap((group) => group.fields)
    expect(fields).toHaveLength(22)

    const withUnknown = feeGroups({ ...TABLE, brandNewFee: 500 })
    const last = withUnknown[withUnknown.length - 1]
    expect(last.title).toBe('Outras taxas')
    expect(last.fields).toEqual([{ path: ['brandNewFee'], label: 'brandNewFee', unit: 'raw' }])
  })

  it('sends the table its own scale, and leaves the fees nobody touched alone', () => {
    const groups = feeGroups(TABLE)
    const texts = feeTexts(TABLE, groups)
    expect(texts['creditCard.oneInstallment']).toBe('2,99')
    expect(texts['transfer.monthlyWithoutFee']).toBe('30')

    const patched = applyFees(TABLE, groups, {
      'creditCard.oneInstallment': 310,
      'transfer.monthlyWithoutFee': 12,
    })
    expect(patched.creditCard.oneInstallment).toBe(310)
    expect(patched.transfer.monthlyWithoutFee).toBe(12)
    expect(patched.creditCard.fixed).toBe(49)
    expect(patched.boleto).toBe(199)
  })

  it('keeps the key of a fee stable between the tree and the screen', () => {
    expect(feeKey(['creditCard', 'upToTwentyOne'])).toBe('creditCard.upToTwentyOne')
  })
})
