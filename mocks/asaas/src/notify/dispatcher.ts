/**
 * Delivers the queued payer notifications: the e-mail to Mailpit's send API, the
 * template to the WhatsApp mock's Cloud API (`POST /v23.0/{phoneNumberId}/messages`).
 *
 * Runs with every webhook dispatch (each tick and right after a request that
 * changed something). A failure keeps the row PENDING for the next pass, up to
 * NOTIFY_MAX_ATTEMPTS, then FAILED with the last error; nothing here blocks or
 * retries the business operation that produced it.
 */
import { asc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context.ts'
import { notificationDeliveries } from '../db/schema/index.ts'
import { composeNotification } from '../domain/notification-text.ts'
import { GRAPH_VERSION, WHATSAPP_AUTH } from './channels.ts'

type Row = typeof notificationDeliveries.$inferSelect

const BATCH = 50
const TIMEOUT_MS = 5_000

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
}

async function send(ctx: AppContext, row: Row): Promise<void> {
  const { mailpitUrl, whatsappUrl, whatsappPhoneNumberId, fromEmail } = ctx.config.notify
  if (row.channel === 'EMAIL') {
    if (!mailpitUrl) throw new Error('MAILPIT_URL não configurado')
    await post(`${mailpitUrl}/api/v1/send`, {
      From: { Email: fromEmail, Name: 'Asaas (simulador)' },
      To: [{ Email: row.recipient }],
      Subject: row.subject ?? '',
      Text: row.body,
      ...(row.html ? { HTML: row.html } : {}),
      Tags: ['asaas', row.event],
    })
    return
  }
  if (!whatsappUrl) throw new Error('WHATSAPP_MOCK_URL não configurado')
  const template = row.template
  if (!template) throw new Error('notificação de WhatsApp sem template')
  // Positional placeholders ({{1}}, {{2}}…): Meta fills them in order, no name.
  await post(
    `${whatsappUrl}/${GRAPH_VERSION}/${whatsappPhoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: row.recipient,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: [{ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) }],
      },
    },
    WHATSAPP_AUTH,
  )
}

/**
 * A test straight to the channel, outside any charge (Integrações › "Enviar teste"):
 * the same e-mail and template a new charge produces, with sample data.
 */
export async function sendTestNotification(
  ctx: AppContext,
  channel: 'EMAIL' | 'WHATSAPP',
  to: string,
): Promise<void> {
  const message = composeNotification('PAYMENT_CREATED', {
    payer: 'Pagador de Teste',
    merchant: 'Asaas (teste de canal)',
    valueCents: 12_345,
    dueDate: ctx.clock.today(),
    invoiceUrl: `${ctx.config.invoiceBaseUrl}/i/000000000000`,
    description: 'Teste de envio',
  })
  await send(ctx, {
    id: 'test',
    accountId: '',
    customerId: '',
    paymentId: null,
    event: 'PAYMENT_CREATED',
    channel,
    recipient: to,
    subject: channel === 'EMAIL' ? `[Teste] ${message.subject}` : null,
    body: channel === 'EMAIL' ? message.text : message.template.params.join(' | '),
    html: channel === 'EMAIL' ? message.html : null,
    template: channel === 'WHATSAPP' ? message.template : null,
    forced: true,
    status: 'PENDING',
    attempt: 0,
    lastError: null,
    dateCreated: ctx.clock.timestamp(),
    sentAt: null,
    createdAtMs: 0,
  })
}

/** One pass over the pending notifications; returns how many were sent. */
export async function dispatchNotifications(ctx: AppContext): Promise<number> {
  const { mailpitUrl, whatsappUrl, maxAttempts } = ctx.config.notify
  if (!mailpitUrl && !whatsappUrl) return 0

  const due = await ctx.db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.status, 'PENDING'))
    .orderBy(asc(notificationDeliveries.createdAtMs))
    .limit(BATCH)

  let sent = 0
  for (const row of due) {
    try {
      await send(ctx, row)
      await ctx.db
        .update(notificationDeliveries)
        .set({ status: 'SENT', attempt: row.attempt + 1, sentAt: ctx.clock.timestamp(), lastError: null })
        .where(eq(notificationDeliveries.id, row.id))
      sent++
    } catch (err) {
      const attempt = row.attempt + 1
      await ctx.db
        .update(notificationDeliveries)
        .set({
          status: attempt >= maxAttempts ? 'FAILED' : 'PENDING',
          attempt,
          lastError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(notificationDeliveries.id, row.id))
    }
  }
  return sent
}
