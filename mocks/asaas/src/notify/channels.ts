/**
 * The payer channels as running services: the WhatsApp mock, the SMS mock and Mailpit.
 *
 * Nothing here needs a person. Both are found by themselves (discovery.ts), and on
 * boot and on every tick the sender number gets this server's webhook in the
 * WhatsApp mock through the Cloud API call Meta documents (`POST /{phone-number-id}`
 * with `webhook_configuration`; the mock verifies the address with `hub.challenge`,
 * which `/_mock/whatsapp/webhook` answers), so the number has somewhere to send
 * delivery statuses and the payer's replies. Unless NOTIFY_CALLBACK_BASE_URL says
 * where, that address is found the same way: each place this server may be reached
 * on is offered in turn, and the first one the WhatsApp mock verifies is kept. The
 * WhatsApp mock keeps it in memory, so a restart of it is repaired on the next
 * tick. Mailpit and the SMS mock need no setup. Someone may change either one by hand afterwards;
 * the registration only fills in what is missing.
 *
 * Also what Integrações shows: whether each channel answers, and what actually
 * arrived there (read back from Mailpit's API and the number's messages).
 */
import { networkInterfaces } from 'node:os'
import type { Config } from '../core/config.ts'
import type { AppContext } from '../core/context.ts'
import { allowHost, disallowHost } from '../http/local-guard.ts'

const TIMEOUT_MS = 3_000
/** The WhatsApp mock verifies a callback before it answers, up to 5 s per address. */
const REGISTER_TIMEOUT_MS = 8_000

/** The Graph version the WhatsApp mock serves (its `spec/<version>`). */
export const GRAPH_VERSION = 'v23.0'

/**
 * The access token of the Cloud API calls. The mock wants one, like Meta, and
 * accepts any: it is not a secret.
 */
export const WHATSAPP_AUTH = { authorization: 'Bearer asaas-mock' }

/** The names the WhatsApp mock's guard admits without MOCK_ALLOWED_HOSTS. */
const WHATSAPP_KNOWN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'])

/**
 * The headers of a call to the WhatsApp mock at `url`. Its guard admits only known
 * Host names, against DNS rebinding from a page in a browser. Reached by a compose
 * service name or a container address, this server names itself `localhost`, as a
 * server-side caller may: no browser is involved, and the WhatsApp mock then needs
 * no MOCK_ALLOWED_HOSTS. A dotted name (a proxy in front of it) is left as it is.
 */
export function whatsappHeaders(url: string): Record<string, string> {
  const { hostname } = new URL(url)
  const local = !WHATSAPP_KNOWN_HOSTS.has(hostname) && (!hostname.includes('.') || /^\d+(\.\d+){3}$/.test(hostname))
  return local ? { ...WHATSAPP_AUTH, host: 'localhost' } : { ...WHATSAPP_AUTH }
}

/** Why a channel is off, for the logs, the notification rows and Integrações. */
export function channelOffReason(notify: Config['notify'], channel: 'EMAIL' | 'WHATSAPP' | 'SMS'): string {
  const discover = notify.discover
  if (channel === 'EMAIL') {
    return discover?.mailpit.length
      ? `nenhum Mailpit respondendo (procurado em ${discover.mailpit.join(', ')})`
      : 'MAILPIT_URL vazio: e-mail desligado'
  }
  if (channel === 'SMS') {
    return discover?.sms?.length
      ? `nenhum mock de SMS respondendo (procurado em ${discover.sms.join(', ')})`
      : 'SMS_MOCK_URL vazio: SMS desligado'
  }
  return discover?.whatsapp.length
    ? `nenhum mock de WhatsApp respondendo (procurado em ${discover.whatsapp.join(', ')})`
    : 'WHATSAPP_MOCK_URL vazio: WhatsApp desligado'
}

async function get(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const CALLBACK_PATH = '/_mock/whatsapp/webhook'

/** The webhook this server listens on for the WhatsApp mock. */
export const whatsappCallbackUrl = (ctx: AppContext) => `${ctx.config.notify.callbackBaseUrl}${CALLBACK_PATH}`

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Where the WhatsApp mock may reach this server, best first. A WhatsApp mock on
 * this machine's loopback reaches it there, or through the Docker host when the
 * mock runs in a container with its port published; one in another container
 * reaches it by this container's address on their network.
 */
export function callbackCandidates(ctx: AppContext, whatsappUrl: string): string[] {
  const { port } = ctx.config
  const own = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a!.address}:${port}`)
  const local = [`http://localhost:${port}`, `http://host.docker.internal:${port}`]
  const ordered = LOOPBACK.has(new URL(whatsappUrl).hostname) ? [...local, ...own] : [...own, ...local.reverse()]
  return [...new Set(ordered)]
}

/**
 * Registers the sender number in the WhatsApp mock unless it already has a webhook
 * there: a person's address is kept, and so is this server's own. Returns whether
 * the number is registered now.
 */
export async function ensureWhatsappSender(ctx: AppContext): Promise<{ registered: boolean; error?: string }> {
  const notify = ctx.config.notify
  const { whatsappUrl, whatsappPhoneNumberId } = notify
  if (!whatsappUrl) return { registered: false, error: channelOffReason(ctx.config.notify,'WHATSAPP') }
  const findCallback = Boolean(notify.discover?.callback)
  const node = `${whatsappUrl}/${GRAPH_VERSION}/${whatsappPhoneNumberId}`
  const headers = whatsappHeaders(whatsappUrl)
  try {
    const number = await get(`${node}?fields=webhook_configuration`, headers)
    const current: string | undefined = number.webhook_configuration?.phone_number
    // Only an earlier run's container address is replaced (a restarted container
    // gets a new one, and the WhatsApp mock would call the old one in vain). A name
    // is kept: it may be another Asaas mock sharing this WhatsApp mock.
    const stale =
      findCallback &&
      current !== undefined &&
      current !== whatsappCallbackUrl(ctx) &&
      current.endsWith(CALLBACK_PATH) &&
      /^\d+(\.\d+){3}$/.test(new URL(current).hostname)
    if (current && !stale) return { registered: true }

    const bases = findCallback ? callbackCandidates(ctx, whatsappUrl) : [notify.callbackBaseUrl]
    const refused: string[] = []
    for (const base of bases) {
      // The WhatsApp mock checks the address right away: the guard must admit it first.
      const added = allowHost(ctx.config.allowedHosts, base)
      const res = await fetch(node, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          webhook_configuration: { override_callback_uri: `${base}${CALLBACK_PATH}`, verify_token: 'asaas-mock' },
        }),
        signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
      })
      if (res.ok) {
        notify.callbackBaseUrl = base
        ctx.log('info', 'Sender number registered in the WhatsApp mock', {
          phoneNumberId: whatsappPhoneNumberId,
          callback: `${base}${CALLBACK_PATH}`,
        })
        return { registered: true }
      }
      if (added) disallowHost(ctx.config.allowedHosts, added)
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      refused.push(`${base}: HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    throw new Error(refused.join('; '))
  } catch (err) {
    return { registered: false, error: errorText(err) }
  }
}

const FOOTER = 'Enviado pelo Asaas (simulador)'

/**
 * The payer templates, one per event (`domain/notification-text.ts` names them
 * and fills the five body variables: payer, merchant, value, due date, link).
 */
export const WHATSAPP_TEMPLATES: Array<{ name: string; header: string; body: string }> = [
  {
    name: 'asaas_cobranca_criada',
    header: 'Nova cobrança',
    body: 'Olá, {{1}}! {{2}} gerou uma cobrança de {{3}} com vencimento em {{4}}. Pague por aqui: {{5}}',
  },
  {
    name: 'asaas_cobranca_alterada',
    header: 'Cobrança alterada',
    body: 'Olá, {{1}}. {{2}} alterou a sua cobrança: agora {{3}}, com vencimento em {{4}}. Veja a fatura: {{5}}',
  },
  {
    name: 'asaas_lembrete_vencimento',
    header: 'Lembrete de vencimento',
    body: 'Olá, {{1}}. Lembrete: a cobrança de {{3}} de {{2}} vence em {{4}}. Pague por aqui: {{5}}',
  },
  {
    name: 'asaas_cobranca_vencida',
    header: 'Cobrança vencida',
    body: 'Olá, {{1}}. A cobrança de {{3}} de {{2}} venceu em {{4}} e ainda não foi paga. Regularize por aqui: {{5}}',
  },
  {
    name: 'asaas_pagamento_confirmado',
    header: 'Pagamento confirmado',
    body: 'Olá, {{1}}! Recebemos o seu pagamento de {{3}} para {{2}} (vencimento {{4}}). Comprovante: {{5}}',
  },
]

const TEMPLATE_EXAMPLE = ['Maria', 'Clínica Exemplo', 'R$ 150,00', '30/10/2026', 'http://localhost:45445/i/123456789012']

/**
 * Creates in the WhatsApp mock, through Meta's call (`POST /{waba-id}/message_templates`),
 * every payer template its library lacks, approved at once (`X-Mock-Template-Review-Delay: 0`).
 * A template that exists is left as it is: a person's edit is kept.
 */
export async function ensureWhatsappTemplates(ctx: AppContext): Promise<{ ready: boolean; error?: string }> {
  const { whatsappUrl, whatsappWabaId } = ctx.config.notify
  if (!whatsappUrl) return { ready: false, error: channelOffReason(ctx.config.notify,'WHATSAPP') }
  const library = `${whatsappUrl}/${GRAPH_VERSION}/${whatsappWabaId}/message_templates`
  const headers = whatsappHeaders(whatsappUrl)
  try {
    for (const template of WHATSAPP_TEMPLATES) {
      const found = await get(`${library}?name=${template.name}`, headers)
      if ((found.data ?? []).some((t: any) => t.name === template.name && t.language === 'pt_BR')) continue
      const res = await fetch(library, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mock-template-review-delay': '0', ...headers },
        body: JSON.stringify({
          name: template.name,
          language: 'pt_BR',
          category: 'UTILITY',
          components: [
            { type: 'HEADER', format: 'TEXT', text: template.header },
            { type: 'BODY', text: template.body, example: { body_text: [TEMPLATE_EXAMPLE] } },
            { type: 'FOOTER', text: FOOTER },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`${template.name}: HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
      }
      ctx.log('info', 'Payer template created in the WhatsApp mock', { name: template.name })
    }
    return { ready: true }
  } catch (err) {
    return { ready: false, error: errorText(err) }
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
  sms: ChannelStatus
}> {
  const n = ctx.config.notify
  const probe = async (url: string | undefined, path: string, off: string, headers: Record<string, string> = {}) => {
    if (!url) return { reachable: false, error: off }
    try {
      await get(`${url}${path}`, headers)
      return { reachable: true, error: null }
    } catch (err) {
      return { reachable: false, error: errorText(err) }
    }
  }
  const [mail, wa, sms, sender] = await Promise.all([
    probe(n.mailpitUrl, '/api/v1/info', channelOffReason(ctx.config.notify,'EMAIL')),
    probe(
      n.whatsappUrl,
      '/health',
      channelOffReason(ctx.config.notify,'WHATSAPP'),
      n.whatsappUrl ? whatsappHeaders(n.whatsappUrl) : {},
    ),
    probe(n.smsUrl, '/health', channelOffReason(ctx.config.notify, 'SMS')),
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
    sms: { on: Boolean(n.smsUrl), ...sms, uiUrl: n.smsUiUrl ?? 'http://localhost:8899' },
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
export async function arrivals(ctx: AppContext, channel: 'EMAIL' | 'WHATSAPP' | 'SMS'): Promise<Arrival[]> {
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
  if (channel === 'SMS') {
    if (!n.smsUrl) return []
    const res = await get(`${n.smsUrl}/v1/messages?direction=outbound&limit=50`)
    return (res.messages ?? []).map((m: any) => ({
      id: String(m.id),
      to: String(m.to ?? ''),
      title: 'SMS',
      text: String(m.body ?? ''),
      at: String(m.createdAt ?? ''),
    }))
  }
  if (!n.whatsappUrl) return []
  // The number's conversation, both sides: `out` is what the business sent.
  const res = await get(
    `${n.whatsappUrl}/${GRAPH_VERSION}/${n.whatsappPhoneNumberId}/messages`,
    whatsappHeaders(n.whatsappUrl),
  )
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
