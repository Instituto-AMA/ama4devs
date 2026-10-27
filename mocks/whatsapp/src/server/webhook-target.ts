/**
 * Webhook target helpers.
 *
 * When the mock runs as a compose service, `localhost` points at the container
 * itself instead of the developer app running on the host. The
 * `WEBHOOK_LOCALHOST_REWRITE` environment variable names the host that must
 * receive those webhooks (for example `host.docker.internal`).
 */

import { getWebhookSecret } from './configuration.ts'
import {
	computeHmacSignatureHeader,
	SIGNATURE_HEADER,
	serializeJsonWithEscapedUnicode,
} from './middleware/hmac-signature.ts'
import { mockStore, type WebhookEvent } from './store/mock-store.ts'
import type { WebhookPayload } from './types/api-types.ts'
import { broadcast } from './websocket.ts'

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Replace the hostname of loopback webhook URLs with the configured host.
 *
 * The URL is returned unchanged when no rewrite host is configured, when the
 * URL cannot be parsed or when it does not point to a loopback address. Only
 * the hostname is replaced: protocol, port and path are preserved.
 *
 * @param url - Webhook URL to deliver to
 * @returns The URL to use for the webhook delivery
 */
export function rewriteLoopback(url: string): string {
	const rewriteHost = process.env.WEBHOOK_LOCALHOST_REWRITE?.trim()
	if (!rewriteHost) {
		return url
	}

	let target: URL
	try {
		target = new URL(url)
	} catch {
		return url
	}

	if (!LOOPBACK_HOSTNAMES.has(target.hostname)) {
		return url
	}

	try {
		target.hostname = rewriteHost
	} catch {
		return url
	}

	return target.toString()
}

/**
 * URL form that is safe to log: origin and path only, since the query string
 * can carry a token.
 */
export function redactUrl(url: string): string {
	try {
		const parsed = new URL(url)
		return `${parsed.origin}${parsed.pathname}`
	} catch {
		return '[invalid url]'
	}
}

/** Classify a payload for the event log. */
function webhookKind(payload: WebhookPayload): WebhookEvent['kind'] {
	const change = payload.entry[0]?.changes[0]
	if (change?.field === 'message_template_status_update') {
		return 'template_status'
	}
	if ((change?.field as string) === 'calls') return 'call'
	const value = change?.value
	if (value && 'messages' in value && value.messages) return 'message'
	return 'status'
}

/** Record a delivery attempt in the store and tell the panel. */
function logWebhookAttempt(
	url: string,
	payload: WebhookPayload,
	outcome: Pick<WebhookEvent, 'status' | 'httpStatus' | 'error'>
): void {
	const event = mockStore.storeWebhookEvent({
		timestamp: new Date(),
		url: redactUrl(url),
		kind: webhookKind(payload),
		payload,
		...outcome,
	})
	broadcast({ type: 'WEBHOOK_EVENT', payload: event })
}

/** Wait for the configured response delay. */
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Deliver a webhook payload, signing it when a secret is configured. */
export async function sendWebhook(
	url: string,
	payload: WebhookPayload
): Promise<void> {
	// Inside a container, localhost points at the container itself: the
	// rewrite points the delivery to the app running on the host.
	const targetUrl = rewriteLoopback(url)
	const logTarget = redactUrl(targetUrl)
	let httpStatus: number | null = null

	try {
		const body = serializeJsonWithEscapedUnicode(payload)
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'User-Agent': 'WhatsApp-Mock-Server/1.0',
		}

		// Inject HMAC-SHA256 signature when a secret is configured, mirroring
		// what the real WhatsApp Cloud API does on outgoing webhook calls.
		const webhookSecret = getWebhookSecret()
		if (webhookSecret) {
			headers[SIGNATURE_HEADER] = computeHmacSignatureHeader(
				webhookSecret,
				body
			)
		}

		// The application behind the webhook may need a moment to answer. The
		// delay is what the panel calls the response timer.
		const delayMs = mockStore.getResponseDelayMs()
		if (delayMs > 0) {
			await wait(delayMs)
		}

		const response = await fetch(targetUrl, {
			method: 'POST',
			headers,
			body,
		})
		httpStatus = response.status

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		console.log(`✅ Webhook delivered successfully to ${logTarget}`)
		logWebhookAttempt(url, payload, {
			status: 'delivered',
			httpStatus,
			error: null,
		})
	} catch (error) {
		console.error(`❌ Failed to deliver webhook to ${logTarget}:`, error)
		logWebhookAttempt(url, payload, {
			status: 'failed',
			httpStatus,
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
