/**
 * The payer notifications: the e-mail Asaas sends (to Mailpit's send API) and the
 * WhatsApp template (to the WhatsApp mock's Cloud API), per charge event.
 *
 * Two real HTTP receivers stand in for Mailpit and the WhatsApp mock. What this file
 * proves: a new charge sends both, with the charge's value, due date and invoice link
 * as the template's parameters; a customer with notifications off gets nothing; the
 * panel's forced send goes on the channels it names even for an event that did not
 * happen; a channel that is not configured queues nothing and refuses a forced send;
 * a receiver that fails keeps the notification pending and then marks it failed.
 */
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'bun:test'
import { notificationDeliveries } from '../../src/db/schema/index.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'
import { WebhookSink } from '../helpers/webhook-sink.ts'

let h: Harness
let mail: WebhookSink
let whatsapp: WebhookSink
afterEach(() => {
  h?.close()
  mail?.stop()
  whatsapp?.stop()
})

async function boot(opts: { channels?: boolean; maxAttempts?: number } = {}) {
  mail = await WebhookSink.start()
  whatsapp = await WebhookSink.start()
  const on = opts.channels ?? true
  h = await createHarness({
    notify: {
      mailpitUrl: on ? mail.url : undefined,
      whatsappUrl: on ? whatsapp.url : undefined,
      whatsappPhoneNumberId: '5511400000000',
      fromEmail: 'notificacoes@asaas.localhost',
      maxAttempts: opts.maxAttempts ?? 5,
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

async function charge(cus: string) {
  const res = await h.api.call('create-new-payment', {
    body: { customer: cus, billingType: 'PIX', value: 150, dueDate: '2026-01-20', description: 'Consulta' },
  })
  expect(res.status).toBe(200)
  return res.body
}

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

const rows = () => h.app.db.select().from(notificationDeliveries)

describe('payer notifications', () => {
  it('a new charge sends the e-mail to Mailpit and the template to the WhatsApp mock', async () => {
    await boot()
    const p = await charge(await customer())
    await h.tick()

    const email = mail.received.find((r) => r.payload?.Subject)
    expect(email?.payload.To[0].Email).toBe('maria@localhost')
    expect(email?.payload.Subject).toContain('R$ 150,00')
    expect(email?.payload.Text).toContain(p.invoiceUrl)
    expect(email?.payload.HTML).toContain('Ver fatura e pagar')

    const wa = whatsapp.received.find((r) => r.payload?.template)
    expect(wa?.payload.to).toBe('5547999998888')
    expect(wa?.payload.template.name).toBe('asaas_cobranca_criada')
    expect(wa?.payload.template.language.code).toBe('pt_BR')
    const params = wa?.payload.template.components[0].parameters.map((x: any) => x.text)
    expect(params).toEqual(['Maria Teste', 'Conta de Teste', 'R$ 150,00', '20/01/2026', p.invoiceUrl])

    const sent = await rows()
    expect(sent.map((r) => [r.channel, r.event, r.status]).sort()).toEqual([
      ['EMAIL', 'PAYMENT_CREATED', 'SENT'],
      ['WHATSAPP', 'PAYMENT_CREATED', 'SENT'],
    ])
  })

  it('a customer with notifications off gets nothing', async () => {
    await boot()
    await charge(await customer({ notificationDisabled: true }))
    await h.tick()
    expect(await rows()).toHaveLength(0)
    expect(mail.received).toHaveLength(0)
  })

  it('the panel forces a notification on the channels it names', async () => {
    await boot()
    const p = await charge(await customer())
    await h.tick()
    mail.clear()
    whatsapp.clear()

    const res = await admin('/notifications', 'POST', {
      paymentId: p.id,
      event: 'PAYMENT_OVERDUE',
      channels: ['WHATSAPP'],
    })
    expect(res.status).toBe(200)
    expect(res.body.queued).toBe(1)
    await h.tick()

    expect(mail.received).toHaveLength(0)
    expect(whatsapp.received[0]?.payload.template.name).toBe('asaas_cobranca_vencida')

    const list = await admin(`/notifications?paymentId=${p.id}`)
    expect(list.body.channels).toEqual({ email: true, whatsapp: true })
    expect(list.body.data.find((r: any) => r.event === 'PAYMENT_OVERDUE')?.forced).toBe(true)
  })

  it('without channels configured nothing is queued and a forced send is refused', async () => {
    await boot({ channels: false })
    const p = await charge(await customer())
    await h.tick()
    expect(await rows()).toHaveLength(0)

    const res = await admin('/notifications', 'POST', { paymentId: p.id, event: 'PAYMENT_CREATED', channels: ['EMAIL'] })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('notify_not_configured')
  })

  it('a customer without a phone gets the e-mail only; forcing WhatsApp is refused', async () => {
    await boot()
    const p = await charge(await customer({ mobilePhone: undefined }))
    await h.tick()
    expect((await rows()).map((r) => r.channel)).toEqual(['EMAIL'])

    const res = await admin('/notifications', 'POST', { paymentId: p.id, event: 'PAYMENT_CREATED', channels: ['WHATSAPP'] })
    expect(res.body.errors[0].code).toBe('notify_no_recipient')
  })

  it('a failing receiver keeps the notification pending, then marks it failed', async () => {
    await boot({ maxAttempts: 2 })
    mail.respondWith(500)
    whatsapp.respondWith(500)
    await charge(await customer())

    await h.tick()
    let [first] = await rows()
    expect(first?.status).toBe('PENDING')
    expect(first?.lastError).toContain('HTTP 500')

    await h.tick()
    ;[first] = await h.app.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, first!.id))
    expect(first?.status).toBe('FAILED')
    expect(first?.attempt).toBe(2)
  })
})
