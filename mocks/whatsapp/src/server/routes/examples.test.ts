import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { resetWebhookConfig } from '../config.ts'
import { createApp } from '../server.ts'
import { openDatabase } from '../store/database.ts'
import { TemplateStore } from '../store/template-store.ts'

const base = 'http://localhost:3010'
const phone = '5511933333333'
const user = '5511944444444'
const templatesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../templates'
)

// biome-ignore lint/suspicious/noExplicitAny: the tests read Graph answers of any shape
type Json = Record<string, any>

describe('The example templates (templates/examples)', () => {
	let store: TemplateStore
	let app: ReturnType<typeof createApp>['app']

	const call = (path: string, body?: unknown) =>
		app.request(`${base}${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test',
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		})

	beforeAll(async () => {
		store = new TemplateStore(templatesDir, undefined, openDatabase(':memory:'))
		await store.initialize()
		app = createApp(store).app
		delete process.env.WEBHOOK_URL
		resetWebhookConfig()
	})

	afterAll(async () => {
		await store.cleanup()
	})

	test('every file of the folder is in the library, listed apart as an example', async () => {
		const files = (await readdir(join(templatesDir, 'examples'))).filter(
			(file) => file.endsWith('.json')
		)
		const res = await call('/settings/examples')
		const { data } = (await res.json()) as Json

		expect(data).toHaveLength(files.length)
		expect(data).toContainEqual({
			name: 'example_treatments_showcase',
			language: 'pt_BR',
		})
		// The application's own seeds are not examples.
		expect(data.map((e: Json) => e.name)).not.toContain('order_confirmation')
		for (const example of data) {
			expect(store.getTemplate(example.name, example.language)).toBeDefined()
		}
	})

	test('the sample media of a header is served, and only from the media folder', async () => {
		const image = await call('/settings/examples/media/appointment.jpg')
		expect(image.status).toBe(200)
		expect(image.headers.get('content-type')).toBe('image/jpeg')

		const video = await call('/settings/examples/media/care.mp4')
		expect(video.headers.get('content-type')).toBe('video/mp4')

		expect((await call('/settings/examples/media/nada.jpg')).status).toBe(404)
		expect(
			(await call('/settings/examples/media/..%2Fexample_directions.json'))
				.status
		).toBe(404)
		expect(
			(await call('/settings/examples/media/example_directions.json')).status
		).toBe(404)
	})

	test('an example is sent like any template, and the panel sees its offer, image and code', async () => {
		const ends = Date.UTC(2026, 10, 30, 23, 0)
		const res = await call(`/v23.0/${phone}/messages`, {
			messaging_product: 'whatsapp',
			to: user,
			type: 'template',
			template: {
				name: 'example_flash_offer',
				language: { code: 'pt_BR' },
				components: [
					{
						type: 'header',
						parameters: [
							{
								type: 'image',
								image: {
									link: 'http://localhost:3010/settings/examples/media/whitening.jpg',
								},
							},
						],
					},
					{
						type: 'limited_time_offer',
						parameters: [
							{
								type: 'limited_time_offer',
								limited_time_offer: { expiration_time_ms: ends },
							},
						],
					},
					{ type: 'body', parameters: [{ type: 'text', text: 'Mariana' }] },
					{
						type: 'button',
						sub_type: 'copy_code',
						index: 0,
						parameters: [{ type: 'coupon_code', coupon_code: 'METADE50' }],
					},
					{
						type: 'button',
						sub_type: 'url',
						index: 1,
						parameters: [{ type: 'text', text: 'METADE50' }],
					},
				],
			},
		})
		expect(res.status).toBe(200)
		const { messages } = (await res.json()) as Json

		const list = (await (
			await call(`/v23.0/${phone}/messages?limit=50`)
		).json()) as Json
		const view = list.data.find((m: Json) => m.id === messages[0].id).template

		expect(view.offer).toEqual({
			text: 'Clareamento pela metade',
			expiresAt: ends,
		})
		expect(view.header.media.src).toContain('/whitening.jpg')
		expect(view.body).toContain('Mariana, só nesta semana')
		expect(view.buttons).toEqual([
			{ type: 'COPY_CODE', text: 'Copiar código', detail: 'METADE50' },
			{
				type: 'URL',
				text: 'Garantir a oferta',
				detail: 'https://clinica.exemplo/oferta?c=METADE50',
			},
		])
	})
})
