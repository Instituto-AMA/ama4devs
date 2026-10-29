import pkg from '../package.json' with { type: 'json' }

/**
 * Everything the server needs to boot: the port it listens on, the Asaas it
 * talks to, the hosts the local guard admits and where the files live.
 */
export interface Config {
  port: number
  version: string
  asaasUrl: string
  asaasApiKey: string
  asaasPanelUrl: string
  seedOnBoot: string
  allowedHosts: string[]
  publicDir: string
  coreDir: string
}

/** The hosts the guard admits without any configuration. */
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']

/** The key of the local Asaas mock: a fake placeholder, never a real one. */
const DEFAULT_ASAAS_API_KEY = '$aact_hmlg_local_master'

/** The port of the service, as the compose file and the docs say. */
const DEFAULT_PORT = 45450

/**
 * The configuration of the server, read from the environment.
 * @param env The environment to read: `process.env` in the server, a plain
 * object in the tests.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: portOf(env.PORT),
    version: String(pkg.version),
    asaasUrl: trimTrailingSlash(env.ASAAS_URL?.trim() || 'http://localhost:45445'),
    asaasApiKey: env.ASAAS_API_KEY?.trim() || DEFAULT_ASAAS_API_KEY,
    asaasPanelUrl: trimTrailingSlash(env.ASAAS_PANEL_URL?.trim() || 'http://localhost:45445'),
    seedOnBoot: env.ASAAS_SEED_ON_BOOT?.trim() ?? '',
    allowedHosts: allowedHostsOf(env.MOCK_ALLOWED_HOSTS),
    publicDir: new URL('../public', import.meta.url).pathname,
    coreDir: new URL('./core', import.meta.url).pathname,
  }
}

/**
 * The port to listen on; anything that is not a port falls back to the default.
 * @param value The raw PORT value.
 */
function portOf(value: string | undefined): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT
}

/**
 * The hosts of the guard: the four local names plus the ones the environment
 * adds, comma separated.
 * @param value The raw MOCK_ALLOWED_HOSTS value.
 */
function allowedHostsOf(value: string | undefined): string[] {
  const hosts = [...DEFAULT_ALLOWED_HOSTS]
  for (const host of String(value ?? '').split(',')) {
    const name = host.trim().toLowerCase()
    if (name && !hosts.includes(name)) hosts.push(name)
  }
  return hosts
}

/**
 * A URL without its trailing slashes, so the paths can be appended to it.
 * @param value The raw URL.
 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
