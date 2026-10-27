/**
 * Profiles and API keys, as the panel manages them under /_admin.
 *
 * What this file proves: a profile created in the panel is a working root
 * account; deleting one removes everything it owns and nothing of the others;
 * a rotated, disabled, expired or deleted key stops authenticating on the next
 * request; and a restart neither duplicates a profile whose key was rotated nor
 * forgets an environment profile that the panel deleted.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'bun:test'
import { seedExtraAccounts, seedMasterAccount } from '../../src/admin/seed.ts'
import {
  accounts,
  apiKeys,
  customers,
  payments,
  webhookDeliveries,
  webhooks,
} from '../../src/db/schema/index.ts'
import { createHarness, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

let h: Harness
afterEach(() => h?.close())

async function admin(path: string, method = 'GET', body?: unknown) {
  const res = await h.app.app.handle(
    new Request(`http://localhost/_admin${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

/** Whether a key authenticates right now. */
async function authenticates(key: string): Promise<boolean> {
  return (await h.as(key).call('list-customers')).status === 200
}

const reseed = (harness: Harness) => {
  const deps = {
    db: harness.app.db,
    config: harness.app.config,
    clock: harness.app.ctx.clock,
    rng: harness.app.ctx.rng,
  }
  return { master: () => seedMasterAccount(deps), extras: () => seedExtraAccounts(deps) }
}

describe('profiles', () => {
  it('a created profile is a root account whose key works at once', async () => {
    h = await createHarness()

    const res = await admin('/accounts', 'POST', { name: 'Clínica Nova' })
    expect(res.status).toBe(200)
    expect(res.body.apiKey).toStartWith('$aact_hmlg_')
    expect(await authenticates(res.body.apiKey)).toBe(true)

    const list = (await admin('/accounts')).body.accounts
    const created = list.find((a: any) => a.id === res.body.accountId)
    expect(created.parentAccountId).toBeNull()
    expect(created.email).toBe('clinica-nova@localhost')
    expect(created.seeded).toBe(false)
    expect(created.cpfCnpj).toHaveLength(14) // a generated CNPJ

    // The master is the environment's.
    expect(list.find((a: any) => a.id === h.accountId).seeded).toBe(true)
  })

  it('a fixed key is kept, and a key or document already in use is refused', async () => {
    h = await createHarness()

    const fixed = '$aact_hmlg_fixed_profile_key'
    const res = await admin('/accounts', 'POST', {
      name: 'Fixa',
      cpfCnpj: '12345678000195',
      apiKey: fixed,
    })
    expect(res.body.apiKey).toBe(fixed)

    const sameKey = await admin('/accounts', 'POST', { name: 'Outra', apiKey: fixed })
    expect(sameKey.status).toBe(400)
    expect(sameKey.body.errors[0].code).toBe('invalid_apiKey')

    const sameDocument = await admin('/accounts', 'POST', {
      name: 'Outra',
      cpfCnpj: '12.345.678/0001-95',
    })
    expect(sameDocument.body.errors[0].code).toBe('invalid_cpfCnpj')

    const invalid = await admin('/accounts', 'POST', { name: 'X', cpfCnpj: '11111111111' })
    expect(invalid.body.errors[0].code).toBe('invalid_cpfCnpj')
  })

  it('deleting a profile removes everything it owns and nothing of the others', async () => {
    h = await createHarness()

    // Something in the master account that must survive.
    const keptCustomer = await h.api.call('create-new-customer', {
      body: { name: 'Fica', cpfCnpj: '24971563792' },
    })

    const profile = (await admin('/accounts', 'POST', { name: 'Some' })).body
    const as = h.as(profile.apiKey)

    await as.call('create-new-webhook', {
      body: {
        name: 'app',
        url: h.sink.url,
        email: 'app@localhost',
        sendType: 'SEQUENTIALLY',
        events: ['PAYMENT_RECEIVED'],
      },
    })
    const customer = await as.call('create-new-customer', {
      body: { name: 'Paciente', cpfCnpj: '24971563792' },
    })
    const payment = await as.call('create-new-payment', {
      body: { customer: customer.body.id, billingType: 'PIX', value: 50, dueDate: '2026-01-10' },
    })
    await as.call('confirm-payment', { params: { id: payment.body.id } })
    await as.call('create-subaccount', {
      body: {
        name: 'Filial',
        email: 'filial@localhost',
        cpfCnpj: '24971563792',
        mobilePhone: '47996321478',
        incomeValue: 25000,
        address: 'Rua A',
        addressNumber: '1',
        province: 'Centro',
        postalCode: '14079-452',
      },
    })

    const subs = await h.app.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.parentAccountId, profile.accountId))
    const family = [profile.accountId, ...subs.map((s) => s.id)]
    expect(family).toHaveLength(2)

    const deliveriesBefore = await h.app.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.accountId, profile.accountId))
    expect(deliveriesBefore.length).toBeGreaterThan(0)

    const res = await admin(`/accounts/${profile.accountId}`, 'DELETE')
    expect(res.status).toBe(200)
    expect(res.body.accounts).toBe(2)

    expect(await authenticates(profile.apiKey)).toBe(false)
    for (const table of [apiKeys, customers, payments, webhooks, webhookDeliveries]) {
      const left = await h.app.db.select().from(table).where(inArray(table.accountId, family))
      expect(left).toHaveLength(0)
    }
    expect(
      await h.app.db.select().from(accounts).where(inArray(accounts.id, family)),
    ).toHaveLength(0)

    // The master account is untouched.
    const kept = await h.api.call('retrieve-a-single-customer', {
      params: { id: keptCustomer.body.id },
    })
    expect(kept.status).toBe(200)
    expect(await authenticates(TEST_API_KEY)).toBe(true)
    await h.assertLedgerBalances()
  })

  it('a subaccount is closed through the API, not deleted as a profile', async () => {
    h = await createHarness()
    const sub = await h.api.call('create-subaccount', {
      body: {
        name: 'Filial',
        email: 'filial@localhost',
        cpfCnpj: '24971563792',
        mobilePhone: '47996321478',
        incomeValue: 25000,
        address: 'Rua A',
        addressNumber: '1',
        province: 'Centro',
        postalCode: '14079-452',
      },
    })

    const res = await admin(`/accounts/${sub.body.id}`, 'DELETE')
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_account')
  })

  it('an environment profile deleted in the panel comes back on the next boot', async () => {
    const extra = { apiKey: '$aact_hmlg_dev_tenant_a', name: 'Clinica A', cpfCnpj: '12345678000195' }
    h = await createHarness({ seedExtraAccounts: [extra] })

    const list = (await admin('/accounts')).body.accounts
    const tenant = list.find((a: any) => a.name === 'Clinica A')
    expect(tenant.seeded).toBe(true)

    await admin(`/accounts/${tenant.id}`, 'DELETE')
    expect(await authenticates(extra.apiKey)).toBe(false)

    const created = await reseed(h).extras()
    expect(created).toHaveLength(1)
    expect(await authenticates(extra.apiKey)).toBe(true)
  })

  it('the master deleted in the panel comes back on the next boot too', async () => {
    h = await createHarness()
    await admin(`/accounts/${h.accountId}`, 'DELETE')
    expect(await authenticates(TEST_API_KEY)).toBe(false)

    const seeded = await reseed(h).master()
    expect(seeded.created).toBe(true)
    expect(await authenticates(TEST_API_KEY)).toBe(true)
  })
})

describe('api keys', () => {
  const keyOf = async (accountId: string) =>
    (await admin(`/accounts/${accountId}/keys`)).body.keys as any[]

  it('a second key works beside the first; deleting it kills only it', async () => {
    h = await createHarness()

    const created = await admin(`/accounts/${h.accountId}/keys`, 'POST', { name: 'Backend' })
    expect(created.status).toBe(200)
    expect(created.body.name).toBe('Backend')
    expect(await authenticates(created.body.apiKey)).toBe(true)
    expect(await authenticates(TEST_API_KEY)).toBe(true)
    expect(await keyOf(h.accountId)).toHaveLength(2)

    await admin(`/accounts/${h.accountId}/keys/${created.body.id}`, 'DELETE')
    expect(await authenticates(created.body.apiKey)).toBe(false)
    expect(await authenticates(TEST_API_KEY)).toBe(true)
  })

  it('rotating replaces the key: the old one is a 401 on the next request', async () => {
    h = await createHarness()
    const [original] = await keyOf(h.accountId)

    const rotated = await admin(`/accounts/${h.accountId}/keys/${original.id}/rotate`, 'POST', {})
    expect(rotated.status).toBe(200)
    expect(rotated.body.apiKey).not.toBe(TEST_API_KEY)
    expect(rotated.body.name).toBe(original.name)

    expect(await authenticates(TEST_API_KEY)).toBe(false)
    expect(await authenticates(rotated.body.apiKey)).toBe(true)

    // The panel acts with the new key.
    const listed = (await admin('/accounts')).body.accounts.find((a: any) => a.id === h.accountId)
    expect(listed.apiKey).toBe(rotated.body.apiKey)

    // A restart does not seed a second master after the rotation.
    const before = (await h.app.db.select().from(accounts)).length
    const seeded = await reseed(h).master()
    expect(seeded.created).toBe(false)
    expect((await h.app.db.select().from(accounts)).length).toBe(before)
  })

  it('a disabled key is refused until enabled again', async () => {
    h = await createHarness()
    const [key] = await keyOf(h.accountId)

    await admin(`/accounts/${h.accountId}/keys/${key.id}`, 'PUT', { enabled: false })
    expect(await authenticates(TEST_API_KEY)).toBe(false)
    expect((await keyOf(h.accountId))[0].usable).toBe(false)

    await admin(`/accounts/${h.accountId}/keys/${key.id}`, 'PUT', { enabled: true })
    expect(await authenticates(TEST_API_KEY)).toBe(true)
  })

  it('a key expires with the virtual clock', async () => {
    h = await createHarness() // the clock starts on 2026-01-05

    const created = await admin(`/accounts/${h.accountId}/keys`, 'POST', {
      name: 'Curta',
      expirationDate: '2026-01-06',
    })
    expect(created.body.expirationDate).toBe('2026-01-06 23:59:59')
    expect(await authenticates(created.body.apiKey)).toBe(true)

    await h.advance({ days: 2 })
    expect(await authenticates(created.body.apiKey)).toBe(false)
    const listed = (await keyOf(h.accountId)).find((k) => k.id === created.body.id)
    expect(listed.expired).toBe(true)

    const bad = await admin(`/accounts/${h.accountId}/keys`, 'POST', { expirationDate: '06/01' })
    expect(bad.body.errors[0].code).toBe('invalid_expirationDate')
  })
})

describe('webhook settings', () => {
  it('lists every subscribable event, from the spec', async () => {
    h = await createHarness()
    const { events } = (await admin('/webhooks/events')).body
    expect(events).toContain('PAYMENT_RECEIVED')
    expect(events).toContain('SUBSCRIPTION_CREATED')
    expect(new Set(events).size).toBe(events.length)
  })

  it('narrows the delivery log to one account', async () => {
    h = await createHarness()
    await h.subscribeWebhook(['PAYMENT_RECEIVED'])
    const customer = await h.api.call('create-new-customer', {
      body: { name: 'Fulano', cpfCnpj: '24971563792' },
    })
    const pay = await h.api.call('create-new-payment', {
      body: { customer: customer.body.id, billingType: 'PIX', value: 10, dueDate: '2026-01-10' },
    })
    await h.api.call('confirm-payment', { params: { id: pay.body.id } })

    const mine = (await admin(`/webhooks/deliveries?accountId=${h.accountId}`)).body.data
    expect(mine.length).toBeGreaterThan(0)
    expect(mine[0].webhookName).toBe('sink')
    expect(mine[0].event).toBe('PAYMENT_RECEIVED')

    const other = (await admin('/accounts', 'POST', { name: 'Vazia' })).body
    expect((await admin(`/webhooks/deliveries?accountId=${other.accountId}`)).body.data).toHaveLength(0)
  })
})
