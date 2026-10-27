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
import { MOCK_IDS } from '../../graph/nodes.ts'
import { clearCalls, setRingTimeoutMs } from '../calls.ts'
import {
	clearWebhookOverrides,
	resetWebhookConfig,
	setWebhookUrl,
} from '../config.ts'
import { createApp } from '../server.ts'
import { DEFAULT_PHONE_NUMBER_ID } from '../store/account-store.ts'
import { mockStore } from '../store/mock-store.ts'
import { TemplateStore } from '../store/template-store.ts'
import { addClient, removeClient } from '../websocket.ts'
import { resetPhoneState } from './nodes.ts'

// biome-ignore lint/suspicious/noExplicitAny: the tests read Graph answers of any shape
type Json = Record<string, any>

const phone = DEFAULT_PHONE_NUMBER_ID
const user = '5511955554444'
const waba = MOCK_IDS.waba
const SDP_OFFER = [
	'v=0',
	'o=- 1 2 IN IP4 127.0.0.1',
	's=-',
	't=0 0',
	'm=audio 9 UDP/TLS/RTP/SAVPF 111',
	'a=setup:actpass',
	'',
].join('\r\n')
const SDP_ANSWER = [
	'v=0',
	'o=- 3 4 IN IP4 127.0.0.1',
	's=-',
	't=0 0',
	'm=audio 9 UDP/TLS/RTP/SAVPF 111',
	'a=setup:active',
	'',
].join('\r\n')

describe('Calls and numbers through the Cloud API', () => {
	let app: ReturnType<typeof createApp>['app']
	const realFetch = globalThis.fetch
	const hooks: Json[] = []
	const frames: Json[] = []
	const socket = {
		readyState: 1,
		send: (data: string) => frames.push(JSON.parse(data)),
	}

	const call = (
		path: string,
		body?: unknown,
		headers: Record<string, string> = {}
	) =>
		app.request(`http://localhost:3010/v23.0${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test',
				...headers,
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		})
	const json = async (res: Response) => (await res.json()) as Json
	const asUser = { 'X-Mock-From': user, 'X-Mock-Contact-Name': 'Mariana Souza' }
	/** The `calls` webhooks the application heard, flattened. */
	const callHooks = () =>
		hooks
			.filter((h) => h.entry[0].changes[0].field === 'calls')
			.map((h) => h.entry[0].changes[0].value)

	beforeAll(() => {
		app = createApp(new TemplateStore('./templates')).app
		addClient(socket as never)
	})
	afterAll(() => removeClient(socket as never))

	beforeEach(() => {
		delete process.env.WEBHOOK_URL
		resetWebhookConfig()
		clearWebhookOverrides()
		resetPhoneState()
		clearCalls()
		mockStore.setResponseDelayMs(0)
		setWebhookUrl(phone, 'http://app.test/hook')
		hooks.length = 0
		frames.length = 0
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = String(input instanceof Request ? input.url : input)
			if (url.startsWith('http://app.test/')) {
				if ((init?.method ?? 'GET') === 'GET') {
					return new Response(
						new URL(url).searchParams.get('hub.challenge') ?? ''
					)
				}
				hooks.push(JSON.parse(String(init?.body)))
				return new Response('ok')
			}
			return realFetch(input, init)
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
		setRingTimeoutMs(60_000)
	})

	test('the mock boots with its number registered on the Cloud API, calling on', async () => {
		const numbers = await json(await call(`/${waba}/phone_numbers`))
		expect(numbers.data).toContainEqual(
			expect.objectContaining({
				id: phone,
				platform_type: 'CLOUD_API',
				status: 'CONNECTED',
			})
		)
		const settings = await json(await call(`/${phone}/settings`))
		expect(settings.calling).toMatchObject({
			status: 'enabled',
			callback_permission_status: 'enabled',
		})
		const owned = await json(
			await call(`/${MOCK_IDS.business}/owned_whatsapp_business_accounts`)
		)
		expect(owned.data.map((w: Json) => w.id)).toContain(waba)
	})

	test('a new number goes through code, verification and registration before it sends or calls', async () => {
		const created = await json(
			await call(`/${waba}/phone_numbers`, {
				cc: '55',
				phone_number: '11977776666',
				verified_name: 'Clínica Nova',
			})
		)
		const id = created.id as string
		const send = {
			messaging_product: 'whatsapp',
			to: user,
			type: 'text',
			text: { body: 'Oi' },
		}

		const early = await json(await call(`/${id}/messages`, send))
		expect(early.error.code).toBe(133010)

		expect(
			(
				await call(`/${id}/request_code`, {
					code_method: 'SMS',
					language: 'pt_BR',
				})
			).status
		).toBe(200)
		const sms = frames.find(
			(f) => f.type === 'ACCOUNT_UPDATE' && f.payload.kind === 'code'
		)
		expect(sms?.payload.code).toMatch(/^\d{6}$/)

		const wrong = await json(
			await call(`/${id}/verify_code`, {
				code: sms?.payload.code === '000000' ? '111111' : '000000',
			})
		)
		expect(wrong.error.code).toBe(136025)
		expect(
			(await call(`/${id}/verify_code`, { code: sms?.payload.code })).status
		).toBe(200)

		expect(
			(
				await call(`/${id}/register`, {
					messaging_product: 'whatsapp',
					pin: '123456',
				})
			).status
		).toBe(200)
		expect((await call(`/${id}/messages`, send)).status).toBe(200)

		// Calling needs an app on the calls field: a webhook for the number.
		const refused = await json(
			await call(`/${id}/settings`, { calling: { status: 'enabled' } })
		)
		expect(refused.error.code).toBe(138018)
		setWebhookUrl(id, 'http://app.test/new')
		expect(
			(await call(`/${id}/settings`, { calling: { status: 'enabled' } })).status
		).toBe(200)

		const again = await json(
			await call(`/${id}/register`, {
				messaging_product: 'whatsapp',
				pin: '654321',
			})
		)
		expect(again.error.code).toBe(133005)
	})

	test('the user calls: the application hears the offer, accepts with its answer, the user hangs up', async () => {
		const started = await json(
			await call(
				`/${phone}/calls`,
				{
					messaging_product: 'whatsapp',
					action: 'connect',
					session: { sdp_type: 'offer', sdp: SDP_OFFER },
				},
				asUser
			)
		)
		const callId = started.calls[0].id as string
		expect(callId).toMatch(/^wacid\./)

		await vi.waitFor(() => expect(callHooks().length).toBeGreaterThan(0))
		const connect = callHooks()[0]
		expect(connect.contacts[0]).toEqual({
			profile: { name: 'Mariana Souza' },
			wa_id: user,
		})
		expect(connect.calls[0]).toMatchObject({
			id: callId,
			from: user,
			event: 'connect',
			direction: 'USER_INITIATED',
			session: { sdp_type: 'offer', sdp: SDP_OFFER },
		})

		const answer = {
			messaging_product: 'whatsapp',
			call_id: callId,
			session: { sdp_type: 'answer', sdp: SDP_ANSWER },
		}
		expect(
			(await call(`/${phone}/calls`, { ...answer, action: 'pre_accept' }))
				.status
		).toBe(200)
		const mismatch = await json(
			await call(`/${phone}/calls`, {
				...answer,
				action: 'accept',
				session: { sdp_type: 'answer', sdp: SDP_OFFER },
			})
		)
		expect(mismatch.error.code).toBe(100)
		expect(
			(await call(`/${phone}/calls`, { ...answer, action: 'accept' })).status
		).toBe(200)

		// The panel (the user's phone) gets the answer to finish its WebRTC side.
		const live = frames
			.filter((f) => f.type === 'CALL_UPDATE' && f.payload.call?.id === callId)
			.pop()
		expect(live?.payload.call).toMatchObject({
			state: 'active',
			answer: SDP_ANSWER,
		})

		await call(
			`/${phone}/calls`,
			{ messaging_product: 'whatsapp', call_id: callId, action: 'terminate' },
			asUser
		)
		await vi.waitFor(() =>
			expect(callHooks().some((v) => v.calls?.[0]?.event === 'terminate')).toBe(
				true
			)
		)
		const end = callHooks().find((v) => v.calls?.[0]?.event === 'terminate')
			?.calls[0]
		expect(end).toMatchObject({
			status: 'COMPLETED',
			direction: 'USER_INITIATED',
		})
		expect(end.duration).toBeGreaterThanOrEqual(0)
		expect(end.start_time).toBeDefined()

		// Calling the business granted it permission to call back.
		const permission = await json(
			await call(`/${phone}/call_permissions?user_wa_id=${user}`)
		)
		expect(permission.permission.status).toBe('temporary')
	})

	test('the business calls only with permission: request, the user allows, ringing, accepted', async () => {
		const connect = {
			messaging_product: 'whatsapp',
			to: user,
			action: 'connect',
			session: { sdp_type: 'offer', sdp: SDP_OFFER },
		}
		const denied = await json(await call(`/${phone}/calls`, connect))
		expect(denied.error.code).toBe(138006)

		const request = {
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: user,
			type: 'interactive',
			interactive: {
				type: 'call_permission_request',
				action: { name: 'call_permission_request' },
				body: { text: 'Podemos ligar?' },
			},
		}
		const sent = await json(await call(`/${phone}/messages`, request))
		const requestId = sent.messages[0].id as string
		const second = await json(await call(`/${phone}/messages`, request))
		expect(second.error.code).toBe(138009)

		await call(
			`/${phone}/messages`,
			{
				messaging_product: 'whatsapp',
				type: 'interactive',
				context: { message_id: requestId },
				interactive: {
					type: 'call_permission_reply',
					call_permission_reply: { response: 'accept', is_permanent: false },
				},
			},
			asUser
		)
		await vi.waitFor(() =>
			expect(
				hooks.some(
					(h) =>
						h.entry[0].changes[0].value.messages?.[0]?.interactive?.type ===
						'call_permission_reply'
				)
			).toBe(true)
		)
		const reply = hooks.find(
			(h) => h.entry[0].changes[0].value.messages?.[0]?.interactive
		)?.entry[0].changes[0].value.messages[0]
		expect(reply.context.id).toBe(requestId)
		expect(reply.interactive.call_permission_reply).toMatchObject({
			response: 'accept',
			is_permanent: false,
			response_source: 'user_action',
			expiration_timestamp: expect.stringMatching(/^\d+$/),
		})

		const view = await json(
			await call(`/${phone}/call_permissions?user_wa_id=${user}`)
		)
		expect(view.permission.status).toBe('temporary')
		expect(
			view.actions.find((a: Json) => a.action_name === 'start_call')
				.can_perform_action
		).toBe(true)

		const started = await json(
			await call(`/${phone}/calls`, {
				...connect,
				biz_opaque_callback_data: 'tracking-1',
			})
		)
		const callId = started.calls[0].id as string
		await vi.waitFor(() =>
			expect(
				callHooks().some((v) => v.statuses?.[0]?.status === 'RINGING')
			).toBe(true)
		)
		// The user's phone rings with the business offer.
		expect(
			frames.some(
				(f) =>
					f.payload.call?.id === callId && f.payload.call.offer === SDP_OFFER
			)
		).toBe(true)

		await call(
			`/${phone}/calls`,
			{
				messaging_product: 'whatsapp',
				call_id: callId,
				action: 'accept',
				session: { sdp_type: 'answer', sdp: SDP_ANSWER },
			},
			asUser
		)
		await vi.waitFor(() =>
			expect(
				callHooks().some((v) => v.statuses?.[0]?.status === 'ACCEPTED')
			).toBe(true)
		)
		const answered = callHooks().find((v) => v.calls?.[0]?.event === 'connect')
			?.calls[0]
		expect(answered).toMatchObject({
			id: callId,
			direction: 'BUSINESS_INITIATED',
			to: user,
			session: { sdp_type: 'answer', sdp: SDP_ANSWER },
			biz_opaque_callback_data: 'tracking-1',
		})

		expect(
			(
				await call(`/${phone}/calls`, {
					messaging_product: 'whatsapp',
					call_id: callId,
					action: 'terminate',
				})
			).status
		).toBe(200)
		const over = await json(
			await call(`/${phone}/calls`, {
				messaging_product: 'whatsapp',
				call_id: callId,
				action: 'terminate',
			})
		)
		expect(over.error.code).toBe(100)
	})

	test('a number without calling refuses calls, and a call nobody answers ends unanswered', async () => {
		await call(`/${phone}/settings`, { calling: { status: 'disabled' } })
		const off = await json(
			await call(
				`/${phone}/calls`,
				{
					messaging_product: 'whatsapp',
					action: 'connect',
					session: { sdp_type: 'offer', sdp: SDP_OFFER },
				},
				asUser
			)
		)
		expect(off.error.code).toBe(138000)
		await call(`/${phone}/settings`, { calling: { status: 'enabled' } })

		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		setRingTimeoutMs(30_000)
		const started = await json(
			await call(
				`/${phone}/calls`,
				{
					messaging_product: 'whatsapp',
					action: 'connect',
					session: { sdp_type: 'offer', sdp: SDP_OFFER },
				},
				asUser
			)
		)
		vi.advanceTimersByTime(30_000)
		vi.useRealTimers()
		await vi.waitFor(() =>
			expect(callHooks().some((v) => v.calls?.[0]?.event === 'terminate')).toBe(
				true
			)
		)
		const end = callHooks().find((v) => v.calls?.[0]?.event === 'terminate')
			?.calls[0]
		expect(end).toMatchObject({ id: started.calls[0].id, status: 'COMPLETED' })
		expect(end.duration).toBeUndefined()
	})
})
