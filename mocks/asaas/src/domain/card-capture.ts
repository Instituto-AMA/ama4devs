/**
 * When Asaas tries to charge a saved card for a recurring charge. PURE.
 *
 * Asaas charges the card of a subscription by itself on the due date. Its own
 * account of the schedule (blog.asaas.com/cobranca-recorrente-no-asaas, and the
 * editorial answer under it, 2024-07-04):
 *
 *   - 3 attempts on the due date, every six hours: 08:00, 14:00 and 20:00;
 *   - if none captures, 3 more on the next day;
 *   - then the charge is OVERDUE and there are no further attempts: the payer
 *     has to open the invoice and pay with a valid card.
 *
 * The body of the same article says "2 more, every 24 h, 5 in total" instead of
 * "3 more the next day". The newer editorial answer is the default here, and the
 * whole schedule is configuration (CARD_CAPTURE_SCHEDULE, or the panel), so a
 * team that sees another schedule in production sets it without a release.
 *
 * Every refused attempt is a PAYMENT_CREDIT_CARD_CAPTURE_REFUSED webhook
 * ("Falha na captura do pagamento com cartão de crédito."); the charge stays
 * PENDING until the schedule runs out.
 */

/** One attempt: how many days after the due date, at which local time. */
export interface CaptureSlot {
  dayOffset: number
  hour: number
  minute: number
}

export const DEFAULT_CAPTURE_SCHEDULE: readonly CaptureSlot[] = [
  { dayOffset: 0, hour: 8, minute: 0 },
  { dayOffset: 0, hour: 14, minute: 0 },
  { dayOffset: 0, hour: 20, minute: 0 },
  { dayOffset: 1, hour: 8, minute: 0 },
  { dayOffset: 1, hour: 14, minute: 0 },
  { dayOffset: 1, hour: 20, minute: 0 },
]

export class CaptureScheduleError extends Error {}

/**
 * Reads "0@08:00,0@14:00,1@08" (day offset @ hour[:minute]). An empty string is
 * the default schedule; anything malformed is an error, never a silent default.
 */
export function parseCaptureSchedule(raw: string | undefined | null): CaptureSlot[] {
  if (!raw || !raw.trim()) return DEFAULT_CAPTURE_SCHEDULE.map((s) => ({ ...s }))
  const slots = raw.split(',').map((part) => {
    const m = part.trim().match(/^(\d{1,2})@(\d{1,2})(?::(\d{2}))?$/)
    if (!m) throw new CaptureScheduleError(`capture slot "${part.trim()}" is not <days>@<hour>[:<minute>]`)
    return { dayOffset: Number(m[1]), hour: Number(m[2]), minute: Number(m[3] ?? 0) }
  })
  return normalizeCaptureSchedule(slots)
}

/** Validates and orders a schedule. At least one slot, at most 24, inside a day each. */
export function normalizeCaptureSchedule(slots: readonly CaptureSlot[]): CaptureSlot[] {
  if (!slots.length) throw new CaptureScheduleError('the capture schedule needs at least one attempt')
  if (slots.length > 24) throw new CaptureScheduleError('the capture schedule takes at most 24 attempts')
  for (const s of slots) {
    const ok =
      Number.isInteger(s.dayOffset) && s.dayOffset >= 0 && s.dayOffset <= 30 &&
      Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23 &&
      Number.isInteger(s.minute) && s.minute >= 0 && s.minute <= 59
    if (!ok) throw new CaptureScheduleError(`capture slot ${JSON.stringify(s)} is out of range`)
  }
  return [...slots]
    .map((s) => ({ dayOffset: s.dayOffset, hour: s.hour, minute: s.minute }))
    .sort((a, b) => a.dayOffset - b.dayOffset || a.hour - b.hour || a.minute - b.minute)
}

export function formatCaptureSchedule(slots: readonly CaptureSlot[]): string {
  return slots
    .map((s) => `${s.dayOffset}@${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`)
    .join(',')
}

/**
 * The local date-time ("YYYY-MM-DD HH:MM:SS") of attempt number `done + 1` of a
 * charge due on `dueDate`, or null when the schedule has run out.
 */
export function nextCaptureAt(
  dueDate: string,
  done: number,
  schedule: readonly CaptureSlot[],
): string | null {
  const slot = schedule[done]
  if (!slot) return null
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number]
  const day = new Date(Date.UTC(y, m - 1, d + slot.dayOffset))
  const date = day.toISOString().slice(0, 10)
  return `${date} ${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}:00`
}
