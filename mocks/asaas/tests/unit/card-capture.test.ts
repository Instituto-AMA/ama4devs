/**
 * The capture schedule of recurring card charges (src/domain/card-capture.ts):
 * Asaas's default, the configuration format, and which attempt falls when.
 */
import { describe, expect, it } from 'bun:test'
import {
  CaptureScheduleError,
  DEFAULT_CAPTURE_SCHEDULE,
  formatCaptureSchedule,
  nextCaptureAt,
  parseCaptureSchedule,
} from '../../src/domain/card-capture.ts'

describe('card capture schedule', () => {
  it('defaults to three tries on the due date and three on the next day', () => {
    expect(formatCaptureSchedule(parseCaptureSchedule(''))).toBe(
      '0@08:00,0@14:00,0@20:00,1@08:00,1@14:00,1@20:00',
    )
    expect(parseCaptureSchedule(undefined)).toEqual([...DEFAULT_CAPTURE_SCHEDULE])
  })

  it('reads days@hour[:minute] and orders the slots', () => {
    expect(formatCaptureSchedule(parseCaptureSchedule('1@8, 0@20:30,0@08'))).toBe('0@08:00,0@20:30,1@08:00')
  })

  it('refuses a malformed or out-of-range slot instead of falling back', () => {
    expect(() => parseCaptureSchedule('tomorrow')).toThrow(CaptureScheduleError)
    expect(() => parseCaptureSchedule('0@24')).toThrow(CaptureScheduleError)
    expect(() => parseCaptureSchedule('0@08:61')).toThrow(CaptureScheduleError)
  })

  it('places attempt n at its slot, and runs out after the last', () => {
    const s = parseCaptureSchedule('')
    expect(nextCaptureAt('2026-01-31', 0, s)).toBe('2026-01-31 08:00:00')
    expect(nextCaptureAt('2026-01-31', 2, s)).toBe('2026-01-31 20:00:00')
    // The next day crosses the month.
    expect(nextCaptureAt('2026-01-31', 3, s)).toBe('2026-02-01 08:00:00')
    expect(nextCaptureAt('2026-01-31', 6, s)).toBeNull()
  })
})
