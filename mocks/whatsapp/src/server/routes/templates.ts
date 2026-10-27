/**
 * The message templates of a business account, as the Cloud API serves them.
 *
 * Create, list and delete are the calls Meta documents, with its bodies, its
 * answers and its errors; the edit is `POST /{template-id}` (`nodes.ts`). A
 * template really changes the library: it is written to `templates/`, born
 * PENDING, and reviewed after a while (`template-review.ts`). The verdict and
 * the wait are the `X-Mock-Template-Review*` headers (`mock-headers.ts`).
 */
import type { Context } from 'hono'
import { Hono } from 'hono'
import { graphError, invalidParameter } from '../graph-error.ts'
import { readReviewPlan } from '../mock-headers.ts'
import { statusOf, type TemplateStore } from '../store/template-store.ts'
import { cancelReview, submitForReview } from '../template-review.ts'
import type { Template, TemplateComponent } from '../types/api-types.ts'

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const
const NAME_PATTERN = /^[a-z0-9_]{1,512}$/
const BODY_LIMIT = 1024
const PAGE_LIMIT = 25

type Category = (typeof CATEGORIES)[number]

/** What a create call carries, as Meta reads it. */
interface TemplateRequest {
	name?: unknown
	language?: unknown
	category?: unknown
	components?: unknown
	parameter_format?: unknown
}

/** The examples Meta asks for, per placeholder, out of the components. */
function examplesOf(
	components: TemplateComponent[]
): Record<string, { description: string; example: string }> {
	const variables: Record<string, { description: string; example: string }> = {}
	const body = components.find((component) => component.type === 'BODY')
	const example = body?.example as
		| {
				body_text?: string[][]
				body_text_named_params?: Array<{ param_name: string; example: string }>
		  }
		| undefined
	example?.body_text?.[0]?.forEach((value, index) => {
		variables[String(index + 1)] = {
			description: `Parameter ${index + 1}`,
			example: String(value),
		}
	})
	for (const named of example?.body_text_named_params ?? []) {
		variables[named.param_name] = {
			description: named.param_name,
			example: String(named.example),
		}
	}
	return variables
}

/** The placeholders of a text, in order, without repeats. */
function placeholders(text: string): string[] {
	const found: string[] = []
	for (const match of text.matchAll(/\{\{([^}]+)\}\}/g)) {
		const name = match[1].trim()
		if (!found.includes(name)) found.push(name)
	}
	return found
}

/**
 * The components as Meta returns them: the body carries its examples. A
 * template written by hand keeps its examples in `variables`; they are put
 * back where Meta puts them.
 */
function graphComponents(template: Template): TemplateComponent[] {
	return template.components.map((component) => {
		if (component.type !== 'BODY' || component.example || !component.text) {
			return component
		}
		const names = placeholders(component.text)
		if (!names.length) return component
		const variables = template.variables ?? {}
		const positional = names.every((name) => /^\d+$/.test(name))
		return {
			...component,
			example: positional
				? { body_text: [names.map((n) => variables[n]?.example ?? '')] }
				: {
						body_text_named_params: names.map((n) => ({
							param_name: n,
							example: variables[n]?.example ?? '',
						})),
					},
		}
	})
}

/** A template as the Graph API returns it. */
export function toGraph(template: Template) {
	const status = statusOf(template)
	const names = placeholders(
		template.components.find((c) => c.type === 'BODY')?.text ?? ''
	)
	return {
		id: template.id,
		name: template.name,
		language: template.language ?? 'en',
		status,
		category: template.category ?? 'UTILITY',
		parameter_format: names.every((n) => /^\d+$/.test(n))
			? 'POSITIONAL'
			: 'NAMED',
		components: graphComponents(template),
		...(status === 'REJECTED'
			? { rejected_reason: template.review?.reason ?? 'INVALID_FORMAT' }
			: {}),
	}
}

async function readBody(c: Context): Promise<TemplateRequest | null> {
	try {
		const body = await c.req.json()
		return body && typeof body === 'object' ? (body as TemplateRequest) : null
	} catch {
		return null
	}
}

/**
 * Check the components of a create or an edit. Meta wants exactly one body,
 * with text, inside its length, and only the component types it knows.
 */
export function checkComponents(
	value: unknown,
	category?: unknown
): { ok: true; components: TemplateComponent[] } | { ok: false; why: string } {
	if (!Array.isArray(value) || value.length === 0) {
		return { ok: false, why: 'components is required and cannot be empty.' }
	}
	const components: TemplateComponent[] = []
	for (const raw of value) {
		// The component types are the spec's (CAROUSEL, LIMITED_TIME_OFFER…):
		// the engine already checked them; the mock only normalises the case.
		const type = String((raw as { type?: unknown })?.type ?? '').toUpperCase()
		if (!type) return { ok: false, why: 'Every component needs a type.' }
		components.push({
			...(raw as TemplateComponent),
			type: type as TemplateComponent['type'],
		})
	}
	const bodies = components.filter((component) => component.type === 'BODY')
	if (bodies.length !== 1) {
		return { ok: false, why: 'A template needs exactly one BODY.' }
	}
	// An authentication body has no text: Meta writes it (the code and the
	// security recommendation). Every other body carries its text.
	if (category !== 'AUTHENTICATION' && !bodies[0].text?.trim()) {
		return { ok: false, why: 'The BODY of the template needs a text.' }
	}
	if ((bodies[0].text ?? '').length > BODY_LIMIT) {
		return {
			ok: false,
			why: `The BODY text is longer than ${BODY_LIMIT} characters.`,
		}
	}
	return { ok: true, components }
}

export function isCategory(value: unknown): value is Category {
	return (
		typeof value === 'string' &&
		(CATEGORIES as readonly string[]).includes(value)
	)
}

export function createTemplatesRouter(templateStore: TemplateStore) {
	const templatesRouter = new Hono()

	// GET /{version}/{waba-id}/message_templates — the library, filtered and paged.
	templatesRouter.get('/:wabaId/message_templates', (c) => {
		const name = c.req.query('name')?.trim().toLowerCase()
		const status = c.req.query('status')?.trim().toUpperCase()
		const language = c.req.query('language')?.trim()
		const category = c.req.query('category')?.trim().toUpperCase()
		const limit = Math.min(
			Math.max(Number(c.req.query('limit')) || PAGE_LIMIT, 1),
			100
		)
		const offset = Math.max(
			Number(Buffer.from(c.req.query('after') ?? '', 'base64url').toString()) ||
				0,
			0
		)

		const matches = templateStore
			.getAllTemplates()
			.filter((t) => !name || t.name.includes(name))
			.filter((t) => !status || statusOf(t) === status)
			.filter((t) => !language || t.language === language)
			.filter((t) => !category || t.category === category)
			.sort((a, b) => a.name.localeCompare(b.name))

		const page = matches.slice(offset, offset + limit)
		const cursor = (at: number) => Buffer.from(String(at)).toString('base64url')
		const next = offset + limit < matches.length ? cursor(offset + limit) : null

		return c.json({
			data: page.map(toGraph),
			paging: {
				cursors: {
					before: cursor(offset),
					after: cursor(offset + page.length),
				},
				...(next
					? {
							next: `${new URL(c.req.url).pathname}?limit=${limit}&after=${next}`,
						}
					: {}),
			},
		})
	})

	// POST /{version}/{waba-id}/message_templates — submit a template to the review.
	templatesRouter.post('/:wabaId/message_templates', async (c) => {
		const { wabaId } = c.req.param()
		const body = await readBody(c)
		if (!body) return invalidParameter(c, 'The request body is not valid JSON.')

		const name = typeof body.name === 'string' ? body.name.trim() : ''
		if (!NAME_PATTERN.test(name)) {
			return invalidParameter(
				c,
				'The template name can only have lowercase letters, numbers and underscores.'
			)
		}
		const language =
			typeof body.language === 'string' ? body.language.trim() : ''
		if (!language) return invalidParameter(c, 'language is required.')
		if (!isCategory(body.category)) {
			return invalidParameter(
				c,
				'category must be MARKETING, UTILITY or AUTHENTICATION.'
			)
		}
		const checked = checkComponents(body.components, body.category)
		if (!checked.ok) return invalidParameter(c, checked.why)

		if (templateStore.getTemplate(name, language)) {
			return graphError(c, {
				message: '(#100) Invalid parameter',
				code: 100,
				subcode: 2388024,
				userTitle: 'Content in this language already exists',
				userMessage: `There is already ${language} content for the template ${name}.`,
			})
		}

		try {
			const saved = await submitForReview(
				templateStore,
				{
					name,
					language,
					category: body.category,
					components: checked.components,
					wabaId,
					variables: examplesOf(checked.components),
				},
				readReviewPlan((header) => c.req.header(header))
			)
			return c.json({
				id: saved.id,
				status: statusOf(saved),
				category: saved.category,
			})
		} catch (error) {
			return invalidParameter(
				c,
				error instanceof Error ? error.message : String(error)
			)
		}
	})

	// DELETE /{version}/{waba-id}/message_templates?name=…[&hsm_id=…]
	templatesRouter.delete('/:wabaId/message_templates', async (c) => {
		const name = c.req.query('name')?.trim()
		const hsmId = c.req.query('hsm_id')?.trim()
		if (!name) return invalidParameter(c, 'name is required.')

		const doomed = templateStore
			.getAllTemplates()
			.filter((t) => t.name === name && (!hsmId || t.id === hsmId))
		if (!doomed.length) {
			return graphError(c, {
				message: '(#100) Invalid parameter',
				code: 100,
				subcode: 2593002,
				userTitle: 'Message template not found',
				userMessage: `There is no template named ${name}${hsmId ? ` with id ${hsmId}` : ''}.`,
			})
		}

		try {
			for (const template of doomed) {
				cancelReview(template)
				await templateStore.removeTemplate(template.name, template.language)
			}
			return c.json({ success: true })
		} catch (error) {
			return invalidParameter(
				c,
				error instanceof Error ? error.message : String(error)
			)
		}
	})

	return templatesRouter
}
