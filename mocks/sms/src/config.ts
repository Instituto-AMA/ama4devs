import pkg from '../package.json' with { type: 'json' }
import type { Settings } from './types.ts'

/**
 * Everything the server needs to boot: the port, the starting settings, the
 * hosts the local guard admits and where the files live.
 */
export interface Config {
  port: number
  version: string
  /** The settings the store starts with; the panel changes them at runtime. */
  settings: Settings
  /** Country code assumed for numbers written without one. */
  defaultCountryCode: string
  /** Messages kept in memory; the oldest are dropped beyond it. */
  maxMessages: number
  /** When set, a loopback webhook host is rewritten to it (Docker → host). */
  localhostRewrite: string | undefined
  allowedHosts: string[]
  publicDir: string
  coreDir: string
}

/**
 * The hosts the guard admits without any configuration: the local names, the
 * Docker host and the names of this service in a compose.
 */
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'sms', 'sms-mock']

/** The port of the service, as the compose file and the docs say. */
const DEFAULT_PORT = 3020

/**
 * The configuration of the server, read from the environment.
 * @param env The environment to read: `process.env` in the server, a plain
 * object in the tests.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: positiveInt(env.PORT, DEFAULT_PORT),
    version: String(pkg.version),
    settings: {
      deliveryDelayMs: nonNegativeInt(env.SMS_DELIVERY_DELAY_MS, 1500),
      autoDeliver: env.SMS_AUTO_DELIVER?.trim() !== '0',
      webhookUrl: env.SMS_WEBHOOK_URL?.trim() ?? '',
      webhookSecret: env.SMS_WEBHOOK_SECRET?.trim() ?? '',
      defaultFrom: env.SMS_DEFAULT_FROM?.trim() || 'AMA4DEVS',
    },
    defaultCountryCode: env.SMS_DEFAULT_COUNTRY_CODE?.trim().replace(/\D/g, '') || '55',
    maxMessages: positiveInt(env.SMS_MAX_MESSAGES, 5000),
    localhostRewrite: env.WEBHOOK_LOCALHOST_REWRITE?.trim() || undefined,
    allowedHosts: allowedHostsOf(env.MOCK_ALLOWED_HOSTS),
    publicDir: new URL('../public', import.meta.url).pathname,
    coreDir: new URL('./core', import.meta.url).pathname,
  }
}

/**
 * A positive integer, or the fallback for anything else.
 * @param value The raw value.
 * @param fallback What to use when the value is not a positive integer.
 */
function positiveInt(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

/**
 * An integer from zero up, or the fallback for anything else.
 * @param value The raw value.
 * @param fallback What to use when the value is not a non-negative integer.
 */
function nonNegativeInt(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isInteger(number) && number >= 0
    ? number
    : fallback
}

/**
 * The hosts of the guard: the local names plus the ones the environment adds,
 * comma separated.
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
