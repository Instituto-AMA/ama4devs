import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetWebhookConfig, setWebhookUrl } from '../config.ts'
import { createApp } from '../server.ts'
import { mockStore } from '../store/mock-store.ts'
import { TemplateStore } from '../store/template-store.ts'

const base = 'http://localhost:3010'
const phone = '5511400000000'
const user = '5511922223333'
// biome-ignore lint/suspicious/noExplicitAny: the tests read Graph answers of any shape
type Json = Record<string, any>

describe('Media through the Cloud API', () => {
	let app: ReturnType<typeof createApp>['app']
	const realFetch = globalThis.fetch
	const delivered: Json[] = []
	const auth = { Authorization: 'Bearer test' }
	const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

	const upload = (
		bytes: Uint8Array<ArrayBuffer>,
		type: string,
		name = 'exame.png'
	) => {
		const form = new FormData()
		form.set('messaging_product', 'whatsapp')
		form.set('type', type)
		form.set('file', new File([bytes], name, { type }))
		return app.request(`${base}/v23.0/${phone}/media`, {
			method: 'POST',
			headers: auth,
			body: form,
		})
	}

	beforeEach(() => {
		app = createApp(new TemplateStore(tmpdir())).app
		mockStore.clear()
		mockStore.setResponseDelayMs(0)
		delete process.env.WEBHOOK_URL
		resetWebhookConfig()
		delivered.length = 0
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = String(input instanceof Request ? input.url : input)
			if (url.startsWith('http://app.test/')) {
				if ((init?.method ?? 'GET') === 'POST')
					delivered.push(JSON.parse(String(init?.body)))
				return new Response('ok')
			}
			return realFetch(input, init)
		})
	})

	afterEach(() => vi.restoreAllMocks())

	test('an upload is kept, described, downloaded with a token and deleted', async () => {
		const res = await upload(png, 'image/png')
		expect(res.status).toBe(200)
		const { id } = (await res.json()) as Json
		expect(id).toMatch(/^\d{16}$/)

		const described = (await (
			await app.request(`${base}/v23.0/${id}`, { headers: auth })
		).json()) as Json
		expect(described).toMatchObject({
			messaging_product: 'whatsapp',
			mime_type: 'image/png',
			sha256: createHash('sha256').update(png).digest('hex'),
			file_size: String(png.byteLength),
			id,
		})
		const url = new URL(described.url)
		expect(url.pathname).toBe('/whatsapp_business/attachments/')

		const anonymous = await app.request(`${base}${url.pathname}${url.search}`)
		expect(anonymous.status).toBe(401)
		const bytes = await app.request(`${base}${url.pathname}${url.search}`, {
			headers: auth,
		})
		expect(bytes.headers.get('content-type')).toBe('image/png')
		expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(png)

		const removed = await app.request(`${base}/v23.0/${id}`, {
			method: 'DELETE',
			headers: auth,
		})
		expect(await removed.json()).toEqual({ success: true })
		const gone = await app.request(`${base}/v23.0/${id}`, { headers: auth })
		expect(gone.status).toBe(400)
	})

	test('a type Meta does not take, or a file too big for its type, is refused', async () => {
		const exe = await upload(png, 'application/x-msdownload', 'virus.exe')
		expect(((await exe.json()) as Json).error.code).toBe(131053)
		const sticker = await upload(
			new Uint8Array(600 * 1024),
			'image/webp',
			'big.webp'
		)
		expect(((await sticker.json()) as Json).error.code).toBe(131053)
	})

	test("the user's media reaches the webhook with its type and hash, as Meta sends it", async () => {
		setWebhookUrl(phone, 'http://app.test/hooks/meta')
		const { id } = (await (await upload(png, 'image/png')).json()) as Json
		const sent = await app.request(`${base}/v23.0/${phone}/messages`, {
			method: 'POST',
			headers: {
				...auth,
				'Content-Type': 'application/json',
				'X-Mock-From': user,
			},
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				type: 'image',
				image: { id, caption: 'Meu exame' },
			}),
		})
		expect(sent.status).toBe(200)
		await vi.waitFor(() =>
			expect(delivered.some((p) => p.entry[0].changes[0].value.messages)).toBe(
				true
			)
		)
		const inbound = delivered.find((p) => p.entry[0].changes[0].value.messages)
		expect(inbound?.entry[0].changes[0].value.messages[0].image).toEqual({
			id,
			caption: 'Meu exame',
			mime_type: 'image/png',
			sha256: createHash('sha256').update(png).digest('hex'),
			filename: 'exame.png',
		})
	})

	test("the user's voice note reaches the webhook as Ogg Opus, with voice set", async () => {
		setWebhookUrl(phone, 'http://app.test/hooks/meta')
		const ogg = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0])
		const { id } = (await (
			await upload(ogg, 'audio/ogg', 'voz.ogg')
		).json()) as Json
		await app.request(`${base}/v23.0/${phone}/messages`, {
			method: 'POST',
			headers: {
				...auth,
				'Content-Type': 'application/json',
				'X-Mock-From': user,
			},
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				type: 'audio',
				audio: { id, voice: true },
			}),
		})
		await vi.waitFor(() =>
			expect(delivered.some((p) => p.entry[0].changes[0].value.messages)).toBe(
				true
			)
		)
		const inbound = delivered.find((p) => p.entry[0].changes[0].value.messages)
		expect(inbound?.entry[0].changes[0].value.messages[0].audio).toMatchObject({
			id,
			voice: true,
			mime_type: 'audio/ogg; codecs=opus',
		})
	})
})
