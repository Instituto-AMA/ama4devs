import { serve } from '@hono/node-server'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest'
import { resetWebhookConfig } from '../config.ts'
import { toPanelMessage } from '../panel-message.ts'
import { createApp } from '../server.ts'
import { mockStore, type StoredMessage } from '../store/memory-store.ts'
import { TemplateStore } from '../store/template-store.ts'
import type { WebhookPayload } from '../types/api-types.ts'
import { sendWebhook } from '../webhook-target.ts'
import { addClient, removeClient } from '../websocket.ts'

const base = 'http://localhost:3010'
const businessId = '5511900000000'
const templatesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../templates'
)

type Frame = { type: string; payload: Record<string, unknown> }

describe('Panel API', () => {
	let app: ReturnType<typeof createApp>['app']
	const frames: Frame[] = []
	const fakeSocket = {
		readyState: 1,
		send: (data: string) => frames.push(JSON.parse(data)),
	}

	const post = (path: string, body: unknown) =>
		app.request(`${base}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})

	const sendText = async (to = '5511911111111') => {
		const res = await post(`/v22.0/${businessId}/messages`, {
			messaging_product: 'whatsapp',
			to,
			type: 'text',
			text: { body: 'hello' },
		})
		const data = (await res.json()) as { messages: Array<{ id: string }> }
		return data.messages[0].id
	}

	const listMessages = async () => {
		const res = await app.request(`${base}/mock/messages`)
		return ((await res.json()) as { messages: Array<Record<string, any>> })
			.messages
	}

	beforeAll(async () => {
		const templateStore = new TemplateStore(templatesDir)
		await templateStore.initialize()
		app = createApp(templateStore).app
		// biome-ignore lint/suspicious/noExplicitAny: minimal socket stand-in
		addClient(fakeSocket as any)
	})

	afterAll(() => {
		// biome-ignore lint/suspicious/noExplicitAny: minimal socket stand-in
		removeClient(fakeSocket as any)
	})

	beforeEach(() => {
		delete process.env.WEBHOOK_URL
		delete process.env.WEBHOOK_SECRET
		resetWebhookConfig()
		mockStore.clear()
		mockStore.setDeliveryMode('auto')
		frames.length = 0
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('toPanelMessage', () => {
		test('maps a template to header, body, footer and buttons', () => {
			const message: StoredMessage = {
				id: 'wamid.1',
				phoneNumberId: businessId,
				to: '+5511922222222',
				type: 'template',
				content: {
					template: { name: 'promo', language: { code: 'pt_BR' } },
					processedTemplate: {
						name: 'promo',
						components: [
							{ type: 'HEADER', format: 'TEXT', text: 'Hi Ana' },
							{ type: 'BODY', text: 'Body for Ana' },
							{ type: 'FOOTER', text: 'Bye' },
							{
								type: 'BUTTONS',
								buttons: [
									{ type: 'QUICK_REPLY', text: 'Yes' },
									{ type: 'QUICK_REPLY', text: 'No' },
								],
							},
						],
					},
				},
				timestamp: new Date('2026-01-02T03:04:05.000Z'),
				status: 'sent',
			}

			expect(toPanelMessage(message)).toEqual({
				id: 'wamid.1',
				direction: 'out',
				businessId,
				contact: '5511922222222',
				contactName: null,
				type: 'template',
				text: 'Body for Ana',
				template: {
					name: 'promo',
					language: 'pt_BR',
					header: 'Hi Ana',
					body: 'Body for Ana',
					footer: 'Bye',
					buttons: ['Yes', 'No'],
				},
				status: 'sent',
				timestamp: '2026-01-02T03:04:05.000Z',
			})
		})
	})

	describe('POST /mock/simulate-message', () => {
		test('works without a webhook URL: stores, broadcasts, delivered:false', async () => {
			const res = await post('/mock/simulate-message', {
				from: '+5511933333333',
				to: businessId,
				name: 'Maria',
				message: { type: 'text', text: { body: 'oi' } },
			})

			expect(res.status).toBe(200)
			const data = (await res.json()) as Record<string, unknown>
			expect(data).toMatchObject({
				success: true,
				delivered: false,
				reason: 'webhook_not_configured',
			})
			expect(String(data.messageId)).toMatch(/^wamid\./)

			const [message] = await listMessages()
			expect(message).toMatchObject({
				id: data.messageId,
				direction: 'in',
				businessId,
				contact: '5511933333333',
				contactName: 'Maria',
				type: 'text',
				text: 'oi',
				status: null,
			})
			expect(frames).toContainEqual({
				type: 'NEW_MESSAGE',
				payload: expect.objectContaining({ direction: 'in', text: 'oi' }),
			})
		})
	})

	describe('outbound messages', () => {
		test('broadcast NEW_MESSAGE as a PanelMessage and list a template rendered', async () => {
			const res = await post(`/v22.0/${businessId}/messages`, {
				messaging_product: 'whatsapp',
				to: '5511944444444',
				type: 'template',
				template: {
					name: 'order_confirmation',
					language: { code: 'en' },
					components: [
						{
							type: 'body',
							parameters: [
								{ type: 'text', parameter_name: '1', text: 'Ana' },
								{ type: 'text', parameter_name: '2', text: '77' },
								{ type: 'text', parameter_name: '3', text: '9.90' },
							],
						},
					],
				},
			})
			expect(res.status).toBe(200)

			expect(frames[0]).toMatchObject({
				type: 'NEW_MESSAGE',
				payload: { direction: 'out', type: 'template', status: 'sent' },
			})
			const [message] = await listMessages()
			expect(message.template).toMatchObject({
				name: 'order_confirmation',
				language: 'en',
				header: 'Order Confirmed! 🎉',
				footer: 'Thank you for shopping with us!',
				buttons: [],
			})
			expect(message.text).toContain('Hi Ana, your order #77')
		})
	})

	describe('delivery mode', () => {
		test('GET and POST /mock/delivery-mode, 400 on other values', async () => {
			expect(
				await (await app.request(`${base}/mock/delivery-mode`)).json()
			).toEqual({ mode: 'auto' })

			const res = await post('/mock/delivery-mode', { mode: 'manual' })
			expect(await res.json()).toEqual({ mode: 'manual' })
			expect(mockStore.getDeliveryMode()).toBe('manual')

			const bad = await post('/mock/delivery-mode', { mode: 'random' })
			expect(bad.status).toBe(400)
			expect(mockStore.getDeliveryMode()).toBe('manual')
		})

		test('auto walks sent, delivered, read and broadcasts each step', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout'] })
			const id = await sendText()

			vi.advanceTimersByTime(3000)

			expect(mockStore.getMessage(id)?.status).toBe('read')
			expect(
				frames.filter((f) => f.type === 'STATUS_UPDATE').map((f) => f.payload)
			).toEqual([
				{ id, status: 'sent' },
				{ id, status: 'delivered' },
				{ id, status: 'read' },
			])
		})

		test('manual leaves the message at sent', async () => {
			mockStore.setDeliveryMode('manual')
			vi.useFakeTimers({ toFake: ['setTimeout'] })
			const id = await sendText()

			vi.advanceTimersByTime(10000)

			expect(mockStore.getMessage(id)?.status).toBe('sent')
			expect(
				frames.filter((f) => f.type === 'STATUS_UPDATE').map((f) => f.payload)
			).toEqual([{ id, status: 'sent' }])
		})
	})

	describe('POST /mock/messages/:id/status', () => {
		test('answers 400 for an invalid status', async () => {
			const id = await sendText()
			const res = await post(`/mock/messages/${id}/status`, { status: 'sent' })
			expect(res.status).toBe(400)
		})

		test('answers 404 for an unknown id and for an inbound id', async () => {
			expect(
				(await post('/mock/messages/wamid.nope/status', { status: 'read' }))
					.status
			).toBe(404)

			const sim = await post('/mock/simulate-message', {
				from: '5511955555555',
				to: businessId,
				message: { type: 'text', text: { body: 'in' } },
			})
			const { messageId } = (await sim.json()) as { messageId: string }
			expect(
				(await post(`/mock/messages/${messageId}/status`, { status: 'read' }))
					.status
			).toBe(404)
		})

		test('updates the store and broadcasts STATUS_UPDATE', async () => {
			mockStore.setDeliveryMode('manual')
			const id = await sendText()
			frames.length = 0

			const res = await post(`/mock/messages/${id}/status`, {
				status: 'delivered',
			})

			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({
				success: true,
				id,
				status: 'delivered',
			})
			expect(mockStore.getMessage(id)?.status).toBe('delivered')
			expect(frames).toContainEqual({
				type: 'STATUS_UPDATE',
				payload: { id, status: 'delivered' },
			})
		})

		test('failed sends the Meta webhook with an errors array', async () => {
			mockStore.setDeliveryMode('manual')
			const received = Promise.withResolvers<WebhookPayload>()
			const target = serve({
				port: 3031,
				fetch: async (req) => {
					received.resolve((await req.json()) as WebhookPayload)
					return new Response('ok')
				},
			})
			try {
				const id = await sendText()
				process.env.WEBHOOK_URL = 'http://localhost:3031/hook'
				resetWebhookConfig()

				await post(`/mock/messages/${id}/status`, { status: 'failed' })

				const payload = await received.promise
				const value = payload.entry[0].changes[0].value as unknown as {
					statuses: Array<Record<string, unknown>>
				}
				expect(value.statuses[0]).toMatchObject({
					id,
					status: 'failed',
					errors: [{ code: 131026, title: 'Message undeliverable' }],
				})
			} finally {
				target.close()
			}
		})
	})

	describe('webhook event log', () => {
		test('records a failed delivery with its httpStatus and broadcasts it', async () => {
			const target = serve({
				port: 3032,
				fetch: () => new Response('boom', { status: 500 }),
			})
			const payload: WebhookPayload = {
				object: 'whatsapp_business_account',
				entry: [
					{
						id: businessId,
						changes: [
							{
								field: 'messages',
								value: {
									messaging_product: 'whatsapp',
									metadata: {
										display_phone_number: businessId,
										phone_number_id: businessId,
									},
									messages: [
										{
											from: '5511900000001',
											id: 'wamid.x',
											timestamp: '1',
											type: 'text',
											text: { body: 'x' },
										},
									],
								},
							},
						],
					},
				],
			}
			try {
				await expect(
					sendWebhook('http://localhost:3032/hook?token=secret', payload)
				).rejects.toThrow('HTTP 500')
			} finally {
				target.close()
			}

			const res = await app.request(`${base}/mock/events`)
			const { events } = (await res.json()) as {
				events: Array<Record<string, unknown>>
			}
			expect(events[0]).toMatchObject({
				kind: 'message',
				status: 'failed',
				httpStatus: 500,
				url: 'http://localhost:3032/hook',
			})
			expect(String(events[0].error)).toContain('HTTP 500')
			expect(frames).toContainEqual({
				type: 'WEBHOOK_EVENT',
				payload: expect.objectContaining({ httpStatus: 500 }),
			})
		})

		test('lists newest first', async () => {
			for (const url of ['mock://a', 'mock://b']) {
				mockStore.storeWebhookEvent({
					timestamp: new Date(),
					url,
					kind: 'status',
					status: 'delivered',
					httpStatus: 200,
					error: null,
					payload: {},
				})
			}
			const res = await app.request(`${base}/mock/events`)
			const { events } = (await res.json()) as {
				events: Array<{ url: string }>
			}
			expect(events.map((e) => e.url)).toEqual(['mock://b', 'mock://a'])
		})
	})

	describe('GET /mock/templates and /mock/config', () => {
		test('lists the templates', async () => {
			const res = await app.request(`${base}/mock/templates`)
			const { templates } = (await res.json()) as {
				templates: Array<{ name: string }>
			}
			expect(templates.map((t) => t.name)).toContain('order_confirmation')
		})

		test('config reports secretSet without leaking the secret', async () => {
			const before = await (await app.request(`${base}/mock/config`)).json()
			expect(before.secretSet).toBe(false)

			process.env.WEBHOOK_SECRET = 'fake-secret-value'
			const res = await app.request(`${base}/mock/config`)
			const text = await res.text()
			expect(JSON.parse(text).secretSet).toBe(true)
			expect(text).not.toContain('fake-secret-value')
		})

		test('a webhook configured through /mock/configure is the one deliveries use', async () => {
			const res = await post('/mock/configure', {
				phoneNumberId: businessId,
				url: 'http://localhost:3099/hooks/meta',
				enabled: true,
			})
			expect(res.status).toBe(200)

			const config = (await (
				await app.request(`${base}/mock/config`)
			).json()) as {
				configured: boolean
				mappings: Array<{ phone: string; url: string }>
			}
			expect(config.configured).toBe(true)
			expect(config.mappings).toContainEqual({
				phone: businessId,
				url: 'http://localhost:3099/hooks/meta',
			})

			const simulated = (await (
				await post('/mock/simulate-message', {
					from: '5511922222222',
					to: businessId,
					message: { type: 'text', text: { body: 'oi' } },
				})
			).json()) as { delivered: boolean }
			expect(simulated.delivered).toBe(true)
		})
	})
})
