/**
 * Date arithmetic in Asaas's wire format ('YYYY-MM-DD').
 *
 * PURE: no function here reads the clock. Whoever needs "today" receives it as
 * an argument. We work with the string directly instead of `Date` because JS's
 * `Date` carries timezone and time, and the due date of a bank slip has neither —
 * mixing the two is the classic source of the "the charge expired a day early for
 * someone in UTC-3" bug.
 */

export type IsoDate = string // 'YYYY-MM-DD'

const DAY_MS = 86_400_000

/** 'YYYY-MM-DD' → epoch ms in UTC (noon, to guard against DST). */
function toUtc(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!, 12, 0, 0)
}

function fromUtc(ms: number): IsoDate {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const ms = toUtc(date)
  return !Number.isNaN(ms) && fromUtc(ms) === date
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS)
}

/** Difference in whole days: daysBetween('2026-01-10', '2026-01-01') === 9 */
export function daysBetween(later: IsoDate, earlier: IsoDate): number {
  return Math.round((toUtc(later) - toUtc(earlier)) / DAY_MS)
}

export const isBefore = (a: IsoDate, b: IsoDate): boolean => a < b // lexicographic = chronological
export const isAfter = (a: IsoDate, b: IsoDate): boolean => a > b
export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a <= b ? a : b)

/**
 * Adds months preserving the day. When the day does not exist in the target
 * month, it falls back to the LAST day of the month: 31/Jan + 1 month = 28/Feb
 * (not 03/Mar).
 *
 * It is the behaviour a monthly subscription needs — otherwise the charge of
 * someone who subscribed on the 31st slides through the calendar and ends up in
 * March.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1, 12))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12),
  ).getUTCDate()
  target.setUTCDate(Math.min(d!, lastDay))
  return fromUtc(target.getTime())
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay()
}

// ── Business days ────────────────────────────────────────────

/**
 * The fixed national holidays. The movable ones (Carnival, Good Friday, Corpus
 * Christi) depend on Easter — computed below.
 *
 * Municipal and state holidays do NOT go in: Asaas does not publish which ones it
 * considers, and guessing would produce a wrong credit date that looks right.
 */
const FIXED_HOLIDAYS = new Set([
  '01-01', // Universal Confraternization
  '04-21', // Tiradentes
  '05-01', // Labour Day
  '09-07', // Independence Day
  '10-12', // Our Lady of Aparecida
  '11-02', // All Souls' Day
  '11-15', // Proclamation of the Republic
  '11-20', // Black Awareness Day (national since 2024)
  '12-25', // Christmas
])

/** Easter Sunday by the Meeus/Jones/Butcher algorithm. */
function easterSunday(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const movableCache = new Map<number, Set<IsoDate>>()

function movableHolidays(year: number): Set<IsoDate> {
  const cached = movableCache.get(year)
  if (cached) return cached

  const easter = easterSunday(year)
  const set = new Set<IsoDate>([
    addDays(easter, -48), // Carnival (Monday)
    addDays(easter, -47), // Carnival (Tuesday)
    addDays(easter, -2), // Good Friday
    addDays(easter, 60), // Corpus Christi
  ])
  movableCache.set(year, set)
  return set
}

export function isHoliday(date: IsoDate): boolean {
  if (FIXED_HOLIDAYS.has(date.slice(5))) return true
  return movableHolidays(Number(date.slice(0, 4))).has(date)
}

export function isBusinessDay(date: IsoDate): boolean {
  const wd = weekday(date)
  if (wd === 0 || wd === 6) return false
  return !isHoliday(date)
}

/** If it is already a business day, returns the date itself. */
export function nextBusinessDay(date: IsoDate): IsoDate {
  let d = date
  while (!isBusinessDay(d)) d = addDays(d, 1)
  return d
}

/** Advances N BUSINESS days. `addBusinessDays(d, 1)` is always the next business day after d. */
export function addBusinessDays(date: IsoDate, days: number): IsoDate {
  let d = date
  let remaining = days
  while (remaining > 0) {
    d = addDays(d, 1)
    if (isBusinessDay(d)) remaining--
  }
  return d
}

// ── Subscription cycles ──────────────────────────────────────

export type Cycle =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'BIMONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUALLY'
  | 'YEARLY'

/** The next due date of a subscription, given the cycle. */
export function advanceCycle(date: IsoDate, cycle: Cycle): IsoDate {
  switch (cycle) {
    case 'WEEKLY':
      return addDays(date, 7)
    case 'BIWEEKLY':
      return addDays(date, 14)
    case 'MONTHLY':
      return addMonths(date, 1)
    case 'BIMONTHLY':
      return addMonths(date, 2)
    case 'QUARTERLY':
      return addMonths(date, 3)
    case 'SEMIANNUALLY':
      return addMonths(date, 6)
    case 'YEARLY':
      return addMonths(date, 12)
  }
}
