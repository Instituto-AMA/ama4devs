/**
 * Queues the payer notifications of a charge event, inside the business
 * transaction (the emitter calls it next to the webhook fan-out).
 *
 * Which channels: those whose address is known, set or found (discovery.ts), for a
 * customer whose notifications are on, by the customer's notification setting for
 * the event at that offset (settings.ts; no such row, or the row off, sends
 * nothing). A forced send (the panel's "Enviar agora") names its channels and
 * skips the settings.
 */
import { eq } from 'drizzle-orm'
import type { Config } from '../core/config.ts'
import type { Clock } from '../core/clock.ts'
import type { Rng } from '../core/rng.ts'
import { badRequest } from '../core/errors.ts'
import type { DB } from '../db/client.ts'
import {
  accounts,
  customers,
  installments,
  notificationDeliveries,
  payments,
} from '../db/schema/index.ts'
import {
  composeNotification,
  smsNumber,
  whatsappNumber,
  type InstallmentFacts,
  type NotifiableEvent,
} from '../domain/notification-text.ts'
import { channelOffReason } from './channels.ts'
import { ensureCustomerNotifications } from './settings.ts'

export type Channel = 'EMAIL' | 'WHATSAPP' | 'SMS'

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
  subscription?: string | null
}

export async function enqueuePaymentNotifications(
  tx: DB,
  deps: NotifyDeps,
  args: {
    accountId: string
    event: NotifiableEvent
    payment: PaymentFacts
    /**
     * Which of the event's settings speaks: the days before the due date of a
     * PAYMENT_DUEDATE_WARNING, the repeat of a PAYMENT_OVERDUE. 0 when absent.
     */
    scheduleOffset?: number
    /** Forced from the panel: these channels, whatever the settings. */
    forced?: Channel[]
  },
): Promise<number> {
  const { mailpitUrl, whatsappUrl, smsUrl } = deps.config.notify
  const [customer] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, args.payment.customer))
    .limit(1)
  if (!customer) return 0

  let channels: Channel[] = []
  if (args.forced) {
    channels = args.forced
    if (channels.includes('EMAIL') && !mailpitUrl) {
      throw badRequest('notify_not_configured', `Envio de e-mail desligado: ${channelOffReason(deps.config.notify, 'EMAIL')}.`)
    }
    if (channels.includes('WHATSAPP') && !whatsappUrl) {
      throw badRequest(
        'notify_not_configured',
        `Envio de WhatsApp desligado: ${channelOffReason(deps.config.notify, 'WHATSAPP')}.`,
      )
    }
    if (channels.includes('SMS') && !smsUrl) {
      throw badRequest('notify_not_configured', `Envio de SMS desligado: ${channelOffReason(deps.config.notify, 'SMS')}.`)
    }
  }

  // An installment plan creates its N charges at once, but the payer hears about
  // the plan once: the first installment's creation tells the whole plan, the
  // other N-1 creations stay silent. Reminders, overdue and payment notices are
  // per installment (each has its own due date).
  let installment: InstallmentFacts | undefined
  if (args.event === 'PAYMENT_CREATED' && !args.forced) {
    const [row] = await tx
      .select({ installmentId: payments.installmentId, installmentNumber: payments.installmentNumber })
      .from(payments)
      .where(eq(payments.id, args.payment.id))
      .limit(1)
    if (row?.installmentId) {
      if (Number(row.installmentNumber) !== 1) return 0
      const [plan] = await tx.select().from(installments).where(eq(installments.id, row.installmentId)).limit(1)
      if (plan) {
        installment = {
          count: plan.installmentCount,
          totalCents: plan.totalValueCents,
          // The first installment's value: the plan keeps the last one's (it carries the rounding).
          valueCents: Math.round(args.payment.value * 100),
          description: plan.description ?? null,
        }
      }
    }
  }

  if (!args.forced) {
    if (customer.notificationDisabled) return 0
    // Asaas tells a new charge, except a subscription's.
    if (args.event === 'PAYMENT_CREATED' && args.payment.subscription) return 0
    const offset = args.scheduleOffset ?? 0
    const setting = (await ensureCustomerNotifications(tx, deps.rng, customer.id)).find(
      (n) => n.event === args.event && n.scheduleOffset === offset,
    )
    if (!setting?.enabled) return 0
    const email = setting.emailEnabledForCustomer
    const whatsapp = setting.whatsappEnabledForCustomer
    const sms = setting.smsEnabledForCustomer
    channels = []
    if (email && mailpitUrl) channels.push('EMAIL')
    if (whatsapp && whatsappUrl) channels.push('WHATSAPP')
    if (sms && smsUrl) channels.push('SMS')
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
    description: installment ? installment.description : (args.payment.description ?? null),
    installment,
  })

  const recipients: Record<Channel, string | null> = {
    EMAIL: customer.email,
    WHATSAPP: whatsappNumber(customer.mobilePhone),
    SMS: smsNumber(customer.mobilePhone),
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
      body: channel === 'EMAIL' ? message.text : channel === 'SMS' ? message.sms : message.template.params.join(' | '),
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
