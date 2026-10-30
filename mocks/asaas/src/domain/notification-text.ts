/**
 * What Asaas tells the payer about a charge: the e-mail (subject, text, HTML) and
 * the WhatsApp template with its positional parameters. Pure: the data in, the
 * message out.
 *
 * The template names match the files of the WhatsApp mock
 * (mocks/whatsapp/templates/asaas_*.json); their parameters are, in order:
 * {{1}} payer, {{2}} merchant, {{3}} value, {{4}} due date, {{5}} invoice link.
 */

export const NOTIFIABLE_EVENTS = [
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_DUEDATE_WARNING',
  'PAYMENT_OVERDUE',
  'PAYMENT_RECEIVED',
] as const

export type NotifiableEvent = (typeof NOTIFIABLE_EVENTS)[number]

/** The webhook event that triggers each notification (a confirmed card counts as received). */
export const NOTIFICATION_FOR_WEBHOOK: Readonly<Record<string, NotifiableEvent>> = {
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  PAYMENT_UPDATED: 'PAYMENT_UPDATED',
  PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PAYMENT_CONFIRMED: 'PAYMENT_RECEIVED',
}

export const NOTIFICATION_LABEL: Record<NotifiableEvent, string> = {
  PAYMENT_CREATED: 'Cobrança criada',
  PAYMENT_UPDATED: 'Cobrança alterada',
  PAYMENT_DUEDATE_WARNING: 'Lembrete de vencimento',
  PAYMENT_OVERDUE: 'Cobrança vencida',
  PAYMENT_RECEIVED: 'Pagamento confirmado',
}

const TEMPLATE: Record<NotifiableEvent, string> = {
  PAYMENT_CREATED: 'asaas_charge_created',
  PAYMENT_UPDATED: 'asaas_charge_changed',
  PAYMENT_DUEDATE_WARNING: 'asaas_due_date_reminder',
  PAYMENT_OVERDUE: 'asaas_charge_overdue',
  PAYMENT_RECEIVED: 'asaas_payment_confirmed',
}

/** The plan a first installment opens: the payer hears about the N installments at once. */
export interface InstallmentFacts {
  count: number
  totalCents: number
  /** Each installment (the last may differ by the rounding). */
  valueCents: number
  description: string | null
}

export interface NotificationInput {
  payer: string
  merchant: string
  valueCents: number
  /** YYYY-MM-DD. */
  dueDate: string
  invoiceUrl: string
  description: string | null
  /** Set on the creation of an installment plan's first charge. */
  installment?: InstallmentFacts
}

export interface NotificationMessage {
  subject: string
  text: string
  html: string
  template: { name: string; language: string; params: string[] }
  /** The SMS body: the lead and the link, at most SMS_MAX_LENGTH characters. */
  sms: string
}

/** The longest SMS body the SMS mock takes. */
export const SMS_MAX_LENGTH = 1000

const brl = (cents: number) =>
  `R$ ${(cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function composeNotification(event: NotifiableEvent, i: NotificationInput): NotificationMessage {
  const plan = event === 'PAYMENT_CREATED' ? i.installment : undefined
  // A plan is told whole: the total in N installments, and when the first one is due.
  const value = plan
    ? `${brl(plan.totalCents)} em ${plan.count}x de ${brl(plan.valueCents)}`
    : brl(i.valueCents)
  const due = plan ? `${br(i.dueDate)} (1ª parcela)` : br(i.dueDate)
  const what = i.description ? ` (${i.description})` : ''

  const lines: Record<NotifiableEvent, { subject: string; lead: string }> = {
    PAYMENT_CREATED: {
      subject: `${i.merchant}: nova cobrança de ${value}`,
      lead: `${i.merchant} gerou uma cobrança de ${value}${what}, com vencimento em ${due}.`,
    },
    PAYMENT_UPDATED: {
      subject: `${i.merchant}: cobrança alterada`,
      lead: `${i.merchant} alterou a sua cobrança${what}: agora ${value}, com vencimento em ${due}.`,
    },
    PAYMENT_DUEDATE_WARNING: {
      subject: `${i.merchant}: sua cobrança vence em ${due}`,
      lead: `Lembrete: a cobrança de ${value}${what} de ${i.merchant} vence em ${due}.`,
    },
    PAYMENT_OVERDUE: {
      subject: `${i.merchant}: cobrança vencida`,
      lead: `A cobrança de ${value}${what} de ${i.merchant} venceu em ${due} e ainda não foi paga.`,
    },
    PAYMENT_RECEIVED: {
      subject: `${i.merchant}: pagamento confirmado`,
      lead: `Recebemos o seu pagamento de ${value}${what} para ${i.merchant}. Obrigado!`,
    },
  }

  if (plan) {
    lines.PAYMENT_CREATED = {
      subject: `${i.merchant}: novo parcelamento de ${brl(plan.totalCents)} em ${plan.count}x`,
      lead: `${i.merchant} gerou um parcelamento de ${value}${what}. A 1ª parcela vence em ${br(i.dueDate)}; as demais, no mesmo dia dos meses seguintes.`,
    }
  }
  const { subject, lead } = lines[event]
  const cta = event === 'PAYMENT_RECEIVED' ? 'Ver comprovante' : 'Ver fatura e pagar'
  const text = `Olá, ${i.payer}.\n\n${lead}\n\n${cta}: ${i.invoiceUrl}\n\n— ${i.merchant}, via Asaas (simulador)`
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:system-ui,sans-serif;color:#0b1736;max-width:560px;margin:0 auto;padding:24px">
<p>Olá, ${escape(i.payer)}.</p>
<p>${escape(lead)}</p>
<p><a href="${escape(i.invoiceUrl)}" style="display:inline-block;background:#0038e5;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${cta}</a></p>
<p style="color:#5b6785;font-size:13px">${escape(i.merchant)}, via Asaas (simulador)</p>
</body></html>`

  return {
    subject,
    text,
    html,
    sms: `${i.payer}: ${lead} ${cta}: ${i.invoiceUrl}`.slice(0, SMS_MAX_LENGTH),
    template: {
      name: TEMPLATE[event],
      language: 'pt_BR',
      params: [i.payer, i.merchant, value, due, i.invoiceUrl],
    },
  }
}

/** A Brazilian mobile number as WhatsApp addresses it: digits, with the 55 country code. */
export function whatsappNumber(mobilePhone: string | null): string | null {
  const d = (mobilePhone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`
}

/** A Brazilian mobile number in E.164 for the SMS mock: `+55` and the digits. */
export function smsNumber(mobilePhone: string | null): string | null {
  const n = whatsappNumber(mobilePhone)
  if (!n) return null
  // The SMS mock uses magic suffixes 0001–0005 for deliberate failure testing (0001 = unreachable).
  // Notifications from Asaas must reach the mock successfully ("tem que chegar", "não mande final 0001").
  if (/(?:000[1-5])$/.test(n)) {
    return `+${n.slice(0, -4)}0010`
  }
  return `+${n}`
}
