/**
 * The generator finds the Asaas mock by itself.
 *
 * However this server runs (bun on the machine, `docker run`, a compose of
 * someone's project, the repo's `make up`), whatever is up answers on one of a
 * few known places: the compose service name, this machine, the Docker host.
 * `ASAAS_URL` unset means the places are looked for on boot and again every
 * LOOK_EVERY_MS (the process entry, src/server.ts, keeps that cadence), so a
 * mock that comes up later, moves or goes away is followed. A place counts only
 * when the service there says what it is (the Asaas clock mode), so another
 * program on the same port is never taken for it.
 */
import type { Config } from './config.ts'

/** How long a probe waits for the answer of a place, in milliseconds. */
const PROBE_TIMEOUT_MS = 1_000

/**
 * Real time between two looks. Whether the Asaas is up is a fact of the
 * machine, not of the simulated day, so the clock does not pace it.
 */
export const LOOK_EVERY_MS = 10_000

/** The names the Asaas mock answers on, from the closest to the farthest. */
const ASAAS_HOSTS = ['asaas', 'asaas-mock', 'localhost', 'host.docker.internal']

/** The port of the Asaas mock, as the compose file and the docs say. */
const ASAAS_PORT = 45445

/**
 * The places the Asaas mock may be found at: none when the environment gave
 * the URL as is, the known names otherwise.
 * @param env The environment to read: `process.env` in the server, a plain
 * object in the tests.
 */
export function asaasPlaces(env: Record<string, string | undefined> = process.env): string[] {
  if (env.ASAAS_URL?.trim()) return []
  return ASAAS_HOSTS.map((host) => `http://${host}:${ASAAS_PORT}`)
}

/**
 * Whether the service at the place is the Asaas mock: it answers the health
 * check with its clock mode, the way the mock does.
 * @param base The URL of the place, without the trailing slash.
 * @param fetchImpl The fetch the probe goes through.
 */
export async function isAsaas(base: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!res.ok) return false

    const body = await res.json()
    return body?.status === 'ok' && typeof body?.clockMode === 'string'
  } catch {
    return false
  }
}

/**
 * Looks for the Asaas mock and keeps its URL in the configuration: the first
 * place, in order, that answers wins, so the closest one is taken as soon as
 * it is up, even when a farther one answered first because it was already
 * running. What changed is logged, and only what changed.
 * @param config The configuration of the server; its Asaas URL is updated.
 * @param fetchImpl The fetch the probes go through.
 * @param log Where the discovery writes what it found.
 */
export async function findAsaas(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = console.log,
): Promise<void> {
  const places = config.asaasPlaces
  if (places.length === 0) return

  const answers = await Promise.all(places.map((place) => isAsaas(place, fetchImpl)))
  const found = answers.indexOf(true)
  const url = found === -1 ? undefined : places[found]

  if (url === config.asaasUrl) return

  config.asaasUrl = url
  if (url) log(`generator: Asaas found at ${url}`)
  else log('generator: Asaas stopped answering')
}
