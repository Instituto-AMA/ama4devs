/**
 * Profiles: the ROOT accounts of the simulator, created and deleted from the
 * panel. NOT an Asaas operation — Asaas has no API that opens a root account —
 * so this lives under /_admin with the rest of the simulator's controls.
 *
 * A profile is what the integrating app calls a tenant: one root account with
 * its own key, wallet, customers and webhooks. The environment seeds some
 * (`ASAAS_API_KEY`, `SEED_EXTRA_ACCOUNTS`); the panel adds and removes the
 * others without a restart.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AppContext } from '../core/context.ts'
import { badRequest, invalid, notFound } from '../core/errors.ts'
import { accounts, apiKeys } from '../db/schema/index.ts'
import { cnpjFromBase, isValidCpfCnpj } from '../domain/cpf-cnpj.ts'
import * as ids from '../domain/ids.ts'
import { cents } from '../domain/money.ts'
import { insertRootAccount, type SeedResult } from './seed.ts'

export interface CreateProfileInput {
  name?: string
  cpfCnpj?: string
  email?: string
  /** A fixed key, for an app whose configuration already names one. */
  apiKey?: string
}

const digitsOnly = (v: string) => v.replace(/\D/g, '')

/** "Clínica A" → "clinica-a", the local part of a profile's default e-mail. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * The documents of the environment's profiles. A profile whose document is here
 * comes back on the next boot after a delete, and the panel says so.
 */
export function seededDocuments(ctx: AppContext): Set<string> {
  return new Set([
    ctx.config.seedAccount.cpfCnpj,
    ...ctx.config.seedExtraAccounts.map((e) => e.cpfCnpj),
  ])
}

export async function createProfile(
  ctx: AppContext,
  input: CreateProfileInput,
): Promise<SeedResult> {
  const name = (input.name ?? '').trim()
  if (name === '') throw invalid('name', 'Informe o nome do perfil.')

  // No document given: a valid CNPJ, so every validation downstream accepts it.
  const cpfCnpj = input.cpfCnpj
    ? digitsOnly(input.cpfCnpj)
    : cnpjFromBase(`${ctx.rng.digits(8)}0001`)
  if (!isValidCpfCnpj(cpfCnpj)) throw invalid('cpfCnpj', 'O CPF/CNPJ informado é inválido.')

  // The document is how the seed recognises a profile across restarts; two
  // roots with the same one would make that lookup ambiguous.
  const [sameDocument] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(isNull(accounts.parentAccountId), eq(accounts.cpfCnpj, cpfCnpj)))
    .limit(1)
  if (sameDocument) {
    throw invalid('cpfCnpj', 'Já existe um perfil com este CPF/CNPJ.')
  }

  const apiKey = input.apiKey?.trim() || ids.apiKey(ctx.rng)
  if (!apiKey.startsWith('$aact_')) {
    throw invalid('apiKey', 'A chave deve começar com "$aact_", como as do Asaas.')
  }
  const [sameKey] = await ctx.db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.key, apiKey))
    .limit(1)
  if (sameKey) throw invalid('apiKey', 'Esta chave já pertence a outra conta.')

  return insertRootAccount(
    { db: ctx.db, config: ctx.config, clock: ctx.clock, rng: ctx.rng },
    {
      apiKey,
      name,
      email: input.email?.trim() || `${slug(name) || 'perfil'}@localhost`,
      cpfCnpj,
      // Zero, never an opening balance: money enters through the ledger, or
      // `balance === SUM(ledger)` stops holding for this account.
      balanceCents: cents(0),
    },
  )
}

/** The account and every subaccount under it, at any depth. */
async function familyOf(ctx: AppContext, rootId: string): Promise<string[]> {
  const family = [rootId]
  let frontier = [rootId]
  while (frontier.length > 0) {
    const children = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.parentAccountId, frontier))
    frontier = children.map((c) => c.id)
    family.push(...frontier)
  }
  return family
}

interface TableShape {
  name: string
  ownedByAccount: boolean
  /** Foreign keys of a table with no `account_id` of its own. */
  parents: Array<{ column: string; table: string; to: string }>
}

/**
 * Every table and how a row of it belongs to an account: by its own
 * `account_id`, or through a parent row that has one (a split through its
 * payment, a notification through its customer). Read from SQLite itself, so a
 * table added later is deleted with its account without touching this file.
 */
async function tableShapes(ctx: AppContext): Promise<TableShape[]> {
  const tables = await ctx.db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table'
        and name not like 'sqlite_%' and name not like '__drizzle%' and name <> 'accounts'`,
  )

  const shapes: TableShape[] = []
  for (const { name } of tables) {
    const columns = await ctx.db.all<{ name: string }>(
      sql`select name from pragma_table_info(${name})`,
    )
    const fks = await ctx.db.all<{ from: string; table: string; to: string }>(
      sql`select "from", "table", "to" from pragma_foreign_key_list(${name})`,
    )
    shapes.push({
      name,
      ownedByAccount: columns.some((c) => c.name === 'account_id'),
      parents: fks.map((f) => ({ column: f.from, table: f.table, to: f.to })),
    })
  }
  return shapes
}

export interface DeleteProfileResult {
  deleted: true
  id: string
  /** The profile plus its subaccounts. */
  accounts: number
  rows: number
}

/**
 * Deletes a profile and EVERYTHING it owns — subaccounts, keys, customers,
 * charges, ledger, webhooks and their deliveries — in one transaction.
 *
 * Foreign keys are deferred to the commit, so the order of the deletes does not
 * matter; a row left pointing at a deleted one fails the commit and nothing is
 * deleted. Rows of OTHER accounts stay: a split that paid this profile's wallet
 * stays in the payer's statement, as it would at Asaas after an account closes.
 */
export async function deleteProfile(
  ctx: AppContext,
  accountId: string,
): Promise<DeleteProfileResult> {
  const [account] = await ctx.db
    .select({ id: accounts.id, parentAccountId: accounts.parentAccountId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
  if (!account) throw notFound('Perfil')
  if (account.parentAccountId) {
    throw badRequest(
      'invalid_account',
      'Subcontas são encerradas pela API do Asaas (DELETE /v3/accounts/{id}), com a chave da conta principal.',
    )
  }

  const family = await familyOf(ctx, account.id)
  const shapes = await tableShapes(ctx)
  const owned = new Set(shapes.filter((s) => s.ownedByAccount).map((s) => s.name))
  const idList = sql.join(
    family.map((id) => sql`${id}`),
    sql`, `,
  )

  // A SYNCHRONOUS callback, on purpose. bun:sqlite runs the transaction body
  // synchronously and commits when it returns: an async body would commit at
  // its first `await` and run the rest outside the transaction, one statement
  // at a time — the deferred check gone, and a failure leaving half a profile.
  let rows = 0
  ctx.db.transaction((tx) => {
    tx.run(sql`PRAGMA defer_foreign_keys = ON`)

    // Children first only for readability: the deferred check is what makes
    // the order irrelevant.
    for (const shape of shapes.filter((s) => !s.ownedByAccount)) {
      for (const parent of shape.parents.filter((p) => owned.has(p.table))) {
        rows += tx.all(
          sql`delete from ${sql.identifier(shape.name)} where ${sql.identifier(parent.column)} in (
                select ${sql.identifier(parent.to)} from ${sql.identifier(parent.table)}
                where account_id in (${idList})) returning 1`,
        ).length
      }
    }

    for (const name of owned) {
      rows += tx.all(
        sql`delete from ${sql.identifier(name)} where account_id in (${idList}) returning 1`,
      ).length
    }

    tx.delete(accounts).where(inArray(accounts.id, family)).run()
  })

  ctx.log('info', `Perfil ${account.id} excluído com ${family.length - 1} subconta(s)`)
  return { deleted: true, id: account.id, accounts: family.length, rows }
}
