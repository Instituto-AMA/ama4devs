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
  PAYMENT_CREATED: 'asaas_cobranca_criada',
  PAYMENT_UPDATED: 'asaas_cobranca_alterada',
  PAYMENT_DUEDATE_WARNING: 'asaas_lembrete_vencimento',
  PAYMENT_OVERDUE: 'asaas_cobranca_vencida',
  PAYMENT_RECEIVED: 'asaas_pagamento_confirmado',
}

export interface NotificationInput {
  payer: string
  merchant: string
  valueCents: number
  /** YYYY-MM-DD. */
  dueDate: string
  invoiceUrl: string
  description: string | null
}

export interface NotificationMessage {
  subject: string
  text: string
  html: string
  template: { name: string; language: string; params: string[] }
}

const brl = (cents: number) =>
  `R$ ${(cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function composeNotification(event: NotifiableEvent, i: NotificationInput): NotificationMessage {
  const value = brl(i.valueCents)
  const due = br(i.dueDate)
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
