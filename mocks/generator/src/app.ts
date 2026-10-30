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
import { guardLocal } from './local-guard.ts'

/**
 * The parts of the outside world the server talks to. The tests replace them
 * with fakes, so the whole API can be exercised without a network.
 */
export interface AppDeps {
  fetch?: typeof fetch
  now?: () => Date
}

/** The application: a fetch handler the server (and the tests) can call. */
export interface App {
  fetch(request: Request): Promise<Response>
}

/** The public files the UI needs, and the type each one is served with. */
const PUBLIC_FILES: Record<string, { name: string; type: string }> = {
  '/index.html': { name: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { name: 'app.js', type: 'text/javascript; charset=utf-8' },
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

  return {
    async fetch(request: Request): Promise<Response> {
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
