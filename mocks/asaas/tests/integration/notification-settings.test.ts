/**
 * A customer's notification settings and the notices they schedule.
 *
 * Asaas creates eight settings with every customer
 * (https://docs.asaas.com/docs/notificacoes-padroes); here e-mail, SMS and
 * WhatsApp all start on (the mock's divergence, progress.md). What this file
 * proves: the list endpoint answers the eight in Asaas's envelope and only to the
 * customer's own account; a setting turned off silences its event; the warning
 * goes out N days before the due date and on the due day; an overdue charge is
 * told again every N days while unpaid, once per day; a moved offset moves the
 * day; a subscription's charge is not told on creation.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { notificationDeliveries } from '../../src/db/schema/index.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'
import { WebhookSink } from '../helpers/webhook-sink.ts'

let h: Harness
let mail: WebhookSink
let whatsapp: WebhookSink
afterEach(() => {
  h?.close()
  mail?.stop()
  whatsapp?.stop()
})

async function boot() {
  mail = await WebhookSink.start()
  whatsapp = await WebhookSink.start()
  h = await createHarness({
    notify: {
      mailpitUrl: mail.url,
      whatsappUrl: whatsapp.url,
      whatsappPhoneNumberId: '5511400000000',
      fromEmail: 'notificacoes@asaas.localhost',
      maxAttempts: 5,
    },
  })
}

async function customer(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Maria Teste', cpfCnpj: '24971563792', email: 'maria@localhost', mobilePhone: '47999998888', ...extra },
  })
  expect(res.status).toBe(200)
  return res.body.id
}

/** Today is 2026-01-05 (TEST_CLOCK_START). */
async function charge(cus: string, dueDate = '2026-01-20') {
  const res = await h.api.call('create-new-payment', {
    body: { customer: cus, billingType: 'BOLETO', value: 150, dueDate, description: 'Consulta' },
  })
  expect(res.status).toBe(200)
  return res.body
}

async function settings(cus: string) {
  const res = await h.api.call('retrieve-notifications-from-a-customer', { params: { id: cus }, query: { limit: 100 } })
  expect(res.status).toBe(200)
  return res.body.data as any[]
}

/** Turns a customer's settings, picked by event and offset, into `patch`. */
async function update(cus: string, pick: (n: any) => boolean, patch: Record<string, unknown>) {
  const items = (await settings(cus)).filter(pick).map((n) => ({ id: n.id, ...patch }))
  const res = await h.api.call('update-existing-notifications-in-batch', { body: { customer: cus, notifications: items } })
  expect(res.status).toBe(200)
}

/** Each notice told so far, as `day event channel`, in order. */
async function told(): Promise<string[]> {
  const rows = await h.app.db.select().from(notificationDeliveries)
  return rows
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map((r) => `${r.dateCreated.slice(0, 10)} ${r.event} ${r.channel}`)
}

describe('customer notification settings', () => {
  it('a new customer has the eight defaults, every payer channel on', async () => {
    await boot()
    const cus = await customer()

    const res = await h.api.call('retrieve-notifications-from-a-customer', { params: { id: cus } })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ object: 'list', hasMore: false, totalCount: 8, limit: 10, offset: 0 })
    expect(res.body.data.map((n: any) => `${n.event}/${n.scheduleOffset}`)).toEqual([
      'PAYMENT_CREATED/0',
      'PAYMENT_DUEDATE_WARNING/0',
      'PAYMENT_RECEIVED/0',
      'SEND_LINHA_DIGITAVEL/0',
      'PAYMENT_OVERDUE/0',
      'PAYMENT_OVERDUE/7',
      'PAYMENT_DUEDATE_WARNING/10',
      'PAYMENT_UPDATED/0',
    ])
    for (const n of res.body.data) {
      expect(n).toMatchObject({
        object: 'notification',
        customer: cus,
        enabled: true,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: true,
        whatsappEnabledForCustomer: true,
        deleted: false,
      })
      expect(n.id).toMatch(/^not_/)
    }

    const page = await h.api.call('retrieve-notifications-from-a-customer', { params: { id: cus }, query: { limit: 3, offset: 6 } })
    expect(page.body).toMatchObject({ hasMore: false, totalCount: 8, limit: 3, offset: 6 })
    expect(page.body.data).toHaveLength(2)
  })

  it('another account cannot read them', async () => {
    await boot()
    const cus = await customer()
    const other = await createSecondAccount(h)
    const res = await h.as(other.apiKey).call('retrieve-notifications-from-a-customer', { params: { id: cus } })
    expect(res.status).toBe(404)
  })

  it('a setting turned off silences its event; the other channels follow their flags', async () => {
    await boot()
    const cus = await customer()
    await update(cus, (n) => n.event === 'PAYMENT_CREATED', { enabled: false })
    await update(cus, () => true, { whatsappEnabledForCustomer: false, smsEnabledForCustomer: false })

    await charge(cus)
    await h.tick()
    expect(await told()).toEqual([])
  })

  it('warns 10 days before and on the due day, then tells the overdue charge every 7 days', async () => {
    await boot()
    const cus = await customer()
    await update(cus, () => true, { whatsappEnabledForCustomer: false })
    await update(cus, (n) => n.event === 'PAYMENT_CREATED', { enabled: false })
    await charge(cus, '2026-01-20')

    await h.advance({ days: 30 })

    expect(await told()).toEqual([
      '2026-01-10 PAYMENT_DUEDATE_WARNING EMAIL',
      '2026-01-20 PAYMENT_DUEDATE_WARNING EMAIL',
      '2026-01-21 PAYMENT_OVERDUE EMAIL',
      '2026-01-27 PAYMENT_OVERDUE EMAIL',
      '2026-02-03 PAYMENT_OVERDUE EMAIL',
    ])
    expect(mail.received.filter((r) => r.payload?.Subject)).toHaveLength(5)
  })

  it('a moved offset moves the day, and a repeat on the overdue day is told once', async () => {
    await boot()
    const cus = await customer()
    await update(cus, () => true, { whatsappEnabledForCustomer: false })
    await update(cus, (n) => n.event === 'PAYMENT_CREATED', { enabled: false })
    await update(cus, (n) => n.event === 'PAYMENT_DUEDATE_WARNING' && n.scheduleOffset === 10, { scheduleOffset: 5 })
    await update(cus, (n) => n.event === 'PAYMENT_DUEDATE_WARNING' && n.scheduleOffset === 0, { enabled: false })
    await update(cus, (n) => n.event === 'PAYMENT_OVERDUE' && n.scheduleOffset === 7, { scheduleOffset: 1 })
    await charge(cus, '2026-01-20')

    await h.advance({ days: 18 })

    expect(await told()).toEqual([
      '2026-01-15 PAYMENT_DUEDATE_WARNING EMAIL',
      '2026-01-21 PAYMENT_OVERDUE EMAIL',
      '2026-01-22 PAYMENT_OVERDUE EMAIL',
      '2026-01-23 PAYMENT_OVERDUE EMAIL',
    ])
  })

  it('a customer with notifications disabled hears nothing on any day', async () => {
    await boot()
    await charge(await customer({ notificationDisabled: true }), '2026-01-10')
    await h.advance({ days: 15 })
    expect(await told()).toEqual([])
  })

  it('a subscription charge is not told on creation', async () => {
    await boot()
    const cus = await customer()
    const res = await h.api.call('create-new-subscription', {
      body: { customer: cus, billingType: 'BOLETO', value: 99, nextDueDate: '2026-01-30', cycle: 'MONTHLY', description: 'Plano' },
    })
    expect(res.status).toBe(200)
    await h.tick()
    expect((await told()).filter((t) => t.includes('PAYMENT_CREATED'))).toEqual([])
  })
})
