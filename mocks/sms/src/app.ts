/**
 * The application of the SMS mock: the guard, the CORS, the routes of the
 * three send APIs, the control routes, the static files of the panel and the
 * WebSocket upgrade.
 */
import type { Config } from './config.ts'
import { json } from './http.ts'
import { guardLocal } from './local-guard.ts'
import { createLifecycle } from './lifecycle.ts'
import { controlRoutes } from './routes/control.ts'
import { nativeRoutes } from './routes/native.ts'
import { simpleRoutes } from './routes/simple.ts'
import { twilioRoutes } from './routes/twilio.ts'
import { createSettings, createStore } from './store.ts'
import type { Ctx, LiveEvent, Route } from './types.ts'
import { createWebhooks, type Webhooks } from './webhooks.ts'

/**
 * The parts of the outside world the server talks to. The tests replace them
 * with fakes, so the whole API can be exercised without a network and without
 * waiting for a timer.
 */
export interface AppDeps {
  fetch?: typeof fetch
  now?: () => Date
  newId?: () => string
  schedule?: (fn: () => void, ms: number) => void
}

/** The application: the fetch handler the server (and the tests) can call. */
export interface App extends Ctx {
  /** Answers a request; undefined when the request became a WebSocket. */
  fetch(request: Request, server?: MockServer): Promise<Response | undefined>
  /** Listens to the live events; the function returned stops the listening. */
  onEvent(fn: (event: LiveEvent) => void): () => void
}

/** The server of the mock, as the handler needs it: the WebSocket upgrade. */
export type MockServer = import('bun').Server<undefined>

/** The content type each kind of static file is served with. */
const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
}

/** The files of the public directory: `/app.js`, `/style.css`, `/favicon.svg`. */
const PUBLIC_FILE = /^\/([a-z0-9-]+)\.(js|css|svg|html)$/

/** The core modules: `/core/phone.js`, `/core/segments.js`, `/core/otp.js`. */
const CORE_FILE = /^\/core\/([a-z0-9-]+)\.js$/

/** The methods a preflight asks for. */
const ALLOWED_METHODS = 'GET,POST,PUT,DELETE,OPTIONS'

/** The headers a preflight asks for when it names none. */
const DEFAULT_ALLOWED_HEADERS = 'authorization,content-type'

/** How long a browser may keep the answer of a preflight. */
const PREFLIGHT_MAX_AGE = '600'

/**
 * The application of the mock: the store, the settings, the webhooks, the
 * lifecycle and the handler that ties them to the routes.
 * @param config The configuration of the server.
 * @param deps The outside world: the fetch of the webhooks, the clock, the ids
 * and the timers.
 */
export function createApp(config: Config, deps: AppDeps = {}): App {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? (() => `SM${crypto.randomUUID().replace(/-/g, '')}`)
  const doFetch = deps.fetch ?? globalThis.fetch
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms))

  const settings = createSettings(config.settings)
  const store = createStore({ now, newId, maxMessages: config.maxMessages })

  const listeners = new Set<(event: LiveEvent) => void>()

  /**
   * Announces a live event to every listener; a listener that breaks is ignored.
   * @param event What happened.
   */
  const emit = (event: LiveEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // One broken listener must not stop the others nor the app.
      }
    }
  }

  const base = createWebhooks({
    fetch: doFetch,
    settings,
    now,
    newId,
    localhostRewrite: config.localhostRewrite,
  })

  // The webhooks of the app: emptying the log also tells the panel about it.
  const webhooks: Webhooks = {
    notify: (message, event) => base.notify(message, event),
    deliveries: () => base.deliveries(),
    clear: () => {
      base.clear()
      emit({ type: 'deliveries.cleared' })
    },
    subscribe: (fn) => base.subscribe(fn),
  }

  const lifecycle = createLifecycle({ store, settings, webhooks, schedule })

  store.subscribe((event) => emit(event))
  settings.subscribe((current) => emit({ type: 'settings.updated', settings: current }))
  webhooks.subscribe((delivery) => emit({ type: 'delivery', delivery }))

  const ctx: Ctx = { config, store, settings, webhooks, lifecycle, now, newId }
  const routes: Route[] = [controlRoutes(ctx), nativeRoutes(ctx), twilioRoutes(ctx), simpleRoutes(ctx)]

  /**
   * Answers a request: the health check, the guard, the CORS, the WebSocket
   * upgrade, the routes and, at the end, the static files of the panel.
   * @param request The request to answer.
   * @param server The server of the mock, for the WebSocket upgrade.
   */
  const fetchHandler = async (
    request: Request,
    server?: MockServer,
  ): Promise<Response | undefined> => {
    const url = new URL(request.url)
    const pathname = url.pathname

    // The health check is the one route everybody may ask: it says nothing.
    if (pathname === '/health' && request.method === 'GET') {
      return json({ status: 'ok', service: 'sms', version: config.version })
    }

    // Every other route carries no key: it belongs to this machine.
    const refusal = guardLocal(request, config.allowedHosts)
    if (refusal) return refusal

    const origin = request.headers.get('origin')
    const allowedOrigin =
      origin !== null && isAllowedOrigin(origin, config.allowedHosts) ? origin : null

    if (request.method === 'OPTIONS') {
      if (allowedOrigin === null) {
        return json({ error: { code: 'forbidden_origin', message: 'Origin not allowed.' } }, 403)
      }
      return new Response(null, { status: 204, headers: preflightHeaders(request, allowedOrigin) })
    }

    /**
     * A response with the CORS headers of the allowed origin.
     * @param response The response to answer with.
     */
    const withCors = (response: Response): Response =>
      allowedOrigin === null ? response : withCorsHeaders(response, allowedOrigin)

    if (pathname === '/ws' && isWebSocketUpgrade(request)) {
      const upgraded = server?.upgrade(request) ?? false
      if (upgraded) return undefined
      return withCors(
        json(
          { error: { code: 'upgrade_required', message: 'This route needs a WebSocket upgrade.' } },
          426,
        ),
      )
    }

    try {
      for (const route of routes) {
        const response = await route(request, url)
        if (response) return withCors(response)
      }
    } catch (error) {
      return withCors(
        json({ error: { code: 'internal_error', message: messageOf(error) } }, 500),
      )
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = await staticFile(config, pathname)
      if (file) return withCors(file)
    }

    return withCors(json({ error: { code: 'not_found', message: 'Route not found.' } }, 404))
  }

  /**
   * Listens to the live events of the mock; the function returned stops it.
   * @param fn The listener.
   */
  const onEvent = (fn: (event: LiveEvent) => void): (() => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  return {
    config,
    store,
    settings,
    webhooks,
    lifecycle,
    now,
    newId,
    fetch: fetchHandler,
    onEvent,
  }
}

/**
 * Whether the origin of a request is one the server answers to.
 * @param origin The raw Origin header.
 * @param allowedHosts The hostnames the server answers to.
 */
function isAllowedOrigin(origin: string, allowedHosts: string[]): boolean {
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false
  }

  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1)
  const name = hostname.toLowerCase()
  return allowedHosts.some((host) => host.toLowerCase() === name)
}

/**
 * The headers of the answer of a preflight.
 * @param request The request to answer.
 * @param origin The origin the answer is for.
 */
function preflightHeaders(request: Request, origin: string): Record<string, string> {
  const requested = request.headers.get('access-control-request-headers')
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-allow-headers':
      requested !== null && requested.trim() !== '' ? requested : DEFAULT_ALLOWED_HEADERS,
    'access-control-max-age': PREFLIGHT_MAX_AGE,
  }
}

/**
 * A response with the CORS headers of an allowed origin.
 * @param response The response to answer with.
 * @param origin The origin the answer is for.
 */
function withCorsHeaders(response: Response, origin: string): Response {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Whether the request asks for a WebSocket upgrade.
 * @param request The request to read.
 */
function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

/**
 * The file of the public directory or of the core the path names, and null
 * when the path names no file or the file is not there.
 * @param config The configuration of the server.
 * @param pathname The path of the request.
 */
async function staticFile(config: Config, pathname: string): Promise<Response | null> {
  if (pathname === '/') {
    return serveFile(config.publicDir, 'index.html', contentTypeOf('html'))
  }

  const core = CORE_FILE.exec(pathname)
  if (core) {
    const name = core[1]
    if (!name) return null
    return serveFile(config.coreDir, `${name}.js`, contentTypeOf('js'))
  }

  const publicFile = PUBLIC_FILE.exec(pathname)
  if (publicFile) {
    const name = publicFile[1]
    const extension = publicFile[2]
    if (!name || !extension) return null
    return serveFile(config.publicDir, `${name}.${extension}`, contentTypeOf(extension))
  }

  return null
}

/**
 * A file of the public directory or of the core, served with its type; null
 * when the file is not there.
 * @param dir The directory the file lives in.
 * @param name The name of the file.
 * @param type The content type it is served with.
 */
async function serveFile(dir: string, name: string, type: string): Promise<Response | null> {
  const file = Bun.file(`${dir.replace(/\/+$/, '')}/${name}`)
  if (!(await file.exists())) return null

  return new Response(file, {
    headers: { 'content-type': type, 'cache-control': 'no-cache' },
  })
}

/**
 * The content type of a kind of file.
 * @param extension The extension of the file.
 */
function contentTypeOf(extension: string): string {
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

/**
 * The message of an error the route threw.
 * @param error What was thrown.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
