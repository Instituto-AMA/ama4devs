import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
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
import { mockStore, type StoredMessage } from '../store/mock-store.ts'
import { TemplateStore } from '../store/template-store.ts'
import type { WebhookPayload } from '../types/api-types.ts'
import { sendWebhook } from '../webhook-target.ts'
import { addClient, removeClient } from '../websocket.ts'

const base = 'http://localhost:3010'
const phone = '5511900000000'
const user = '5511922222222'
const templatesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../templates'
)

type Frame = { type: string; payload: Record<string, unknown> }
// biome-ignore lint/suspicious/noExplicitAny: the tests read Graph answers of any shape
type Json = Record<string, any>

describe('The conversation and the settings', () => {
	let app: ReturnType<typeof createApp>['app']
	const frames: Frame[] = []
	const fakeSocket = {
		readyState: 1,
		send: (data: string) => frames.push(JSON.parse(data)),
	}

	const call = (
		path: string,
		init: {
			method?: string
			body?: unknown
			headers?: Record<string, string>
		} = {}
	) =>
		app.request(`${base}${path}`, {
			method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test',
				...init.headers,
			},
			...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
		})

	/** The clinic writes, through the Cloud API. */
	const clinicSends = async (to = user) => {
		const res = await call(`/v23.0/${phone}/messages`, {
			body: {
				messaging_product: 'whatsapp',
				to,
				type: 'text',
				text: { body: 'Olá' },
			},
		})
		return ((await res.json()) as Json).messages[0].id as string
	}

	/** The user writes, through the same call, from the user's phone. */
	const userSends = async (text = 'Oi', from = user, name = 'Maria Souza') => {
		const res = await call(`/v23.0/${phone}/messages`, {
			body: {
				messaging_product: 'whatsapp',
				type: 'text',
				text: { body: text },
			},
			headers: { 'X-Mock-From': from, 'X-Mock-Contact-Name': name },
		})
		return (await res.json()) as Json
	}

	/** A webhook of the application, answered on a real port. */
	const listen = async (port: number) => {
		const received: WebhookPayload[] = []
		const server = serve({
			port,
			fetch: async (req) => {
				received.push((await req.json()) as WebhookPayload)
				return new Response('ok')
			},
		})
		process.env.WEBHOOK_URL = `http://localhost:${port}/hook`
		resetWebhookConfig()
		return { received, close: () => server.close() }
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
		mockStore.setResponseDelayMs(0)
		frames.length = 0
	})

	afterEach(() => vi.useRealTimers())

	describe('one conversation, both sides', () => {
		test('the user writes through the Cloud API call and the webhook hears it', async () => {
			const hook = await listen(3041)
			try {
				const res = await userSends('Quero marcar uma consulta')
				expect(res).toMatchObject({
					messaging_product: 'whatsapp',
					contacts: [{ input: user, wa_id: user }],
				})
				await vi.waitFor(() => expect(hook.received).toHaveLength(1))
				const value = hook.received[0].entry[0].changes[0].value as Json
				expect(value.contacts[0]).toEqual({
					profile: { name: 'Maria Souza' },
					wa_id: user,
				})
				expect(value.messages[0]).toMatchObject({
					from: user,
					id: res.messages[0].id,
					type: 'text',
					text: { body: 'Quero marcar uma consulta' },
				})
			} finally {
				hook.close()
			}
		})

		test('both sides land in the same conversation, in order', async () => {
			await userSends('Oi')
			await clinicSends()
			await userSends('Obrigado', '5511933333333')

			const mine = (await (
				await call(`/v23.0/${phone}/messages?contact=${user}`)
			).json()) as Json
			expect(mine.data.map((m: Json) => [m.direction, m.text])).toEqual([
				['in', 'Oi'],
				['out', 'Olá'],
			])
			expect(mine.data[0]).toMatchObject({
				status: 'received',
				contactName: 'Maria Souza',
			})

			const all = (await (await call('/settings/conversations')).json()) as Json
			expect(all.messages).toHaveLength(3)
			expect(frames.filter((f) => f.type === 'NEW_MESSAGE')).toHaveLength(3)
		})

		test('the user sends any type, and a reply carries its context', async () => {
			const hook = await listen(3042)
			try {
				const clinic = await clinicSends()
				const res = await call(`/v23.0/${phone}/messages`, {
					body: {
						messaging_product: 'whatsapp',
						type: 'image',
						image: { id: '1', caption: 'Exame' },
						context: { message_id: clinic },
					},
					headers: { 'X-Mock-From': user },
				})
				expect(res.status).toBe(200)
				await vi.waitFor(() =>
					expect(
						hook.received.some(
							(p) => (p.entry[0].changes[0].value as Json).messages
						)
					).toBe(true)
				)
				const inbound = hook.received
					.map((p) => p.entry[0].changes[0].value as Json)
					.find((v) => v.messages)
				expect(inbound?.messages[0]).toMatchObject({
					from: user,
					type: 'image',
					image: { id: '1', caption: 'Exame' },
					context: { id: clinic },
				})
			} finally {
				hook.close()
			}
		})
	})

	describe('receipts', () => {
		test('auto walks sent, delivered, read and broadcasts each step', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout'] })
			const id = await clinicSends()
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

		test('manual stops at sent, and the user phone gives the receipt', async () => {
			mockStore.setDeliveryMode('manual')
			const id = await clinicSends()
			const receipt = await call(`/v23.0/${phone}/messages`, {
				body: { messaging_product: 'whatsapp', status: 'read', message_id: id },
				headers: { 'X-Mock-From': user, 'X-Mock-Message-Status': 'delivered' },
			})
			expect(await receipt.json()).toEqual({ success: true })
			expect(mockStore.getMessage(id)?.status).toBe('delivered')
		})

		test('a failed receipt reaches the webhook with the errors of Meta', async () => {
			mockStore.setDeliveryMode('manual')
			const id = await clinicSends()
			const hook = await listen(3042)
			try {
				await call(`/v23.0/${phone}/messages`, {
					body: {
						messaging_product: 'whatsapp',
						status: 'read',
						message_id: id,
					},
					headers: { 'X-Mock-From': user, 'X-Mock-Message-Status': 'failed' },
				})
				await vi.waitFor(() => expect(hook.received).toHaveLength(1))
				const value = hook.received[0].entry[0].changes[0].value as Json
				expect(value.statuses[0]).toMatchObject({
					id,
					status: 'failed',
					recipient_id: user,
					errors: [{ code: 131026, title: 'Message undeliverable' }],
				})
			} finally {
				hook.close()
			}
		})

		test('refuses a receipt for a message the clinic did not send to that user', async () => {
			const mine = await clinicSends()
			const other = await call(`/v23.0/${phone}/messages`, {
				body: {
					messaging_product: 'whatsapp',
					status: 'read',
					message_id: mine,
				},
				headers: { 'X-Mock-From': '5511988888888' },
			})
			expect(other.status).toBe(400)
			const bad = await call(`/v23.0/${phone}/messages`, {
				body: {
					messaging_product: 'whatsapp',
					status: 'read',
					message_id: mine,
				},
				headers: { 'X-Mock-From': user, 'X-Mock-Message-Status': 'sent' },
			})
			expect(bad.status).toBe(400)
		})

		test('the clinic marks the user message as read, the Meta way', async () => {
			const { messages } = await userSends()
			const res = await call(`/v23.0/${phone}/messages`, {
				body: {
					messaging_product: 'whatsapp',
					status: 'read',
					message_id: messages[0].id,
				},
			})
			expect(await res.json()).toEqual({ success: true })
			expect(mockStore.getMessage(messages[0].id)?.status).toBe('read')
		})
	})

	describe('settings', () => {
		test('delivery mode and webhook delay are read and changed with PUT', async () => {
			expect(await (await call('/settings/delivery-mode')).json()).toEqual({
				mode: 'auto',
			})
			const mode = await call('/settings/delivery-mode', {
				method: 'PUT',
				body: { mode: 'manual' },
			})
			expect(await mode.json()).toEqual({ mode: 'manual' })
			expect(
				(
					await call('/settings/delivery-mode', {
						method: 'PUT',
						body: { mode: 'x' },
					})
				).status
			).toBe(400)

			const delay = await call('/settings/webhook-delay', {
				method: 'PUT',
				body: { delayMs: 1500 },
			})
			expect(await delay.json()).toEqual({ delayMs: 1500 })
			expect(
				(
					await call('/settings/webhook-delay', {
						method: 'PUT',
						body: { delayMs: -1 },
					})
				).status
			).toBe(400)
		})

		test('the webhooks report the secret without leaking it', async () => {
			process.env.WEBHOOK_SECRET = 'fake-secret-value'
			const text = await (await call('/settings/webhooks')).text()
			expect(JSON.parse(text).secretSet).toBe(true)
			expect(text).not.toContain('fake-secret-value')
		})

		test('the event log keeps every webhook call, newest first', async () => {
			const target = serve({
				port: 3043,
				fetch: () => new Response('boom', { status: 500 }),
			})
			try {
				const payload = {
					object: 'whatsapp_business_account',
					entry: [],
				} as unknown as WebhookPayload
				await expect(
					sendWebhook('http://localhost:3043/hook?token=secret', payload)
				).rejects.toThrow('HTTP 500')
			} finally {
				target.close()
			}
			const { events } = (await (await call('/settings/events')).json()) as Json
			expect(events[0]).toMatchObject({
				status: 'failed',
				httpStatus: 500,
				url: 'http://localhost:3043/hook',
			})
			await call('/settings/events', { method: 'DELETE' })
			expect(
				((await (await call('/settings/events')).json()) as Json).events
			).toEqual([])
		})

		test('start from zero clears both sides of every conversation', async () => {
			await userSends()
			await clinicSends()
			await call('/settings/conversations', { method: 'DELETE' })
			expect(mockStore.getAllMessages()).toEqual([])
		})

		test('there is no /mock, /webhook or /conversation any more', async () => {
			for (const path of [
				'/mock/messages',
				'/mock/config',
				'/webhook/events',
				'/conversation',
			]) {
				expect((await call(path)).status).toBe(404)
			}
		})
	})

	test('toPanelMessage maps a template to header, body, footer and buttons', () => {
		const message: StoredMessage = {
			id: 'wamid.1',
			direction: 'out',
			phoneNumberId: phone,
			contact: user,
			contactName: null,
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
			timestamp: new Date('2026-01-01T00:00:00Z'),
			status: 'sent',
		}
		expect(toPanelMessage(message)).toMatchObject({
			direction: 'out',
			contact: user,
			text: 'Body for Ana',
			template: {
				header: { format: 'TEXT', text: 'Hi Ana' },
				footer: 'Bye',
				buttons: [
					{ type: 'QUICK_REPLY', text: 'Yes' },
					{ type: 'QUICK_REPLY', text: 'No' },
				],
				cards: [],
			},
		})
	})

	test('toPanelMessage draws the media header, the link behind a button and the carousel cards', () => {
		const message: StoredMessage = {
			id: 'wamid.2',
			direction: 'out',
			phoneNumberId: phone,
			contact: user,
			contactName: null,
			type: 'template',
			content: {
				template: {
					name: 'oferta',
					language: { code: 'pt_BR' },
					components: [
						{
							type: 'header',
							parameters: [
								{ type: 'image', image: { link: 'https://x.test/a.jpg' } },
							],
						},
						{
							type: 'button',
							sub_type: 'url',
							index: 0,
							parameters: [{ type: 'text', text: 'abc' }],
						},
						{
							type: 'carousel',
							cards: [
								{
									card_index: 0,
									components: [
										{
											type: 'header',
											parameters: [
												{
													type: 'video',
													video: { link: 'https://x.test/v.mp4' },
												},
											],
										},
										{
											type: 'body',
											parameters: [{ type: 'text', text: 'Lente A' }],
										},
									],
								},
							],
						},
					],
				} as never,
				processedTemplate: {
					name: 'oferta',
					components: [
						{ type: 'HEADER', format: 'IMAGE' },
						{ type: 'BODY', text: 'Veja' },
						{
							type: 'BUTTONS',
							buttons: [
								{ type: 'URL', text: 'Abrir', url: 'https://x.test/{{1}}' },
							],
						},
						{
							type: 'CAROUSEL',
							cards: [
								{
									components: [
										{ type: 'HEADER', format: 'VIDEO' },
										{ type: 'BODY', text: 'Card {{1}}' },
										{
											type: 'BUTTONS',
											buttons: [{ type: 'QUICK_REPLY', text: 'Quero' }],
										},
									],
								},
							],
						},
					],
				},
			},
			timestamp: new Date('2026-01-01T00:00:00Z'),
			status: 'sent',
		}
		expect(toPanelMessage(message).template).toMatchObject({
			header: {
				format: 'IMAGE',
				media: { kind: 'image', src: 'https://x.test/a.jpg' },
			},
			buttons: [{ type: 'URL', text: 'Abrir', detail: 'https://x.test/abc' }],
			cards: [
				{
					header: {
						format: 'VIDEO',
						media: { kind: 'video', src: 'https://x.test/v.mp4' },
					},
					body: 'Card Lente A',
					buttons: [{ type: 'QUICK_REPLY', text: 'Quero' }],
				},
			],
		})
	})
})
