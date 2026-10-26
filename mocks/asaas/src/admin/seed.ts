/**
 * Seed idempotente: garante que existe uma conta principal com a API key do
 * ambiente. Roda em todo boot; se a conta já existe, não faz nada.
 */
import { eq } from 'drizzle-orm'
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

/** The fields an account needs to be born. Master and extra accounts differ only here. */
interface RootAccountSeed {
  apiKey: string
  name: string
  email: string
  cpfCnpj: string
  balanceCents: Cents
}

/** A stable slug from a name: "Clínica A" → "clinica-a". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The INSERT shared by the master account and the extra ones: a ROOT account
 * (`parentAccountId: null`), its own walletId, the API key row and the KYC
 * already approved — what the real sandbox returns for an account in use. A
 * SUB-account created via POST /v3/accounts is the one born with documents to
 * send.
 */
async function insertRootAccount(
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

export async function seedMasterAccount(deps: SeedDeps): Promise<SeedResult> {
  const { db, config, rng } = deps
  const existing = await db.select().from(accounts).limit(1)
  if (existing.length > 0) {
    const account = existing[0]!
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.accountId, account.id))
      .limit(1)

    // Banco criado antes da tabela de documentos: sem este backfill, a conta
    // principal apareceria com o KYC pendente depois de um simples restart.
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
 * idempotency contract: if the key already exists, the account is already
 * seeded and NOTHING changes — no new wallet, no new balance. The balance of a
 * fresh extra account starts at zero.
 */
export async function seedExtraAccounts(deps: SeedDeps): Promise<SeedResult[]> {
  const { db, config } = deps
  const created: SeedResult[] = []

  for (const extra of config.seedExtraAccounts) {
    const [existing] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.key, extra.apiKey))
      .limit(1)
    if (existing) continue

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
