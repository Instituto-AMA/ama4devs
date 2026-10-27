/**
 * The Cloud API reference the panel shows, built from a version's spec.
 *
 * Every operation of the specification, grouped by Meta's topics, with Meta's
 * own summary, description and examples, a call ready to run against this
 * mock (its fixed ids in the path, the required query filled), whether the
 * mock runs it with state or answers Meta's example, and which optional
 * `X-Mock-*` headers it reads. A new Graph version gets its reference for free.
 */
import { MOCK_HEADERS } from '../server/mock-headers.ts'
import { KIND_OF_PARAMETER, MOCK_IDS, SAMPLE_IDS } from './nodes.ts'
import type { Example, GraphSpec, Operation } from './spec.ts'

export interface ReferenceOperation {
	id: string
	method: Operation['method']
	/** The path as Meta writes it: `/{Phone-Number-ID}/messages`. */
	path: string
	summary: string
	description: string
	/** The same path with this mock's ids and the required query: runs as is. */
	call: string
	query: Array<{ name: string; required: boolean; description: string }>
	/** Meta's request examples the API accepts, by name. */
	examples: Example[]
	/** Meta's answer to the first example (or the schema's shape when Meta has none). */
	response: unknown
	/** True when the mock runs the call with state; false when it answers Meta's example. */
	simulated: boolean
	/** The optional headers of the mock this call reads. */
	mockHeaders: string[]
}

export interface ReferenceTopic {
	name: string
	description: string
	operations: ReferenceOperation[]
}

export interface Reference {
	version: string
	topics: ReferenceTopic[]
}

/** The phone number id of the calls: any number answers, this one reads well. */
export const REFERENCE_PHONE = '1234567890'

/** The topics a clinic uses first; the others follow in the spec's order. */
const FIRST_TOPICS = [
	'Messages',
	'Templates',
	'Media',
	'Phone Numbers',
	'Phone Number Management',
	'Phone Number Registration',
	'Phone Number Verification',
	'WhatsApp Business Profile',
	'Settings',
	'Webhook Subscriptions',
	'Block Users',
	'Marketing Messages',
	'Flows',
	'Groups',
]

/** The optional `X-Mock-*` headers each simulated operation reads. */
const MOCK_HEADERS_OF: Record<string, string[]> = {
	sendMessage: [
		MOCK_HEADERS.from,
		MOCK_HEADERS.contactName,
		MOCK_HEADERS.messageStatus,
	],
	createAuthenticationTemplateWOtpCopyCodeButton: [
		MOCK_HEADERS.review,
		MOCK_HEADERS.reviewReason,
		MOCK_HEADERS.reviewDelay,
	],
	editTemplate: [
		MOCK_HEADERS.review,
		MOCK_HEADERS.reviewReason,
		MOCK_HEADERS.reviewDelay,
	],
	updatePhoneNumberStatus: [MOCK_HEADERS.skipCallbackVerification],
}

function idFor(parameter: string, templateId: string): string {
	const kind = KIND_OF_PARAMETER[parameter]
	if (kind === 'phone') return REFERENCE_PHONE
	if (kind === 'template') return templateId
	return (
		(MOCK_IDS as Record<string, string>)[kind] ??
		SAMPLE_IDS[kind] ??
		`{${parameter}}`
	)
}

function callOf(
	operation: Operation,
	version: string,
	templateId: string
): string {
	const path = operation.segments
		.map((s) => (s.startsWith('{') ? idFor(s.slice(1, -1), templateId) : s))
		.join('/')
	// A placeholder of Meta's (`<TEMPLATE_NAME>`) stays readable: it is the
	// part of the call the reader fills.
	const text = operation.query
		.filter((parameter) => parameter.required)
		.map((parameter) => {
			const value = String(parameter.example ?? '')
			return `${parameter.name}=${/^<[^>]+>$/.test(value) ? value : encodeURIComponent(value)}`
		})
		.join('&')
	return `/${version}/${path}${text ? `?${text}` : ''}`
}

/**
 * The reference of one version. `templateId` is a template of the library,
 * so the calls on `/{TEMPLATE_ID}` run as written.
 */
export function buildReference(
	spec: GraphSpec,
	stateful: Set<string>,
	templateId: string
): Reference {
	const byTag = new Map<string, ReferenceOperation[]>()
	for (const operation of spec.operations) {
		const broken = spec.brokenExamples[operation.operationId] ?? []
		const examples = operation.requestExamples.filter(
			(e) => !broken.includes(e.name)
		)
		const answer =
			operation.responseExamples.find((e) => e.name === examples[0]?.name) ??
			operation.responseExamples[0]
		const list = byTag.get(operation.tag) ?? []
		list.push({
			id: operation.operationId,
			method: operation.method,
			path: operation.path,
			summary: operation.summary,
			description: operation.description.trim(),
			call: callOf(operation, spec.version, templateId),
			query: operation.query.map((p) => ({
				name: p.name,
				required: p.required,
				description: String(p.description ?? '').trim(),
			})),
			examples,
			response: answer
				? answer.value
				: (spec.sampleResponse(operation) ?? null),
			simulated: stateful.has(operation.operationId),
			mockHeaders: MOCK_HEADERS_OF[operation.operationId] ?? [],
		})
		byTag.set(operation.tag, list)
	}

	const described = new Map(spec.tags.map((t) => [t.name, t.description]))
	const order = [
		...FIRST_TOPICS.filter((name) => byTag.has(name)),
		...spec.tags.map((t) => t.name).filter((n) => !FIRST_TOPICS.includes(n)),
		...[...byTag.keys()].filter(
			(n) => !FIRST_TOPICS.includes(n) && !described.has(n)
		),
	]
	return {
		version: spec.version,
		topics: [...new Set(order)]
			.filter((name) => byTag.has(name))
			.map((name) => ({
				name,
				description: described.get(name) ?? '',
				operations: byTag.get(name) ?? [],
			})),
	}
}
