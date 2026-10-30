/**
 * The panel and the accounts' introspection.
 *
 * `GET /_admin/accounts` returns the API KEYS of every account — something the
 * Asaas's API would ever do. It is acceptable because this is a localhost simulator,
 * but only as long as it is really locked behind `ADMIN_ENABLED`. That is what the
 * last test of this file exists to guarantee: if someone moves the route out of
 * the admin block, the test breaks.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
afterEach(() => h?.close())

const get = (app: Harness['app'], path: string) =>
  app.app.handle(new Request(`http://localhost${path}`))

describe('panel', () => {
  it('is served at the root, as HTML', async () => {
    h = await createHarness()
    const res = await get(h.app, '/')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Asaas Mock')
  })

  /**
   * THE PANEL HAS TO BE A SINGLE FILE. It is the regression the front build introduced,
   * and it is silent in the worst way.
   *
   * The server serves ONE file: `src/admin/ui.html`. There is no static route. If
   * someone touches `vite.config.ts` and removes the `viteSingleFile`, Vite starts emitting
   * `<script src="/assets/index-a1b2c3.js">` — which the server does not know. The HTML
   * keeps answering 200, the test above keeps passing, and the panel opens
   * BLANK in everyone's container.
   */
  it('is self-contained: no external asset, or the panel opens blank in the container', async () => {
    h = await createHarness()
    const html = await (await get(h.app, '/')).text()

    // The JS and the CSS have to be INLINE.
    expect(html).toContain('<script')
    expect(html).not.toMatch(/<script[^>]+src=["']\/(assets|src)\//)
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']\/(assets|src)\//)

    // And the bundle has to have really gone in: an HTML with the shell and without
    // the app would pass the asserts above.
    expect(html.length).toBeGreaterThan(20_000)
  })

  /**
   * The routes the panel LIVES on. If one disappears, the screen loads and stays empty — with
   * error in the server's console, with nothing else. It is the kind of breakage that only shows up when
   * someone opens the panel, which can be weeks later.
   */
  it('the routes the panel consumes exist', async () => {
    h = await createHarness()
    const account = h.app.seed.accountId

    for (const path of [
      '/_admin/accounts',
      '/_admin/clock',
      '/_admin/test-cards',
      '/_admin/webhooks/queue',
      '/_admin/notify/status',
      `/_admin/summary?accountId=${account}`,
    ]) {
      const res = await get(h.app, path)
      expect(res.status, `${path} should answer 200`).toBe(200)
    }
  })

  it('lists the accounts with balance and key — subaccounts included', async () => {
    h = await createHarness()

    await h.api.call('create-subaccount', {
      body: {
        name: 'Partner Store',
        email: 'loja@localhost',
        cpfCnpj: '24971563792',
        mobilePhone: '47996321478',
        incomeValue: 25000,
        address: 'Street A',
        addressNumber: '1',
        province: 'Center',
        postalCode: '14079-452',
      },
    })

    const body = (await (await get(h.app, '/_admin/accounts')).json()) as any
    expect(body.accounts.length).toBe(2)

    const principal = body.accounts.find((a: any) => !a.parentAccountId)
    const sub = body.accounts.find((a: any) => a.parentAccountId)

    expect(principal.id).toBe(h.accountId)
    expect(sub.parentAccountId).toBe(h.accountId)

    // What the panel needs from each account, and that Asaas's API does not give:
    for (const a of [principal, sub]) {
      expect(a.apiKey).toStartWith('$aact_hmlg_')
      expect(a.walletId).toBeString()
      expect(a.balance).toBe(0) // in REAIS, not cents
    }

    // Distinct wallets — it is what gives the split somewhere to go.
    expect(sub.walletId).not.toBe(principal.walletId)
  })

  it('the balance comes in REAIS, and follows the ledger', async () => {
    h = await createHarness()

    const customer = await h.api.call('create-new-customer', {
      body: { name: 'Fulano', cpfCnpj: '24971563792' },
    })
    const pay = await h.api.call('create-new-payment', {
      body: {
        customer: customer.body.id,
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-10',
      },
    })
    await h.api.call('confirm-payment', { params: { id: pay.body.id } })

    const body = (await (await get(h.app, '/_admin/accounts')).json()) as any
    const principal = body.accounts.find((a: any) => !a.parentAccountId)

    // 100 − 1.99 of Pix fee. In reais: the panel displays it directly.
    expect(principal.balance).toBe(98.01)
    await h.assertLedgerBalances()
  })

  it('lists the removed customers of an account apart from the active ones', async () => {
    h = await createHarness()

    const kept = await h.api.call('create-new-customer', {
      body: { name: 'Active', cpfCnpj: '24971563792' },
    })
    const gone = await h.api.call('create-new-customer', {
      body: { name: 'Removed', cpfCnpj: '24971563792' },
    })
    await h.api.call('remove-customer', { params: { id: gone.body.id } })

    const removed = (await (
      await get(h.app, `/_admin/customers?accountId=${h.accountId}&removed=true`)
    ).json()) as any
    expect(removed.data.map((c: any) => c.id)).toEqual([gone.body.id])
    expect(removed.data[0].deleted).toBe(true)

    const active = (await (await get(h.app, `/_admin/customers?accountId=${h.accountId}`)).json()) as any
    expect(active.data.map((c: any) => c.id)).toEqual([kept.body.id])
  })

  it('the summary leaves deleted charges out, as the charge list does', async () => {
    h = await createHarness()

    const customer = await h.api.call('create-new-customer', {
      body: { name: 'Fulano', cpfCnpj: '24971563792' },
    })
    const kept = await h.api.call('create-new-payment', {
      body: { customer: customer.body.id, billingType: 'BOLETO', value: 150, dueDate: '2026-12-10' },
    })
    const gone = await h.api.call('create-new-payment', {
      body: { customer: customer.body.id, billingType: 'BOLETO', value: 283.66, dueDate: '2026-12-10' },
    })
    expect(kept.status).toBe(200)
    await h.api.call('delete-payment', { params: { id: gone.body.id } })

    const body = (await (await get(h.app, `/_admin/summary?accountId=${h.accountId}`)).json()) as any
    const awaiting = body.groups.find((g: any) => g.group === 'AWAITING')
    expect(awaiting.count).toBe(1)
    expect(awaiting.value).toBe(150)
    expect(awaiting.customers).toBe(1)
  })

  it('with ADMIN_ENABLED=false, the panel disappears and the keys do not leak', async () => {
    h = await createHarness({ adminEnabled: false })

    // The panel's route is not even mounted.
    expect((await get(h.app, '/')).status).toBe(404)

    // And the endpoint that exposes the keys refuses.
    const res = await get(h.app, '/_admin/accounts')
    expect(res.status).toBeGreaterThanOrEqual(400)

    const body = (await res.json()) as any
    expect(JSON.stringify(body)).not.toContain('$aact_')
  })
})
