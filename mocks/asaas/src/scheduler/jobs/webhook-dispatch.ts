/**
 * Job 7 — delivers the webhooks that are due.
 *
 * It is NOT `once()`: it is not a daily job. Every time the clock moves (a tick,
 * an advance, the timer), the queue is drained. An event emitted at 10am and a
 * retry scheduled for 10:30am are two different instants of the same simulated
 * day.
 *
 * The real logic is in src/webhooks/dispatcher.ts.
 */
import { ensureWhatsappSender, ensureWhatsappTemplates } from '../../notify/channels.ts'
import { dispatchNotifications } from '../../notify/dispatcher.ts'
import { dispatchDue } from '../../webhooks/dispatcher.ts'
import type { Job } from '../scheduler.ts'

export const webhookDispatch: Job = {
  name: 'webhook-dispatch',
  async run({ ctx, report, paused }) {
    await dispatchDue(ctx, report, paused)
    // The payer notifications (e-mail, WhatsApp) drain with the webhooks, and the
    // sender number and its templates are put back if the WhatsApp mock came up
    // late, restarted or lost them.
    if (ctx.config.notify.whatsappUrl) {
      await ensureWhatsappSender(ctx)
      await ensureWhatsappTemplates(ctx)
    }
    await dispatchNotifications(ctx)
  },
}
