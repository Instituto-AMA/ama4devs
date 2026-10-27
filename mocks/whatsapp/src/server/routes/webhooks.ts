import type { Context } from 'hono'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import {
	getAllWebhookMappings,
	getWebhookUrl,
	setWebhookUrl,
} from '../config.ts'
import { getWebhookSecret } from '../configuration.ts'
import { applyStatus, sendDeliveryStatusWebhook } from '../delivery-status.ts'
import { toPanelMessage } from '../panel-message.ts'
import { mockStore } from '../store/memory-store.ts'
import type {
	SimulateMessageParams,
	WebhookConfiguration,
	WebhookPayload,
	WhatsAppErrorResponse,
} from '../types/api-types.ts'
import { invalidJsonResponse, parseJsonBody } from '../utils/json-body.ts'
import { redactUrl, sendWebhook } from '../webhook-target.ts'
import { broadcast } from '../websocket.ts'

const webhooksRouter = new Hono()

// Configure webhook URL for a phone number
webhooksRouter.post(
	'/configure',
	parseJsonBody,
	validator('json', (value, c) => {
		const body = value as WebhookConfiguration

		if (!body.phoneNumberId) {
			return c.json(
				{
					error: {
						message: 'phoneNumberId is required',
						type: 'validation_error',
						code: 400,
					},
				} as WhatsAppErrorResponse,
				400
			)
		}

		if (!body.url) {
			return c.json(
				{
					error: {
						message: 'url is required',
						type: 'validation_error',
						code: 400,
					},
				} as WhatsAppErrorResponse,
				400
			)
		}

		try {
			new URL(body.url) // Validate URL format
		} catch {
			return c.json(
				{
					error: {
						message: 'Invalid URL format',
						type: 'validation_error',
						code: 400,
					},
				} as WhatsAppErrorResponse,
				400
			)
		}

		return body
	}),
	async (c) => {
		const config = c.req.valid('json') as WebhookConfiguration

		// Store webhook configuration
		mockStore.setWebhookConfig(config.phoneNumberId, config)
		// Deliveries read the URL from the webhook mappings: without this, a URL
		// configured here was stored and never used.
		setWebhookUrl(config.phoneNumberId, config.url)

		console.log(
			`🔗 Configured webhook for ${config.phoneNumberId}: ${redactUrl(config.url)}`
		)

		return c.json({
			success: true,
			message: `Webhook configured for phone number ${config.phoneNumberId}`,
			config,
		})
	}
)

// Get webhook configuration for a phone number
webhooksRouter.get('/configure/:phoneNumberId', (c) => {
	const phoneNumberId = c.req.param('phoneNumberId')
	const config = mockStore.getWebhookConfig(phoneNumberId)

	if (!config) {
		return c.json(
			{
				error: {
					message: 'Webhook configuration not found',
					type: 'not_found',
					code: 404,
				},
			} as WhatsAppErrorResponse,
			404
		)
	}

	return c.json(config)
})

// Get current webhook configuration
webhooksRouter.get('/config', (c) => {
	const fallbackUrl = getWebhookUrl()
	const mappings = getAllWebhookMappings()

	return c.json({
		fallbackUrl,
		mappings,
		configured: !!fallbackUrl || mappings.length > 0,
		secretSet: !!getWebhookSecret(),
		sources: {
			environment: !!fallbackUrl,
			cli_mappings: mappings.length > 0,
		},
	})
})

// Get all webhook configurations (legacy)
webhooksRouter.get('/configure', (c) => {
	const configs = mockStore.getAllWebhookConfigs()
	return c.json({ webhooks: configs })
})

// Simulate incoming message (triggers webhook)
webhooksRouter.post(
	'/simulate-message',
	parseJsonBody,
	validator('json', (value, c) => {
		const body = value as SimulateMessageParams

		if (!body.from) {
			return c.json(
				{
					error: {
						message: 'from is required',
						type: 'validation_error',
						code: 400,
					},
				} as WhatsAppErrorResponse,
				400
			)
		}

		if (!body.to) {
			return c.json(
				{
					error: {
						message: 'to (phone number ID) is required',
						type: 'validation_error',
						code: 400,
					},
				} as WhatsAppErrorResponse,
				400
			)
		}

		if (!body.message || !body.message.text || !body.message.text.body) {
			return c.json(
				{
					error: {
						message: 'message.text.body is required',
						type: 'validation_error',
						code: 400,
					},
				} as WhatsAppErrorResponse,
				400
			)
		}

		return body
	}),
	async (c) => {
		const params = c.req.valid('json') as SimulateMessageParams

		// Get webhook URL for the specific phone number (optional: the message is
		// stored and shown in the panel either way)
		const webhookUrl = getWebhookUrl(params.to)

		// Store the webhook message and tell the panel
		const storedMessage = mockStore.storeWebhookMessage(params)
		broadcast({ type: 'NEW_MESSAGE', payload: toPanelMessage(storedMessage) })

		// Create webhook payload
		const payload: WebhookPayload = {
			object: 'whatsapp_business_account',
			entry: [
				{
					id: params.to,
					changes: [
						{
							value: {
								messaging_product: 'whatsapp',
								metadata: {
									display_phone_number: params.to,
									phone_number_id: params.to,
								},
								contacts: [
									{
										profile: {
											name: params.name ?? `User ${params.from}`,
										},
										wa_id: params.from,
									},
								],
								messages: [
									{
										from: params.from,
										id: storedMessage.id,
										timestamp:
											params.message.timestamp ??
											Math.floor(
												storedMessage.timestamp.getTime() / 1000
											).toString(),
										type: 'text',
										text: {
											body: params.message.text.body,
										},
									},
								],
							},
							field: 'messages',
						},
					],
				},
			],
		}

		console.log(
			`Simulating incoming message from ${params.from} to ${params.to}`
		)

		if (!webhookUrl) {
			return c.json({
				success: true,
				messageId: storedMessage.id,
				delivered: false,
				reason: 'webhook_not_configured',
			})
		}

		console.log(`🔗 Sending webhook to: ${redactUrl(webhookUrl)}`)

		// Send webhook (fire and forget)
		sendWebhook(webhookUrl, payload).catch((error) => {
			console.error(`❌ Webhook delivery failed: ${error.message}`)
		})

		return c.json({
			success: true,
			messageId: storedMessage.id,
			delivered: true,
		})
	}
)

// List every message, both directions, oldest first (web panel)
webhooksRouter.get('/messages', (c) => {
	const messages = [
		...mockStore.getAllMessages(),
		...mockStore.getAllWebhookMessages(),
	]
		.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
		.map(toPanelMessage)
	return c.json({ messages })
})

const invalidValue = (c: Context, message: string) =>
	c.json(
		{
			error: { message, type: 'validation_error', code: 400 },
		} as WhatsAppErrorResponse,
		400
	)

// Delivery mode: `auto` walks sent/delivered/read, `manual` stops at sent
webhooksRouter.get('/delivery-mode', (c) =>
	c.json({ mode: mockStore.getDeliveryMode() })
)

webhooksRouter.post('/delivery-mode', async (c) => {
	let body: { mode?: unknown }
	try {
		body = await c.req.json()
	} catch {
		return invalidJsonResponse(c)
	}
	if (body?.mode !== 'auto' && body?.mode !== 'manual') {
		return invalidValue(c, "mode must be 'auto' or 'manual'")
	}
	mockStore.setDeliveryMode(body.mode)
	return c.json({ mode: body.mode })
})

// Move an outbound message to delivered, read or failed (manual delivery)
webhooksRouter.post('/messages/:id/status', async (c) => {
	const id = c.req.param('id')
	let body: { status?: unknown }
	try {
		body = await c.req.json()
	} catch {
		return invalidJsonResponse(c)
	}
	const status = body?.status
	if (status !== 'delivered' && status !== 'read' && status !== 'failed') {
		return invalidValue(c, "status must be 'delivered', 'read' or 'failed'")
	}

	const message = mockStore.getMessage(id)
	if (!message) {
		return c.json(
			{
				error: {
					message: 'Message not found',
					type: 'not_found',
					code: 404,
				},
			} as WhatsAppErrorResponse,
			404
		)
	}

	applyStatus(id, status)
	sendDeliveryStatusWebhook(
		id,
		message.phoneNumberId,
		message.to,
		status,
		undefined,
		status === 'failed'
			? [{ code: 131026, title: 'Message undeliverable' }]
			: undefined
	)

	return c.json({ success: true, id, status })
})

// Get mock server stats
webhooksRouter.get('/stats', (c) => {
	const stats = mockStore.getStats()
	return c.json(stats)
})

// Clear all mock data
webhooksRouter.delete('/clear', (c) => {
	mockStore.clear()
	return c.json({
		success: true,
		message: 'All mock data cleared',
	})
})

// Get conversation history
webhooksRouter.get('/conversation/:phoneNumberId/:otherNumber', (c) => {
	const phoneNumberId = c.req.param('phoneNumberId')
	const otherNumber = c.req.param('otherNumber')

	const conversation = mockStore.getConversation(phoneNumberId, otherNumber)

	return c.json({
		phoneNumberId,
		otherNumber,
		messages: conversation,
	})
})

// GET /webhook/events - Get webhook events
webhooksRouter.get('/events', (c) => {
	return c.json({ events: mockStore.getRecentWebhookEvents() })
})

// POST /webhook/trigger - Trigger a webhook
webhooksRouter.post('/trigger', async (c) => {
	let body: { phone?: string; message?: string }

	try {
		body = await c.req.json()
	} catch {
		return invalidJsonResponse(c)
	}

	const { phone, message } = body

	// Store webhook event
	const event = mockStore.storeWebhookEvent({
		timestamp: new Date(),
		payload: { phone, message },
		url: 'mock://trigger',
		kind: 'message',
		status: 'delivered',
		httpStatus: null,
		error: null,
	})

	console.log(`🔗 Triggered webhook for ${phone}: ${message}`)
	return c.json({ success: true, eventId: event.id })
})

// DELETE /webhook/events - Clear webhook events
webhooksRouter.delete('/events', (c) => {
	mockStore.clearWebhookEvents()
	return c.json({ success: true })
})

export { webhooksRouter }
