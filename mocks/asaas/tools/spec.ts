/**
 * Shared utilities for handling Asaas's OpenAPI spec.
 *
 * `spec/openapi.json` is vendored byte-for-byte from upstream and is NEVER
 * hand-edited — that is what keeps the drift diff clean. Corrections to the spec
 * live in `spec/overlays/*.json` as JSON Patch and are applied in memory in the
 * codegen.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SPEC_URL =
  'https://www.asaas.com/openApi/document?version=3&languageCode=en-US'

export const SPEC_DIR = join(import.meta.dir, '..', 'spec')
export const SPEC_PATH = join(SPEC_DIR, 'openapi.json')
export const LOCK_PATH = join(SPEC_DIR, 'openapi.lock.json')
export const OVERLAY_DIR = join(SPEC_DIR, 'overlays')

export interface OpenApiSpec {
  openapi: string
  info: { title: string; version: string }
  servers: { url: string; description?: string }[]
  paths: Record<string, Record<string, RawOperation>>
  components: { schemas: Record<string, any>; securitySchemes: Record<string, any> }
}

export interface RawOperation {
  operationId: string
  tags?: string[]
  summary?: string
  parameters?: any[]
  requestBody?: any
  responses: Record<string, any>
}

export interface SpecLock {
  sha256: string
  fetchedAt: string
  url: string
  openapi: string
  pathCount: number
  operationCount: number
  schemaCount: number
  /** operationId -> hash of the operation's shape. It is what detects a field change. */
  operations: Record<string, string>
  /** the schema's name -> hash. */
  schemas: Record<string, string>
}

export const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export async function sha256(text: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(text)
  return hasher.digest('hex')
}

/** Stable hash: keys sorted recursively, so that a reordering does not become drift. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as object).sort()
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`)
    .join(',')
  return `{${body}}`
}

export async function readSpec(): Promise<OpenApiSpec> {
  return JSON.parse(await Bun.file(SPEC_PATH).text()) as OpenApiSpec
}

export async function readLock(): Promise<SpecLock | null> {
  const f = Bun.file(LOCK_PATH)
  if (!(await f.exists())) return null
  return JSON.parse(await f.text()) as SpecLock
}

export function eachOperation(
  spec: OpenApiSpec,
): { path: string; method: HttpMethod; op: RawOperation }[] {
  const out: { path: string; method: HttpMethod; op: RawOperation }[] = []
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method]
      if (op) out.push({ path, method, op })
    }
  }
  return out
}

export async function buildLock(raw: string, fetchedAt: string): Promise<SpecLock> {
  const spec = JSON.parse(raw) as OpenApiSpec
  const operations: Record<string, string> = {}
  for (const { path, method, op } of eachOperation(spec)) {
    operations[op.operationId] = (
      await sha256(stableStringify({ path, method, op }))
    ).slice(0, 16)
  }
  const schemas: Record<string, string> = {}
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    schemas[name] = (await sha256(stableStringify(schema))).slice(0, 16)
  }
  return {
    sha256: await sha256(raw),
    fetchedAt,
    url: SPEC_URL,
    openapi: spec.openapi,
    pathCount: Object.keys(spec.paths).length,
    operationCount: Object.keys(operations).length,
    schemaCount: Object.keys(schemas).length,
    operations,
    schemas,
  }
}

/**
 * The spec's endpoint answers 429 easily. Never call this during the
 * build — the build only reads the vendored file.
 */
export async function fetchSpec(attempts = 4): Promise<string> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await Bun.sleep(2000 * 2 ** (i - 1))
    try {
      const res = await fetch(SPEC_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 429) {
        lastError = new Error('429 Too Many Requests')
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      JSON.parse(text) // validates that it is JSON before writing
      return text
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`Failed to download the spec after ${attempts} attempts: ${lastError}`)
}

interface Overlay {
  _why: string
  _source?: string
  patch: { op: 'add' | 'replace' | 'remove'; path: string; value?: unknown }[]
}

/** Applies the overlays of `spec/overlays/` in memory. The spec on disk does not change. */
export function applyOverlays(spec: OpenApiSpec): { spec: OpenApiSpec; applied: string[] } {
  const files = readdirSync(OVERLAY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
  const out = JSON.parse(JSON.stringify(spec)) as OpenApiSpec
  const applied: string[] = []

  for (const file of files) {
    const overlay: Overlay = JSON.parse(readFileSync(join(OVERLAY_DIR, file), 'utf8'))
    for (const patch of overlay.patch) applyPatch(out, patch, file)
    applied.push(file)
  }
  return { spec: out, applied }
}

function applyPatch(
  doc: unknown,
  patch: { op: string; path: string; value?: unknown },
  file: string,
): void {
  const tokens = patch.path
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))
  const last = tokens.pop()
  if (last === undefined) throw new Error(`${file}: invalid path "${patch.path}"`)

  let cursor: any = doc
  for (const token of tokens) {
    cursor = cursor?.[token]
    if (cursor === undefined) {
      throw new Error(
        `${file}: path "${patch.path}" does not resolve — the target is gone from the spec. ` +
          `This almost always means Asaas changed the API and the overlay became obsolete.`,
      )
    }
  }

  if (patch.op === 'add' && Array.isArray(cursor) && last === '-') {
    cursor.push(patch.value)
  } else if (patch.op === 'add' || patch.op === 'replace') {
    cursor[last] = patch.value
  } else if (patch.op === 'remove') {
    delete cursor[last]
  } else {
    throw new Error(`${file}: unsupported op "${patch.op}"`)
  }
}
