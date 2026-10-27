/**
 * The two payer channels as running services: the WhatsApp mock and Mailpit.
 *
 * Nothing here needs a person. On boot and on every tick the sender number gets
 * this server's webhook in the WhatsApp mock through the Cloud API call Meta
 * documents (`POST /{phone-number-id}` with `webhook_configuration`; the mock
 * verifies the address with `hub.challenge`, which `/_mock/whatsapp/webhook`
 * answers), so the number has somewhere to send delivery statuses and the payer's
 * replies. The WhatsApp mock keeps that in memory, so a restart of it is repaired
 * on the next tick. Mailpit needs no setup. Someone may change either one by hand
 * afterwards; the registration only fills in what is missing.
 *
 * Also what Integrações shows: whether each channel answers, and what actually
 * arrived there (read back from Mailpit's API and the number's messages).
 */
import type { AppContext } from '../core/context.ts'

const TIMEOUT_MS = 3_000

/** The Graph version the WhatsApp mock serves (its `spec/<version>`). */
export const GRAPH_VERSION = 'v23.0'

/**
 * The access token of the Cloud API calls. The mock wants one, like Meta, and
 * accepts any: it is not a secret.
 */
export const WHATSAPP_AUTH = { authorization: 'Bearer asaas-mock' }

async function get(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The webhook this server listens on for the WhatsApp mock. */
export const whatsappCallbackUrl = (ctx: AppContext) =>
  `${ctx.config.notify.callbackBaseUrl}/_mock/whatsapp/webhook`

/**
 * Registers the sender number in the WhatsApp mock unless it already has a webhook
 * there (a person's change is kept). Returns whether the number is registered now.
 */
export async function ensureWhatsappSender(ctx: AppContext): Promise<{ registered: boolean; error?: string }> {
  const { whatsappUrl, whatsappPhoneNumberId } = ctx.config.notify
  if (!whatsappUrl) return { registered: false, error: 'WHATSAPP_MOCK_URL não configurado' }
  const node = `${whatsappUrl}/${GRAPH_VERSION}/${whatsappPhoneNumberId}`
  try {
    const number = await get(`${node}?fields=webhook_configuration`, WHATSAPP_AUTH)
    if (number.webhook_configuration?.phone_number) return { registered: true }
    const res = await fetch(node, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...WHATSAPP_AUTH },
      body: JSON.stringify({
        webhook_configuration: {
          override_callback_uri: whatsappCallbackUrl(ctx),
          verify_token: 'asaas-mock',
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    ctx.log('info', 'Sender number registered in the WhatsApp mock', { phoneNumberId: whatsappPhoneNumberId })
    return { registered: true }
  } catch (err) {
    return { registered: false, error: errorText(err) }
  }
}

export interface ChannelStatus {
  on: boolean
  reachable: boolean
  error: string | null
  uiUrl: string
}

/** Whether each channel is configured and answering, for Integrações. */
export async function channelStatus(ctx: AppContext): Promise<{
  email: ChannelStatus & { from: string }
  whatsapp: ChannelStatus & { sender: string; registered: boolean; callbackUrl: string }
}> {
  const n = ctx.config.notify
  const probe = async (url: string | undefined, path: string) => {
    if (!url) return { reachable: false, error: null }
    try {
      await get(`${url}${path}`)
      return { reachable: true, error: null }
    } catch (err) {
      return { reachable: false, error: errorText(err) }
    }
  }
  const [mail, wa, sender] = await Promise.all([
    probe(n.mailpitUrl, '/api/v1/info'),
    probe(n.whatsappUrl, '/health'),
    ensureWhatsappSender(ctx),
  ])
  return {
    email: { on: Boolean(n.mailpitUrl), ...mail, uiUrl: n.mailpitUiUrl, from: n.fromEmail },
    whatsapp: {
      on: Boolean(n.whatsappUrl),
      ...wa,
      uiUrl: n.whatsappUiUrl,
      sender: n.whatsappPhoneNumberId,
      registered: sender.registered,
      callbackUrl: whatsappCallbackUrl(ctx),
    },
  }
}

export interface Arrival {
  id: string
  to: string
  title: string
  text: string
  at: string
}

/** What actually arrived at the channel from this server, newest first. */
export async function arrivals(ctx: AppContext, channel: 'EMAIL' | 'WHATSAPP'): Promise<Arrival[]> {
  const n = ctx.config.notify
  if (channel === 'EMAIL') {
    if (!n.mailpitUrl) return []
    const res = await get(`${n.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`from:${n.fromEmail}`)}&limit=50`)
    return (res.messages ?? []).map((m: any) => ({
      id: String(m.ID),
      to: (m.To ?? []).map((t: any) => t.Address).join(', '),
      title: String(m.Subject ?? ''),
      text: String(m.Snippet ?? ''),
      at: String(m.Created ?? ''),
    }))
  }
  if (!n.whatsappUrl) return []
  // The number's conversation, both sides: `out` is what the business sent.
  const res = await get(`${n.whatsappUrl}/${GRAPH_VERSION}/${n.whatsappPhoneNumberId}/messages`, WHATSAPP_AUTH)
  return (res.data ?? [])
    .filter((m: any) => m.direction === 'out')
    .reverse()
    .slice(0, 50)
    .map((m: any) => ({
      id: String(m.id),
      to: String(m.contact ?? ''),
      title: m.template ? `template ${m.template.name}` : 'mensagem',
      text: String(m.template?.body ?? m.text ?? ''),
      at: String(m.timestamp ?? ''),
    }))
}
