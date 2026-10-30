/**
 * Map of handlers: operationId → function.
 *
 * Every operationId of the spec that is NOT here is assembled automatically as
 * `notImplemented` by the register driven by the manifest. Therefore:
 *
 *   - the route ALWAYS exists (auth, validation and error format included);
 *   - the coverage is computed from here, never maintained by hand;
 *   - a new track integrates by adding one line, without touching the routing.
 *
 * Each track adds its spread below. Since each one lives in its own folder, two
 * agents working in parallel do not conflict.
 */
import type { HandlerMap } from '../http/register.ts'
import { accountDocumentHandlers } from './account-documents/handlers.ts'
import { accountInfoHandlers } from './account-info/handlers.ts'
import { anticipationHandlers } from './anticipations/handlers.ts'
import { chargebackHandlers } from './chargebacks/handlers.ts'
import { checkoutHandlers } from './checkout/handlers.ts'
import { creditBureauHandlers } from './credit-bureau/handlers.ts'
import { creditCardHandlers } from './credit-cards/handlers.ts'
import { customerHandlers } from './customers/handlers.ts'
import { financeHandlers } from './finance/handlers.ts'
import { installmentHandlers } from './installments/handlers.ts'
import { invoiceHandlers } from './invoices/handlers.ts'
import { notificationHandlers } from './notifications/handlers.ts'
import { paymentLinkHandlers } from './payment-links/handlers.ts'
import { paymentHandlers, sandboxHandlers } from './payments/handlers.ts'
import { splitHandlers } from './splits/handlers.ts'
import { subaccountHandlers } from './subaccounts/handlers.ts'
import { subscriptionHandlers } from './subscriptions/handlers.ts'
import { transferHandlers } from './transfers/handlers.ts'
import { webhookHandlers } from './webhooks/handlers.ts'

export const HANDLERS: HandlerMap = {
  // Track A — customers, payments, state machine, sandbox actions
  ...customerHandlers,
  ...paymentHandlers,
  ...sandboxHandlers,

  // Track B — webhooks
  ...webhookHandlers,

  // Track G1 — account, payment links, notifications, checkout, Serasa
  ...accountInfoHandlers,
  // KYC/onboarding of the account + the sandbox action that approves it
  ...accountDocumentHandlers,
  ...paymentLinkHandlers,
  ...notificationHandlers,
  ...checkoutHandlers,
  ...creditBureauHandlers,

  // Track F — split multiconta e subcontas
  ...splitHandlers,
  ...subaccountHandlers,

  // Track D — statement, balance, transfers, anticipations
  ...financeHandlers,
  ...transferHandlers,
  ...anticipationHandlers,

  // Track H — card: tokenization, pre-authorization/capture, chargeback
  ...creditCardHandlers,
  ...chargebackHandlers,

  // Track E — parcelamentos e assinaturas
  ...installmentHandlers,
  ...subscriptionHandlers,

  // Fiscal notes (NFS-e) and fiscal information
  ...invoiceHandlers,
}
