/**
 * The doors of the panel — and the distinction between them is the point of
 * the project.
 *
 * `v3()` is the REAL Asaas API, called with the key of an account. Every button
 * that represents something the real Asaas does goes through here: confirming a
 * payment in the sandbox, reactivating a webhook, creating a subaccount. The
 * button exercises the SAME path the user's code will exercise.
 *
 * `admin()` is the introspection of the simulator — time travel, the queue of
 * deliveries, the keys of every account. None of it exists in Asaas, and that is
 * why it lives outside /v3 and shows up on the screen under the "Simulador"
 * brand.
 *
 * `mock()` is the simulator's outcome control (/_mock/*), not Asaas, like `admin()`.
 * It triggers payment lifecycle transitions (receive, overdue, refund) directly
 * without account API keys, driving ledger entries and webhooks.
 *
 * When the two get confused, the panel becomes a useful lie: you press a button
 * that exists only here and walk away thinking your integration works.
 */

export interface AsaasError {
  code: string
  description: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: AsaasError[] = [],
  ) {
    super(message)
  }
}

async function parse(r: Response): Promise<any> {
  if (r.status === 204) return null
  const body = await r.json().catch(() => null)
  if (!r.ok) {
    const errors: AsaasError[] = body?.errors ?? []
    throw new ApiError(errors[0]?.description ?? `HTTP ${r.status}`, r.status, errors)
  }
  return body
}

/** Introspection of the simulator. It does not exist in Asaas. */
export async function admin(path: string, init?: RequestInit): Promise<any> {
  return parse(
    await fetch(`/_admin${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    }),
  )
}

/** Simulator outcome control (/_mock/*), not Asaas, like admin(). */
export async function mock(path: string, init?: RequestInit): Promise<any> {
  return parse(
    await fetch(`/_mock${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    }),
  )
}

/** The v3 API of Asaas, AS the owner of the key. */
export async function v3(path: string, apiKey: string, init?: RequestInit): Promise<any> {
  return parse(
    await fetch(`/v3${path}`, {
      headers: { access_token: apiKey, 'content-type': 'application/json' },
      ...init,
    }),
  )
}

// ── tipos que as telas consomem ─────────────────────────────────────────────

export interface Account {
  id: string
  name: string
  email: string
  cpfCnpj: string
  walletId: string
  parentAccountId: string | null
  status: string
  balance: number
  /** A key that authenticates now, or null when every key is disabled, expired or gone. */
  apiKey: string | null
  /** An environment profile: deleted, it returns on the next boot. */
  seeded: boolean
  dateCreated: string
}

/** An API key as the "Chaves de API" tab lists it (`/_admin/accounts/:id/keys`). */
export interface ApiKey {
  id: string
  name: string
  enabled: boolean
  expired: boolean
  usable: boolean
  expirationDate: string | null
  dateCreated: string
  apiKey: string
}

/** A webhook as `GET /v3/webhooks` returns it. */
export interface Webhook {
  id: string
  name: string
  url: string
  email: string
  enabled: boolean
  interrupted: boolean
  apiVersion: number
  hasAuthToken: boolean
  sendType: 'SEQUENTIALLY' | 'NON_SEQUENTIALLY'
  events: string[]
}

/** One delivery of one event to one webhook (`/_admin/webhooks/deliveries`). */
/** A request of the "Logs de Requisições": the list row; the detail adds the bodies. */
export interface RequestLog {
  id: number
  method: string
  path: string
  query: string
  status: number
  apiKeyName: string | null
  dateCreated: string
  requestBody?: unknown
  responseBody?: unknown
}

/** A webhook delivery, or an event no webhook took (NO_WEBHOOK: no webhook, url or attempt). */
export interface Delivery {
  id: string
  webhookId: string | null
  webhookName: string | null
  url: string | null
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'INTERRUPTED' | 'EXPIRED' | 'NO_WEBHOOK'
  attempt: number
  nextAttemptAtMs: number | null
  lastStatusCode: number | null
  lastError: string | null
  lastAttemptAt: string | null
  dateCreated: string
  event: string
  eventId: string
  payload: Record<string, unknown>
}

export interface Clock {
  mode: 'REAL' | 'VIRTUAL_FLOWING' | 'VIRTUAL_FROZEN'
  now: string
  today: string
  epochMs: number
  driftDays: number
}

export type SummaryGroup = 'RECEIVED' | 'CONFIRMED' | 'AWAITING' | 'OVERDUE'

export interface GroupSummary {
  group: SummaryGroup
  value: number
  netValue: number
  count: number
  customers: number
  byBillingType: Array<{ billingType: string; value: number; count: number }>
}

export interface QueueHealth {
  webhookId: string
  accountId: string
  accountName: string
  name: string
  url: string
  sendType: 'SEQUENTIALLY' | 'NON_SEQUENTIALLY'
  enabled: boolean
  interrupted: boolean
  pending: number
  blocked: null | {
    reason: 'INTERRUPTED' | 'DISABLED' | 'HEAD_FAILING' | 'HEAD_IN_BACKOFF'
    event: string
    attempt: number
    lastStatusCode: number | null
    lastError: string | null
    nextAttemptAtMs: number | null
    behind: number
  }
}

export interface TestCard {
  number: string
  outcome: string
  label: string
  real: boolean
  brand: string
  error: AsaasError | null
  /** Added in the panel: it can be removed. */
  custom?: boolean
}

/** One payer notification (`/_admin/notifications`): an e-mail, a WhatsApp template or an SMS. */
export interface PayerNotification {
  id: string
  event: string
  channel: 'EMAIL' | 'WHATSAPP' | 'SMS'
  recipient: string
  subject: string | null
  body: string
  template: { name: string; language: string; params: string[] } | null
  forced: boolean
  status: 'PENDING' | 'SENT' | 'FAILED'
  attempt: number
  lastError: string | null
  dateCreated: string
  sentAt: string | null
}

export interface NotificationList {
  channels: { email: boolean; whatsapp: boolean; sms: boolean }
  events: Array<{ event: string; label: string }>
  data: PayerNotification[]
}

/** `GET /_admin/test-cards`. */
export interface TestCardTable {
  acceptAny: boolean
  cards: TestCard[]
  outcomes: Array<{ outcome: string; label: string }>
  brands: string[]
}

export interface Payment {
  id: string
  customer: string
  billingType: string
  status: string
  value: number
  netValue: number
  dueDate: string
  paymentDate: string | null
  creditDate: string | null
  description: string | null
  externalReference: string | null
  invoiceUrl: string
  invoiceNumber: string | null
  bankSlipUrl: string | null
  deleted: boolean
  /** Present only on a charge of an installment plan or a subscription (Asaas omits the key otherwise). */
  installment?: string
  installmentNumber?: number | null
  subscription?: string
  clientPaymentDate?: string | null
}

/** A customer as `GET /v3/customers` returns it. */
export interface Customer {
  id: string
  name: string
  email: string | null
  cpfCnpj: string
  phone: string | null
  mobilePhone: string | null
  postalCode: string | null
  address: string | null
  addressNumber: string | null
  province: string | null
  externalReference: string | null
  observations: string | null
  dateCreated: string
  deleted: boolean
}

/** A subscription as `GET /v3/subscriptions` returns it. */
export interface Subscription {
  id: string
  customer: string
  value: number
  nextDueDate: string
  cycle: string
  description: string | null
  billingType: string
  status: string
  endDate: string | null
  maxPayments: number | null
  deleted: boolean
  dateCreated: string
}

/** An installment plan as `GET /v3/installments` returns it. */
export interface Installment {
  id: string
  customer: string
  value: number
  netValue: number
  installmentCount: number
  billingType: string
  description: string | null
  deleted: boolean
  dateCreated: string
}
