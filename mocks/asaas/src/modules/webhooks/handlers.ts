/**
 * The 6 operations of the "Webhook" tag of the v3 API.
 *
 * The CRUD is the usual one; what is not trivial lives in two rules:
 *
 *   - `interrupted` is the brake of the queue. It becomes `true` on its own when
 *     a delivery exhausts the 15 attempts (see src/webhooks/dispatcher.ts). While
 *     it is `true`, NOTHING of that webhook is delivered — not even the new
 *     events.
 *
 *   - `removeBackoff` (and a PUT with `interrupted: false`) is the unblocking: it
 *     zeroes the attempt counter, reschedules everything for now and releases the
 *     queue. It is the button the developer presses after fixing their endpoint.
 *
 * The answer does NOT return the `authToken` — only `hasAuthToken`. It is what
 * the spec says and it is what Asaas does: the token only leaves here inside the
 * `asaas-access-token` header of a delivery.
 */
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { badRequest, invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { webhookDeliveries, webhooks } from '../../db/schema/index.ts'
import { webhookConfigId } from '../../domain/ids.ts'
import type { HandlerMap } from '../../http/register.ts'

type WebhookRow = typeof webhooks.$inferSelect
type SendType = WebhookRow['sendType']

/** The `authToken` has 32–255 characters. It is the rule of the spec, and it is checkable. */
const AUTH_TOKEN_MIN = 32
const AUTH_TOKEN_MAX = 255

function serialize(row: WebhookRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    email: row.email,
    enabled: row.enabled,
    interrupted: row.interrupted,
    apiVersion: row.apiVersion,
    hasAuthToken: row.authToken !== null && row.authToken !== '',
    sendType: row.sendType,
    /**
     * TODO(rule): the docs do not define how Asaas counts a "penalized request" —
     * whether it is the attempt that failed, the one that the backoff deferred,
     * or the throttling window of the account. Inventing a number here would be
     * worse than returning 0: it would produce false confidence in a field
     * nobody can check. Recorded in progress.md.
     */
    penalizedRequestsCount: 0,
    events: row.events,
  }
}

function assertAuthToken(token: unknown): string | null {
  if (token === undefined || token === null || token === '') return null
  if (typeof token !== 'string') {
    throw invalid('authToken', 'O token de autenticação deve ser um texto.')
  }
  if (token.length < AUTH_TOKEN_MIN || token.length > AUTH_TOKEN_MAX) {
    throw invalid(
      'authToken',
      `O token de autenticação deve ter entre ${AUTH_TOKEN_MIN} e ${AUTH_TOKEN_MAX} caracteres.`,
    )
  }
  return token
}

function assertUrl(url: unknown): string {
  if (typeof url !== 'string' || url.trim() === '') {
    throw invalid('url', 'A URL do webhook é obrigatória.')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw invalid('url', `A URL do webhook é inválida: "${url}".`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid('url', 'A URL do webhook deve usar http ou https.')
  }
  return url
}

function assertEvents(events: unknown): string[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw invalid('events', 'Informe ao menos um evento para o webhook observar.')
  }
  return [...new Set(events as string[])]
}

async function findOwned(ctx: AppContext, accountId: string, id: string): Promise<WebhookRow> {
  const [row] = await ctx.db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId)))
    .limit(1)

  if (!row) throw notFound('Webhook')
  return row
}

/**
 * Unblocks the queue: the deliveries that were waiting for the backoff (or that
 * had already exhausted the attempts) go back to PENDING, with the counter zeroed
 * and scheduled for NOW. The next tick delivers them.
 *
 * It is what `removeBackoff` does, and it is what a PUT with
 * `interrupted: false` also has to do — otherwise the webhook would say "I am
 * not interrupted" and keep delivering nothing, which is the worst lie possible
 * here.
 */
async function releaseQueue(ctx: AppContext, webhookId: string): Promise<void> {
  const now = ctx.clock.nowMs()

  await ctx.db
    .update(webhookDeliveries)
    .set({ status: 'PENDING', attempt: 0, nextAttemptAtMs: now })
    .where(
      and(
        eq(webhookDeliveries.webhookId, webhookId),
        inArray(webhookDeliveries.status, ['PENDING', 'INTERRUPTED']),
      ),
    )

  await ctx.db
    .update(webhooks)
    .set({ interrupted: false })
    .where(eq(webhooks.id, webhookId))
}

export const webhookHandlers: HandlerMap = {
  /** POST /v3/webhooks — the creation returns 200, never 201. */
  'create-new-webhook': async ({ ctx, auth, body }) => {
    const b = body as Record<string, unknown>

    const [{ total = 0 } = {}] = await ctx.db
      .select({ total: count() })
      .from(webhooks)
      .where(eq(webhooks.accountId, auth.accountId))

    const max = ctx.config.webhook.maxPerAccount
    if (total >= max) {
      throw badRequest(
        'invalid_webhook',
        `Você atingiu o limite de ${max} webhooks por conta. ` +
          `Remova um webhook existente antes de criar outro.`,
      )
    }

    const row: WebhookRow = {
      id: webhookConfigId(ctx.rng),
      accountId: auth.accountId,
      name: String(b.name),
      url: assertUrl(b.url),
      email: String(b.email),
      enabled: b.enabled === undefined || b.enabled === null ? true : Boolean(b.enabled),
      interrupted: b.interrupted === true,
      authToken: assertAuthToken(b.authToken),
      apiVersion: b.apiVersion == null ? 3 : Number(b.apiVersion),
      sendType: (b.sendType as SendType) ?? 'SEQUENTIALLY',
      events: assertEvents(b.events),
      dateCreated: ctx.clock.timestamp(),
    }

    await ctx.db.insert(webhooks).values(row)
    return serialize(row)
  },

  /** GET /v3/webhooks */
  'list-webhooks': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)

    const [{ total = 0 } = {}] = await ctx.db
      .select({ total: count() })
      .from(webhooks)
      .where(eq(webhooks.accountId, auth.accountId))

    const rows = await ctx.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.accountId, auth.accountId))
      .orderBy(asc(webhooks.dateCreated), asc(webhooks.id))
      .limit(limit)
      .offset(offset)

    return listEnvelope(rows.map(serialize), total, limit, offset)
  },

  /** GET /v3/webhooks/{id} */
  'retrieve-a-single-webhook': async ({ ctx, auth, params }) => {
    return serialize(await findOwned(ctx, auth.accountId, params.id!))
  },

  /** PUT /v3/webhooks/{id} */
  'update-existing-webhook': async ({ ctx, auth, params, body }) => {
    const current = await findOwned(ctx, auth.accountId, params.id!)
    const b = (body ?? {}) as Record<string, unknown>

    const patch: Partial<WebhookRow> = {}
    if (b.name != null) patch.name = String(b.name)
    if (b.url != null) patch.url = assertUrl(b.url)
    if (b.sendType != null) patch.sendType = b.sendType as SendType
    if (b.enabled != null) patch.enabled = Boolean(b.enabled)
    if (b.events != null) patch.events = assertEvents(b.events)
    if ('authToken' in b) patch.authToken = assertAuthToken(b.authToken)

    // `interrupted: true` freezes the queue by hand — it is how the developer
    // simulates a stuck webhook without having to take their own endpoint down.
    const reactivating = b.interrupted === false && current.interrupted
    if (b.interrupted != null) patch.interrupted = Boolean(b.interrupted)

    if (Object.keys(patch).length > 0) {
      await ctx.db.update(webhooks).set(patch).where(eq(webhooks.id, current.id))
    }
    // Releasing the queue is more than flipping the boolean: the stuck deliveries
    // have to go back to PENDING, otherwise the webhook would lie about being
    // active.
    if (reactivating) await releaseQueue(ctx, current.id)

    return serialize(await findOwned(ctx, auth.accountId, current.id))
  },

  /** DELETE /v3/webhooks/{id} */
  'remove-webhook': async ({ ctx, auth, params }) => {
    const row = await findOwned(ctx, auth.accountId, params.id!)

    // The deliveries reference the webhook (FK ON): they go first. The history of
    // a removed webhook has nowhere to point to.
    await ctx.db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, row.id))
    await ctx.db.delete(webhooks).where(eq(webhooks.id, row.id))

    return { deleted: true, id: row.id }
  },

  /**
   * POST /v3/webhooks/{id}/removeBackoff — 204, no body.
   *
   * It is the endpoint the developer calls after fixing their route: it zeroes
   * the backoff, reschedules the queue for now and unblocks the webhook.
   */
  'remove-webhook-backoff': async ({ ctx, auth, params }) => {
    const row = await findOwned(ctx, auth.accountId, params.id!)
    await releaseQueue(ctx, row.id)
    return new Response(null, { status: 204 })
  },
}
