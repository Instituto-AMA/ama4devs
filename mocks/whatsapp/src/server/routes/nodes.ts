/**
 * The Graph API nodes the mock knows by id: a template and a phone number.
 *
 * Meta addresses both as `/{version}/{id}`:
 * - a template id reads the template (`GET`) or edits it (`POST`), and the
 *   edit goes back to the review like on Meta;
 * - a phone number id reads the number (`GET`, `?fields=webhook_configuration`
 *   included) or sets its webhook override (`POST` with
 *   `webhook_configuration.override_callback_uri`). Meta calls the new address
 *   with `hub.mode=subscribe` and a challenge before it accepts it; the mock
 *   does the same, unless `X-Mock-Skip-Callback-Verification: true`.
 */
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
	getWebhookOverride,
	getWebhookUrl,
	removeWebhookUrl,
	setWebhookUrl,
} from '../config.ts'
import { graphError, invalidParameter } from '../graph-error.ts'
import {
	MOCK_HEADERS,
	readReviewPlan,
	skipsCallbackVerification,
} from '../mock-headers.ts'
import {
	accountStore,
	type PhoneNumber,
	type Waba,
} from '../store/account-store.ts'
import { statusOf, type TemplateStore } from '../store/template-store.ts'
import { submitForReview } from '../template-review.ts'
import { redactUrl, rewriteLoopback } from '../webhook-target.ts'
import { checkComponents, isCategory, toGraph } from './templates.ts'

/** How long Meta waits for the callback to answer the verification. */
const VERIFY_TIMEOUT_MS = 5000

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
	try {
		const body = await c.req.json()
		return body && typeof body === 'object'
			? (body as Record<string, unknown>)
			: null
	} catch {
		return null
	}
}

/**
 * Call the callback the way Meta does before it accepts it: a GET with the
 * challenge, answered with the challenge itself.
 */
export async function verifyCallback(
	url: string,
	verifyToken: string
): Promise<{ ok: true } | { ok: false; why: string }> {
	const challenge = String(Math.floor(Math.random() * 1_000_000_000))
	let target: URL
	try {
		target = new URL(rewriteLoopback(url))
	} catch {
		return { ok: false, why: 'The callback URL is not a valid URL.' }
	}
	target.searchParams.set('hub.mode', 'subscribe')
	target.searchParams.set('hub.challenge', challenge)
	target.searchParams.set('hub.verify_token', verifyToken)
	try {
		const res = await fetch(target, {
			signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
		})
		const text = (await res.text()).trim()
		if (res.ok && text === challenge) return { ok: true }
		return {
			ok: false,
			why: `The URL answered HTTP ${res.status} without echoing the challenge.`,
		}
	} catch (error) {
		return {
			ok: false,
			why: `The URL could not be reached: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/** The fields Meta returns when the call does not ask for any. */
const DEFAULT_FIELDS = [
	'display_phone_number',
	'verified_name',
	'quality_rating',
]

/** Forget the numbers and accounts, then boot them again (tests). */
export function resetPhoneState(): void {
	accountStore.clear()
	accountStore.seed()
}

/**
 * A number as the Graph API reads it: what Meta keeps of it (the account,
 * the verification, the registration, what `POST /{phone-number-id}` said).
 */
export function phoneFields(number: PhoneNumber): Record<string, unknown> {
	return {
		display_phone_number: number.display_phone_number,
		verified_name:
			(number.new_display_name as string | undefined) ?? number.verified_name,
		quality_rating: number.quality_rating,
		name_status: number.new_display_name ? 'PENDING_REVIEW' : 'APPROVED',
		code_verification_status: number.code_verification_status,
		platform_type: number.platform_type,
		throughput: { level: 'STANDARD' },
		status: (number.connection_status as string | undefined) ?? number.status,
		...(number.username ? { username: number.username } : {}),
		...(number.search_visibility
			? { search_visibility: number.search_visibility }
			: {}),
	}
}

/** A WABA as the Graph API reads it. */
export function wabaNode(waba: Waba): Record<string, unknown> {
	return {
		id: waba.id,
		name: waba.name,
		currency: waba.currency,
		timezone_id: waba.timezone_id,
		message_template_namespace: waba.message_template_namespace,
		account_review_status: 'APPROVED',
		business_verification_status: 'VERIFIED',
		ownership_type: 'SELF_OWNED',
		country: 'BR',
	}
}

function phoneNode(c: Context, id: string) {
	const asked = (c.req.query('fields') ?? '')
		.split(',')
		.map((field) => field.trim())
		.filter(Boolean)
	const fields = asked.length ? asked : DEFAULT_FIELDS
	const known = phoneFields(accountStore.ensure(id))
	const node: Record<string, unknown> = { id }
	for (const field of fields) {
		if (field in known) node[field] = known[field]
	}
	if (fields.includes('webhook_configuration')) {
		const override = getWebhookOverride(id)
		const application = getWebhookUrl()
		node.webhook_configuration = {
			...(override ? { phone_number: override } : {}),
			...(application ? { application } : {}),
		}
	}
	return c.json(node)
}

export function createNodesRouter(templateStore: TemplateStore) {
	const nodes = new Hono()

	// The engine (graph/engine.ts) already told the template from the number.
	nodes.get('/:id', (c) => {
		const { id } = c.req.param()
		const template = templateStore.getTemplateById(id)
		if (template) return c.json(toGraph(template))
		const waba = accountStore.waba(id)
		if (waba) return c.json(wabaNode(waba))
		return phoneNode(c, id)
	})

	nodes.post('/:id', async (c) => {
		const { id } = c.req.param()
		const body = await readJson(c)
		if (!body) return invalidParameter(c, 'The request body is not valid JSON.')

		const template = templateStore.getTemplateById(id)
		if (template) {
			if (statusOf(template) === 'PENDING') {
				return graphError(c, {
					message: '(#100) Invalid parameter',
					code: 100,
					subcode: 2388025,
					userTitle: 'Template is in review',
					userMessage:
						'A template can only be edited once its review has finished.',
				})
			}
			if (body.category !== undefined && !isCategory(body.category)) {
				return invalidParameter(
					c,
					'category must be MARKETING, UTILITY or AUTHENTICATION.'
				)
			}
			let components = template.components
			if (body.components !== undefined) {
				const checked = checkComponents(
					body.components,
					body.category ?? template.category
				)
				if (!checked.ok) return invalidParameter(c, checked.why)
				components = checked.components
			}
			await submitForReview(
				templateStore,
				{
					...template,
					components,
					...(isCategory(body.category) ? { category: body.category } : {}),
				},
				readReviewPlan((header) => c.req.header(header))
			)
			return c.json({ success: true })
		}

		const waba = accountStore.waba(id)
		if (waba) {
			// updateWhatsAppBusinessAccount: the name and what else the call says.
			accountStore.saveWaba({
				...waba,
				...body,
				id,
				business_id: waba.business_id,
			} as Waba)
			return c.json({ success: true })
		}

		// Everything but the webhook is kept as the number's state.
		const {
			webhook_configuration: _webhook,
			webhook_url: _url,
			...settings
		} = body
		accountStore.patch(id, settings)

		const configuration = body.webhook_configuration as
			| { override_callback_uri?: unknown; verify_token?: unknown }
			| undefined
		if (!configuration || typeof configuration !== 'object') {
			return c.json({ success: true })
		}
		const uri =
			typeof configuration.override_callback_uri === 'string'
				? configuration.override_callback_uri.trim()
				: ''
		if (!uri) {
			removeWebhookUrl(id)
			console.log(`🔗 Webhook override of ${id} removed`)
			return c.json({ success: true })
		}
		try {
			new URL(uri)
		} catch {
			return invalidParameter(c, 'override_callback_uri is not a valid URL.')
		}

		if (
			!skipsCallbackVerification(
				c.req.header(MOCK_HEADERS.skipCallbackVerification)
			)
		) {
			const token =
				typeof configuration.verify_token === 'string'
					? configuration.verify_token
					: ''
			const verified = await verifyCallback(uri, token)
			if (!verified.ok) {
				return graphError(c, {
					message: `(#2200) Callback verification failed with the following errors: ${verified.why}`,
					code: 2200,
				})
			}
		}

		setWebhookUrl(id, uri)
		console.log(`🔗 Webhook override of ${id}: ${redactUrl(uri)}`)
		return c.json({ success: true })
	})

	return nodes
}
