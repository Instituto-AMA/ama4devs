import pkg from '../package.json' with { type: 'json' }
import type { UnlistedPolicy } from './directd.ts'
import { asaasPlaces } from './discovery.ts'

/**
 * Everything the server needs to boot: the port it listens on, the Asaas it
 * talks to, the hosts the local guard admits and where the files live.
 */
export interface Config {
  port: number
  version: string
  /** The Asaas the calls go to; undefined until the discovery finds it. */
  asaasUrl: string | undefined
  /** The places the Asaas may be found at; empty when it was given as is. */
  asaasPlaces: string[]
  asaasApiKey: string
  asaasPanelUrl: string
  seedOnBoot: string
  /** What the Direct Data mock answers a CPF that is not in its test table. */
  directdUnlisted: UnlistedPolicy
  /** The balance the Direct Data mock starts with. */
  directdBalance: number
  allowedHosts: string[]
  publicDir: string
  coreDir: string
}

/**
 * The hosts the guard admits without any configuration: the local names, the
 * Docker host and the names of this service in a compose.
 */
const DEFAULT_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'generator',
  'generator-mock',
]

/** The key of the local Asaas mock: a fake placeholder, never a real one. */
const DEFAULT_ASAAS_API_KEY = '$aact_hmlg_local_master'

/** The port of the service, as the compose file and the docs say. */
const DEFAULT_PORT = 45450

/** The balance the Direct Data mock starts with when the environment says nothing. */
const DEFAULT_DIRECTD_BALANCE = 500

/**
 * The configuration of the server, read from the environment.
 * @param env The environment to read: `process.env` in the server, a plain
 * object in the tests.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const asaasUrl = env.ASAAS_URL?.trim()

  return {
    port: portOf(env.PORT),
    version: String(pkg.version),
    asaasUrl: asaasUrl ? trimTrailingSlash(asaasUrl) : undefined,
    asaasPlaces: asaasPlaces(env),
    asaasApiKey: env.ASAAS_API_KEY?.trim() || DEFAULT_ASAAS_API_KEY,
    asaasPanelUrl: trimTrailingSlash(env.ASAAS_PANEL_URL?.trim() || 'http://localhost:45445'),
    seedOnBoot: env.ASAAS_SEED_ON_BOOT?.trim() ?? '',
    directdUnlisted: directdUnlistedOf(env.DIRECTD_UNLISTED),
    directdBalance: balanceOf(env.DIRECTD_BALANCE),
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
 * The policy of the CPFs that are not in the test table of the Direct Data
 * mock: `lowRisk` unless the environment asks for another one.
 * @param value The raw DIRECTD_UNLISTED value.
 */
function directdUnlistedOf(value: string | undefined): UnlistedPolicy {
  const name = String(value ?? '').trim()
  if (name === 'derived' || name === 'notFound') return name
  return 'lowRisk'
}

/**
 * The balance of the Direct Data mock: the number of the environment, or the
 * default when it says nothing usable.
 * @param value The raw DIRECTD_BALANCE value.
 */
function balanceOf(value: string | undefined): number {
  const raw = String(value ?? '').trim()
  if (raw === '') return DEFAULT_DIRECTD_BALANCE

  const balance = Number(raw)
  if (!Number.isFinite(balance) || balance < 0) return DEFAULT_DIRECTD_BALANCE
  return Math.round(balance * 100) / 100
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
