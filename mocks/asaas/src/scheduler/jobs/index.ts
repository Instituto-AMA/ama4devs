/**
 * The jobs, IN THE ORDER they run. The order carries meaning: read each one's
 * comment before changing it.
 *
 * The scheduler's spine (mutex, once-per-simulated-day idempotency, TickReport)
 * is what keeps the jobs from colliding.
 */
import type { Job } from '../scheduler.ts'
import { anticipationSettlement } from './anticipation-jobs.ts'
import { invoiceIssuing } from './invoice-jobs.ts'
import { paymentNotices } from './notice-jobs.ts'
import { cardCapture, creditSettlement, overdue } from './payment-jobs.ts'
import { retentionPurge } from './retention-purge.ts'
import { splitDivergenceExpiry, splitRelease } from './split-jobs.ts'
import { subscriptionGeneration } from './subscription-jobs.ts'
import { transferSettlement } from './transfer-jobs.ts'
import { webhookDispatch } from './webhook-dispatch.ts'

/**
 * 1. Creates the charges of the subscriptions whose nextDueDate entered the
 *    lookahead window (default: 40 days). Runs FIRST so a charge created today
 *    is already seen by the jobs after it.
 *    → Track E — src/scheduler/jobs/subscription-jobs.ts
 */
export { subscriptionGeneration }

/**
 * 2. PENDING with dueDate < today → OVERDUE. From here on interest and fine run.
 *    → Track A — src/scheduler/jobs/payment-jobs.ts
 */
export { cardCapture }

export { overdue }

/**
 * 2b. The payer notices that fall on a calendar day: the warning N days before
 *    the due date and the repeat of an overdue charge. After `overdue`, so a
 *    charge that went overdue today already counts as overdue; before
 *    `webhook-dispatch`, which delivers the notifications.
 *    → src/scheduler/jobs/notice-jobs.ts
 */
export { paymentNotices }

/**
 * 3. CONFIRMED with creditDate <= today → RECEIVED. This is where money becomes
 *    balance: posts PAYMENT_RECEIVED (+gross) and PAYMENT_FEE (−fee) to the
 *    ledger. Pix skips this step (straight to RECEIVED); a card lands here at D+32.
 *    → Track A — src/scheduler/jobs/payment-jobs.ts
 */
export { creditSettlement }

/**
 * 4. AWAITING_CREDIT splits of credited charges → DONE. Moves the money between
 *    accounts and posts to BOTH statements. Runs after the credit because only
 *    money that came in can be split.
 *    → Track F — src/scheduler/jobs/split-jobs.ts
 */
export { splitRelease }

/**
 * 5. BLOCKED_BY_VALUE_DIVERGENCE splits whose adjustment deadline (2 business
 *    days) expired → CANCELLED with cancellationReason VALUE_DIVERGENCE_BLOCK.
 *    → Track F — src/scheduler/jobs/split-jobs.ts
 */
export { splitDivergenceExpiry }

/**
 * 6. SCHEDULED anticipations whose date arrived → CREDITED; and the debit when
 *    the original receivable settles. Runs AFTER the credit: the anticipation's
 *    debit only makes sense once the original receivable came in.
 *    → Track D — src/scheduler/jobs/anticipation-jobs.ts
 */
export { anticipationSettlement }

/**
 * 7. Transfers PENDING → BANK_PROCESSING → DONE/FAILED, on the business day.
 *    → Track D — src/scheduler/jobs/transfer-jobs.ts
 */
export { transferSettlement }

/**
 * 7b. Invoices (NFS-e): the city hall answers, a scheduled invoice goes to the
 *     city hall on its day, a subscription with `invoiceSettings` gets an invoice
 *     for each charge.
 *     → src/scheduler/jobs/invoice-jobs.ts
 */
export { invoiceIssuing }

/**
 * 8. Delivers the pending webhooks.
 *
 *    RUNS LAST, on purpose: every event the jobs above produced is already
 *    queued and goes out together, in the order it happened. Were the
 *    dispatcher to run in the middle, a 40-day advance() would deliver day 1's
 *    events before day 1 finished processing.
 *    → Track B — src/scheduler/jobs/webhook-dispatch.ts
 */
export { webhookDispatch }

/**
 * 9. Expires webhook deliveries past retention (14 simulated days).
 *    → Track B — src/scheduler/jobs/retention-purge.ts
 */
export { retentionPurge }

/** The order of this list IS the order of execution. */
export const JOBS: Job[] = [
  subscriptionGeneration,
  cardCapture,
  overdue,
  paymentNotices,
  creditSettlement,
  splitRelease,
  splitDivergenceExpiry,
  anticipationSettlement,
  transferSettlement,
  invoiceIssuing,
  webhookDispatch,
  retentionPurge,
]
