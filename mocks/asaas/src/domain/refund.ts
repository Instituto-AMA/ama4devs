/**
 * The refund lifecycle. PURE — no clock, no database, no HTTP.
 *
 * A refund is NOT a step of the charge's state machine: it is a REQUEST that
 * lives on its own row (`payment_refunds`), and it only becomes money when the
 * provider settles it. The real Asaas works exactly like this:
 *
 *   - the card and the Pix refund automatically: the provider accepts the
 *     request and the money comes back on its own;
 *   - the boleto refund is a REGISTRATION: the payer fills a form, sends the
 *     documents, and the provider decides later — or refuses.
 *
 * The status of the request is the Asaas vocabulary: `PENDING` (accepted, the
 * money did not move), `DONE` (the money went back) and `CANCELLED` (the
 * provider refused; nothing went back).
 *
 * What this module knows: which kind of refund a charge has, and which event
 * each step announces. How the money moves is the state machine's job
 * (`src/domain/payment-machine.ts`).
 */

/** The status of a refund row — the same vocabulary the Asaas documents use. */
export type RefundStatus = 'PENDING' | 'DONE' | 'CANCELLED'

/**
 * How the refund was asked for.
 *
 * - `AUTOMATIC`: the provider refunds on its own (card and Pix).
 * - `REGISTRATION`: the payer acts and the provider answers later (boleto).
 */
export type RefundKind = 'AUTOMATIC' | 'REGISTRATION'

/**
 * The boleto is the only method whose refund is a registration.
 *
 * TODO(rule): the Asaas documentation does not say whether the CARD also has a
 * registration flow. We treat the card and the Pix as automatic because that
 * is what the Asaas reference page of `POST /v3/payments/{id}/refund` describes.
 */
export function refundKindFor(billingType: string): RefundKind {
  return billingType === 'BOLETO' ? 'REGISTRATION' : 'AUTOMATIC'
}

/**
 * The event the REQUEST announces.
 *
 * The automatic one says that the money is on its way
 * (`PAYMENT_REFUND_IN_PROGRESS`); the registration is silent — the payer is the
 * one acting, and the provider has nothing to announce yet.
 */
export function requestEventFor(kind: RefundKind): 'PAYMENT_REFUND_IN_PROGRESS' | null {
  return kind === 'AUTOMATIC' ? 'PAYMENT_REFUND_IN_PROGRESS' : null
}

/**
 * The event the SETTLEMENT announces: the whole money went back, or only a
 * part of it.
 */
export function settlementEventFor(
  wholeRefund: boolean,
): 'PAYMENT_REFUNDED' | 'PAYMENT_PARTIALLY_REFUNDED' {
  return wholeRefund ? 'PAYMENT_REFUNDED' : 'PAYMENT_PARTIALLY_REFUNDED'
}
