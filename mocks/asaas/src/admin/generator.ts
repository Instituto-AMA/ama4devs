/**
 * The generator of fake data, seen from here: whether it answers, and the
 * population of one account through it.
 *
 * The generator is found by itself (src/notify/discovery.ts), like Mailpit and
 * the WhatsApp mock: `GENERATOR_URL` says where it answers, empty turns it off.
 * The population is the generator's own job (it calls the Asaas API like any
 * client); what this server does is choose the account — it sends the API key
 * of the account being filled, so the generator writes there and nowhere else.
 */
import { and, asc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context.ts'
import { badRequest } from '../core/errors.ts'
import { apiKeys } from '../db/schema/index.ts'

/** How long the status probe waits for the generator's answer. */
const STATUS_TIMEOUT_MS = 2_000

/** A population creates hundreds of objects: it takes its time. */
const POPULATE_TIMEOUT_MS = 120_000

export interface GeneratorStatus {
  /** Whether the generator is configured or found at all. */
  on: boolean
  /** Where it answers; null when it is off. */
  url: string | null
  /** Where the browser opens the generator's UI. */
  uiUrl: string
  /** Whether it answered the health check now. */
  reachable: boolean
  /** The version it says about itself. */
  version: string | null
  /** Why it is off or why it did not answer. */
  error: string | null
}

/** Whether the generator answers, and what it says about itself. */
export async function generatorStatus(ctx: AppContext): Promise<GeneratorStatus> {
  const { url, uiUrl } = ctx.config.generator
  if (!url) {
    return {
      on: false,
      url: null,
      uiUrl,
      reachable: false,
      version: null,
      error: 'Gerador desligado (GENERATOR_URL vazio) ou não encontrado.',
    }
  }

  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { version?: string }
    return { on: true, url, uiUrl, reachable: true, version: body.version ?? null, error: null }
  } catch (err) {
    return {
      on: true,
      url,
      uiUrl,
      reachable: false,
      version: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export interface PopulateThroughGenerator {
  /** The account to fill; its own API key goes to the generator. */
  accountId: string
  people?: number
  companies?: number
  chargesPerCustomer?: number
  billingTypes?: Array<'PIX' | 'BOLETO' | 'CREDIT_CARD'>
  /** The share of the charges that come back paid (0..1). */
  confirm?: number
  seed?: string
}

/**
 * Fills one account through the generator: the counts go to it, the account's
 * own API key tells it where to write, and its answer comes back as it is.
 */
export async function populateThroughGenerator(
  ctx: AppContext,
  input: PopulateThroughGenerator,
): Promise<{ status: number; body: unknown }> {
  const url = ctx.config.generator.url
  if (!url) throw badRequest('generator_off', 'Gerador desligado ou não encontrado.')

  const [key] = await ctx.db
    .select({ key: apiKeys.key })
    .from(apiKeys)
    .where(and(eq(apiKeys.accountId, input.accountId), eq(apiKeys.active, true)))
    .orderBy(asc(apiKeys.dateCreated), asc(apiKeys.id))
    .limit(1)
  if (!key) throw badRequest('account_without_key', 'Conta sem chave de API ativa.')

  const { accountId: _accountId, ...counts } = input

  let res: Response
  try {
    res = await fetch(`${url}/_mock/asaas/populate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...counts, apiKey: key.key }),
      signal: AbortSignal.timeout(POPULATE_TIMEOUT_MS),
    })
  } catch (err) {
    throw badRequest('generator_unreachable', err instanceof Error ? err.message : String(err))
  }

  return { status: res.status, body: await res.json().catch(() => null) }
}
