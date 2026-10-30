/**
 * Resetting a profile (`POST /_admin/accounts/:id/reset`).
 *
 * What this file proves: the account and its keys survive every reset; each
 * group empties what it names for the profile and its subaccounts, and drags
 * along what cannot live without it; `cancelCharges` sends PAYMENT_DELETED and
 * SUBSCRIPTION_DELETED to the webhooks BEFORE anything is deleted; and every
 * table an account owns is either emptied by some group or kept on purpose.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'bun:test'
import { GROUP_TABLES, KEPT_TABLES } from '../../src/admin/reset.ts'
import {
  accounts,
  customers,
  financialTransactions,
  invoices,
  payments,
  requestLogs,
  subscriptions,
  webhookEvents,
  webhooks,
} from '../../src/db/schema/index.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

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

const reset = (body: unknown) => admin(`/accounts/${h.accountId}/reset`, 'POST', body)

/**
 * The master with a customer, an open charge, a paid one, a subscription, a
 * subaccount and a webhook — and the money of the paid charge in its statement.
 */
async function populate() {
  await h.subscribeWebhook(['PAYMENT_DELETED', 'SUBSCRIPTION_DELETED', 'PAYMENT_CREATED'])
  const customer = (
    await h.api.call('create-new-customer', { body: { name: 'Paciente', cpfCnpj: '24971563792' } })
  ).body.id
  const open = (
    await h.api.call('create-new-payment', {
      body: { customer, billingType: 'PIX', value: 50, dueDate: '2026-01-10' },
    })
  ).body.id
  const paid = (
    await h.api.call('create-new-payment', {
      body: { customer, billingType: 'PIX', value: 80, dueDate: '2026-01-10' },
    })
  ).body.id
  await h.api.call('confirm-payment', { params: { id: paid } })
  const subscription = (
    await h.api.call('create-new-subscription', {
      body: {
        customer,
        billingType: 'BOLETO',
        value: 19.9,
        nextDueDate: '2026-02-15',
        cycle: 'MONTHLY',
      },
    })
  ).body.id
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
  await h.app.scheduler.idle()
  h.sink.clear()
  return { customer, open, paid, subscription, subaccount: sub.body.id as string }
}

const countOf = async (table: any) =>
  (await h.app.db.select().from(table).where(eq(table.accountId, h.accountId))).length

describe('profile reset', () => {
  it('everything: an empty account with the same id and key', async () => {
    h = await createHarness()
    const { subaccount } = await populate()

    const res = await reset({
      remove: {
        customers: true,
        subaccounts: true,
        charges: true,
        invoices: true,
        webhooks: true,
        logs: true,
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.subaccounts).toBe(1)
    expect(res.body.cancelled).toBeNull()

    for (const table of [customers, payments, subscriptions, financialTransactions, webhooks, webhookEvents, requestLogs]) {
      expect(await countOf(table)).toBe(0)
    }
    expect(await h.app.db.select().from(accounts).where(eq(accounts.id, subaccount))).toHaveLength(0)

    const [master] = await h.app.db.select().from(accounts).where(eq(accounts.id, h.accountId))
    expect(master!.balanceCents).toBe(0 as never)
    // The key keeps working: the app's configuration does not change.
    expect((await h.api.call('list-customers')).status).toBe(200)
    await h.assertLedgerBalances()
  })

  it('keeping customers and subaccounts empties the charges and the money only', async () => {
    h = await createHarness()
    const { customer, subaccount } = await populate()

    const res = await reset({ remove: { charges: true, logs: true } })
    expect(res.body.removed).toEqual(['charges', 'invoices', 'logs'])

    expect(await countOf(payments)).toBe(0)
    expect(await countOf(financialTransactions)).toBe(0)
    expect(await countOf(requestLogs)).toBe(0)
    // Kept: the customer, the subaccount and the webhook.
    expect((await h.api.call('retrieve-a-single-customer', { params: { id: customer } })).status).toBe(200)
    expect(await h.app.db.select().from(accounts).where(eq(accounts.id, subaccount))).toHaveLength(1)
    expect(await countOf(webhooks)).toBe(1)
    await h.assertLedgerBalances()
  })

  it('removing customers drags their charges and invoices along', async () => {
    h = await createHarness()
    await populate()

    const res = await reset({ remove: { customers: true } })
    expect(res.status).toBe(200)
    expect(res.body.removed).toEqual(['customers', 'charges', 'invoices'])
    expect(await countOf(customers)).toBe(0)
    expect(await countOf(payments)).toBe(0)
    await h.assertLedgerBalances()
  })

  it('cancelling first sends PAYMENT_DELETED and SUBSCRIPTION_DELETED before the delete', async () => {
    h = await createHarness()
    const { open, paid, subscription } = await populate()

    const res = await reset({ cancelCharges: true, remove: { charges: true, webhooks: true, logs: true } })
    expect(res.status).toBe(200)
    // The open charge and the subscription's first charge; the paid one is not removable.
    expect(res.body.cancelled.payments).toBe(2)
    expect(res.body.cancelled.subscriptions).toBe(1)
    expect(res.body.cancelled.webhooks.notDelivered).toBe(0)
    expect(res.body.cancelled.webhooks.delivered).toBeGreaterThanOrEqual(3)

    const deleted = h.sink.eventsOf('PAYMENT_DELETED').map((r) => r.payload.payment.id)
    expect(deleted).toContain(open)
    expect(deleted).not.toContain(paid)
    expect(h.sink.eventsOf('SUBSCRIPTION_DELETED').map((r) => r.payload.subscription.id)).toEqual([
      subscription,
    ])
    expect(await countOf(payments)).toBe(0)
    expect(await countOf(webhooks)).toBe(0)
  })

  it('cancelling alone keeps the charges, removed, as the API leaves them', async () => {
    h = await createHarness()
    const { open, paid } = await populate()

    const res = await reset({ cancelCharges: true })
    expect(res.status).toBe(200)
    expect(res.body.removed).toEqual([])

    const rows = await h.app.db
      .select({ id: payments.id, deleted: payments.deleted })
      .from(payments)
      .where(inArray(payments.id, [open, paid]))
    expect(Object.fromEntries(rows.map((r) => [r.id, r.deleted]))).toEqual({
      [open]: true,
      [paid]: false,
    })
    await h.assertLedgerBalances()
  })

  it('cancelling first cancels the notes too, through the city hall, before they are deleted', async () => {
    h = await createHarness()
    await h.subscribeWebhook(['INVOICE_CANCELED', 'INVOICE_PROCESSING_CANCELLATION'])
    const { open, paid } = await populate()
    const note = async (payment: string) =>
      (
        await h.api.call('schedule-invoice', {
          body: {
            payment,
            serviceDescription: 'Consultation',
            observations: '',
            value: 50,
            deductions: 0,
            effectiveDate: '2026-01-05',
            municipalServiceName: 'Fisioterapia',
            taxes: { retainIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
          },
        })
      ).body.id
    const scheduled = await note(open)
    const issued = await note(paid)
    await h.app.app.handle(new Request(`http://localhost/_mock/invoices/${issued}/authorize`, { method: 'POST' }))
    await h.app.scheduler.dispatchNow()
    h.sink.clear()

    const res = await reset({ cancelCharges: true, remove: { charges: true, invoices: true } })
    expect(res.status).toBe(200)
    expect(res.body.cancelled.invoices).toBe(2)
    expect(h.sink.eventsOf('INVOICE_CANCELED').map((r) => r.payload.invoice.id).sort()).toEqual(
      [scheduled, issued].sort(),
    )
    expect(h.sink.eventsOf('INVOICE_PROCESSING_CANCELLATION').map((r) => r.payload.invoice.id)).toEqual([issued])
    expect(await countOf(invoices)).toBe(0)
  })

  it('notes alone: the invoices go, the charges stay', async () => {
    h = await createHarness()
    const { open } = await populate()
    await h.api.call('schedule-invoice', {
      body: {
        payment: open,
        serviceDescription: 'Consultation',
        observations: '',
        value: 50,
        deductions: 0,
        effectiveDate: '2026-01-05',
        municipalServiceName: 'Fisioterapia',
        taxes: { retainIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
      },
    })
    expect(await countOf(invoices)).toBe(1)

    const res = await reset({ remove: { invoices: true } })
    expect(res.body.removed).toEqual(['invoices'])
    expect(await countOf(invoices)).toBe(0)
    expect(await countOf(payments)).toBeGreaterThan(0)
    await h.assertLedgerBalances()
  })

  it('refuses an empty choice and a subaccount', async () => {
    h = await createHarness()
    const { subaccount } = await populate()

    const empty = await reset({})
    expect(empty.status).toBe(400)
    expect(empty.body.errors[0].code).toBe('invalid_reset')

    const sub = await admin(`/accounts/${subaccount}/reset`, 'POST', { remove: { charges: true } })
    expect(sub.status).toBe(400)
    expect(sub.body.errors[0].code).toBe('invalid_account')
  })

  it('every table an account owns is emptied by a group or kept on purpose', async () => {
    h = await createHarness()
    const tables = await h.app.db.all<{ name: string }>(
      sql`select m.name from sqlite_master m where m.type = 'table'
          and exists (select 1 from pragma_table_info(m.name) where name = 'account_id')`,
    )
    const classified = new Set([...Object.values(GROUP_TABLES).flat(), ...KEPT_TABLES])
    expect(tables.map((t) => t.name).filter((t) => !classified.has(t))).toEqual([])
    // And no group names a table that does not exist.
    const names = new Set(tables.map((t) => t.name))
    expect([...classified].filter((t) => !names.has(t))).toEqual([])
  })
})
