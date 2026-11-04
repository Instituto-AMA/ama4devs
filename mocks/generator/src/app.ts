import {
  GeneratorError,
  KINDS,
  generate,
  isValidCnh,
  isValidCnpj,
  isValidCpf,
  isValidPis,
} from './core/index.js'
import { asaasStatus, populate, type PopulateInput } from './asaas.ts'
import type { Config } from './config.ts'
import { createDirectd } from './directd.ts'
import { guardLocal } from './local-guard.ts'

/**
 * The parts of the outside world the server talks to. The tests replace them
 * with fakes, so the whole API can be exercised without a network.
 */
export interface AppDeps {
  fetch?: typeof fetch
  now?: () => Date
  newId?: () => string
  sleep?: (ms: number) => Promise<void>
  schedule?: (ms: number, task: () => Promise<void>) => void
  post?: (url: string, body: unknown) => Promise<{ status: number }>
}

/** The application: a fetch handler the server (and the tests) can call. */
export interface App {
  fetch(request: Request, clientIp?: string): Promise<Response>
}

/** The public files the UI needs, and the type each one is served with. */
const PUBLIC_FILES: Record<string, { name: string; type: string }> = {
  '/index.html': { name: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { name: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/directd.js': { name: 'directd.js', type: 'text/javascript; charset=utf-8' },
  '/chips.js': { name: 'chips.js', type: 'text/javascript; charset=utf-8' },
  '/tools.js': { name: 'tools.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { name: 'style.css', type: 'text/css; charset=utf-8' },
  '/favicon.svg': { name: 'favicon.svg', type: 'image/svg+xml' },
}

/** The documents the validation route knows. */
const VALIDATORS: Record<string, (value: string) => boolean> = {
  cpf: isValidCpf,
  cnpj: isValidCnpj,
  cnh: isValidCnh,
  pis: isValidPis,
}

/** The options the generation route reads from the query string. */
interface GenerateOptions {
  count?: number | string
  seed?: string | number
  [key: string]: any
}

/**
 * The application of the generator: the generation API over the core, the
 * static files of the UI and the population of the Asaas mock.
 * @param config The configuration of the server.
 * @param deps The outside world: the fetch of the Asaas and the clock.
 */
export function createApp(config: Config, deps: AppDeps = {}): App {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  // The Direct Data server is built once: the test CPFs, the log and the
  // counters live between the requests.
  const directd = createDirectd(
    {
      now,
      newId,
      sleep,
      schedule: deps.schedule ?? defaultSchedule,
      post: deps.post ?? rewritingPost(config.webhookLocalhostRewrite),
    },
    {
      unlisted: config.directdUnlisted,
      baseUrl: `http://localhost:${config.port}`,
      balance: config.directdBalance,
    },
  )

  return {
    async fetch(request: Request, clientIp?: string): Promise<Response> {
      const url = new URL(request.url)
      const pathname = url.pathname

      if (pathname === '/health') {
        return json({ status: 'ok', service: 'generator', version: config.version })
      }

      // The panel and the mock routes carry no key: they belong to this machine.
      if (pathname === '/' || pathname.startsWith('/_mock/')) {
        const refusal = guardLocal(request, config.allowedHosts)
        if (refusal) return refusal
      }

      if (pathname === '/' || pathname === '/index.html') {
        return staticFile(config.publicDir, 'index.html', PUBLIC_FILES['/index.html']!.type)
      }

      const publicFile = PUBLIC_FILES[pathname]
      if (publicFile) {
        return staticFile(config.publicDir, publicFile.name, publicFile.type)
      }

      // The core is served as it is: the browser runs the very same modules.
      const core = /^\/core\/([a-z-]+)\.js$/.exec(pathname)
      if (core) {
        return staticFile(config.coreDir, `${core[1]!}.js`, 'text/javascript; charset=utf-8')
      }

      if (pathname.startsWith('/v1/')) {
        return generationRoute(request, url)
      }

      // The Direct Data routes live at the provider's own paths: the Hub
      // calls them from another container, so they carry no local guard.
      if (pathname.startsWith('/api/')) {
        return directd.api(request, url, clientIp)
      }

      if (pathname.startsWith('/_mock/directd/')) {
        return directd.control(request, url)
      }

      if (pathname === '/_mock/asaas/status') {
        return json(await asaasStatus(config, doFetch))
      }

      if (pathname === '/_mock/asaas/populate') {
        if (request.method !== 'POST') {
          return json(
            { error: { code: 'method_not_allowed', message: 'The population uses POST.' } },
            405,
          )
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json(
            { error: { code: 'invalid_body', message: 'The request body must be valid JSON.' } },
            400,
          )
        }

        const input = (body && typeof body === 'object' ? body : {}) as PopulateInput
        return json(await populate(config, input, doFetch, now()))
      }

      return notFound(isApi(pathname))
    },
  }
}

/**
 * The generation API: the kinds, the validation and the generation itself.
 * @param request The request to answer.
 * @param url The URL of the request.
 */
async function generationRoute(request: Request, url: URL): Promise<Response> {
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return apiJson({ error: { code: 'invalid_request', message: 'Path with an invalid encoding.' } }, 400)
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
      },
    })
  }

  if (pathname === '/v1/kinds') {
    return apiJson({ kinds: KINDS.map(({ id, label }) => ({ id, label })) })
  }

  const validate = /^\/v1\/validate\/([^/]+)\/([^/]+)$/.exec(pathname)
  if (validate) {
    const type = validate[1]!.toLowerCase()
    const value = validate[2]!
    const validator = VALIDATORS[type]
    if (!validator) {
      return apiJson(
        { error: { code: 'unknown_type', message: `Unknown document type: ${type}` } },
        400,
      )
    }
    return apiJson({ type, value, valid: validator(value) })
  }

  const kind = /^\/v1\/([^/]+)$/.exec(pathname)
  if (kind) {
    const name = kind[1]!
    try {
      return apiJson(generate(name, optionsOf(url.searchParams)))
    } catch (error) {
      if (error instanceof GeneratorError) {
        return apiJson({ error: { code: error.code, message: error.message } }, 400)
      }
      const message = error instanceof Error ? error.message : String(error)
      return apiJson({ error: { code: 'invalid_request', message } }, 400)
    }
  }

  return apiJson({ error: { code: 'not_found', message: 'Route not found.' } }, 404)
}

/**
 * The options of a generation, read from the query string. Only the keys the
 * caller sent are passed to the core.
 * @param params The query string.
 */
function optionsOf(params: URLSearchParams): GenerateOptions {
  const options: GenerateOptions = {}

  if (params.has('count')) options.count = params.get('count') ?? undefined
  if (params.has('seed')) options.seed = params.get('seed') ?? undefined
  if (params.has('formatted')) {
    const value = params.get('formatted')
    options.formatted = value === 'true' || value === '1'
  }
  if (params.has('state')) options.state = String(params.get('state')).toUpperCase()
  if (params.has('gender')) options.gender = params.get('gender')
  if (params.has('outcome')) options.outcome = params.get('outcome')
  if (params.has('billingType')) options.billingType = params.get('billingType')
  if (params.has('type')) options.type = params.get('type')
  if (params.has('now')) options.now = params.get('now')

  return options
}

/**
 * A file of the public directory or of the core.
 * @param dir The directory the file lives in.
 * @param name The name of the file.
 * @param type The content type it is served with.
 */
async function staticFile(dir: string, name: string, type: string): Promise<Response> {
  const file = Bun.file(joinPath(dir, name))
  if (!(await file.exists())) return notFound(false)

  return new Response(file, {
    headers: { 'content-type': type, 'cache-control': 'no-cache' },
  })
}

/**
 * A JSON answer.
 * @param payload The body of the answer.
 * @param status The status of the answer.
 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * A JSON answer of the generation API, open to every origin: the UI runs on
 * the Pages site, away from the container.
 * @param payload The body of the answer.
 * @param status The status of the answer.
 */
function apiJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  })
}

/**
 * The answer of a route that does not exist.
 * @param cors Whether the answer carries the CORS header of the API.
 */
function notFound(cors: boolean): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
  if (cors) headers['access-control-allow-origin'] = '*'

  return new Response(
    JSON.stringify({ error: { code: 'not_found', message: 'Route not found.' } }, null, 2),
    { status: 404, headers },
  )
}

/**
 * True when a path belongs to the generation API.
 * @param pathname The path of the request.
 */
function isApi(pathname: string): boolean {
  return pathname === '/v1' || pathname.startsWith('/v1/')
}

/**
 * The path of a file inside a directory.
 * @param dir The directory.
 * @param name The name of the file.
 */
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** The hosts a registration names when the receiver runs on this machine. */
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The address a delivery really goes to: a receiver registered on a local
 * name is reached at the rewrite host (the Docker host from a container), the
 * same rule as the other mocks of ama4devs. The registration keeps the
 * address the Hub sent.
 * @param raw The registered URL.
 * @param rewrite The host that replaces a local name; empty keeps it.
 */
export function deliveryUrl(raw: string, rewrite: string): string {
  if (!rewrite) return raw
  const url = new URL(raw)
  if (!LOCAL_NAMES.has(url.hostname)) return raw
  url.hostname = rewrite
  return url.toString()
}

/**
 * The default post behind the localhost rewrite.
 * @param rewrite The host that replaces a local name; empty keeps it.
 */
function rewritingPost(rewrite: string): (url: string, body: unknown) => Promise<{ status: number }> {
  return (url, body) => defaultPost(deliveryUrl(url, rewrite), body)
}

/**
 * The schedule of the mock when the caller injects none: the task runs after
 * the milliseconds it was given.
 * @param ms The milliseconds to wait.
 * @param task The task to run.
 */
function defaultSchedule(ms: number, task: () => Promise<void>): void {
  setTimeout(() => void task(), ms)
}

/**
 * The post of the mock when the caller injects none: the body goes to the URL
 * and the status the receiver answered comes back. The destination guard of
 * the Direct Data server keeps this call inside the machine.
 * @param url The URL of the receiver.
 * @param body The body of the post.
 */
async function defaultPost(url: string, body: unknown): Promise<{ status: number }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // A redirect could lead anywhere: the destination guard saw this URL only.
      redirect: 'manual',
      // A receiver that never answers must not hold the provider's route.
      signal: AbortSignal.timeout(5000),
    })
    return { status: response.status }
  } catch {
    return { status: 0 }
  }
}
