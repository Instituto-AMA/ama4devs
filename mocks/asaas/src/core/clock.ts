/**
 * The clock. It is the discipline boundary of the whole project.
 *
 * `Date.now()`, `new Date()` (without an argument) and an implicit `Date` are
 * FORBIDDEN everywhere else in the code. A single leak and the time travel starts
 * recording the real date: determinism dies in silence and the bug comes back as
 * a flaky test three months later. There is a test (tests/unit/no-ambient-time)
 * that greps the sources to guarantee this.
 *
 * Modes:
 *   REAL             follows the system clock. Default; parity with development.
 *   VIRTUAL_FLOWING  offset of the real clock — time flows, but you can skip ahead.
 *   VIRTUAL_FROZEN   only moves when you tell it to. It is the mode of the tests and of CI.
 */

/** Asaas's business timezone. Every date calculation happens in it. */
export const BUSINESS_TZ = 'America/Sao_Paulo'

export type ClockMode = 'REAL' | 'VIRTUAL_FLOWING' | 'VIRTUAL_FROZEN'

export interface Clock {
  nowMs(): number
  now(): Date
  /** 'YYYY-MM-DD' in the business timezone. */
  today(): string
  /** 'YYYY-MM-DD HH:mm:ss' in the business timezone. */
  timestamp(): string
  readonly mode: ClockMode
}

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** Date → 'YYYY-MM-DD' in the business timezone. */
export function toBusinessDate(d: Date): string {
  return DATE_FMT.format(d)
}

/** Date → 'YYYY-MM-DD HH:mm:ss' in the business timezone. */
export function toBusinessTimestamp(d: Date): string {
  // en-GB gives '24:00:00' at midnight instead of '00:00:00'.
  const time = TIME_FMT.format(d).replace(/^24:/, '00:')
  return `${DATE_FMT.format(d)} ${time}`
}

export class RealClock implements Clock {
  readonly mode = 'REAL' as const
  nowMs(): number {
    return Date.now()
  }
  now(): Date {
    return new Date(this.nowMs())
  }
  today(): string {
    return toBusinessDate(this.now())
  }
  timestamp(): string {
    return toBusinessTimestamp(this.now())
  }
}

export class VirtualClock implements Clock {
  #mode: Exclude<ClockMode, 'REAL'>
  /** VIRTUAL_FROZEN: the instant. VIRTUAL_FLOWING: the base of the offset. */
  #epochMs: number
  /** VIRTUAL_FLOWING: the real instant that corresponds to #epochMs. */
  #anchorRealMs: number

  constructor(startMs: number, mode: Exclude<ClockMode, 'REAL'> = 'VIRTUAL_FROZEN') {
    this.#mode = mode
    this.#epochMs = startMs
    this.#anchorRealMs = Date.now()
  }

  get mode(): ClockMode {
    return this.#mode
  }

  nowMs(): number {
    if (this.#mode === 'VIRTUAL_FROZEN') return this.#epochMs
    return this.#epochMs + (Date.now() - this.#anchorRealMs)
  }

  now(): Date {
    return new Date(this.nowMs())
  }
  today(): string {
    return toBusinessDate(this.now())
  }
  timestamp(): string {
    return toBusinessTimestamp(this.now())
  }

  advance(ms: number): void {
    this.#epochMs = this.nowMs() + ms
    this.#anchorRealMs = Date.now()
  }

  setTo(epochMs: number): void {
    this.#epochMs = epochMs
    this.#anchorRealMs = Date.now()
  }

  freeze(): void {
    this.#epochMs = this.nowMs()
    this.#anchorRealMs = Date.now()
    this.#mode = 'VIRTUAL_FROZEN'
  }

  unfreeze(): void {
    this.#epochMs = this.nowMs()
    this.#anchorRealMs = Date.now()
    this.#mode = 'VIRTUAL_FLOWING'
  }

  /** To persist in clock_state and survive the container restart. */
  snapshot() {
    return {
      mode: this.#mode,
      virtualEpochMs: this.#epochMs,
      anchorRealEpochMs: this.#anchorRealMs,
    }
  }
}

export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/**
 * The REAL time of the machine. The only sanctioned `Date.now()` outside the clock.
 *
 * It serves to answer "how far ahead of the world is the simulator?" — the
 * question the panel needs to ask to warn that a new charge will be born OVERDUE.
 * Do not use it for ANYTHING that enters the domain: there only `clock.now()`
 * goes, and the determinism test brings down whoever tries.
 */
export function realNowMs(): number {
  return Date.now()
}

/** Days the simulator's clock is ahead of real time. Negative = the past. */
export function driftDays(clock: Clock): number {
  return Math.round((clock.nowMs() - realNowMs()) / DAY_MS)
}

/**
 * Builds the clock. It lives here, and not in the bootstrap, because seeding a
 * virtual clock requires reading the REAL clock — and this is the only module
 * allowed to do that.
 *
 * `savedEpochMs` comes from `clock_state`: the virtual clock is persisted, or a
 * container restart would take the clock back to the present while the database
 * kept being "in the future".
 */
export function createClock(opts: {
  mode: ClockMode
  start?: string
  savedEpochMs?: number | null
}): Clock {
  if (opts.mode === 'REAL') return new RealClock()

  const startMs =
    opts.savedEpochMs ??
    (opts.start !== undefined && opts.start !== ''
      ? new Date(opts.start).getTime()
      : Date.now())

  if (Number.isNaN(startMs)) {
    throw new Error(`Invalid CLOCK_START: "${opts.start}"`)
  }

  return new VirtualClock(startMs, opts.mode)
}
