/**
 * The contract with Meta: every call of the specification, as Meta's own
 * examples write it, is answered by the mock with a body that follows Meta's
 * response schema. A new version passes the same test against its own spec.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { answerPermission } from '../server/calls.ts'
import { resetWebhookConfig, setWebhookUrl } from '../server/config.ts'
import { createApp, graphSpecs } from '../server/server.ts'
import { accountStore } from '../server/store/account-store.ts'
import { mockStore } from '../server/store/mock-store.ts'
import { TemplateStore } from '../server/store/template-store.ts'
import { KIND_OF_PARAMETER, MOCK_IDS, SAMPLE_IDS } from './nodes.ts'
import type { Operation } from './spec.ts'

const phone = '5511400000000'
/** The number the deregister example takes off the Cloud API. */
const doomedPhone = '5511400000099'
/** The user Meta's Connect Call example calls. */
const callee = '14085551234'

/** The template of a send example, as far as the seed reads it. */
interface ExampleTemplate {
	name: string
	language: { code: string }
	components?: Array<{ type: string; parameters?: Array<{ type: string }> }>
}

describe.each([...graphSpecs().keys()])('Cloud API %s', (version) => {
	const spec = graphSpecs().get(version)
	if (!spec) throw new Error(`no spec for ${version}`)
	let dir: string
	let app: ReturnType<typeof createApp>['app']
	let templateId = ''
	/** Two uploads: one the delete removes, one every other call reads. */
	let mediaId = ''
	let doomedMediaId = ''

	/** A real id of the kind each path parameter asks for. */
	const idFor = (parameter: string, operation: Operation): string => {
		const kind = KIND_OF_PARAMETER[parameter]
		if (kind === 'phone') {
			return operation.operationId === 'deregisterPhoneNumber'
				? doomedPhone
				: phone
		}
		if (kind === 'template') return templateId
		if (kind === 'media') {
			return operation.operationId === 'deleteMedia' ? doomedMediaId : mediaId
		}
		return (MOCK_IDS as Record<string, string>)[kind] ?? SAMPLE_IDS[kind] ?? '1'
	}

	const pathOf = (operation: Operation) =>
		`/${version}/${operation.segments
			.map((s) => (s.startsWith('{') ? idFor(s.slice(1, -1), operation) : s))
			.join('/')}`

	/** The short types of Meta's curl examples (`type=ogg`), as media types. */
	const CURL_TYPES: Record<string, string> = {
		ogg: 'audio/ogg',
		webp: 'image/webp',
	}

	/**
	 * Meta writes an upload in curl's `-F` notation (`"file": "@/path;type=…"`);
	 * the call is multipart, so the example becomes the form curl would send.
	 */
	const curlForm = (object: Record<string, unknown>): FormData | null => {
		const file = object.file
		if (typeof file !== 'string' || !file.startsWith('@')) return null
		const [path, ...options] = file.slice(1).split(';')
		const declared = options.find((o) => o.startsWith('type='))?.slice(5) ?? ''
		const type = CURL_TYPES[declared] ?? declared
		const form = new FormData()
		for (const [key, value] of Object.entries(object)) {
			if (key !== 'file') form.set(key, String(value))
		}
		form.set('type', type)
		form.set(
			'file',
			new File([new Uint8Array([1, 2, 3])], path.split('/').pop() ?? 'file', {
				type,
			})
		)
		return form
	}

	const upload = async () => {
		const form = new FormData()
		form.set('messaging_product', 'whatsapp')
		form.set(
			'file',
			new File([new Uint8Array([137, 80, 78, 71])], 'seed.png', {
				type: 'image/png',
			})
		)
		const res = await app.request(`/${version}/${phone}/media`, {
			method: 'POST',
			headers: { Authorization: 'Bearer contract' },
			body: form,
		})
		return ((await res.json()) as { id: string }).id
	}

	const queryOf = (operation: Operation) => {
		const query = new URLSearchParams()
		for (const parameter of operation.query) {
			if (parameter.required)
				query.set(parameter.name, String(parameter.example ?? 'x'))
		}
		const text = query.toString()
		return text ? `?${text}` : ''
	}

	/** A message the user sent, for the receipts of the examples to point at. */
	let inboundId = ''

	/**
	 * The templates the send examples use, approved in the library, shaped by
	 * the call: as many body and header variables as the call fills.
	 */
	const seedTemplatesOfExamples = async (store: TemplateStore) => {
		const send = spec.operations.find((o) => o.operationId === 'sendMessage')
		for (const example of send?.requestExamples ?? []) {
			const template = (example.value as { template?: ExampleTemplate })
				.template
			if (!template) continue
			const parts = template.components ?? []
			const of = (type: string) =>
				parts.find((p) => String(p.type).toLowerCase() === type)?.parameters ??
				[]
			const vars = (n: number) =>
				Array.from({ length: n }, (_, i) => `{{${i + 1}}}`).join(' ')
			const header = of('header')
			const body = of('body').filter((p) =>
				['text', 'currency', 'date_time'].includes(p.type)
			)
			const media = header.find((p) => p.type !== 'text')
			await store.upsertTemplate({
				name: template.name,
				language: template.language.code,
				category: 'UTILITY',
				status: 'APPROVED',
				components: [
					...(media
						? [
								{
									type: 'HEADER' as const,
									format: String(media.type).toUpperCase() as 'IMAGE',
								},
							]
						: header.length
							? [
									{
										type: 'HEADER' as const,
										format: 'TEXT' as const,
										text: vars(header.length),
									},
								]
							: []),
					{ type: 'BODY' as const, text: `Body ${vars(body.length)}`.trim() },
				],
			})
		}
	}

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'whap-contract-'))
		const store = new TemplateStore(dir)
		const seeded = await store.upsertTemplate({
			name: 'contract_seed',
			language: 'en_US',
			category: 'MARKETING',
			status: 'APPROVED',
			components: [{ type: 'BODY', text: 'Hello {{1}}' }],
		})
		templateId = seeded.id ?? ''
		await seedTemplatesOfExamples(store)
		app = createApp(store).app
		delete process.env.WEBHOOK_URL
		resetWebhookConfig()
		mockStore.setResponseDelayMs(0)
		const inbound = await app.request(`/${version}/${phone}/messages`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer contract',
				'Content-Type': 'application/json',
				'X-Mock-From': '16505551234',
			},
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				type: 'text',
				text: { body: 'Hi' },
			}),
		})
		inboundId = ((await inbound.json()) as { messages: Array<{ id: string }> })
			.messages[0].id
		mediaId = await upload()
		doomedMediaId = await upload()
		// The calling examples call a user who allowed it, from a number with
		// calling on (an app hears its calls field).
		setWebhookUrl(phone, 'http://127.0.0.1:9/contract')
		accountStore.patch(phone, {
			calling: {
				status: 'enabled',
				call_icon_visibility: 'visible',
				callback_permission_status: 'disabled',
			},
		})
		answerPermission(phone, callee, 'accept', true, 'user_action')
	})

	/** A call a user just made, for the examples that act on a call_id. */
	const userCall = async () => {
		const offer = spec.operations
			.find((o) => o.operationId === 'manageCalls')
			?.requestExamples.find((e) => e.name === 'Connect Call')?.value as {
			session: { sdp: string }
		}
		const res = await app.request(`/${version}/${phone}/calls`, {
			method: 'POST',
			headers: {
				Authorization: 'Bearer contract',
				'Content-Type': 'application/json',
				'X-Mock-From': `1650${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
			},
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				action: 'connect',
				session: { sdp_type: 'offer', sdp: offer.session.sdp },
			}),
		})
		return ((await res.json()) as { calls: Array<{ id: string }> }).calls[0].id
	}

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	const cases = spec.operations.flatMap((operation) => {
		const broken = spec.brokenExamples[operation.operationId] ?? []
		const examples = operation.requestExamples.filter(
			(e) => !broken.includes(e.name)
		)
		return examples.length
			? examples.map((example) => ({
					operation,
					example: example.name,
					body: example.value,
				}))
			: [{ operation, example: '(no body)', body: undefined as unknown }]
	})

	test.each(
		cases.map((c) => [
			`${c.operation.method} ${c.operation.path} — ${c.example}`,
			c,
		])
	)('%s', async (_name, { operation, body }) => {
		// A template name is unique per language: each create gets its own.
		// A receipt points at a message the user really sent.
		const object =
			body && typeof body === 'object'
				? (body as Record<string, unknown>)
				: null
		// A code is checked against the one request_code sent.
		// A call action names a call a user really made.
		let sent =
			operation.operationId ===
				'createAuthenticationTemplateWOtpCopyCodeButton' && object
				? { ...object, name: `contract_${crypto.randomUUID().slice(0, 8)}` }
				: object && 'status' in object && 'message_id' in object
					? { ...object, message_id: inboundId }
					: body
		if (operation.operationId === 'verifyPhoneNumberCode' && object) {
			const requested = accountStore.requestCode(phone, 'SMS')
			sent = { ...object, code: requested.ok ? requested.code : '' }
		}
		if (
			operation.operationId === 'manageCalls' &&
			object &&
			object.action !== 'connect'
		) {
			sent = { ...object, call_id: await userCall() }
		}
		const form = object ? curlForm(object) : null
		const res = await app.request(`${pathOf(operation)}${queryOf(operation)}`, {
			method: operation.method,
			headers: {
				Authorization: 'Bearer contract',
				// A form sets its own multipart boundary.
				...(form ? {} : { 'Content-Type': 'application/json' }),
				// A webhook override is checked without a live callback.
				'X-Mock-Skip-Callback-Verification': 'true',
			},
			...(form
				? { body: form }
				: sent !== undefined
					? { body: JSON.stringify(sent) }
					: {}),
		})
		const answer = await res.json()
		expect(res.status, JSON.stringify(answer)).toBe(200)

		// Meta's own examples break its response schema in a few places: the
		// mock is held to the schema only where Meta's example is.
		const metaExampleFits = operation.responseExamples.every(
			(example) => spec.checkResponse(operation, example.value) === null
		)
		if (metaExampleFits) {
			expect(spec.checkResponse(operation, answer)).toBeNull()
		}
	})
})
