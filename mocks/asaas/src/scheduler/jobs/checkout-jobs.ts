/**
 * Expires the hosted checkouts whose `minutesToExpire` ran out: ACTIVE → EXPIRED
 * and CHECKOUT_EXPIRED, once. (Track G1)
 *
 * NOT a daily job: a checkout lives minutes (10 to 1440), so it runs on every
 * tick, and `POST /_admin/clock/advance` with `{"minutes": 61}` expires a
 * 60-minute checkout. The compare-and-swap in `expireCheckout` keeps a repeated
 * tick, or a payer paying at the same instant, from producing a second event.
 */
import { expireDue } from '../../modules/checkout/service.ts'
import type { Job } from '../scheduler.ts'

export const checkoutExpiry: Job = {
  name: 'checkout-expiry',

  async run({ ctx, report }) {
    await expireDue(ctx, report)
  },
}
