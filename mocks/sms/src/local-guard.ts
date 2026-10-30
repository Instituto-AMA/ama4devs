/**
 * The local guard of the SMS mock: the routes that carry no key are bound to
 * this machine.
 *
 * The Host check blocks DNS rebinding: a browser page can resolve an attacker
 * controlled name to 127.0.0.1, but it still sends that name in the Host
 * header. The Origin check keeps the state changing requests local: browsers
 * send Origin on cross-site writes, and the opaque `null` origin (a sandboxed
 * iframe, a data: or file: page) is foreign too.
 */

/** The methods that change state — the guard checks the Origin on these only. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** The description of each refusal. */
const FORBIDDEN = {
  forbidden_host: 'Host not allowed for local routes.',
  forbidden_origin: 'Origin not allowed for local routes.',
} as const

/** The code of a refusal. */
export type ForbiddenCode = keyof typeof FORBIDDEN

/**
 * The hostname of a header or an URL, in lower case and without the brackets
 * of an IPv6 address.
 * @param value The raw hostname.
 */
function normalizeHostname(value: string): string {
  const hostname = value.trim().toLowerCase()
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

/**
 * The hostname of a Host header: the port is dropped and an IPv6 address keeps
 * only what is between the brackets.
 * @param value The raw Host header.
 */
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
 * @param value The raw URL.
 * @param options `httpOnly` refuses the schemes that are not http(s).
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

/**
 * True when the hostname is one of the admitted ones.
 * @param allowedHosts The allowlist.
 * @param hostname The hostname of the request.
 */
function isAllowed(allowedHosts: string[], hostname: string): boolean {
  return allowedHosts.some((host) => normalizeHostname(host) === hostname)
}

/**
 * The refusal: 403 with the code and the description.
 * @param code Which rule was broken.
 */
function forbidden(code: ForbiddenCode): Response {
  return new Response(JSON.stringify({ error: { code, message: FORBIDDEN[code] } }, null, 2), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Admits a request whose Host (and Origin, on a write) is local. Returns the
 * refusal when the request must not go through, and null when it can.
 * @param request The request to judge.
 * @param allowedHosts The hostnames the server answers to.
 */
export function guardLocal(request: Request, allowedHosts: string[]): Response | null {
  const hostHeader = request.headers.get('host')
  const hostname = hostHeader === null ? hostnameOf(request.url) : hostnameFromHost(hostHeader)
  if (!hostname || !isAllowed(allowedHosts, hostname)) return forbidden('forbidden_host')

  if (!STATE_CHANGING_METHODS.has(request.method)) return null

  const origin = request.headers.get('origin')
  if (origin === null) return null

  const originHostname = hostnameOf(origin, { httpOnly: true })
  if (!originHostname || !isAllowed(allowedHosts, originHostname)) {
    return forbidden('forbidden_origin')
  }

  return null
}

/**
 * Refuses a request a foreign page made: an Origin outside the allowlist (a
 * WebSocket handshake always carries one), or no Origin and a cross-site
 * fetch (an <img> or a link aimed at a GET that changes state). Only for the
 * GET routes that read the live feed or send: `/ws` and `GET /sms/send`.
 * @param request The request to judge.
 * @param allowedHosts The hostnames the server answers to.
 */
export function guardForeignPage(request: Request, allowedHosts: string[]): Response | null {
  const origin = request.headers.get('origin')
  if (origin !== null) {
    const originHostname = hostnameOf(origin, { httpOnly: true })
    return !originHostname || !isAllowed(allowedHosts, originHostname) ? forbidden('forbidden_origin') : null
  }
  return request.headers.get('sec-fetch-site') === 'cross-site' ? forbidden('forbidden_origin') : null
}
