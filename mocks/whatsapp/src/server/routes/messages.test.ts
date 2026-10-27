import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest'
import { createApp } from '../server.ts'
import { mockStore, type StoredMessage } from '../store/mock-store.ts'
import { TemplateStore } from '../store/template-store.ts'
import type {
	WhatsAppErrorResponse,
	WhatsAppSendMessageRequest,
	WhatsAppSendMessageResponse,
} from '../types/api-types.ts'

describe('Messages API Integration Tests', () => {
	let server: ReturnType<typeof serve>
	let mockWebhookServer: ReturnType<typeof serve>
	let templateStore: TemplateStore
	const baseUrl = 'http://localhost:3014'
	const mockWebhookUrl = 'http://localhost:3015/webhook'
	const testPhoneId = '12345678901'
	// Resolved from this file so the suite does not depend on the current
	// working directory.
	const templatesDir = join(
		dirname(fileURLToPath(import.meta.url)),
		'../../../templates'
	)

	// Store received webhook payloads for verification
	const receivedWebhooks: unknown[] = []

	beforeAll(async () => {
		// Set environment variable for webhook URL
		process.env.WEBHOOK_URL = mockWebhookUrl

		// Create and initialize template store for testing
		templateStore = new TemplateStore(templatesDir)
		await templateStore.initialize()

		// The mock as it runs: the Cloud API engine in front of the messages.
		const { app } = createApp(templateStore)

		server = serve({
			fetch: app.fetch,
			port: 3014,
		})

		// Set up mock webhook endpoint to receive webhooks
		const mockApp = new Hono()

		mockApp.post('/webhook', async (c) => {
			const payload = await c.req.json()
			receivedWebhooks.push(payload)
			console.log('📥 Mock webhook received:', JSON.stringify(payload, null, 2))
			return c.json({ success: true })
		})

		mockWebhookServer = serve({
			fetch: mockApp.fetch,
			port: 3015,
		})

		// Initialize template store and wait for servers to start
		await templateStore.initialize()
		await new Promise((resolve) => setTimeout(resolve, 500))
	})

	afterAll(async () => {
		server?.close()
		mockWebhookServer?.close()
		await templateStore?.cleanup()
	})

	beforeEach(() => {
		// Clear received webhooks and reset mocks before each test
		receivedWebhooks.length = 0
		vi.clearAllMocks()
	})

	describe('POST /v23.0/{phone-number-id}/messages - Text Messages', () => {
		test('should send text message and trigger webhooks', async () => {
			const textMessage: WhatsAppSendMessageRequest = {
				messaging_product: 'whatsapp',
				to: '1234567890',
				type: 'text',
				text: {
					body: 'Hello, this is a test message!',
				},
			}

			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: JSON.stringify(textMessage),
			})

			expect(response.status).toBe(200)

			const data = (await response.json()) as WhatsAppSendMessageResponse
			expect(data.messaging_product).toBe('whatsapp')
			expect(data.contacts).toBeDefined()
			expect(data.messages).toBeDefined()

			if (data.contacts) {
				expect(data.contacts[0]?.wa_id).toBe(textMessage.to)
			}

			if (data.messages) {
				expect(data.messages[0]?.id).toBeDefined()
			}

			// Wait for webhooks to be delivered
			await new Promise((resolve) => setTimeout(resolve, 2000))

			// Should receive at least one webhook
			expect(receivedWebhooks.length).toBeGreaterThanOrEqual(1)
		})

		test('should validate text message request', async () => {
			const invalidMessage = {
				messaging_product: 'whatsapp',
				to: '1234567890',
				type: 'text',
				// Missing text.body
			}

			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: JSON.stringify(invalidMessage),
			})

			// The spec of the version refuses it, as Meta does: (#100) Invalid parameter.
			expect(response.status).toBe(400)

			const data = (await response.json()) as WhatsAppErrorResponse
			expect(data.error.type).toBe('OAuthException')
			expect(data.error.code).toBe(100)
		})
	})

	describe('POST /v23.0/{phone-number-id}/messages - Template Messages', () => {
		test('should send template message and trigger template-specific webhooks', async () => {
			const templateMessage: WhatsAppSendMessageRequest = {
				messaging_product: 'whatsapp',
				to: '1234567890',
				type: 'template',
				template: {
					name: 'welcome_message',
					language: { code: 'en' },
					// Header and body each ask for their own {{1}}, as Meta reads them.
					components: [
						{ type: 'header', parameters: [{ type: 'text', text: 'Ama' }] },
						{
							type: 'body',
							parameters: [
								{
									type: 'text',
									// The body asks for {{1}}: the parameter without a name fills it.
									text: 'John Doe',
								},
							],
						},
					],
				},
			}

			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: JSON.stringify(templateMessage),
			})

			expect(response.status).toBe(200)

			const data = (await response.json()) as WhatsAppSendMessageResponse
			expect(data.messaging_product).toBe('whatsapp')
			expect(data.contacts).toBeDefined()
			expect(data.messages).toBeDefined()

			// Wait for template approval/rejection and delivery webhooks
			await new Promise((resolve) => setTimeout(resolve, 2000))

			// Should receive template-related webhooks
			expect(receivedWebhooks.length).toBeGreaterThanOrEqual(1)
		})

		test('should return error for non-existent template', async () => {
			const invalidTemplateMessage: WhatsAppSendMessageRequest = {
				messaging_product: 'whatsapp',
				to: '1234567890',
				type: 'template',
				template: {
					name: 'non_existent_template',
					language: { code: 'en' },
					components: [
						{
							type: 'body',
							parameters: [
								{
									type: 'text',
									parameter_name: 'name',
									text: 'John Doe',
								},
							],
						},
					],
				},
			}

			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: JSON.stringify(invalidTemplateMessage),
			})

			expect(response.status).toBe(400)

			const data = (await response.json()) as WhatsAppErrorResponse
			expect(data.error.type).toBe('OAuthException')
			// Meta: "Template name does not exist in the translation".
			expect(data.error.code).toBe(132001)
			expect(data.error.message).toContain('not found')
		})

		test('should refuse a template whose variables did not arrive and say which', async () => {
			const templateMessage: WhatsAppSendMessageRequest = {
				messaging_product: 'whatsapp',
				to: '1234567890',
				type: 'template',
				template: {
					name: 'welcome_message',
					language: { code: 'en' },
					components: [
						{
							type: 'body',
							parameters: [
								{
									type: 'text',
									// The body of the template asks for {{1}}, not for "name".
									parameter_name: 'name',
									text: 'John Doe',
								},
							],
						},
					],
				},
			}

			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: JSON.stringify(templateMessage),
			})

			expect(response.status).toBe(400)

			const data = (await response.json()) as WhatsAppErrorResponse & {
				error: { error_data: { details: string; missing_parameters: string[] } }
			}
			expect(data.error.type).toBe('OAuthException')
			// Meta: "Number of parameters does not match the expected number".
			expect(data.error.code).toBe(132000)
			expect(data.error.message).toContain('missing 1 parameter')
			expect(data.error.error_data.details).toBe('MISSING_PARAMETERS')
			expect(data.error.error_data.missing_parameters).toEqual(['1'])
		})
	})

	describe('Message Storage Integration', () => {
		test('should store template messages in memory store', async () => {
			const templateMessage: WhatsAppSendMessageRequest = {
				messaging_product: 'whatsapp',
				to: '1234567890',
				type: 'template',
				template: {
					name: 'welcome_message',
					language: { code: 'en' },
					components: [
						{ type: 'header', parameters: [{ type: 'text', text: 'Ama' }] },
						{
							type: 'body',
							parameters: [
								{
									type: 'text',
									text: 'Test User',
								},
							],
						},
					],
				},
			}

			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: JSON.stringify(templateMessage),
			})

			expect(response.status).toBe(200)

			const data = (await response.json()) as WhatsAppSendMessageResponse
			const messageId = data.messages?.[0]?.id

			expect(messageId).toBeDefined()

			// Check if message is stored in memory store
			const storedMessages = mockStore.getConversation(testPhoneId)
			const storedMessage = storedMessages.find(
				(msg: StoredMessage) => msg.id === messageId
			)

			expect(storedMessage).toBeDefined()
			expect(storedMessage?.type).toBe('template')
			expect(storedMessage?.content.template?.name).toBe('welcome_message')
		})
	})

	describe('Error Handling', () => {
		test('should handle malformed JSON', async () => {
			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: 'invalid json',
			})

			expect(response.status).toBe(400)
		})

		test('should handle webhook delivery failures gracefully', async () => {
			// Configure invalid webhook URL temporarily
			const originalUrl = process.env.WEBHOOK_URL
			process.env.WEBHOOK_URL = 'http://localhost:9999/invalid'

			const textMessage: WhatsAppSendMessageRequest = {
				messaging_product: 'whatsapp',
				to: '1234567890',
				type: 'text',
				text: {
					body: 'Test message with failing webhook',
				},
			}

			// API should still work even if webhook fails
			const response = await fetch(`${baseUrl}/v23.0/${testPhoneId}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test',
				},
				body: JSON.stringify(textMessage),
			})

			expect(response.status).toBe(200)

			// Restore original webhook URL
			process.env.WEBHOOK_URL = originalUrl
		})
	})

	describe('Graph API version routing', () => {
		test('answers the versions it has a specification for, and refuses the others', async () => {
			const { app: versionedApp } = createApp(templateStore)
			const auth = { headers: { Authorization: 'Bearer test' } }

			const v23 = await versionedApp.request(
				`/v23.0/${testPhoneId}/messages`,
				auth
			)
			expect(v23.status).toBe(200)

			for (const version of ['v22.0', 'v99.0']) {
				const response = await versionedApp.request(
					`/${version}/${testPhoneId}/messages`,
					auth
				)
				expect(response.status).toBe(400)
				expect(
					((await response.json()) as { error: { code: number } }).error.code
				).toBe(2500)
			}

			const latestResponse = await versionedApp.request(
				`/latest/${testPhoneId}/messages`
			)
			expect(latestResponse.status).toBe(404)
		})

		test('wants an access token, like Meta', async () => {
			const { app: versionedApp } = createApp(templateStore)
			const none = await versionedApp.request(`/v23.0/${testPhoneId}/messages`)
			expect(none.status).toBe(400)
			const bad = await versionedApp.request(`/v23.0/${testPhoneId}/messages`, {
				headers: { Authorization: 'Basic x' },
			})
			expect(bad.status).toBe(401)
			expect(
				((await bad.json()) as { error: { code: number } }).error.code
			).toBe(190)
		})
	})
})
