/**
 * The Graph API front door: every `/{version}/…` call goes through here.
 *
 * 1. The version must be one the mock has a specification for.
 * 2. The call needs an access token, like Meta (any bearer is accepted).
 * 3. The path is matched to an operation of the spec; an `{id}` segment is
 *    told apart by what the id is (nodes.ts), the way Meta resolves nodes.
 * 4. The body is checked against the operation's schema (with the errata).
 * 5. The operation runs: with state when the mock simulates it (messages,
 *    templates, numbers…), otherwise with the answer of Meta's own example.
 */
import type { Context, Hono } from 'hono'
import { graphError } from '../server/graph-error.ts'
import { MOCK_HEADERS } from '../server/mock-headers.ts'
import { KIND_OF_PARAMETER, type NodeRegistry } from './nodes.ts'
import type { GraphSpec, Operation } from './spec.ts'

type Json = Record<string, unknown>

export interface Match {
	operation: Operation
	params: Record<string, string>
}

/** The calls the mock answers on a version path that Meta's spec does not list. */
const EXTENSIONS: Array<{ method: string; segments: string[] }> = [
	// The conversations of a number, both sides (the panel and the tests read it).
	{ method: 'GET', segments: ['*', 'messages'] },
]

/** The kind of object a collection creates, so its id resolves afterwards. */
const CREATED_KIND: Record<string, string> = {
	flows: 'flow',
	message_qrdls: 'qr-code',
	groups: 'group',
	phone_numbers: 'phone',
	schedules: 'schedule',
	whatsapp_business_solution: 'solution',
	obo_mobility_intent: 'obo-intent',
}

const isParameter = (segment: string) =>
	segment.startsWith('{') && segment.endsWith('}')
const nameOf = (segment: string) => segment.slice(1, -1)

/**
 * The operation a call means. Literal segments must match; an id must not be
 * of another kind than the parameter names. Among the operations left, the
 * one whose ids the mock recognises wins; an unknown id is taken as a phone
 * number, the node most calls address.
 */
export function matchOperation(
	operations: Operation[],
	method: string,
	segments: string[],
	nodes: NodeRegistry
): Match | null {
	let best: { match: Match; score: number } | null = null
	for (const operation of operations) {
		if (
			operation.method !== method ||
			operation.segments.length !== segments.length
		)
			continue
		let score = 0
		let fits = true
		const params: Record<string, string> = {}
		operation.segments.forEach((segment, index) => {
			if (!fits) return
			const actual = segments[index]
			if (!isParameter(segment)) {
				fits = segment === actual
				score += 100
				return
			}
			const name = nameOf(segment)
			params[name] = actual
			const wanted = KIND_OF_PARAMETER[name]
			const kind = nodes.kindOf(actual)
			if (kind && wanted && kind !== wanted) {
				fits = false
				return
			}
			if (kind && kind === wanted) score += 10
			else if (wanted === 'phone') score += 1
		})
		if (!fits) continue
		if (!best || score > best.score)
			best = { match: { operation, params }, score }
	}
	return best?.match ?? null
}

function isExtension(method: string, segments: string[]): boolean {
	return EXTENSIONS.some(
		(extension) =>
			extension.method === method &&
			extension.segments.length === segments.length &&
			extension.segments.every((s, i) => s === '*' || s === segments[i])
	)
}

/** A placeholder of Meta's examples (`<FLOW_ID>`, `{{Flow-ID}}`) becomes a real id. */
function freshId(): string {
	return `1${String(Math.floor(Math.random() * 1e15)).padStart(15, '0')}`
}

function realise(value: unknown, created: string[]): unknown {
	if (Array.isArray(value)) return value.map((v) => realise(v, created))
	if (!value || typeof value !== 'object') return value
	return Object.fromEntries(
		Object.entries(value).map(([key, inner]) => {
			if (
				key === 'id' &&
				typeof inner === 'string' &&
				/^(<.*>|\{\{.*\}\})$/.test(inner)
			) {
				const id = freshId()
				created.push(id)
				return [key, id]
			}
			if (key === 'id' && typeof inner === 'string') created.push(inner)
			return [key, realise(inner, created)]
		})
	)
}

/**
 * The answer of an operation the mock does not simulate: Meta's example for
 * the same call when the body is one of the spec's examples, the first
 * example otherwise; a body shaped by the response schema when Meta gives no
 * example. The ids it hands out resolve from then on.
 */
export function exampleAnswer(
	spec: GraphSpec,
	operation: Operation,
	body: unknown,
	nodes: NodeRegistry
): unknown {
	const sent = JSON.stringify(body ?? null)
	const requestName = operation.requestExamples.find(
		(example) => JSON.stringify(example.value) === sent
	)?.name
	const example =
		operation.responseExamples.find((e) => e.name === requestName) ??
		operation.responseExamples[0]

	const created: string[] = []
	const answer = realise(
		example
			? example.value
			: (spec.sampleResponse(operation) ?? { success: true }),
		created
	)
	const collection = operation.segments[operation.segments.length - 1]
	const kind =
		operation.method === 'POST' ? CREATED_KIND[collection] : undefined
	if (kind) for (const id of created) nodes.remember(id, kind)
	return answer
}

/** The access token of the call: the bearer header or the `access_token` query. */
function hasToken(c: Context): 'ok' | 'missing' | 'malformed' {
	const header = c.req.header('authorization')
	if (header) return /^Bearer\s+\S+/i.test(header) ? 'ok' : 'malformed'
	return c.req.query('access_token') ? 'ok' : 'missing'
}

async function readBody(c: Context): Promise<unknown> {
	if (c.req.method === 'GET' || c.req.method === 'DELETE') return undefined
	const type = c.req.header('content-type') ?? ''
	const text = await c.req.raw.clone().text()
	// A POST without a body is an action (deregister, publish…): nothing to check.
	if (!text.trim()) return undefined
	if (type.includes('application/x-www-form-urlencoded')) {
		return Object.fromEntries(new URLSearchParams(text))
	}
	if (!type.includes('application/json')) return undefined
	try {
		return JSON.parse(text)
	} catch {
		return Symbol.for('invalid-json')
	}
}

export interface EngineOptions {
	specs: Map<string, GraphSpec>
	nodes: NodeRegistry
	/** The operations the mock simulates with state, per version. */
	stateful: (version: string) => Set<string>
	/** The Hono app that holds the simulated operations, mounted at the version path. */
	simulation: Hono
}

export function graphEngine(options: EngineOptions) {
	return async (c: Context) => {
		const [, version, ...segments] = c.req.path.split('/')
		const spec = options.specs.get(version)
		if (!spec) {
			return graphError(c, {
				message: `(#2500) Unknown path components: /${version}. This mock serves ${[...options.specs.keys()].join(', ')}.`,
				code: 2500,
			})
		}

		const token = hasToken(c)
		if (token === 'missing') {
			return graphError(c, {
				message:
					'An active access token must be used to query information about the current user.',
				code: 2500,
			})
		}
		if (token === 'malformed') {
			return c.json(
				{
					error: {
						message: 'Invalid OAuth access token - Cannot parse access token',
						type: 'OAuthException',
						code: 190,
						fbtrace_id: crypto.randomUUID().replaceAll('-', '').slice(0, 23),
					},
				},
				401
			)
		}

		const method = c.req.method.toUpperCase()
		const match = matchOperation(
			spec.operations,
			method,
			segments,
			options.nodes
		)
		if (!match) {
			if (isExtension(method, segments))
				return options.simulation.fetch(c.req.raw)
			return graphError(c, {
				message: `(#100) Unsupported ${method.toLowerCase()} request: /${segments.join('/')} is not an operation of the WhatsApp Cloud API ${version}.`,
				code: 100,
				subcode: 33,
			})
		}

		const { operation } = match
		for (const parameter of operation.query) {
			if (parameter.required && c.req.query(parameter.name) === undefined) {
				return graphError(c, {
					message: `(#100) The parameter ${parameter.name} is required`,
					code: 100,
				})
			}
		}

		const body = await readBody(c)
		if (body === Symbol.for('invalid-json')) {
			return graphError(c, {
				message: '(#100) Invalid JSON for postcard',
				code: 100,
			})
		}
		// The user's phone (X-Mock-From) and the receipts (`status` bodies) are
		// not messages the clinic composes: they are not checked as one.
		const userSide = !!c.req.header(MOCK_HEADERS.from)
		const receipt =
			!!body && typeof body === 'object' && 'status' in (body as Json)
		if (
			body !== undefined &&
			!userSide &&
			!(operation.operationId === 'sendMessage' && receipt)
		) {
			const problem = spec.checkRequest(operation, body)
			if (problem) {
				return graphError(c, {
					message: `(#100) Invalid parameter: ${problem}`,
					code: 100,
					userTitle: 'Invalid parameter',
					userMessage: problem,
				})
			}
		}

		if (options.stateful(version).has(operation.operationId)) {
			return options.simulation.fetch(c.req.raw)
		}
		return c.json(exampleAnswer(spec, operation, body, options.nodes) as Json)
	}
}
