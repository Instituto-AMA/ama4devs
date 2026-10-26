/**
 * Webhook target helpers.
 *
 * When the mock runs as a compose service, `localhost` points at the container
 * itself instead of the developer app running on the host. The
 * `WEBHOOK_LOCALHOST_REWRITE` environment variable names the host that must
 * receive those webhooks (for example `host.docker.internal`).
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Replace the hostname of loopback webhook URLs with the configured host.
 *
 * The URL is returned unchanged when no rewrite host is configured, when the
 * URL cannot be parsed or when it does not point to a loopback address. Only
 * the hostname is replaced: protocol, port and path are preserved.
 *
 * @param url - Webhook URL to deliver to
 * @returns The URL to use for the webhook delivery
 */
export function rewriteLoopback(url: string): string {
	const rewriteHost = process.env.WEBHOOK_LOCALHOST_REWRITE?.trim()
	if (!rewriteHost) {
		return url
	}

	let target: URL
	try {
		target = new URL(url)
	} catch {
		return url
	}

	if (!LOOPBACK_HOSTNAMES.has(target.hostname)) {
		return url
	}

	try {
		target.hostname = rewriteHost
	} catch {
		return url
	}

	return target.toString()
}
