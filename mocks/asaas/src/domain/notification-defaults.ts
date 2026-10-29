/**
 * The notifications Asaas creates with every customer: eight rows, one per
 * moment the payer hears about a charge
 * (https://docs.asaas.com/docs/notificacoes-padroes).
 *
 * `scheduleOffset` is the day the row speaks on: for PAYMENT_DUEDATE_WARNING,
 * days BEFORE the due date (0 is the due day itself); for PAYMENT_OVERDUE, 0 is
 * the day the charge goes overdue and N > 0 repeats every N days while it stays
 * unpaid.
 *
 * Divergence: Asaas starts every row with WhatsApp off (the docs: WhatsApp is
 * disabled in every initial setting). Here the payer's e-mail,
 * SMS and WhatsApp all start on, so a new customer's charges reach Mailpit and
 * the WhatsApp mock with nothing to set. The provider flags the docs leave
 * unstated start off (TODO(rule), progress.md).
 */
import { daysBetween } from './calendar.ts'

export interface DefaultNotification {
  event:
    | 'PAYMENT_CREATED'
    | 'PAYMENT_UPDATED'
    | 'PAYMENT_RECEIVED'
    | 'PAYMENT_OVERDUE'
    | 'PAYMENT_DUEDATE_WARNING'
    | 'SEND_LINHA_DIGITAVEL'
  scheduleOffset: number
  emailEnabledForProvider: boolean
  phoneCallEnabledForCustomer: boolean
}

/** In the order Asaas lists them. */
export const DEFAULT_NOTIFICATIONS: readonly DefaultNotification[] = [
  { event: 'PAYMENT_CREATED', scheduleOffset: 0, emailEnabledForProvider: false, phoneCallEnabledForCustomer: false },
  { event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 0, emailEnabledForProvider: false, phoneCallEnabledForCustomer: false },
  { event: 'PAYMENT_RECEIVED', scheduleOffset: 0, emailEnabledForProvider: true, phoneCallEnabledForCustomer: false },
  { event: 'SEND_LINHA_DIGITAVEL', scheduleOffset: 0, emailEnabledForProvider: false, phoneCallEnabledForCustomer: false },
  { event: 'PAYMENT_OVERDUE', scheduleOffset: 0, emailEnabledForProvider: true, phoneCallEnabledForCustomer: true },
  { event: 'PAYMENT_OVERDUE', scheduleOffset: 7, emailEnabledForProvider: false, phoneCallEnabledForCustomer: true },
  { event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 10, emailEnabledForProvider: false, phoneCallEnabledForCustomer: false },
  { event: 'PAYMENT_UPDATED', scheduleOffset: 0, emailEnabledForProvider: false, phoneCallEnabledForCustomer: false },
]

/**
 * Whether a row with this event and offset speaks today about a charge due on
 * `dueDate` and in `status`. PAYMENT_OVERDUE with offset 0 is not here: it goes
 * out when the charge turns overdue (the transition), not on a calendar day.
 */
export function scheduledToday(
  row: { event: string; scheduleOffset: number },
  charge: { status: string; dueDate: string },
  today: string,
): boolean {
  const late = daysBetween(today, charge.dueDate)
  if (row.event === 'PAYMENT_DUEDATE_WARNING') {
    return charge.status === 'PENDING' && late === -row.scheduleOffset
  }
  if (row.event === 'PAYMENT_OVERDUE' && row.scheduleOffset > 0) {
    return charge.status === 'OVERDUE' && late > 0 && late % row.scheduleOffset === 0
  }
  return false
}
