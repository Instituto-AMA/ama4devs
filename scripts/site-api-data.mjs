#!/usr/bin/env node
// Writes the API reference data of the Pages site (site/data/) from the mocks' vendored
// specifications and the running mocks, so the API pages list exactly what the images answer.
//
//   <mock>-api.json          the list: [{ tag, ops: [{ id, method, path, summary, live }] }]
//   <mock>-api-details.json  what a row opens to, loaded on the first click:
//                            { [id]: { description, params, fields, examples, responses } }
//
//   Asaas:    every operation of spec/openapi.json, live unless GET /_admin/coverage lists it
//             as answered with 501.
//   WhatsApp: every operation of spec/<version>, live when the mock simulates it with state
//             (the reference the panel inlines at GET /), otherwise it answers Meta's example.
//
// usage: node scripts/site-api-data.mjs [asaas-url] [whatsapp-url]
//        (defaults http://localhost:45445 and http://localhost:3010; start them with make up,
//        and run bun install in mocks/whatsapp once for its yaml parser)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const asaasUrl = process.argv[2] ?? 'http://localhost:45445'
const whatsappUrl = process.argv[3] ?? 'http://localhost:3010'
const out = join(root, 'site', 'data')
mkdirSync(out, { recursive: true })

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const MAX_DEPTH = 5

/** Follows a local $ref ("#/components/schemas/X") inside one spec. */
const resolver = (spec) => (node) => {
  let seen = 0
  while (node && node.$ref && seen++ < 20) {
    node = node.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[decodeURIComponent(k)], spec)
  }
  return node ?? {}
}

/** A value shaped like the schema: its own example first, then the examples of its parts. */
function exampleOf(schema, resolve, depth = 0) {
  const s = resolve(schema)
  if (s.example !== undefined) return s.example
  if (s.examples && Array.isArray(s.examples) && s.examples.length) return s.examples[0]
  if (s.default !== undefined) return s.default
  if (s.enum?.length) return s.enum[0]
  if (s.allOf) return Object.assign({}, ...s.allOf.map((p) => exampleOf(p, resolve, depth)).filter((v) => v && typeof v === 'object'))
  if (s.oneOf || s.anyOf) return exampleOf((s.oneOf ?? s.anyOf)[0], resolve, depth)
  if (depth >= MAX_DEPTH) return s.type === 'array' ? [] : s.type === 'object' || s.properties ? {} : null
  if (s.type === 'array' || s.items) return [exampleOf(s.items ?? {}, resolve, depth + 1)]
  if (s.type === 'object' || s.properties) {
    const o = {}
    // A field with nothing to show stays out, like a caller would leave it.
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      const value = exampleOf(v, resolve, depth + 1)
      if (value !== null) o[k] = value
    }
    return o
  }
  if (s.type === 'integer' || s.type === 'number') return 0
  if (s.type === 'boolean') return false
  if (s.type === 'string') return s.format === 'date' ? '2026-11-10' : s.format === 'date-time' ? '2026-11-10T12:00:00Z' : 'string'
  return null
}

/** The type of a field as a reader wants it: "string", "enum: A | B", "array of object". */
function typeOf(schema, resolve) {
  const s = resolve(schema)
  if (s.enum?.length) return `enum: ${s.enum.slice(0, 8).join(' | ')}${s.enum.length > 8 ? ' | …' : ''}`
  if (s.type === 'array' || s.items) return `array of ${typeOf(s.items ?? {}, resolve)}`
  if (s.oneOf || s.anyOf) return 'one of several shapes'
  return [s.type ?? (s.properties ? 'object' : 'any'), s.format].filter(Boolean).join(', ')
}

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

/** The details of one operation of an OpenAPI spec. */
function detailsOf(operation, pathItem, resolve, extra = {}) {
  const params = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .map(resolve)
    // Headers (User-Agent, Content-Type, Authorization) are the same on every call.
    // The Graph version is already in the path the page shows.
    .filter((p) => p.in !== 'header' && p.name !== 'Version')
    .map((p) => ({ in: p.in, name: p.name, required: !!p.required, type: typeOf(p.schema ?? {}, resolve), description: clean(p.description) }))

  const content = resolve(operation.requestBody ?? {}).content ?? {}
  const [contentType, media] = Object.entries(content)[0] ?? []
  const bodySchema = media ? resolve(media.schema ?? {}) : null
  const required = new Set(bodySchema?.required ?? [])
  const fields = bodySchema
    ? Object.entries(bodySchema.properties ?? {}).map(([name, v]) => ({
        name, required: required.has(name), type: typeOf(v, resolve), description: clean(resolve(v).description),
      }))
    : []
  let examples = extra.examples ?? []
  if (!examples.length && media) {
    const named = Object.entries(media.examples ?? {}).map(([name, e]) => ({ name: clean(resolve(e).summary) || name, value: resolve(e).value }))
    examples = named.length ? named : [{ name: 'Example', value: media.example ?? exampleOf(media.schema ?? {}, resolve) }]
  }

  const responses = Object.entries(operation.responses ?? {}).map(([status, r]) => {
    const res = resolve(r)
    const [, m] = Object.entries(res.content ?? {})[0] ?? []
    let example = null
    if (m) {
      const first = Object.values(m.examples ?? {})[0]
      example = m.example ?? (first ? resolve(first).value : undefined) ?? exampleOf(m.schema ?? {}, resolve)
    }
    if (status.startsWith('2') && extra.response !== undefined && extra.response !== null) example = extra.response
    return { status, description: clean(res.description).slice(0, 200), example }
  })

  return {
    description: clean(operation.description ?? '').slice(0, 1200),
    contentType: contentType ?? null,
    params,
    fields,
    examples: examples.slice(0, 60),
    responses,
  }
}

const byLiveThenName = (a, b) =>
  b.ops.filter((o) => o.live).length - a.ops.filter((o) => o.live).length || a.tag.localeCompare(b.tag)

const write = (name, data) => writeFileSync(join(out, name), `${JSON.stringify(data)}\n`)

function build(spec, isLive, extras = () => ({}), pathOf = (p) => p) {
  const resolve = resolver(spec)
  const groups = new Map()
  const details = {}
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method]
      if (!op?.operationId) continue
      const tag = op.tags?.[0] ?? 'Other'
      const group = groups.get(tag) ?? { tag, ops: [] }
      group.ops.push({ id: op.operationId, method: method.toUpperCase(), path: pathOf(path), summary: clean(op.summary), live: isLive(op.operationId) })
      groups.set(tag, group)
      details[op.operationId] = detailsOf(op, item, resolve, extras(op.operationId))
    }
  }
  return { groups: [...groups.values()].sort(byLiveThenName), details }
}

const count = (groups) => {
  const ops = groups.flatMap((g) => g.ops)
  return `${ops.length} operations, ${ops.filter((o) => o.live).length} live`
}

// ── Asaas ──
const asaasSpec = JSON.parse(readFileSync(join(root, 'mocks/asaas/spec/openapi.json'), 'utf8'))
const coverage = await (await fetch(`${asaasUrl}/_admin/coverage`)).json()
const stubbed = new Set(coverage.notImplemented)
const asaas = build(asaasSpec, (id) => !stubbed.has(id))
write('asaas-api.json', asaas.groups)
write('asaas-api-details.json', asaas.details)

// ── WhatsApp ──
const panel = await (await fetch(`${whatsappUrl}/`)).text()
const inline = panel.match(/<script type="application\/json" id="reference">([\s\S]*?)<\/script>/)
if (!inline) throw new Error(`no API reference in the panel at ${whatsappUrl}`)
const reference = JSON.parse(inline[1])
const referenced = new Map(reference.topics.flatMap((t) => t.operations.map((o) => [o.id, o])))
const yaml = createRequire(join(root, 'mocks/whatsapp/package.json'))('yaml')
const whatsappSpec = yaml.parse(readFileSync(join(root, `mocks/whatsapp/spec/${reference.version}/business-messaging-api.yaml`), 'utf8'))
const whatsapp = build(
  whatsappSpec,
  (id) => !!referenced.get(id)?.simulated,
  // The panel's reference already drops the examples the errata mark broken.
  (id) => {
    const r = referenced.get(id)
    return r ? { examples: r.examples, response: r.response } : {}
  },
  (path) => path.replace(/^\/\{Version\}/, `/${reference.version}`),
)
write('whatsapp-api.json', whatsapp.groups)
write('whatsapp-api-details.json', whatsapp.details)

console.log(`asaas: ${count(asaas.groups)}; whatsapp ${reference.version}: ${count(whatsapp.groups)}`)
