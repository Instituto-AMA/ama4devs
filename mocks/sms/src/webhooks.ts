import type { Delivery, Message } from './types.ts'
import type { SettingsStore } from './store.ts'

/**
 * The webhooks of the mock: it posts the status and inbound events to the
 * callback URL, signs the body and keeps the attempts in a log.
 */
export interface Webhooks {
  /** Posts the event; null when there is no URL to post it to. */
  notify(message: Message, event: 'status' | 'inbound'): Promise<Delivery | null>
  /** The attempts, newest first. */
  deliveries(): Delivery[]
  /** Empties the log. */
  clear(): void
  /** Watches the log; the function returned unsubscribes. */
  subscribe(fn: (delivery: Delivery) => void): () => void
}

/** The outside world the webhooks need: the request, the settings and the clock. */
export interface WebhooksDeps {
  fetch: typeof fetch
  settings: SettingsStore
  now: () => Date
  newId: () => string
  /** When set, a loopback host is rewritten to it (the container to the host). */
  localhostRewrite?: string
}

/** The account the Twilio-shaped body announces; a fake placeholder. */
const MOCK_ACCOUNT_SID = 'ACmock00000000000000000000000000'

/** The hosts that mean "this machine"; rewritten when the mock runs in a container. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** How many attempts the log keeps; the oldest are dropped beyond it. */
const MAX_DELIVERIES = 200

/** How long a webhook request may take before it is aborted. */
const REQUEST_TIMEOUT_MS = 5000

/**
 * The webhooks: the event goes out to the callback URL and the attempt goes
 * into the log. A failing request is recorded, never raised.
 * @param deps The outside world: the request, the settings, the clock and the ids.
 */
export function createWebhooks(deps: WebhooksDeps): Webhooks {
  const log: Delivery[] = []
  const subscribers = new Set<(delivery: Delivery) => void>()

  /**
   * Posts the event to the callback URL and records the attempt.
   * @param message The message the event belongs to.
   * @param event The kind of event: a status change or an inbound message.
   */
  async function notify(message: Message, event: 'status' | 'inbound'): Promise<Delivery | null> {
    const settings = deps.settings.get()
    const url = event === 'status' ? message.callbackUrl || settings.webhookUrl : settings.webhookUrl
    if (!url) return null

    const contentType = message.api === 'twilio' ? 'application/x-www-form-urlencoded' : 'application/json'
    const requestBody = message.api === 'twilio' ? twilioBody(message, event) : jsonBody(message, event)
    const attempt: Delivery = {
      id: deps.newId(),
      messageId: message.id,
      event,
      url,
      ok: false,
      statusCode: null,
      error: null,
      requestBody,
      contentType,
      signed: false,
      at: deps.now().toISOString(),
    }

    let target: URL
    try {
      target = new URL(url)
    } catch {
      return record({ ...attempt, error: 'invalid_url' })
    }
    if (deps.localhostRewrite && LOOPBACK_HOSTS.has(target.hostname)) {
      target.hostname = deps.localhostRewrite
    }

    const signature = settings.webhookSecret ? await sign(settings.webhookSecret, requestBody) : null
    const headers: Record<string, string> = {
      'content-type': contentType,
      'user-agent': 'sms-mock',
      'x-sms-event': event,
    }
    if (signature) headers['x-sms-signature'] = `sha256=${signature}`

    try {
      const response = await deps.fetch(target.toString(), {
        method: 'POST',
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      return record({
        ...attempt,
        ok: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        signed: signature !== null,
      })
    } catch (error) {
      return record({
        ...attempt,
        ok: false,
        statusCode: null,
        error: error instanceof Error ? error.message : String(error),
        signed: signature !== null,
      })
    }
  }

  /**
   * Puts the attempt at the head of the log and tells the watchers.
   * @param delivery The attempt to keep.
   */
  function record(delivery: Delivery): Delivery {
    log.unshift(delivery)
    if (log.length > MAX_DELIVERIES) log.length = MAX_DELIVERIES

    for (const subscriber of subscribers) {
      try {
        subscriber(delivery)
      } catch {
        // A watcher that breaks does not stop the delivery.
      }
    }
    return delivery
  }

  return {
    notify,
    deliveries: () => [...log],
    clear: () => {
      log.length = 0
    },
    subscribe: (fn) => {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },
  }
}

/**
 * The body of a message that did not come through Twilio: the event and the
 * whole message as JSON.
 * @param message The message the event belongs to.
 * @param event The kind of event.
 */
function jsonBody(message: Message, event: 'status' | 'inbound'): string {
  return JSON.stringify({ event: event === 'inbound' ? 'message.inbound' : 'message.status', message })
}

/**
 * The body of a message that came through Twilio: the form Twilio posts.
 * @param message The message the event belongs to.
 * @param event The kind of event; only an inbound event carries the body.
 */
function twilioBody(message: Message, event: 'status' | 'inbound'): string {
  const params = new URLSearchParams()
  params.set('MessageSid', message.id)
  params.set('SmsSid', message.id)
  params.set('AccountSid', MOCK_ACCOUNT_SID)
  params.set('MessageStatus', message.status)
  params.set('SmsStatus', message.status)
  params.set('From', message.from)
  params.set('To', message.to)
  params.set('NumSegments', String(message.segments))
  if (event === 'inbound') params.set('Body', message.body)
  if (message.errorCode !== null) params.set('ErrorCode', String(message.errorCode))
  if (message.errorMessage !== null) params.set('ErrorMessage', message.errorMessage)
  return params.toString()
}

/**
 * The HMAC-SHA256 of the body, hex encoded; null when the digest fails.
 * @param secret The shared secret of the webhook.
 * @param body The exact body that goes out.
 */
async function sign(secret: string, body: string): Promise<string | null> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
    return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
