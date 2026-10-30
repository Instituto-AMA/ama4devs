/**
 * What the WhatsApp mock sends back to the sender number's webhook: delivery
 * statuses of the templates and the payer's replies. Kept in memory (the last
 * 100), for the Integrations > WhatsApp page; nothing in the business depends on it.
 */
export interface InboundWhatsapp {
  kind: 'status' | 'message'
  from: string
  detail: string
  at: string
}

const MAX = 100
const received: InboundWhatsapp[] = []

/** Reads a Cloud API webhook payload into lines: one per status or message. */
export function recordWhatsappWebhook(payload: any, at: string): number {
  let n = 0
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {}
      // A template's statuses come as `template_statuses` (the WhatsApp mock's shape);
      // a text message's as `statuses`.
      for (const s of [...(value.statuses ?? []), ...(value.template_statuses ?? [])]) {
        const what = s.template?.name ? `${s.status} · ${s.template.name}` : String(s.status ?? '')
        received.unshift({ kind: 'status', from: String(s.recipient_id ?? ''), detail: what, at })
        n++
      }
      for (const m of value.messages ?? []) {
        received.unshift({
          kind: 'message',
          from: String(m.from ?? ''),
          detail: String(m.text?.body ?? m.type ?? ''),
          at,
        })
        n++
      }
    }
  }
  received.splice(MAX)
  return n
}

export const inboundWhatsapp = (): readonly InboundWhatsapp[] => received
