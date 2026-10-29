/**
 * The payer notices that fall on a calendar day, not on a fact of the charge:
 * PAYMENT_DUEDATE_WARNING N days before the due date (0 is the due day), and
 * PAYMENT_OVERDUE every N days while the charge stays overdue. Each customer's
 * settings say which days (domain/notification-defaults.ts, `scheduledToday`);
 * the notice turning overdue itself goes with the transition (core/events.ts).
 *
 * Every tick, so a channel found late in the day still gets the day's notice;
 * one notice per charge, event and day (a forced send does not count), so the
 * ticks of a day, and an OVERDUE repeat that falls on the day the charge went
 * overdue, never tell the payer twice.
 */
import { and, eq, inArray, like } from 'drizzle-orm'
import { customers, notificationDeliveries, notifications, payments } from '../../db/schema/index.ts'
import { addDays } from '../../domain/calendar.ts'
import { scheduledToday } from '../../domain/notification-defaults.ts'
import type { NotifiableEvent } from '../../domain/notification-text.ts'
import { enqueuePaymentNotifications, type PaymentFacts } from '../../notify/enqueue.ts'
import { serializePayment } from '../../modules/payments/serializer.ts'
import type { PaymentRow } from '../../modules/payments/serializer.ts'
import type { Job } from '../scheduler.ts'

/** The farthest warning Asaas offers: 30 days before the due date. */
const MAX_WARNING_DAYS = 30

export const paymentNotices: Job = {
  name: 'payment-notices',

  async run({ ctx }) {
    const { mailpitUrl, whatsappUrl } = ctx.config.notify
    if (!mailpitUrl && !whatsappUrl) return
    const today = ctx.clock.today()

    // The charges that may hear something today: due within the warning window,
    // or overdue. The settings narrow it to the day.
    const candidates = await ctx.db
      .select({ payment: payments, setting: notifications })
      .from(payments)
      .innerJoin(customers, eq(customers.id, payments.customerId))
      .innerJoin(notifications, eq(notifications.customerId, customers.id))
      .where(
        and(
          eq(payments.deleted, false),
          eq(customers.notificationDisabled, false),
          inArray(payments.status, ['PENDING', 'OVERDUE']),
          inArray(notifications.event, ['PAYMENT_DUEDATE_WARNING', 'PAYMENT_OVERDUE']),
          eq(notifications.enabled, true),
          eq(notifications.deleted, false),
        ),
      )

    const horizon = addDays(today, MAX_WARNING_DAYS)
    for (const { payment, setting } of candidates) {
      if (payment.status === 'PENDING' && payment.dueDate > horizon) continue
      if (!scheduledToday(setting, payment, today)) continue

      const [told] = await ctx.db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.paymentId, payment.id),
            eq(notificationDeliveries.event, setting.event),
            eq(notificationDeliveries.forced, false),
            like(notificationDeliveries.dateCreated, `${today}%`),
          ),
        )
        .limit(1)
      if (told) continue

      const facts = (await serializePayment(ctx.db, payment as PaymentRow)) as unknown as PaymentFacts
      await enqueuePaymentNotifications(
        ctx.db,
        { clock: ctx.clock, rng: ctx.rng, config: ctx.config },
        {
          accountId: payment.accountId,
          event: setting.event as NotifiableEvent,
          payment: facts,
          scheduleOffset: setting.scheduleOffset,
        },
      )
    }
  },
}
