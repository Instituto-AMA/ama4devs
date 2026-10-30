/**
 * The Asaas retry table. There are 15 attempts, and the intervals are NOT a
 * nice progression — it is a table, copied from the documentation:
 *
 *   1st   immediate          9th   +1h
 *   2nd   +30s              10th  +1h
 *   3rd   +1min             11th  +1h
 *   4th   +3min30s          12th  +1h
 *   5th   +5min             13th  +2h
 *   6th   +15min            14th  +2h
 *   7th   +25min            15th  +3h
 *   8th   +1h
 *
 * Once the 15 are exhausted, the delivery becomes INTERRUPTED and the WHOLE
 * queue of that webhook freezes (`webhooks.interrupted = true`) until someone
 * calls removeBackoff. It is the real behavior, and it is what the developer
 * needs to be able to reproduce locally.
 *
 * The index of the table is the number of attempts ALREADY MADE: with 0
 * attempts made the offset is 0 (the first goes out right away); with 1 made,
 * the second waits 30s.
 */
import { HOUR_MS, MINUTE_MS } from '../core/clock.ts'

/** Offsets in ms, measured from the attempt that just failed. */
export const BACKOFF_MS: readonly number[] = [
  0, //                     1st attempt: immediate
  30_000, //                2nd:  +30s
  MINUTE_MS, //             3rd:  +1min
  3 * MINUTE_MS + 30_000, // 4th: +3min30s
  5 * MINUTE_MS, //         5th:  +5min
  15 * MINUTE_MS, //        6th:  +15min
  25 * MINUTE_MS, //        7th:  +25min
  HOUR_MS, //               8th:  +1h
  HOUR_MS, //               9th:  +1h
  HOUR_MS, //              10th:  +1h
  HOUR_MS, //              11th:  +1h
  HOUR_MS, //              12th:  +1h
  2 * HOUR_MS, //          13th:  +2h
  2 * HOUR_MS, //          14th:  +2h
  3 * HOUR_MS, //          15th:  +3h
]

export const MAX_ATTEMPTS = BACKOFF_MS.length // 15

/**
 * When the next attempt should go out, given the number of attempts already
 * made.
 *
 * `null` = it is over. The delivery becomes INTERRUPTED and the webhook
 * freezes.
 *
 * `maxAttempts` comes from `config.webhook.maxAttempts` (default 15) — it is
 * behind an environment variable because it is a rule read in the docs, not
 * proven against the real API. If it is greater than the table, the last offset
 * (3h) repeats.
 */
export function nextAttemptAt(
  attempt: number,
  nowMs: number,
  maxAttempts: number = MAX_ATTEMPTS,
): number | null {
  if (attempt >= maxAttempts) return null
  const offset = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!
  return nowMs + offset
}
