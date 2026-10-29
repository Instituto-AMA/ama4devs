/**
 * The contracts of the SMS mock: the message model, the settings, the events
 * the store and the WebSocket carry, and the shape the route modules share.
 * The plan (plans/sms/README.md) explains each rule.
 */
import type { Config } from './config.ts'

/** API view of a message: app → handset (`outbound`) or handset → app (`inbound`). */
export type Direction = 'outbound' | 'inbound'

/** Where a message is in its life; inbound messages are always `received`. */
export type Status = 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'received'

/** The API the message came through; `mock` is the panel or the control routes. */
export type Api = 'native' | 'twilio' | 'simple' | 'mock'

/** One SMS, as the store keeps it and the native API returns it. */
export interface Message {
  /** `SM` followed by 32 lowercase hex digits. */
  id: string
  direction: Direction
  /** E.164 or an alphanumeric sender id. */
  from: string
  /** E.164; for an inbound message, the number the handset wrote to. */
  to: string
  body: string
  status: Status
  api: Api
  encoding: 'GSM-7' | 'UCS-2'
  segments: number
  /** OTP-looking codes found in the body. */
  codes: string[]
  errorCode: number | null
  errorMessage: string | null
  /** Per-message status callback. */
  callbackUrl: string | null
  createdAt: string
  updatedAt: string
  sentAt: string | null
  deliveredAt: string | null
  history: { status: Status; at: string }[]
}

/** The behavior the panel and `/_mock/sms/settings` change at runtime. */
export interface Settings {
  /** Time from `queued` to `delivered`; 0 progresses synchronously. */
  deliveryDelayMs: number
  /** False keeps messages in `queued` until a manual status. */
  autoDeliver: boolean
  /** Where status and inbound events are posted; empty for none. */
  webhookUrl: string
  /** Signs the webhook body (HMAC-SHA256); empty for unsigned. */
  webhookSecret: string
  /** Sender used when a request names none. */
  defaultFrom: string
}

/** One attempt to post a webhook, kept for the panel and the tests. */
export interface Delivery {
  id: string
  messageId: string
  event: 'status' | 'inbound'
  url: string
  ok: boolean
  statusCode: number | null
  error: string | null
  requestBody: string
  contentType: string
  signed: boolean
  at: string
}

/** What the message store announces. */
export type StoreEvent =
  | { type: 'message.created'; message: Message }
  | { type: 'message.updated'; message: Message }
  | { type: 'message.deleted'; id: string }
  | { type: 'reset' }

/** A WebSocket frame: the store events plus the ones the server adds. */
export type LiveEvent =
  | StoreEvent
  | { type: 'snapshot'; messages: Message[]; settings: Settings; deliveries: Delivery[]; version: string }
  | { type: 'settings.updated'; settings: Settings }
  | { type: 'delivery'; delivery: Delivery }
  | { type: 'deliveries.cleared' }

/** The shared pieces a route module receives. */
export interface Ctx {
  config: Config
  store: import('./store.ts').MessageStore
  settings: import('./store.ts').SettingsStore
  webhooks: import('./webhooks.ts').Webhooks
  lifecycle: import('./lifecycle.ts').Lifecycle
  now: () => Date
  newId: () => string
}

/** A route module's handler: null means the request is not its own. */
export type Route = (request: Request, url: URL) => Promise<Response | null> | Response | null
