import { Elysia } from 'elysia'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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

function hostnameFromUrl(value: string): string | null {
  try {
    return normalizeHostname(new URL(value).hostname)
  } catch {
    return null
  }
}

function hostnameFromOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return normalizeHostname(url.hostname)
  } catch {
    return null
  }
}

function isGuardedPath(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/_admin') || pathname.startsWith('/_mock')
}

function forbiddenBody(code: 'forbidden_host' | 'forbidden_origin') {
  const description =
    code === 'forbidden_host'
      ? 'Host não permitido para rotas locais.'
      : 'Origem não permitida para rotas locais.'
  return { errors: [{ code, description }] }
}

/**
 * Restricts the key-free local routes to an explicit hostname allowlist.
 *
 * The Host check blocks DNS rebinding: a browser page can resolve an attacker
 * controlled name to 127.0.0.1, but it still sends that name in the Host header.
 */
export function localGuard(allowedHosts: string[]) {
  const allowed = new Set(allowedHosts.map(normalizeHostname).filter(Boolean))

  return new Elysia({ name: 'local-guard' }).onRequest(({ request, set }) => {
    const pathname = new URL(request.url).pathname
    if (!isGuardedPath(pathname)) return

    const hostHeader = request.headers.get('host')
    const hostname = hostHeader === null ? hostnameFromUrl(request.url) : hostnameFromHost(hostHeader)
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
    const originHostname = hostnameFromOrigin(origin)
    if (!originHostname || !allowed.has(originHostname)) {
      set.status = 403
      return forbiddenBody('forbidden_origin')
    }
  })
}
