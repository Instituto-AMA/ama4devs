/**
 * Trap nº 1 of the project — and the reason it exists.
 *
 * The Asaas sandbox does not deliver webhooks to `localhost`. This server
 * does. But it runs INSIDE a container: there, `localhost` is the container
 * itself, and a POST to `http://localhost:3000/webhook` hits nothing — or,
 * worse, the simulator itself.
 *
 * The developer configures the webhook with the URL they see from their own
 * machine (`http://localhost:3000/webhook`); we rewrite the HOST to
 * `host.docker.internal` (WEBHOOK_LOCALHOST_REWRITE) at delivery time. Port,
 * path, query and fragment are preserved — only the host changes.
 *
 * Outside Docker, `WEBHOOK_LOCALHOST_REWRITE` is empty and nothing is
 * rewritten: that is the case of the tests, where the real sink listens on
 * localhost.
 */

/** The names that, inside a container, point at the container. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

export type Logger = (
  level: 'debug' | 'info' | 'warn' | 'error',
  msg: string,
  data?: unknown,
) => void

/** Logs the FIRST rewrite and only that one: the rest would be noise on every delivery. */
let announced = false

/** Only for the tests — the "already warned" state is global to the process. */
export function resetRewriteNotice(): void {
  announced = false
}

/**
 * Rewrites the host of a loopback URL to `target`.
 *
 * `target === undefined` → no rewrite (we are not in Docker).
 * Invalid URL → returns the original string; what fails is the `fetch`, with
 * the real error recorded on the delivery. This is not where you find out that
 * the URL is invalid.
 */
export function rewriteForContainer(
  url: string,
  target: string | undefined,
  log?: Logger,
): string {
  if (!target) return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  if (!LOOPBACK.has(parsed.hostname) && !LOOPBACK.has(parsed.host)) return url

  const original = parsed.host // host = hostname + port, and the port is kept
  parsed.hostname = target
  const rewritten = parsed.toString()

  if (!announced) {
    announced = true
    log?.(
      'info',
      `Webhook points at ${original}: rewriting the host to "${target}". ` +
        `Inside the container, "localhost" is the container itself — without this the ` +
        `webhook would never reach your machine. (WEBHOOK_LOCALHOST_REWRITE)`,
      { from: url, to: rewritten },
    )
  }

  return rewritten
}
