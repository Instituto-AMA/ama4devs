/**
 * The API keys of any account, as the panel's "Chaves de API" tab manages them.
 *
 * At Asaas a ROOT account manages its keys only in the web dashboard — the v3
 * API has key operations for SUBaccounts alone (`/v3/accounts/{id}/accessTokens`).
 * So these live under /_admin, and they cover every account the same way: the
 * panel is the dashboard of all of them.
 *
 * Two differences from the real dashboard, both deliberate:
 *   - the list shows the key itself. Asaas shows it once, at creation; here the
 *     panel is the simulator's introspection and the key is a fake one.
 *   - "rotate" is one action: a new key with the same name, the old one deleted
 *     in the same transaction. At Asaas it is two clicks (create, then delete),
 *     and both stay available here for an overlap window.
 *
 * TODO(rule): Asaas emits ACCESS_TOKEN_* webhook events for key changes, but
 * the spec documents no payload for them. They are not emitted until a real
 * payload is captured: an invented shape would teach the integrating app the
 * wrong one.
 */
import { and, asc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context.ts'
import { invalid, notFoundMessage } from '../core/errors.ts'
import { accounts, apiKeys } from '../db/schema/index.ts'
import * as ids from '../domain/ids.ts'

type ApiKeyRow = typeof apiKeys.$inferSelect

export interface KeyInput {
  name?: string
  /** `YYYY-MM-DD` (end of that day) or `YYYY-MM-DD HH:mm:ss`; null clears it. */
  expirationDate?: string | null
  enabled?: boolean
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** The stored form is the business timestamp the authentication compares with. */
function expirationOf(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (DATE.test(raw)) return `${raw} 23:59:59`
  if (TIMESTAMP.test(raw)) return raw
  throw invalid('expirationDate', `Invalid expiration date: "${raw}".`)
}

function serialize(row: ApiKeyRow, now: string) {
  const expired = row.expirationDate !== null && row.expirationDate <= now
  return {
    id: row.id,
    name: row.name,
    enabled: row.active,
    expired,
    /** Whether a request with this key authenticates right now. */
    usable: row.active && !expired,
    expirationDate: row.expirationDate,
    dateCreated: row.dateCreated,
    apiKey: row.key,
  }
}

async function assertAccount(ctx: AppContext, accountId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
  if (!row) throw notFoundMessage('Account not found.')
}

async function findKey(ctx: AppContext, accountId: string, keyId: string): Promise<ApiKeyRow> {
  const [row] = await ctx.db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.accountId, accountId)))
    .limit(1)
  if (!row) throw notFoundMessage('API key not found.')
  return row
}

export async function listKeys(ctx: AppContext, accountId: string) {
  await assertAccount(ctx, accountId)
  const rows = await ctx.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.accountId, accountId))
    .orderBy(asc(apiKeys.dateCreated), asc(apiKeys.id))
  const now = ctx.clock.timestamp()
  return rows.map((r) => serialize(r, now))
}

export async function createKey(ctx: AppContext, accountId: string, input: KeyInput) {
  await assertAccount(ctx, accountId)
  const row: ApiKeyRow = {
    id: ids.genericId(ctx.rng),
    accountId,
    key: ids.apiKey(ctx.rng),
    name: input.name?.trim() || 'Chave de API',
    active: true,
    dateCreated: ctx.clock.timestamp(),
    expirationDate: expirationOf(input.expirationDate),
  }
  await ctx.db.insert(apiKeys).values(row)
  return serialize(row, ctx.clock.timestamp())
}

/**
 * A new key in place of an old one: same name, no expiration unless one is
 * given (copying an expired date would hand back a dead key), and the old key
 * deleted in the same transaction — its next request is a 401.
 */
export async function rotateKey(
  ctx: AppContext,
  accountId: string,
  keyId: string,
  input: KeyInput,
) {
  const old = await findKey(ctx, accountId, keyId)
  const row: ApiKeyRow = {
    id: ids.genericId(ctx.rng),
    accountId,
    key: ids.apiKey(ctx.rng),
    name: old.name,
    active: true,
    dateCreated: ctx.clock.timestamp(),
    expirationDate: expirationOf(input.expirationDate),
  }

  // Synchronous: bun:sqlite commits when the body returns, so an async body
  // would commit at its first `await` (see deleteProfile).
  ctx.db.transaction((tx) => {
    tx.insert(apiKeys).values(row).run()
    tx.delete(apiKeys).where(eq(apiKeys.id, old.id)).run()
  })
  return serialize(row, ctx.clock.timestamp())
}

export async function updateKey(
  ctx: AppContext,
  accountId: string,
  keyId: string,
  input: KeyInput,
) {
  const current = await findKey(ctx, accountId, keyId)
  const patch: Partial<ApiKeyRow> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (name === '') throw invalid('name', 'Provide the key name.')
    patch.name = name
  }
  if (input.enabled !== undefined) patch.active = Boolean(input.enabled)
  if (input.expirationDate !== undefined) {
    patch.expirationDate = expirationOf(input.expirationDate)
  }

  if (Object.keys(patch).length > 0) {
    await ctx.db.update(apiKeys).set(patch).where(eq(apiKeys.id, current.id))
  }
  return serialize({ ...current, ...patch }, ctx.clock.timestamp())
}

export async function deleteKey(ctx: AppContext, accountId: string, keyId: string) {
  const row = await findKey(ctx, accountId, keyId)
  await ctx.db.delete(apiKeys).where(eq(apiKeys.id, row.id))
  return { deleted: true, id: row.id }
}
