/**
 * The payer SMS: the third channel, next to the e-mail and the WhatsApp template.
 *
 * Real HTTP receivers stand in for Mailpit and the SMS mock (`/health` says
 * `service: 'sms'`). What this file proves: a new charge queues an SMS beside the
 * e-mail, the dispatcher posts `{ to, body, from }` as JSON to `/v1/messages` and
 * the delivery ends SENT, a customer without a phone gets no SMS, a forced SMS
 * without a found SMS mock is refused, and discovery takes the place whose health
 * says `sms` and ignores another program on the same port.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { notificationDeliveries } from '../../src/db/schema/index.ts'
import { lookForChannels } from '../../src/notify/discovery.ts'
import { enqueuePaymentNotifications } from '../../src/notify/enqueue.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'
import { WebhookSink } from '../helpers/webhook-sink.ts'

let h: Harness
let mail: WebhookSink
let sms: WebhookSink
const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(() => {
  h?.close()
  mail?.stop()
  sms?.stop()
  for (const s of servers.splice(0)) s.stop(true)
})

async function boot(opts: { smsOn?: boolean; discover?: string[] } = {}) {
  mail = await WebhookSink.start()
  sms = await WebhookSink.start()
  const smsOn = opts.smsOn ?? true
  h = await createHarness({
    notify: {
      mailpitUrl: mail.url,
      whatsappUrl: undefined,
      smsUrl: smsOn ? sms.url.replace(/\/webhook$/, '') : undefined,
      whatsappPhoneNumberId: '5511400000000',
      fromEmail: 'notificacoes@asaas.localhost',
      maxAttempts: 5,
      ...(opts.discover ? { discover: { mailpit: [], whatsapp: [], generator: [], callback: true, sms: opts.discover } } : {}),
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

const rows = () => h.app.db.select().from(notificationDeliveries)

async function admin(path: string, method = 'GET', body?: unknown) {
  const res = await h.app.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

describe('the payer SMS', () => {
  it('a new charge queues an SMS next to the e-mail, and the dispatcher posts it to the SMS mock', async () => {
    await boot()
    const p = await charge(await customer())

    const queued = await rows()
    expect(queued.map((r) => r.channel).sort()).toEqual(['EMAIL', 'SMS'])

    await h.tick()
    expect(sms.received).toHaveLength(1)
    const call = sms.received[0]!
    expect(call.headers['content-type']).toContain('application/json')
    expect(call.payload.to).toBe('+5547999998888')
    expect(call.payload.from).toBe('ASAAS')
    expect(call.payload.body).toContain(p.invoiceUrl)
    expect(call.payload.body.length).toBeLessThanOrEqual(1000)

    const done = (await rows()).find((r) => r.channel === 'SMS')!
    expect(done.status).toBe('SENT')
    expect(done.attempt).toBe(1)
    expect(done.sentAt).toBeTruthy()
  })

  it('a customer without a mobile phone gets no SMS', async () => {
    await boot()
    await charge(await customer({ mobilePhone: undefined }))
    expect((await rows()).map((r) => r.channel)).toEqual(['EMAIL'])
  })

  it('a forced SMS without a found SMS mock is refused', async () => {
    await boot({ smsOn: false })
    const p = await charge(await customer())
    await expect(
      enqueuePaymentNotifications(
        h.app.db,
        { clock: h.app.ctx.clock, rng: h.app.ctx.rng, config: h.app.ctx.config },
        {
          accountId: h.accountId,
          event: 'PAYMENT_CREATED',
          payment: { id: p.id, customer: p.customer, value: p.value, dueDate: p.dueDate, invoiceUrl: p.invoiceUrl },
          forced: ['SMS'],
        },
      ),
    ).rejects.toMatchObject({ status: 400, errors: [{ code: 'notify_not_configured' }] })
  })

  it('the test send sends an SMS with WhatsApp off, and refuses it with SMS off', async () => {
    await boot()
    const sent = await admin('/_admin/notify/test', 'POST', { channel: 'SMS', to: '+5547999998888' })
    expect(sent.status).toBe(200)
    expect(sms.received).toHaveLength(1)
    expect(sms.received[0]!.payload.from).toBe('ASAAS')

    h.app.ctx.config.notify.smsUrl = undefined
    const off = await admin('/_admin/notify/test', 'POST', { channel: 'SMS', to: '+5547999998888' })
    expect(off.status).toBe(400)
    expect(JSON.stringify(off.body)).toContain('The SMS channel is off')
  })

  it('the admin list says the SMS channel is on and returns the SMS row', async () => {
    await boot()
    const p = await charge(await customer())
    const list = await admin(`/_admin/notifications?paymentId=${p.id}`)
    expect(list.body.channels.sms).toBe(true)
    expect(list.body.data.map((r: { channel: string }) => r.channel).sort()).toEqual(['EMAIL', 'SMS'])
  })

  it('a failing SMS mock keeps the delivery pending', async () => {
    await boot()
    sms.respondWith(500)
    await charge(await customer())
    await h.tick()
    const row = (await rows()).find((r) => r.channel === 'SMS')!
    expect(row.status).toBe('PENDING')
    expect(row.lastError).toContain('HTTP 500')
  })
})

describe('the SMS mock is found by itself', () => {
  it('takes the place whose health says sms and ignores another program on the same port', async () => {
    const serve = (fetch: (req: Request) => Response) => {
      const s = Bun.serve({ port: 0, fetch })
      servers.push(s)
      return `http://127.0.0.1:${s.port}`
    }
    const other = serve(() => Response.json({ hello: 'world' }))
    // Answers /health as the SMS mock, but refuses everything else: its Host guard would refuse a send.
    const guarded = serve((req) => {
      const path = new URL(req.url).pathname
      return path === '/health' ? Response.json({ service: 'sms', ok: true }) : Response.json({ error: 'forbidden_host' }, { status: 403 })
    })
    const real = serve((req) => {
      const path = new URL(req.url).pathname
      if (path === '/health') return Response.json({ service: 'sms', ok: true })
      if (path === '/_mock/sms/settings') return Response.json({ defaultFrom: 'AMA4DEVS' })
      return new Response('', { status: 404 })
    })
    await boot({ smsOn: false, discover: [other, guarded, real] })

    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.notify.smsUrl).toBe(real)
  })
})
