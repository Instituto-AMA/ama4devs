import { Elysia } from 'elysia'

/** The methods that change state — the guard checks the Origin on these only. */
export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** The pt-BR description of each refusal. */
const FORBIDDEN = {
  forbidden_host: 'Host não permitido para rotas locais.',
  forbidden_origin: 'Origem não permitida para rotas locais.',
} as const

function normalizeHostname(value: string): string {
  const hostname = value.trim().toLowerCase()
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function hostnameFromHost(value: string): string | null {
  const host = value.trim()
  if (!host) return null

  if (host.startsWith('[')) {
    const closingBracket = host.indexOf(']')
    if (closingBracket === -1) return null

    const port = host.slice(closingBracket + 1)
    if (port && !/^:\d+$/.test(port)) return null
    return normalizeHostname(host.slice(1, closingBracket))
  }

  const separator = host.indexOf(':')
  if (separator !== -1) {
    const port = host.slice(separator + 1)
    if (!/^\d*$/.test(port)) return null
    return normalizeHostname(host.slice(0, separator))
  }

  return normalizeHostname(host)
}

/**
 * The hostname of a URL. `httpOnly` keeps only http(s): an Origin header
 * always carries a scheme, and any other one (file:, data:) is not a local
 * origin.
 */
function hostnameOf(
  value: string,
  { httpOnly = false }: { httpOnly?: boolean } = {},
): string | null {
  try {
    const url = new URL(value)
    if (httpOnly && url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return normalizeHostname(url.hostname)
  } catch {
    return null
  }
}

function isGuardedPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/_admin') ||
    pathname.startsWith('/_mock') ||
    // The payer's invoice and bank slip pages: key-free, and paying changes state.
    pathname.startsWith('/i/') ||
    pathname.startsWith('/b/')
  )
}

/**
 * Admits the host of a URL this server handed out itself (its callback in the
 * WhatsApp mock). Returns the hostname when it was new, so a failed attempt can take
 * it back, and null when it was already admitted.
 */
export function allowHost(allowedHosts: string[], url: string): string | null {
  const hostname = hostnameOf(url)
  if (!hostname || allowedHosts.some((host) => normalizeHostname(host) === hostname)) return null
  allowedHosts.push(hostname)
  return hostname
}

/** Takes back a host `allowHost` added. */
export function disallowHost(allowedHosts: string[], hostname: string): void {
  const at = allowedHosts.indexOf(hostname)
  if (at !== -1) allowedHosts.splice(at, 1)
}

function forbiddenBody(code: keyof typeof FORBIDDEN) {
  return { errors: [{ code, description: FORBIDDEN[code] }] }
}

/**
 * Restricts the key-free local routes to an explicit hostname allowlist.
 *
 * The Host check blocks DNS rebinding: a browser page can resolve an attacker
 * controlled name to 127.0.0.1, but it still sends that name in the Host header.
 *
 * The list is read on every request: the address the WhatsApp mock calls back on
 * is found after boot and joins it then (`allowHost`).
 */
export function localGuard(allowedHosts: string[]) {
  const allowed = { has: (hostname: string) => allowedHosts.some((host) => normalizeHostname(host) === hostname) }

  return new Elysia({ name: 'local-guard' }).onRequest(({ request, set }) => {
    const pathname = new URL(request.url).pathname
    if (!isGuardedPath(pathname)) return

    const hostHeader = request.headers.get('host')
    const hostname = hostHeader === null ? hostnameOf(request.url) : hostnameFromHost(hostHeader)
    if (!hostname || !allowed.has(hostname)) {
      set.status = 403
      return forbiddenBody('forbidden_host')
    }

    if (!STATE_CHANGING_METHODS.has(request.method)) return

    const origin = request.headers.get('origin')
    if (origin === null) return

    // Browsers send Origin on cross-site writes, including requests that do not
    // need a preflight. Rejecting foreign origins keeps those writes local. The
    // opaque `null` origin (a sandboxed iframe, a data: or file: page) is foreign
    // too: the panel is same-origin and never sends it.
    const originHostname = hostnameOf(origin, { httpOnly: true })
    if (!originHostname || !allowed.has(originHostname)) {
      set.status = 403
      return forbiddenBody('forbidden_origin')
    }
  })
}
