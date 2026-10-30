import type { Database } from 'bun:sqlite'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
	clearWebhookOverrides,
	resetWebhookConfig,
	setWebhookUrl,
} from '../config.ts'
import { createApp } from '../server.ts'
import { openDatabase } from '../store/database.ts'
import { mockStore } from '../store/mock-store.ts'
import { TemplateStore } from '../store/template-store.ts'

const base = 'http://localhost:3010'
const waba = '102290129340398'
const phone = '5511400000000'

// biome-ignore lint/suspicious/noExplicitAny: the tests read Graph answers of any shape
type Json = Record<string, any>

describe('Message templates through the Cloud API', () => {
	let dir: string
	let db: Database
	let store: TemplateStore
	let app: ReturnType<typeof createApp>['app']
	const realFetch = globalThis.fetch
	const delivered: Array<{ url: string; body: Json }> = []

	const call = (
		path: string,
		init: {
			method?: string
			body?: unknown
			headers?: Record<string, string>
		} = {}
	) =>
		app.request(`${base}${path}`, {
			method: init.method ?? 'GET',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test',
				...init.headers,
			},
			...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
		})

	const create = (body: Json, headers: Record<string, string> = {}) =>
		call(`/v23.0/${waba}/message_templates`, {
			method: 'POST',
			body,
			headers: { 'X-Mock-Template-Review-Delay': '0', ...headers },
		})

	const draft = (name: string): Json => ({
		name,
		language: 'pt_BR',
		category: 'UTILITY',
		components: [
			{ type: 'HEADER', format: 'TEXT', text: 'Cobrança' },
			{
				type: 'BODY',
				text: 'Olá, {{1}}! Sua cobrança de {{2}} venceu.',
				example: { body_text: [['Mariana', 'R$ 120,00']] },
			},
		],
	})

	const statusOf = async (name: string) => {
		const res = await call(`/v23.0/${waba}/message_templates?name=${name}`)
		return ((await res.json()) as Json).data[0]
	}

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'whap-templates-'))
		// One database per test, shared by the stores of a "restart".
		db = openDatabase(':memory:')
		store = new TemplateStore(dir, undefined, db)
		app = createApp(store).app
		delete process.env.WEBHOOK_URL
		resetWebhookConfig()
		mockStore.setResponseDelayMs(0)
		delivered.length = 0
		// The webhooks of the application, answered here.
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = String(input instanceof Request ? input.url : input)
			if (url.startsWith('http://app.test/')) {
				const target = new URL(url)
				if ((init?.method ?? 'GET') === 'GET') {
					return new Response(target.searchParams.get('hub.challenge') ?? '')
				}
				delivered.push({ url, body: JSON.parse(String(init?.body)) })
				return new Response('ok')
			}
			return realFetch(input, init)
		})
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await rm(dir, { recursive: true, force: true })
	})

	test('a new template is born PENDING and a restart finds it in the library', async () => {
		const res = await create(draft('charge_overdue'), {
			'X-Mock-Template-Review-Delay': '60000',
		})

		expect(res.status).toBe(200)
		const created = (await res.json()) as Json
		expect(created).toEqual({
			id: expect.stringMatching(/^\d{16}$/),
			status: 'PENDING',
			category: 'UTILITY',
		})
		const restarted = new TemplateStore(dir, undefined, db)
		await restarted.initialize()
		const kept = restarted.getTemplate('charge_overdue', 'pt_BR') as Json
		expect(kept.status).toBe('PENDING')
		expect(kept.wabaId).toBe(waba)
		expect(kept.variables['1'].example).toBe('Mariana')
		await restarted.cleanup()
	})

	test('a seed deleted through the API stays deleted until its file changes', async () => {
		const seed = join(dir, 'seed.json')
		await writeFile(
			seed,
			JSON.stringify({ ...draft('seed'), status: 'APPROVED' })
		)
		await store.initialize()
		expect(store.getTemplate('seed', 'pt_BR')).toBeDefined()

		const removed = await call(
			`/v23.0/${waba}/message_templates?name=seed`,
			{
				method: 'DELETE',
			}
		)
		expect(removed.status).toBe(200)
		const again = new TemplateStore(dir, undefined, db)
		await again.initialize()
		expect(again.getTemplate('seed', 'pt_BR')).toBeUndefined()

		await writeFile(
			seed,
			JSON.stringify({ ...draft('seed'), category: 'MARKETING' })
		)
		await again.reloadTemplates()
		expect(again.getTemplate('seed', 'pt_BR')?.category).toBe('MARKETING')
		await store.cleanup()
		await again.cleanup()
	})

	test('the review approves it and tells every webhook of the account', async () => {
		setWebhookUrl(phone, 'http://app.test/hooks/meta')
		const created = (await (await create(draft('reminder'))).json()) as Json

		await vi.waitFor(async () => {
			expect((await statusOf('reminder')).status).toBe('APPROVED')
		})
		await vi.waitFor(() => expect(delivered).toHaveLength(1))
		const entry = delivered[0].body.entry[0]
		expect(entry.id).toBe(waba)
		expect(entry.changes[0].field).toBe('message_template_status_update')
		expect(entry.changes[0].value).toMatchObject({
			event: 'APPROVED',
			message_template_id: created.id,
			message_template_name: 'reminder',
			message_template_language: 'pt_BR',
			reason: 'NONE',
		})
	})

	test('the headers decide the verdict, and a rejected template cannot be sent', async () => {
		await create(draft('promo'), {
			'X-Mock-Template-Review': 'REJECTED',
			'X-Mock-Template-Review-Reason': 'TAG_CONTENT_MISMATCH',
		})
		await vi.waitFor(async () => {
			expect((await statusOf('promo')).status).toBe('REJECTED')
		})
		expect((await statusOf('promo')).rejected_reason).toBe(
			'TAG_CONTENT_MISMATCH'
		)

		const send = await call(`/v23.0/${phone}/messages`, {
			method: 'POST',
			body: {
				messaging_product: 'whatsapp',
				to: '5511999999999',
				type: 'template',
				template: { name: 'promo', language: { code: 'pt_BR' } },
			},
		})
		expect(send.status).toBe(400)
		expect(((await send.json()) as Json).error.code).toBe(132001)
	})

	test('a paused template is refused with the code Meta uses for it', async () => {
		await create(draft('paused'), { 'X-Mock-Template-Review': 'PAUSED' })
		await vi.waitFor(async () => {
			expect((await statusOf('paused')).status).toBe('PAUSED')
		})
		const send = await call(`/v23.0/${phone}/messages`, {
			method: 'POST',
			body: {
				messaging_product: 'whatsapp',
				to: '5511999999999',
				type: 'template',
				template: { name: 'paused', language: { code: 'pt_BR' } },
			},
		})
		expect(((await send.json()) as Json).error.code).toBe(132015)
	})

	test('refuses what Meta refuses', async () => {
		const badName = await create({ ...draft('x'), name: 'Overdue Charge' })
		expect(badName.status).toBe(400)
		expect(((await badName.json()) as Json).error).toMatchObject({
			type: 'OAuthException',
			code: 100,
		})

		const noBody = await create({
			...draft('without_body'),
			components: [{ type: 'FOOTER', text: 'footer' }],
		})
		expect(noBody.status).toBe(400)

		await create(draft('duplicate'))
		const twice = await create(draft('duplicate'))
		expect(twice.status).toBe(400)
		expect(((await twice.json()) as Json).error.error_subcode).toBe(2388024)
	})

	test('reads a template by its id and edits it back into the review', async () => {
		const { id } = (await (await create(draft('edit'))).json()) as Json
		await vi.waitFor(async () => {
			expect((await statusOf('edit')).status).toBe('APPROVED')
		})

		const read = (await (await call(`/v23.0/${id}`)).json()) as Json
		expect(read.name).toBe('edit')
		expect(read.components[1].example.body_text[0]).toEqual([
			'Mariana',
			'R$ 120,00',
		])

		const edit = await call(`/v23.0/${id}`, {
			method: 'POST',
			body: {
				components: [{ type: 'BODY', text: 'Oi, {{1}}!' }],
			},
			headers: { 'X-Mock-Template-Review-Delay': '60000' },
		})
		expect(((await edit.json()) as Json).success).toBe(true)
		expect((await statusOf('edit')).status).toBe('PENDING')

		const whileInReview = await call(`/v23.0/${id}`, {
			method: 'POST',
			body: { category: 'MARKETING' },
		})
		expect(whileInReview.status).toBe(400)
	})

	test('deletes one language by hsm_id, or every language by name', async () => {
		const pt = (await (await create(draft('notice'))).json()) as Json
		await create({ ...draft('notice'), language: 'en_US' })

		await call(`/v23.0/${waba}/message_templates?name=notice&hsm_id=${pt.id}`, {
			method: 'DELETE',
		})
		expect(store.getTemplate('notice', 'pt_BR')).toBeUndefined()
		expect(store.getTemplate('notice', 'en_US')).toBeDefined()

		const all = await call(`/v23.0/${waba}/message_templates?name=notice`, {
			method: 'DELETE',
		})
		expect(((await all.json()) as Json).success).toBe(true)
		expect(store.getTemplate('notice', 'en_US')).toBeUndefined()

		const none = await call(`/v23.0/${waba}/message_templates?name=notice`, {
			method: 'DELETE',
		})
		expect(none.status).toBe(400)
	})

	test('lists with the filters and the paging of Meta', async () => {
		await create(draft('one'))
		await create(draft('two'), { 'X-Mock-Template-Review-Delay': '60000' })
		await vi.waitFor(async () => {
			expect((await statusOf('one')).status).toBe('APPROVED')
		})

		const pending = (await (
			await call(`/v23.0/${waba}/message_templates?status=PENDING`)
		).json()) as Json
		expect(pending.data.map((t: Json) => t.name)).toEqual(['two'])

		const page = (await (
			await call(`/v23.0/${waba}/message_templates?limit=1`)
		).json()) as Json
		expect(page.data).toHaveLength(1)
		expect(page.paging.next).toContain('after=')
	})

	test('a template in review when the mock stops resumes its review', async () => {
		await writeFile(
			join(dir, 'resumed_pt_BR.json'),
			JSON.stringify({
				...draft('resumed'),
				status: 'PENDING',
				review: { event: 'APPROVED', delayMs: 0 },
			})
		)
		const restarted = new TemplateStore(dir, undefined, db)
		await restarted.initialize()
		const { resumeReviews } = await import('../template-review.ts')
		resumeReviews(restarted)
		await vi.waitFor(() => {
			expect(restarted.getTemplate('resumed', 'pt_BR')?.status).toBe('APPROVED')
		})
		await restarted.cleanup()
	})
})

describe('The webhook override of a number', () => {
	let app: ReturnType<typeof createApp>['app']
	const realFetch = globalThis.fetch
	let answer: (url: URL) => Response

	const post = (body: Json, headers: Record<string, string> = {}) =>
		app.request(`${base}/v23.0/${phone}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test',
				...headers,
			},
			body: JSON.stringify(body),
		})

	const configuration = async () =>
		(
			(await (
				await app.request(
					`${base}/v23.0/${phone}?fields=webhook_configuration`,
					{
						headers: { Authorization: 'Bearer test' },
					}
				)
			).json()) as Json
		).webhook_configuration

	beforeEach(() => {
		app = createApp(new TemplateStore(tmpdir())).app
		delete process.env.WEBHOOK_URL
		clearWebhookOverrides()
		resetWebhookConfig()
		answer = (url) => new Response(url.searchParams.get('hub.challenge') ?? '')
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = String(input instanceof Request ? input.url : input)
			if (url.startsWith('http://app.test/')) return answer(new URL(url))
			return realFetch(input, init)
		})
	})

	afterEach(() => vi.restoreAllMocks())

	test('is verified with the challenge, then used', async () => {
		const res = await post({
			webhook_configuration: {
				override_callback_uri: 'http://app.test/hooks/meta',
				verify_token: 'segredo',
			},
		})
		expect(((await res.json()) as Json).success).toBe(true)
		expect(await configuration()).toEqual({
			phone_number: 'http://app.test/hooks/meta',
		})
	})

	test('is refused when the callback does not echo the challenge', async () => {
		answer = () => new Response('nope', { status: 403 })
		const res = await post({
			webhook_configuration: { override_callback_uri: 'http://app.test/x' },
		})
		expect(res.status).toBe(400)
		expect(((await res.json()) as Json).error.code).toBe(2200)
		expect(await configuration()).toEqual({})
	})

	test('skips the verification when the mock header asks', async () => {
		answer = () => new Response('nope', { status: 500 })
		const res = await post(
			{ webhook_configuration: { override_callback_uri: 'http://app.test/y' } },
			{ 'X-Mock-Skip-Callback-Verification': 'true' }
		)
		expect(res.status).toBe(200)
		expect((await configuration()).phone_number).toBe('http://app.test/y')
	})

	test('an empty address removes the override', async () => {
		await post(
			{ webhook_configuration: { override_callback_uri: 'http://app.test/z' } },
			{ 'X-Mock-Skip-Callback-Verification': 'true' }
		)
		await post({ webhook_configuration: { override_callback_uri: '' } })
		expect(await configuration()).toEqual({})
	})
})
