/**
 * The renderer of the templates: it says what is wrong with the call.
 *
 * The Cloud API refuses a template that does not exist, that is not approved,
 * or whose variables were not filled. The mock refuses the same calls and
 * says which one it was, so the application can be developed against the
 * failure and not only against the happy path.
 *
 * Like Meta, the variables are numbered per component: the header's {{1}}
 * and the body's {{1}} are two different values, filled by the parameters of
 * the `header` and of the `body` component of the call.
 */
import { statusOf, type TemplateStore } from './store/template-store.ts'
import type { Template, TemplateStatus } from './types/api-types.ts'

/** A parameter of a template, as the application sends it. */
export interface TemplateParameter {
	type: string
	/** The name of the variable. The Cloud API lets it out for the positional ones. */
	parameter_name?: string
	text?: string
	currency?: { fallback_value?: string; code?: string; amount_1000?: number }
	date_time?: { fallback_value?: string }
	image?: { id?: string; link?: string }
	video?: { id?: string; link?: string }
	document?: { id?: string; link?: string; filename?: string }
	location?: Record<string, unknown>
	coupon_code?: string
	payload?: string
}

/** The parameters of a call, per component. A bare list is the body's. */
export interface ComponentParameters {
	header?: TemplateParameter[]
	body?: TemplateParameter[]
}

/** What the renderer found wrong with the call. */
export interface TemplateRenderError {
	/** The message the application reads. */
	message: string
	/** The machine-readable reason. */
	details: string
	/** The code of the template errors, as the Cloud API numbers them. */
	subcode: number
	/** What the renderer knows about the call. */
	data: Record<string, unknown>
}

export type TemplateRenderResult =
	| { ok: true; template: Template }
	| { ok: false; error: TemplateRenderError }

/** The codes the Cloud API uses for the errors of a template. */
export const TEMPLATE_ERROR_CODES = {
	/** The template is not in the library, or not approved in that language. */
	notFound: 132001,
	/** The template is in review or was rejected: Meta knows no approved one. */
	notApproved: 132001,
	/** The template was paused for its quality. */
	paused: 132015,
	/** The template was disabled. */
	disabled: 132016,
	/** The variables of a component did not all arrive. */
	parameters: 132000,
	/** A media or location header was sent without its media, or with another kind. */
	headerFormat: 132012,
} as const

/** The code of the refusal of a template in each status. */
function refusalCode(status: TemplateStatus): number {
	if (status === 'PAUSED') return TEMPLATE_ERROR_CODES.paused
	if (status === 'DISABLED') return TEMPLATE_ERROR_CODES.disabled
	return TEMPLATE_ERROR_CODES.notApproved
}

/** What the mock tells the application when a template does not pass the review. */
export const REVIEW_DETAILS: Record<string, string> = {
	PENDING: 'Template in review',
	APPROVED: 'Template approved and ready for use',
	REJECTED: 'Template rejected',
	PAUSED: 'Template paused',
	DISABLED: 'Template disabled',
}

/** The placeholders a text asks for, in the order they appear. */
export function placeholdersOf(text: string): string[] {
	const found: string[] = []
	const regex = /\{\{([^}]+)\}\}/g
	let match = regex.exec(text)
	while (match) {
		const name = match[1].trim()
		if (name && !found.includes(name)) found.push(name)
		match = regex.exec(text)
	}
	return found
}

/** How many placeholders a text asks for, counting the repeats. */
function placeholderCount(text: string): number {
	return (text.match(/\{\{[^}]+\}\}/g) ?? []).length
}

/** The text a parameter puts in the message: Meta shows the fallback of a currency or a date. */
function textOf(parameter: TemplateParameter): string {
	return (
		parameter.text ??
		parameter.currency?.fallback_value ??
		parameter.date_time?.fallback_value ??
		''
	)
}

/**
 * The values of a component.
 *
 * A parameter that carries a name fills that variable. A parameter without a
 * name fills the next variable, the way the Cloud API reads a body of `{{1}}`.
 */
function valuesOf(parameters: TemplateParameter[]): Map<string, string> {
	const values = new Map<string, string>()
	parameters.forEach((parameter, index) => {
		const name = (parameter.parameter_name ?? '').trim() || String(index + 1)
		values.set(name, textOf(parameter))
	})
	return values
}

/** Only the text parameters fill placeholders; a media header parameter fills the media. */
const textual = (parameters: TemplateParameter[] = []) =>
	parameters.filter(
		(p) => p.type === 'text' || p.type === 'currency' || p.type === 'date_time'
	)

/**
 * Render a template for a call.
 *
 * The order of the checks is the order of the Cloud API: the template has to
 * exist, then to be approved, and only then its variables are read.
 */
export function renderTemplate(
	templateStore: TemplateStore,
	templateName: string,
	language: string,
	parameters: TemplateParameter[] | ComponentParameters
): TemplateRenderResult {
	const perComponent: ComponentParameters = Array.isArray(parameters)
		? { body: parameters }
		: parameters
	const template = templateStore.getTemplate(templateName, language)
	if (!template) {
		return {
			ok: false,
			error: {
				message: `Template "${templateName}" with language "${language}" not found`,
				details: 'TEMPLATE_NOT_FOUND',
				subcode: TEMPLATE_ERROR_CODES.notFound,
				data: { template_name: templateName, template_language: language },
			},
		}
	}

	const status = statusOf(template)
	if (status !== 'APPROVED') {
		const statusDetails = REVIEW_DETAILS[status] ?? 'Template not approved'
		const reason = template.review?.reason || statusDetails
		return {
			ok: false,
			error: {
				message: `Template '${templateName}' is not approved: ${reason}`,
				details: 'TEMPLATE_NOT_APPROVED',
				subcode: refusalCode(status),
				data: {
					template_name: templateName,
					template_language: language,
					review: status,
					reason,
					status_details: statusDetails,
				},
			},
		}
	}

	const filled: Record<'HEADER' | 'BODY', Map<string, string>> = {
		HEADER: valuesOf(textual(perComponent.header)),
		BODY: valuesOf(textual(perComponent.body)),
	}

	for (const part of ['HEADER', 'BODY'] as const) {
		const component = template.components.find((c) => c.type === part)
		const text =
			component?.format && component.format !== 'TEXT'
				? ''
				: (component?.text ?? '')
		const sent = textual(
			part === 'HEADER' ? perComponent.header : perComponent.body
		)
		const required = placeholdersOf(text)
		const expected = placeholderCount(text)
		const missing = required.filter((name) => !filled[part].has(name))
		const where = part === 'BODY' ? '' : ' in the header'
		if (missing.length > 0) {
			return {
				ok: false,
				error: {
					message: `Template '${templateName}' is missing ${missing.length} parameter(s)${where}: ${missing
						.map((name) => `{{${name}}}`)
						.join(
							', '
						)}. Send the value of every variable the ${part.toLowerCase()} asks for.`,
					details: 'MISSING_PARAMETERS',
					subcode: TEMPLATE_ERROR_CODES.parameters,
					data: {
						template_name: templateName,
						template_language: language,
						component: part.toLowerCase(),
						missing_parameters: missing,
						expected,
						got: sent.length,
					},
				},
			}
		}
		if (sent.length > expected) {
			return {
				ok: false,
				error: {
					message: `Template '${templateName}' expects ${expected} parameter(s)${where} and got ${sent.length}.`,
					details: 'PARAM_COUNT_MISMATCH',
					subcode: TEMPLATE_ERROR_CODES.parameters,
					data: {
						template_name: templateName,
						template_language: language,
						component: part.toLowerCase(),
						expected,
						got: sent.length,
					},
				},
			}
		}
	}

	// A media header is filled at every send: Meta wants the image, video or
	// document (or the location) as the header's parameter, of that format.
	const header = template.components.find((c) => c.type === 'HEADER')
	const format = String(header?.format ?? 'TEXT').toUpperCase()
	if (header && format !== 'TEXT') {
		const kind = format.toLowerCase()
		const given = (perComponent.header ?? []).find((p) => p.type === kind)
		if (!given) {
			return {
				ok: false,
				error: {
					message: `(#132012) Parameter format does not match format in the created template: header: Format mismatch, expected ${format}, received ${
						(perComponent.header ?? [])[0]?.type?.toUpperCase() ?? 'UNKNOWN'
					}`,
					details: 'HEADER_FORMAT_MISMATCH',
					subcode: TEMPLATE_ERROR_CODES.headerFormat,
					data: {
						template_name: templateName,
						template_language: language,
						component: 'header',
						expected: format,
					},
				},
			}
		}
	}

	const processedComponents = template.components.map((component) => {
		const values = component.type === 'HEADER' ? filled.HEADER : filled.BODY
		if (
			!component.text ||
			(component.type !== 'HEADER' && component.type !== 'BODY')
		) {
			return component
		}
		const processedText = component.text.replace(
			/\{\{([^}]+)\}\}/g,
			(match, name) => {
				const value = values.get(name.trim())
				return value === undefined ? match : value
			}
		)
		return { ...component, text: processedText }
	})

	return {
		ok: true,
		template: { ...template, components: processedComponents },
	}
}
