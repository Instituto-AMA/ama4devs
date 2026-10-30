/**
 * The 11 data points captured from the REAL Asaas sandbox.
 *
 * These are not invented cases: each line was read from a response of the real
 * API, and the rule was deduced from them. If someone "simplifies" the rule, this
 * file is the one that warns.
 */
import { describe, expect, it } from 'bun:test'
import { isAnticipable } from '../../src/domain/anticipable.ts'
import { addDays } from '../../src/domain/calendar.ts'
import { brlToCents } from '../../src/domain/money.ts'

const TODAY = '2026-07-14' // the day the capture ran
const LIMIT = brlToCents(66.66) // the REAL limit of the sandbox account used

const anticipable = (value: number, inDays: number, billingType = 'BOLETO') =>
  isAnticipable({
    billingType: billingType as never,
    status: 'PENDING',
    valueCents: brlToCents(value),
    dueDate: addDays(TODAY, inDays),
    today: TODAY,
    availableLimitCents: LIMIT,
    horizonDays: 90,
  })

describe('anticipable — captured from the real Asaas', () => {
  it.each([
    // amount,  due in,  expected,  why
    [29.16, 10, true, 'fits in the limit, within the horizon'],
    [29.16, 41, true, 'fits in the limit, within the horizon'],
    [29.16, 72, true, 'fits in the limit, within the horizon'],
    [29.16, 102, false, 'past the 90 days'],
    [29.24, 345, false, 'far beyond the horizon'],
    [50.0, 73, true, 'fits in the limit'],
    [50.0, 79, true, 'fits in the limit'],
    [50.0, 85, true, 'still within the 90 days'],
    [100.0, 80, false, 'R$ 100 does NOT fit in the R$ 66.66 limit'],
    [350.0, 10, false, 'value far above the limit'],
    [500.0, 60, false, 'value far above the limit'],
  ])('R$ %s due on D+%s → %s (%s)', (value, days, expected) => {
    expect(anticipable(value as number, days as number)).toBe(expected as boolean)
  })

  it('Pix is never anticipatable — there is no future receivable', () => {
    expect(anticipable(10, 5, 'PIX')).toBe(false)
  })

  it('the horizon cutoff is EXACTLY 90 days', () => {
    expect(anticipable(10, 90)).toBe(true)
    expect(anticipable(10, 91)).toBe(false)
  })

  it('the limit cutoff is EXACTLY the available amount', () => {
    expect(anticipable(66.66, 10)).toBe(true)
    expect(anticipable(66.67, 10)).toBe(false)
  })
})
