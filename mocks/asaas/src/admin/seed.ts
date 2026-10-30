/**
 * Idempotent seed: makes sure a main account with the environment's API key
 * exists. It runs on every boot; if the account is already there, it does
 * nothing.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { toBusinessTimestamp } from '../core/clock.ts'
import type { DB } from '../db/client.ts'
import { accountDocumentGroups, accounts, apiKeys } from '../db/schema/index.ts'
import { personTypeOf } from '../domain/cpf-cnpj.ts'
import * as ids from '../domain/ids.ts'
import { cents, type Cents } from '../domain/money.ts'
import { createAccountDocuments, type DocumentDeps } from '../modules/account-documents/service.ts'

export interface SeedResult {
  created: boolean
  accountId: string
  walletId: string
  apiKey: string
}

/** Everything the seed needs from the outside world. */
export interface SeedDeps extends DocumentDeps {
  db: DB
}

/**
 * The fields an account needs to be born. Master, extra and panel-created
 * profiles differ only here.
 */
export interface RootAccountSeed {
  apiKey: string
  name: string
  email: string
  cpfCnpj: string
  balanceCents: Cents
}

/** A stable slug from a name: "Clinic A" → "clinic-a". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The INSERT shared by the master account, the extra ones and the profiles the
 * panel creates: a ROOT account (`parentAccountId: null`), its own walletId,
 * the API key row and the KYC already approved — what the real sandbox returns
 * for an account in use. A SUB-account created via POST /v3/accounts is the one
 * born with documents to send.
 */
export async function insertRootAccount(
  deps: SeedDeps,
  seed: RootAccountSeed,
): Promise<SeedResult> {
  const { db, clock, rng } = deps
  const now = clock.timestamp()
  const accountId = ids.accountId(rng)
  const walletId = ids.walletId(rng)

  await db.insert(accounts).values({
    id: accountId,
    walletId,
    parentAccountId: null,
    name: seed.name,
    email: seed.email,
    loginEmail: seed.email,
    cpfCnpj: seed.cpfCnpj,
    personType: personTypeOf(seed.cpfCnpj),
    country: 'Brasil',
    status: 'APPROVED', // sandbox approves by itself
    balanceCents: seed.balanceCents,
    dateCreated: now,
  })

  await db.insert(apiKeys).values({
    id: ids.genericId(rng),
    accountId,
    key: seed.apiKey,
    name: 'Chave principal',
    active: true,
    dateCreated: now,
  })

  await createAccountDocuments(db, deps, {
    accountId,
    name: seed.name,
    personType: personTypeOf(seed.cpfCnpj),
    companyType: null,
    approved: true,
  })

  return { created: true, accountId, walletId, apiKey: seed.apiKey }
}

/**
 * The root account an environment profile already lives in, or none.
 *
 * Found by its KEY or by its DOCUMENT: the panel rotates and deletes keys, so
 * the key alone stops naming the account after a rotation, and a restart would
 * seed a second copy of a profile that is still there. A profile deleted in the
 * panel has neither, and the environment brings it back on the next boot.
 */
async function findSeeded(
  db: DB,
  seed: { apiKey: string | undefined; cpfCnpj: string },
): Promise<typeof accounts.$inferSelect | undefined> {
  if (seed.apiKey) {
    const [byKey] = await db
      .select({ account: accounts })
      .from(apiKeys)
      .innerJoin(accounts, eq(apiKeys.accountId, accounts.id))
      .where(eq(apiKeys.key, seed.apiKey))
      .limit(1)
    if (byKey) return byKey.account
  }

  const [byDocument] = await db
    .select()
    .from(accounts)
    .where(and(isNull(accounts.parentAccountId), eq(accounts.cpfCnpj, seed.cpfCnpj)))
    .limit(1)
  return byDocument
}

export async function seedMasterAccount(deps: SeedDeps): Promise<SeedResult> {
  const { db, config, rng } = deps
  const account = await findSeeded(db, config.seedAccount)
  if (account) {
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.accountId, account.id), eq(apiKeys.active, true)))
      .limit(1)

    // A database created before the documents table: without this backfill, the main
    // account would show up with the KYC pending after a simple restart.
    const [group] = await db
      .select({ id: accountDocumentGroups.id })
      .from(accountDocumentGroups)
      .where(eq(accountDocumentGroups.accountId, account.id))
      .limit(1)

    if (!group) {
      await createAccountDocuments(db, deps, {
        accountId: account.id,
        name: account.name,
        personType: account.personType,
        companyType: account.companyType,
        approved: true,
      })
    }

    return {
      created: false,
      accountId: account.id,
      walletId: account.walletId,
      apiKey: key?.key ?? '(nenhuma)',
    }
  }

  // If the user did not define ASAAS_API_KEY, we generate one and print it on boot.
  return insertRootAccount(deps, {
    apiKey: config.seedAccount.apiKey ?? ids.apiKey(rng),
    name: config.seedAccount.name,
    email: config.seedAccount.email,
    cpfCnpj: config.seedAccount.cpfCnpj,
    balanceCents: config.seedAccount.balanceCents,
  })
}

/**
 * Extra ROOT accounts from `SEED_EXTRA_ACCOUNTS` — a local stack runs several
 * tenants, and the e2e needs two, each with its own FIXED key (chosen by the
 * environment, not generated). Parsing and validation live in the config; by
 * the time an item gets here it is well-formed and its key is not the master's.
 *
 * Runs on every boot, right after `seedMasterAccount`, under the same
 * idempotency contract: if the key, or a root account with the same document,
 * already exists, the account is already seeded and NOTHING changes — no new
 * wallet, no new balance, no key put back after the panel rotated it. The
 * balance of a fresh extra account starts at zero.
 */
export async function seedExtraAccounts(deps: SeedDeps): Promise<SeedResult[]> {
  const { db, config } = deps
  const created: SeedResult[] = []

  for (const extra of config.seedExtraAccounts) {
    if (await findSeeded(db, extra)) continue

    created.push(
      await insertRootAccount(deps, {
        apiKey: extra.apiKey,
        name: extra.name,
        // The account needs a login email and the env format has none — derive
        // a stable one from the name ("Clinica A" → clinica-a@localhost).
        email: `${slugify(extra.name)}@localhost`,
        cpfCnpj: extra.cpfCnpj,
        balanceCents: cents(0),
      }),
    )
  }

  return created
}

export { toBusinessTimestamp }
