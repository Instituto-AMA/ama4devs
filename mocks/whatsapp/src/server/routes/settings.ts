/**
 * The settings of the mock: what Meta has no call for.
 *
 * Every conversation, template and webhook call is the Cloud API (`/v23.0`).
 * What is left is how this mock behaves and what it shows: how the ticks
 * advance, how long the application takes to hear an event, where the events
 * go, the log of webhook calls, and wiping the conversations.
 */
import { Hono } from 'hono'
import { getAllWebhookMappings, getWebhookUrl } from '../config.ts'
import { getWebhookSecret } from '../configuration.ts'
import { invalidParameter } from '../graph-error.ts'
import { toPanelMessage } from '../panel-message.ts'
import { mediaStore } from '../store/media-store.ts'
import { MAX_RESPONSE_DELAY_MS, mockStore } from '../store/mock-store.ts'
import { serveMediaForPanel } from './media.ts'

const settingsRouter = new Hono()

async function readJson(
	request: Request
): Promise<Record<string, unknown> | null> {
	try {
		const body = await request.json()
		return body && typeof body === 'object'
			? (body as Record<string, unknown>)
			: null
	} catch {
		return null
	}
}

// The delivery mode: `auto` walks sent, delivered, read; `manual` stops at sent.
settingsRouter.get('/delivery-mode', (c) =>
	c.json({ mode: mockStore.getDeliveryMode() })
)

settingsRouter.put('/delivery-mode', async (c) => {
	const body = await readJson(c.req.raw)
	if (body?.mode !== 'auto' && body?.mode !== 'manual') {
		return invalidParameter(c, "mode must be 'auto' or 'manual'.")
	}
	mockStore.setDeliveryMode(body.mode)
	return c.json({ mode: body.mode })
})

// How long the mock waits before it delivers an event to the webhook.
settingsRouter.get('/webhook-delay', (c) =>
	c.json({ delayMs: mockStore.getResponseDelayMs() })
)

settingsRouter.put('/webhook-delay', async (c) => {
	const delayMs = (await readJson(c.req.raw))?.delayMs
	if (
		typeof delayMs !== 'number' ||
		!Number.isInteger(delayMs) ||
		delayMs < 0 ||
		delayMs > MAX_RESPONSE_DELAY_MS
	) {
		return invalidParameter(
			c,
			`delayMs must be an integer between 0 and ${MAX_RESPONSE_DELAY_MS}.`
		)
	}
	mockStore.setResponseDelayMs(delayMs)
	return c.json({ delayMs })
})

// Where the events go: the app callback and each number's override. Setting
// one is the Cloud API call `POST /{version}/{phone-number-id}` (nodes.ts).
settingsRouter.get('/webhooks', (c) => {
	const fallbackUrl = getWebhookUrl()
	const mappings = getAllWebhookMappings()
	return c.json({
		fallbackUrl,
		mappings,
		configured: !!fallbackUrl || mappings.length > 0,
		secretSet: !!getWebhookSecret(),
	})
})

// Every call the mock made to a webhook, newest first.
settingsRouter.get('/events', (c) =>
	c.json({ events: mockStore.getRecentWebhookEvents() })
)

settingsRouter.delete('/events', (c) => {
	mockStore.clearWebhookEvents()
	return c.json({ success: true })
})

// Every conversation of every number, both sides, oldest first. One number's
// conversations are the Cloud API's `GET /{version}/{phone-number-id}/messages`.
settingsRouter.get('/conversations', (c) =>
	c.json({ messages: mockStore.getAllMessages().map(toPanelMessage) })
)

// Start from zero: every conversation, both sides, and the event log.
// The bytes of an uploaded media, for the panel to show inside a bubble.
settingsRouter.get('/media/:id', (c) => serveMediaForPanel(c, mediaStore))

settingsRouter.delete('/conversations', (c) => {
	mockStore.clearMessages()
	mockStore.clearWebhookEvents()
	return c.json({ success: true })
})

export { settingsRouter }
