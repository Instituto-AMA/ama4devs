/**
 * The Cloud API as Meta publishes it, one OpenAPI file per Graph version.
 *
 * `spec/<version>/business-messaging-api.yaml` is Meta's own specification
 * (github.com/facebook/openapi, MIT). The mock reads it at start: every
 * operation it lists is a route, its request schema validates the call, and
 * its examples document the API in the panel and answer the operations the
 * mock does not simulate with state. A new Graph version is a new folder.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020, {
	type ErrorObject,
	type ValidateFunction,
} from 'ajv/dist/2020.js'

type Json = Record<string, unknown>

export interface Example {
	name: string
	value: unknown
}

export interface Parameter {
	name: string
	in: 'path' | 'query' | 'header'
	required: boolean
	description?: string
	example?: unknown
}

export interface Operation {
	/** Meta's id of the operation, the key of its handler. */
	operationId: string
	method: 'GET' | 'POST' | 'DELETE'
	/** The path as the spec writes it, without the version: `/{Phone-Number-ID}/messages`. */
	path: string
	/** The segments of the path; a `{Name}` segment is a parameter. */
	segments: string[]
	tag: string
	summary: string
	description: string
	query: Parameter[]
	requestExamples: Example[]
	responseExamples: Example[]
	hasRequestSchema: boolean
	hasResponseSchema: boolean
}

export interface GraphSpec {
	version: string
	title: string
	/** The topics of the spec, in its order, with Meta's description. */
	tags: Array<{ name: string; description: string }>
	operations: Operation[]
	/** Check a request body; null when it is valid or the spec has no schema. */
	checkRequest(operation: Operation, body: unknown): string | null
	/** The body with the defaults the API fills (a message without type is text). */
	withDefaults(operation: Operation, body: unknown): unknown
	/** Check a response body; null when it is valid or the spec has no schema. */
	checkResponse(operation: Operation, body: unknown): string | null
	/** Check a webhook payload against Meta's `WebhookPayload`. */
	checkWebhook(payload: unknown): string | null
	/**
	 * A body shaped by the response schema, for the operations Meta gives no
	 * example of: each property's example, else its first enum value, else a
	 * value of its type. Undefined when the spec has no response schema.
	 */
	sampleResponse(operation: Operation): unknown
	/** Examples of the spec that are not calls the API accepts, per operation. */
	brokenExamples: Record<string, string[]>
	/** Why each correction of the errata was made. */
	errata: Record<string, string>
}

const METHODS = ['get', 'post', 'delete'] as const

/** Bun's YAML parser; the pinned @types/bun predates its typing. */
const parseYaml = (text: string): unknown =>
	(Bun as unknown as { YAML: { parse(source: string): unknown } }).YAML.parse(
		text
	)

/** Where the specifications live: `spec/` beside the templates, or WHAP_SPEC_DIR. */
export function specDir(): string {
	return resolve(process.cwd(), process.env.WHAP_SPEC_DIR ?? 'spec')
}

function resolveRef(spec: Json, value: unknown): Json {
	const ref = (value as { $ref?: string } | undefined)?.$ref
	if (!ref) return (value ?? {}) as Json
	let node: unknown = spec
	for (const part of ref.replace(/^#\//, '').split('/')) {
		node = (node as Json)[part]
	}
	return (node ?? {}) as Json
}

function examplesOf(media: Json | undefined): Example[] {
	if (!media) return []
	const named = media.examples as Record<string, { value: unknown }> | undefined
	if (named) {
		return Object.entries(named).map(([name, example]) => ({
			name,
			value: example.value,
		}))
	}
	return media.example !== undefined
		? [{ name: 'Example', value: media.example }]
		: []
}

/** Ajv's first complaint, the way the error message of Meta reads. */
function describe(errors: ErrorObject[] | null | undefined): string {
	const first = errors?.[0]
	if (!first) return 'Invalid parameter'
	const where = first.instancePath
		? first.instancePath.slice(1).replaceAll('/', '.')
		: 'body'
	const extra =
		first.keyword === 'additionalProperties'
			? ` (${(first.params as { additionalProperty: string }).additionalProperty})`
			: first.keyword === 'enum'
				? ` (${(first.params as { allowedValues: unknown[] }).allowedValues.join(', ')})`
				: ''
	return `${where} ${first.message ?? 'is invalid'}${extra}`
}

/**
 * Where Meta's specification contradicts Meta's API. The examples of the spec
 * are calls the API accepts; when a schema refuses one, the schema is wrong.
 * `errata.json` beside the spec lists each correction, and `reasons` says
 * which examples prove it:
 * - `openObjects`: true drops `additionalProperties: false` everywhere (the
 *   message schemas leave out fields every example sends);
 * - `optional`: `{ "<schema>" | "*": ["<field>"] }`, fields a schema requires
 *   and the examples leave out (the API fills the default);
 * - `looseProperties`: property names whose type and pattern the examples
 *   break (a latitude sent as a number);
 * - `extendEnums`: `{ "<a value of the enum>[,<another>…]": ["<values to add>"] }`,
 *   enums that miss values the examples send; several values name the enum
 *   that holds them all.
 */
export interface Errata {
	openObjects?: boolean
	/** The branches of Meta's oneOf overlap: a body that fits two is still valid. */
	oneOfAsAnyOf?: boolean
	optional?: Record<string, string[]>
	looseProperties?: string[]
	extendEnums?: Record<string, string[]>
	/** `{ "<schema>": [schema, …] }`: shapes the API accepts and the schema misses. */
	addBranches?: Record<string, Json[]>
	/** `{ "<operationId>": { field: value } }`: what the API fills when a body leaves it out. */
	defaults?: Record<string, Json>
	/** `{ "<operationId>": ["<query parameter>"] }`: parameters the API requires and the spec does not mark. */
	requiredQuery?: Record<string, string[]>
	/** `{ "<operationId>": ["<example name>"] }`: examples no correction can save. */
	brokenExamples?: Record<string, string[]>
	reasons?: Record<string, string>
}

function loadErrata(file: string): Errata {
	try {
		return JSON.parse(readFileSync(file, 'utf-8')) as Errata
	} catch {
		return {}
	}
}

function applyErrata(spec: Json, errata: Errata): Json {
	const everywhere = errata.optional?.['*'] ?? []
	const loose = new Set(errata.looseProperties ?? [])
	const extensions = Object.entries(errata.extendEnums ?? {})

	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			node.forEach(visit)
			return
		}
		if (!node || typeof node !== 'object') return
		const object = node as Json
		if (errata.openObjects && object.additionalProperties === false) {
			delete object.additionalProperties
		}
		if (errata.oneOfAsAnyOf && Array.isArray(object.oneOf)) {
			object.anyOf = object.oneOf
			delete object.oneOf
		}
		if (everywhere.length && Array.isArray(object.required)) {
			object.required = (object.required as string[]).filter(
				(f) => !everywhere.includes(f)
			)
		}
		if (Array.isArray(object.enum)) {
			for (const [anchor, extra] of extensions) {
				// "a,b,c" names an enum by several of its values, all present.
				const values = object.enum as unknown[]
				if (anchor.split(',').every((value) => values.includes(value)))
					object.enum = [...new Set([...values, ...extra])]
			}
		}
		const properties = object.properties as Record<string, Json> | undefined
		for (const name of Object.keys(properties ?? {})) {
			if (!loose.has(name) || !properties) continue
			const { description } = properties[name]
			properties[name] = description ? { description } : {}
		}
		Object.values(object).forEach(visit)
	}
	visit(spec)

	const schemas = (spec.components as Json).schemas as Record<string, Json>
	for (const [name, branches] of Object.entries(errata.addBranches ?? {})) {
		const schema = schemas[name]
		if (schema) schemas[name] = { anyOf: [schema, ...branches] }
	}
	for (const [name, fields] of Object.entries(errata.optional ?? {})) {
		const schema = schemas[name]
		if (name === '*' || !schema || !Array.isArray(schema.required)) continue
		schema.required = (schema.required as string[]).filter(
			(f) => !fields.includes(f)
		)
	}
	return spec
}

/** Read a version's specification: a few dozen milliseconds, once at start. */
export function loadSpec(version: string, dir = specDir()): GraphSpec {
	const text = readFileSync(
		resolve(dir, version, 'business-messaging-api.yaml'),
		'utf-8'
	)
	const errata = loadErrata(resolve(dir, version, 'errata.json'))
	const spec = applyErrata(parseYaml(text) as Json, errata)
	const paths = spec.paths as Record<string, Json>

	// Ajv's discriminator does not take a mapping, which Meta's spec uses: the
	// keyword is left to oneOf, and the top-level one is dispatched by hand
	// (schemaFor) so the error names the real message type.
	const ajv = new Ajv2020({
		strict: false,
		allErrors: false,
		validateFormats: false,
	})
	// The components travel as one schema, so every $ref of the spec resolves.
	ajv.addSchema({ $id: 'meta', components: spec.components } as Json)

	// A schema written inline in an operation points at the components with
	// `#/components/…`; compiled on its own it has to point at `meta#/…`.
	const anchored = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(anchored)
		if (!node || typeof node !== 'object') return node
		return Object.fromEntries(
			Object.entries(node).map(([key, value]) => [
				key,
				key === '$ref' && typeof value === 'string' && value.startsWith('#/')
					? `meta${value}`
					: anchored(value),
			])
		)
	}

	const validators = new Map<string, ValidateFunction | null>()
	const validatorFor = (schema: Json | undefined): ValidateFunction | null => {
		if (!schema) return null
		const key = JSON.stringify(schema)
		if (validators.has(key)) return validators.get(key) ?? null
		let compiled: ValidateFunction | null = null
		try {
			compiled = ajv.compile(anchored(schema) as Json)
		} catch (error) {
			// The spec has a few references to schemas it never defines: those
			// bodies go unchecked rather than refused.
			console.warn(
				`⚠️  ${version}: schema not compiled (${error instanceof Error ? error.message : error})`
			)
		}
		validators.set(key, compiled)
		return compiled
	}

	const requestSchemas = new Map<string, Json | undefined>()
	const responseSchemas = new Map<string, Json | undefined>()
	const operations: Operation[] = []

	for (const [rawPath, item] of Object.entries(paths)) {
		if (!rawPath.startsWith('/{Version}/')) continue
		const path = rawPath.slice('/{Version}'.length)
		const shared = ((item.parameters as unknown[]) ?? []).map((p) =>
			resolveRef(spec, p)
		)
		for (const method of METHODS) {
			const op = item[method] as Json | undefined
			if (!op) continue
			const params = [
				...shared,
				...((op.parameters as unknown[]) ?? []).map((p) => resolveRef(spec, p)),
			]
			const requestMedia = (
				resolveRef(spec, op.requestBody).content as Json | undefined
			)?.['application/json'] as Json | undefined
			const ok = resolveRef(spec, (op.responses as Json)?.['200'])
			const responseMedia = (ok.content as Json | undefined)?.[
				'application/json'
			] as Json | undefined
			const operationId = String(op.operationId ?? `${method}${path}`)

			requestSchemas.set(operationId, requestMedia?.schema as Json | undefined)
			responseSchemas.set(
				operationId,
				responseMedia?.schema as Json | undefined
			)
			operations.push({
				operationId,
				method: method.toUpperCase() as Operation['method'],
				path,
				segments: path.split('/').filter(Boolean),
				tag: ((op.tags as string[] | undefined) ?? ['Groups'])[0],
				summary: String(op.summary ?? operationId).replace(/\.$/, ''),
				description: String(op.description ?? ''),
				query: params
					.filter((p) => p.in === 'query')
					.map((p) => ({
						name: String(p.name),
						in: 'query',
						required:
							p.required === true ||
							(errata.requiredQuery?.[operationId] ?? []).includes(
								String(p.name)
							),
						description: p.description as string | undefined,
						example: (p.schema as Json | undefined)?.example ?? p.example,
					})),
				requestExamples: examplesOf(requestMedia),
				responseExamples: examplesOf(responseMedia),
				hasRequestSchema: !!requestMedia?.schema,
				hasResponseSchema: !!responseMedia?.schema,
			})
		}
	}

	/**
	 * The schema a body must follow. When the schema is a discriminated oneOf
	 * (a message: text, image, template…), the branch is the one the body's
	 * discriminator names, so a wrong field is reported on that branch.
	 */
	const schemaFor = (
		schema: Json | undefined,
		body: unknown
	): Json | undefined => {
		if (!schema) return undefined
		const target = resolveRef(spec, schema)
		const discriminator = target.discriminator as
			| { propertyName: string; mapping?: Record<string, string> }
			| undefined
		const tag = (body as Json | null)?.[discriminator?.propertyName ?? '']
		const branch =
			typeof tag === 'string' ? discriminator?.mapping?.[tag] : undefined
		return branch ? { $ref: branch } : schema
	}

	const webhookSchema = validatorFor({
		$ref: '#/components/schemas/WebhookPayload',
	})

	// Deep enough for every response of the spec; a schema that refers to
	// itself stops there.
	const SAMPLE_DEPTH = 8
	const sample = (schema: unknown, depth = 0): unknown => {
		const node = resolveRef(spec, schema)
		if (depth > SAMPLE_DEPTH) return null
		if (node.example !== undefined) return node.example
		if (Array.isArray(node.enum)) return node.enum[0]
		if (Array.isArray(node.allOf)) {
			return Object.assign(
				{},
				...node.allOf.map((part) => sample(part, depth + 1))
			)
		}
		const branches = (node.anyOf ?? node.oneOf) as unknown[] | undefined
		if (branches?.length) return sample(branches[0], depth + 1)
		const properties = node.properties as Record<string, unknown> | undefined
		if (node.type === 'object' || properties) {
			return Object.fromEntries(
				Object.entries(properties ?? {}).map(([name, inner]) => [
					name,
					sample(inner, depth + 1),
				])
			)
		}
		if (node.type === 'array')
			return node.items ? [sample(node.items, depth + 1)] : []
		if (node.type === 'boolean') return true
		if (node.type === 'integer' || node.type === 'number') return 0
		return ''
	}

	return {
		version,
		title: String((spec.info as Json)?.title ?? ''),
		tags: ((spec.tags as Json[] | undefined) ?? []).map((tag) => ({
			name: String(tag.name),
			description: String(tag.description ?? '').trim(),
		})),
		brokenExamples: errata.brokenExamples ?? {},
		errata: errata.reasons ?? {},
		operations,
		withDefaults(operation, body) {
			const defaults = errata.defaults?.[operation.operationId]
			if (
				!defaults ||
				!body ||
				typeof body !== 'object' ||
				Array.isArray(body)
			) {
				return body
			}
			return { ...defaults, ...(body as Json) }
		},
		checkRequest(operation, rawBody) {
			const body = this.withDefaults(operation, rawBody)
			const validate = validatorFor(
				schemaFor(requestSchemas.get(operation.operationId), body)
			)
			if (!validate || validate(body)) return null
			return describe(validate.errors)
		},
		checkResponse(operation, body) {
			const validate = validatorFor(responseSchemas.get(operation.operationId))
			if (!validate || validate(body)) return null
			return describe(validate.errors)
		},
		checkWebhook(payload) {
			if (!webhookSchema || webhookSchema(payload)) return null
			return describe(webhookSchema.errors)
		},
		sampleResponse(operation) {
			const schema = responseSchemas.get(operation.operationId)
			return schema ? sample(schema) : undefined
		},
	}
}
