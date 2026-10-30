/**
 * Identifier generation in the exact Asaas format.
 *
 * The prefixes are NOT uniform — some resources use a prefix, some use a plain
 * UUID. This was verified in the documentation, one by one. Do not "standardize": a
 * client that validates `id.startsWith('pay_')` has to keep working, and so does one
 * that expects a plain UUID in `installment`.
 */
import type { Rng } from '../core/rng.ts'

// ── with a prefix ────────────────────────────────────────────
export const paymentId = (rng: Rng) => `pay_${rng.digits(12)}`
export const customerId = (rng: Rng) => `cus_${rng.digits(12)}`
export const subscriptionId = (rng: Rng) => `sub_${rng.alphanumeric(12)}`
/** `not_wuGp97JeCr7G` — a customer's notification. */
export const notificationId = (rng: Rng) => `not_${rng.alphanumeric(12)}`

/** `evt_<hex32>&<n>`. The `&<n>` suffix is part of the id — it is in every official example. */
export const webhookEventId = (rng: Rng, seq: number) => `evt_${rng.hex(32)}&${seq}`

// ── plain UUID, no prefix ────────────────────────────────────
export const installmentId = (rng: Rng) => rng.uuid()
export const transferId = (rng: Rng) => rng.uuid()
export const anticipationId = (rng: Rng) => rng.uuid()
export const splitId = (rng: Rng) => rng.uuid()
export const webhookConfigId = (rng: Rng) => rng.uuid()
export const walletId = (rng: Rng) => rng.uuid()
export const accountId = (rng: Rng) => rng.uuid()
export const creditCardToken = (rng: Rng) => rng.uuid()
export const checkoutId = (rng: Rng) => rng.uuid()
export const creditBureauReportId = (rng: Rng) => rng.uuid()
export const paymentLinkImageId = (rng: Rng) => rng.uuid()
export const genericId = (rng: Rng) => rng.uuid()

// ── digits only, no prefix ───────────────────────────────────
/** `725104409743` — the payment link has no prefix and is not a UUID. */
export const paymentLinkId = (rng: Rng) => rng.digits(12)

/** The sandbox API key. The production one uses `$aact_prod_`. */
export const apiKey = (rng: Rng) =>
  `$aact_hmlg_${rng.alphanumeric(24)}::${rng.uuid()}::$${rng.alphanumeric(40)}`

/** The invoice number: 8 digits with leading zeros. */
export const invoiceNumber = (rng: Rng) => rng.digits(8)

/** The bank slip's `nossoNumero`. */
export const nossoNumero = (rng: Rng) => rng.digits(11)
