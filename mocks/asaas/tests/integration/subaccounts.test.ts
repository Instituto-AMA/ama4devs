/**
 * Subaccounts.
 *
 * What this file proves, and that is the whole point: the subaccount is born with its **own
 * API key** and its **own walletId**. The key WORKS, and the subaccount is
 * ISOLATED — it does not see the charges of the account that created it.
 *
 * It is what separates "split" from "a real split": without two authenticable accounts, the
 * destination walletId would be a string with no owner and the money would have nowhere to
 * go.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

/** The minimum body the spec requires. */
const body = (over: Record<string, unknown> = {}) => ({
  name: 'Loja do Fulano',
  email: 'loja@localhost',
  cpfCnpj: '12345678909',
  mobilePhone: '11999998888',
  incomeValue: 25000,
  address: 'Rua Fernando Orlandi',
  addressNumber: '544',
  province: 'Jardim Pedra Branca',
  postalCode: '14079-452',
  ...over,
})

describe('creation', () => {
  it('returns 200 (never 201), with its own apiKey and walletId', async () => {
    const res = await h.api.call('create-subaccount', { body: body() })

    expect(res.status).toBe(200)
    expect(res.body.object).toBe('account')
    expect(res.body.id).toBeString()
    expect(res.body.walletId).toBeString()
    expect(res.body.walletId).not.toBe(h.walletId)

    // The key only appears HERE. It is the only time.
    expect(res.body.apiKey).toStartWith('$aact_hmlg_')
    expect(res.body.accessToken.apiKey).toBe(res.body.apiKey)

    expect(res.body.personType).toBe('FISICA')
    expect(res.body.cpfCnpj).toBe('12345678909')
    // In the sandbox the account is born approved — there is no analysis to wait for.
    expect(res.body.accountNumber.agency).toBe('0001')
  })

  it("the subaccount's key WORKS and the subaccount is ISOLATED from the parent account", async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })
    const as = h.as(sub.body.apiKey)

    // The parent account creates a charge.
    const cus = await h.api.call('create-new-customer', {
      body: { name: "Parent's Customer", cpfCnpj: '24971563792' },
    })
    await h.api.call('create-new-payment', {
      body: { customer: cus.body.id, billingType: 'PIX', value: 100, dueDate: '2026-01-10' },
    })

    expect((await h.api.call('list-payments')).body.totalCount).toBe(1)

    // The subaccount sees NONE of that. Neither the charge nor the customer.
    expect((await as.call('list-payments')).body.totalCount).toBe(0)
    expect((await as.call('list-customers')).body.totalCount).toBe(0)

    // But it has its own life: it creates its own customer and charge.
    const own = await as.call('create-new-customer', {
      body: { name: "Subaccount's Customer", cpfCnpj: '98765432100' },
    })
    expect(own.status).toBe(200)

    const p = await as.call('create-new-payment', {
      body: { customer: own.body.id, billingType: 'PIX', value: 40, dueDate: '2026-01-10' },
    })
    expect(p.status).toBe(200)

    expect((await as.call('list-payments')).body.totalCount).toBe(1)
    expect((await h.api.call('list-payments')).body.totalCount).toBe(1) // the parent keeps its own
  })

  it('a CNPJ becomes a JURIDICAL account', async () => {
    const res = await h.api.call('create-subaccount', {
      body: body({ cpfCnpj: '11223344000186', companyType: 'LIMITED' }),
    })
    expect(res.body.personType).toBe('JURIDICA')
    expect(res.body.companyType).toBe('LIMITED')
  })

  it('a CPF with a wrong check digit is rejected', async () => {
    const res = await h.api.call('create-subaccount', {
      body: body({ cpfCnpj: '11111111111' }),
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_cpfCnpj')
  })

  it('there are not two accounts with the same document', async () => {
    await h.api.call('create-subaccount', { body: body() })
    const dup = await h.api.call('create-subaccount', {
      body: body({ email: 'other@localhost' }),
    })
    expect(dup.status).toBe(400)
    expect(dup.body.errors[0].code).toBe('invalid_cpfCnpj')
  })

  it('the webhooks given at creation are registered in the subaccount', async () => {
    const sub = await h.api.call('create-subaccount', {
      body: body({
        webhooks: [
          {
            name: 'My webhook',
            url: 'http://localhost:9999/hook',
            email: 'dev@localhost',
            sendType: 'SEQUENTIALLY',
            events: ['PAYMENT_RECEIVED'],
          },
        ],
      }),
    })

    // Ignoring them silently would make the integrator think it had subscribed to events that
    // would never arrive.
    const as = h.as(sub.body.apiKey)
    const list = await as.call('list-webhooks')
    expect(list.body.totalCount).toBe(1)
    expect(list.body.data[0].url).toBe('http://localhost:9999/hook')
  })
})

describe('listing and retrieval', () => {
  it("lists only this account's subaccounts, with filters", async () => {
    const a = await h.api.call('create-subaccount', { body: body() })
    await h.api.call('create-subaccount', {
      body: body({ name: 'Another Store', cpfCnpj: '98765432100', email: 'other@localhost' }),
    })

    const all = await h.api.call('list-subaccounts')
    expect(all.body.object).toBe('list')
    expect(all.body.totalCount).toBe(2)

    const byDoc = await h.api.call('list-subaccounts', { query: { cpfCnpj: '123.456.789-09' } })
    expect(byDoc.body.totalCount).toBe(1)
    expect(byDoc.body.data[0].id).toBe(a.body.id)

    const byWallet = await h.api.call('list-subaccounts', {
      query: { walletId: a.body.walletId },
    })
    expect(byWallet.body.totalCount).toBe(1)

    // The subaccount is not its own owner: it lists nobody.
    const as = h.as(a.body.apiKey)
    expect((await as.call('list-subaccounts')).body.totalCount).toBe(0)
  })

  it('retrieves by id; a subaccount from another account is a 404, not a 403', async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })

    const one = await h.api.call('retrieve-a-single-subaccount', {
      params: { id: sub.body.id },
    })
    expect(one.body.id).toBe(sub.body.id)
    expect(one.body.walletId).toBe(sub.body.walletId)

    const other = h.as(sub.body.apiKey)
    const nope = await other.call('retrieve-a-single-subaccount', {
      params: { id: h.accountId },
    })
    expect(nope.status).toBe(404)
  })
})

describe("the subaccount's API keys", () => {
  it('creates a new key, which works, and the listing NEVER returns the secret', async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })

    const created = await h.api.call('create-api-key-for-subaccount', {
      params: { id: sub.body.id },
      body: { name: 'CI Key' },
    })

    expect(created.status).toBe(200)
    expect(created.body.apiKey).toStartWith('$aact_hmlg_')
    expect(created.body.enabled).toBe(true)

    // The new key really authenticates.
    const as = h.as(created.body.apiKey)
    expect((await as.call('list-payments')).status).toBe(200)

    const list = await h.api.call('list-api-keys-for-subaccount', {
      params: { id: sub.body.id },
    })
    expect(list.body.accessTokens.length).toBe(2) // a principal + a do CI
    // The secret does not come back in a listing. If it did, we would teach the integrator
    // to trust in something the real API never delivers.
    expect(list.body.accessTokens.every((k: any) => k.apiKey === undefined)).toBe(true)
  })

  it('disabling the key kills it in practice — the next request is a 401', async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })
    const key = await h.api.call('create-api-key-for-subaccount', {
      params: { id: sub.body.id },
      body: { name: 'Temporary' },
    })

    const as = h.as(key.body.apiKey)
    expect((await as.call('list-payments')).status).toBe(200)

    const updated = await h.api.call('update-api-key-for-a-subaccount', {
      params: { id: sub.body.id, accessTokenId: key.body.id },
      body: { name: 'Revogada', enabled: false, expirationDate: '2026-12-31 12:30:50' },
    })
    expect(updated.status).toBe(200)
    expect(updated.body.enabled).toBe(false)
    expect(updated.body.disabledReason).toBe('MANUAL')

    expect((await as.call('list-payments')).status).toBe(401)
  })

  it('deleting the key returns 204 and the key stops existing', async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })
    const key = await h.api.call('create-api-key-for-subaccount', {
      params: { id: sub.body.id },
      body: {},
    })

    const del = await h.api.call('delete-api-key-for-a-subaccount', {
      params: { id: sub.body.id, accessTokenId: key.body.id },
    })
    expect(del.status).toBe(204)

    expect((await h.as(key.body.apiKey).call('list-payments')).status).toBe(401)

    const list = await h.api.call('list-api-keys-for-subaccount', {
      params: { id: sub.body.id },
    })
    expect(list.body.accessTokens.length).toBe(1)
  })
})

describe('closing and activation', () => {
  it('closing the subaccount invalidates its keys', async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })
    const as = h.as(sub.body.apiKey)
    expect((await as.call('list-payments')).status).toBe(200)

    const closed = await h.api.call('close-non-baas-subaccount', {
      params: { id: sub.body.id },
    })
    expect(closed.status).toBe(200)
    expect(closed.body.deleted).toBe(true)
    expect(closed.body.id).toBe(sub.body.id)

    expect((await as.call('list-payments')).status).toBe(401)
  })

  it('resending the activation link returns 204', async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })
    const res = await h.api.call('resend-activation-link-for-non-baas-subaccount', {
      params: { id: sub.body.id },
      body: {},
    })
    expect(res.status).toBe(204)
  })
})

describe('the point of all this: the split between account and subaccount', () => {
  it('R$ 100 by Pix with 30% to the subaccount — and both statements balance', async () => {
    const sub = await h.api.call('create-subaccount', { body: body() })

    const cus = await h.api.call('create-new-customer', {
      body: { name: 'Cliente', cpfCnpj: '24971563792' },
    })

    const p = await h.api.call('create-new-payment', {
      body: {
        customer: cus.body.id,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
        split: [{ walletId: sub.body.walletId, percentualValue: 30 }],
      },
    })

    await h.api.call('confirm-payment', { params: { id: p.body.id } })
    await h.tick()

    // The subaccount sees the split as RECEIVED, with ITS OWN key.
    const as = h.as(sub.body.apiKey)
    const received = await as.call('list-received-splits')

    expect(received.body.totalCount).toBe(1)
    expect(received.body.data[0].totalValue).toBe(29.4) // 30% of 98.01
    expect(received.body.data[0].destinationAccountId).toBe(sub.body.id)
    expect(received.body.data[0].status).toBe('DONE')

    await h.assertLedgerBalances()
  })
})
