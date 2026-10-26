/**
 * `SEED_EXTRA_ACCOUNTS` — extra ROOT accounts with a FIXED key each.
 *
 * The local stack runs several tenants; the e2e needs two accounts it can
 * impersonate without looking any key up. What this file proves: each extra
 * key AUTHENTICATES, each account is a ROOT account (no parent) with its own
 * walletId, tenants are ISOLATED from each other, and a second boot creates
 * nothing — same idempotency contract as the master account.
 */
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedExtraAccounts } from '../../src/admin/seed.ts'
import { accounts, apiKeys } from '../../src/db/schema/index.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

const EXTRA = [
  { apiKey: '$aact_hmlg_dev_tenant_a', name: 'Clinica A', cpfCnpj: '12345678000195' },
  { apiKey: '$aact_hmlg_dev_tenant_b', name: 'Clinica B', cpfCnpj: '98765432000198' },
]

let h: Harness

beforeEach(async () => {
  h = await createHarness({ seedExtraAccounts: EXTRA })
})
afterEach(() => h.close())

describe('seed-extra-accounts', () => {
  it('boots both accounts, each key authenticates /v3/myAccount/status', async () => {
    for (const extra of EXTRA) {
      const as = h.as(extra.apiKey)
      const res = await as.call('check-account-registration-status')
      expect(res.status).toBe(200)
    }
  })

  it('each extra account is a ROOT account with its own walletId', async () => {
    const rows = await h.app.db.select().from(accounts)
    const extras = rows.filter((r) => EXTRA.some((e) => e.name === r.name))

    expect(extras).toHaveLength(2)
    for (const row of extras) {
      expect(row.parentAccountId).toBeNull() // root, not a subaccount
      expect(row.walletId).toBeString()
      expect(row.status).toBe('APPROVED')
    }
    // And distinct wallets — a split needs somewhere to land.
    expect(extras[0]!.walletId).not.toBe(extras[1]!.walletId)
  })

  it('each tenant sees only its own customers', async () => {
    const a = h.as(EXTRA[0]!.apiKey)
    const b = h.as(EXTRA[1]!.apiKey)

    await a.call('create-new-customer', {
      body: { name: 'Paciente A', cpfCnpj: '24971563792' },
    })

    expect((await a.call('list-customers')).body.totalCount).toBe(1)
    expect((await b.call('list-customers')).body.totalCount).toBe(0)
    // The master account does not see the tenants' customers either.
    expect((await h.api.call('list-customers')).body.totalCount).toBe(0)

    await b.call('create-new-customer', {
      body: { name: 'Paciente B', cpfCnpj: '98765432100' },
    })
    expect((await b.call('list-customers')).body.totalCount).toBe(1)
    expect((await a.call('list-customers')).body.totalCount).toBe(1)
  })

  it('a second boot creates nothing', async () => {
    const before = {
      accounts: (await h.app.db.select().from(accounts)).length,
      keys: (await h.app.db.select().from(apiKeys)).length,
    }

    // The same seed, again — what a restart does. Nothing new may appear.
    const created = await seedExtraAccounts({
      db: h.app.db,
      config: h.app.config,
      clock: h.app.ctx.clock,
      rng: h.app.ctx.rng,
    })
    expect(created).toHaveLength(0)

    expect((await h.app.db.select().from(accounts)).length).toBe(before.accounts)
    expect((await h.app.db.select().from(apiKeys)).length).toBe(before.keys)

    // The keys still authenticate after the second pass.
    expect((await h.as(EXTRA[0]!.apiKey).call('list-customers')).status).toBe(200)
    expect((await h.as(EXTRA[1]!.apiKey).call('list-customers')).status).toBe(200)
  })
})
