import type { MiddlewareHandler } from 'hono'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Extract the lowercased hostname from a Host header value (optional port,
 * bracketed IPv6) or from an Origin URL. Returns null when it cannot be read.
 */
export function hostnameOf(value: string): string | null {
	try {
		const hostname = new URL(
			value.includes('://') ? value : `http://${value}`
		).hostname.toLowerCase()
		return hostname.replace(/^\[|\]$/g, '') || null
	} catch {
		return null
	}
}

/** True when the Origin header value names an allowed hostname. */
export function isAllowedOrigin(origin: string, hosts: string[]): boolean {
	if (origin === 'null') return false
	const hostname = hostnameOf(origin)
	return hostname !== null && hosts.includes(hostname)
}

function forbidden(
	c: Parameters<MiddlewareHandler>[0],
	message: string,
	type: string
) {
	return c.json({ error: { message, type, code: 403 } }, 403)
}

/**
 * Guard for the key-free local routes: a Host allowlist on every request
 * (DNS rebinding) and an Origin check on state-changing methods and on the
 * `/ws` upgrade (cross-site writes). A request without Origin (curl, server
 * apps) passes.
 */
export function localGuard(hosts: string[]): MiddlewareHandler {
	return async (c, next) => {
		const hostHeader = c.req.header('host')
		const hostname = hostnameOf(hostHeader ?? c.req.url)
		if (!hostname || !hosts.includes(hostname)) {
			return forbidden(
				c,
				'Host not allowed for local routes.',
				'forbidden_host'
			)
		}

		if (STATE_CHANGING_METHODS.has(c.req.method) || c.req.path === '/ws') {
			const origin = c.req.header('origin')
			if (origin !== undefined && !isAllowedOrigin(origin, hosts)) {
				return forbidden(
					c,
					'Origin not allowed for local routes.',
					'forbidden_origin'
				)
			}
		}

		await next()
	}
}
