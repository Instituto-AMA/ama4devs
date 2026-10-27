/**
 * Queues the payer notifications of a charge event, inside the business
 * transaction (the emitter calls it next to the webhook fan-out).
 *
 * Which channels: those configured (MAILPIT_URL, WHATSAPP_MOCK_URL), for a
 * customer whose notifications are on, by the customer's notification settings
 * for the event when there are any, both channels otherwise. A forced send (the
 * panel's "Enviar agora") names its channels and skips the settings.
 */
import { and, eq } from 'drizzle-orm'
import type { Config } from '../core/config.ts'
import type { Clock } from '../core/clock.ts'
import type { Rng } from '../core/rng.ts'
import { badRequest } from '../core/errors.ts'
import type { DB } from '../db/client.ts'
import { accounts, customers, notificationDeliveries, notifications } from '../db/schema/index.ts'
import {
  composeNotification,
  whatsappNumber,
  type NotifiableEvent,
} from '../domain/notification-text.ts'

export type Channel = 'EMAIL' | 'WHATSAPP'

export interface NotifyDeps {
  clock: Clock
  rng: Rng
  config: Config
}

/** The fields of a serialized payment the messages need. */
export interface PaymentFacts {
  id: string
  customer: string
  value: number
  dueDate: string
  invoiceUrl: string
  description?: string | null
}

export async function enqueuePaymentNotifications(
  tx: DB,
  deps: NotifyDeps,
  args: {
    accountId: string
    event: NotifiableEvent
    payment: PaymentFacts
    /** Forced from the panel: these channels, whatever the settings. */
    forced?: Channel[]
  },
): Promise<number> {
  const { mailpitUrl, whatsappUrl } = deps.config.notify
  const [customer] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, args.payment.customer))
    .limit(1)
  if (!customer) return 0

  let channels: Channel[]
  if (args.forced) {
    channels = args.forced
    if (channels.includes('EMAIL') && !mailpitUrl) {
      throw badRequest('notify_not_configured', 'Envio de e-mail desligado: defina MAILPIT_URL no simulador.')
    }
    if (channels.includes('WHATSAPP') && !whatsappUrl) {
      throw badRequest('notify_not_configured', 'Envio de WhatsApp desligado: defina WHATSAPP_MOCK_URL no simulador.')
    }
  } else {
    if (customer.notificationDisabled) return 0
    const [setting] = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.customerId, customer.id), eq(notifications.event, args.event), eq(notifications.deleted, false)))
      .limit(1)
    const email = setting ? setting.enabled && setting.emailEnabledForCustomer : true
    const whatsapp = setting ? setting.enabled && setting.whatsappEnabledForCustomer : true
    channels = []
    if (email && mailpitUrl) channels.push('EMAIL')
    if (whatsapp && whatsappUrl) channels.push('WHATSAPP')
  }
  if (channels.length === 0) return 0

  const [account] = await tx
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.id, args.accountId))
    .limit(1)

  const message = composeNotification(args.event, {
    payer: customer.name,
    merchant: account?.name ?? 'Asaas',
    valueCents: Math.round(args.payment.value * 100),
    dueDate: args.payment.dueDate,
    invoiceUrl: args.payment.invoiceUrl,
    description: args.payment.description ?? null,
  })

  const recipients: Record<Channel, string | null> = {
    EMAIL: customer.email,
    WHATSAPP: whatsappNumber(customer.mobilePhone),
  }

  let queued = 0
  for (const channel of channels) {
    const recipient = recipients[channel]
    if (!recipient) {
      if (args.forced) {
        throw badRequest(
          'notify_no_recipient',
          channel === 'EMAIL' ? 'O cliente não tem e-mail cadastrado.' : 'O cliente não tem celular cadastrado.',
        )
      }
      continue
    }
    await tx.insert(notificationDeliveries).values({
      id: deps.rng.uuid(),
      accountId: args.accountId,
      customerId: customer.id,
      paymentId: args.payment.id,
      event: args.event,
      channel,
      recipient,
      subject: channel === 'EMAIL' ? message.subject : null,
      body: channel === 'EMAIL' ? message.text : message.template.params.join(' | '),
      html: channel === 'EMAIL' ? message.html : null,
      template: channel === 'WHATSAPP' ? message.template : null,
      forced: Boolean(args.forced),
      status: 'PENDING',
      attempt: 0,
      lastError: null,
      dateCreated: deps.clock.timestamp(),
      sentAt: null,
      createdAtMs: deps.clock.nowMs(),
    })
    queued++
  }
  return queued
}
