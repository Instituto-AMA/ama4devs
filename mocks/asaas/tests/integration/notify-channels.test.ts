/**
 * The payer channels come up configured.
 *
 * A small stand-in for the WhatsApp mock answers the Cloud API calls of the phone
 * number node (`GET /v23.0/{id}?fields=webhook_configuration`, `POST /v23.0/{id}`
 * with `webhook_configuration`) as the real one does, and wants an access token
 * like Meta. What this file proves: the sender number is registered with
 * this server's webhook when it is missing, a registration a person made is kept,
 * an unreachable WhatsApp mock is reported and repaired on the next tick, the
 * webhook records template statuses and replies, and Integrações' status reports
 * both channels.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { ensureWhatsappSender } from '../../src/notify/channels.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
let fake: ReturnType<typeof Bun.serve> | null = null
afterEach(() => {
  h?.close()
  fake?.stop(true)
  fake = null
})

/** The webhook override of each number, in memory, as the real WhatsApp mock keeps it. */
function startFakeWhatsapp(initial: Array<{ phone: string; url: string }> = []) {
  const mappings = [...initial]
  const configures: unknown[] = []
  fake = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/health') return Response.json({ status: 'ok' })
      const node = path.match(/^\/v23\.0\/(\d+)$/)
      if (!node) return new Response('not found', { status: 404 })
      if (!/^Bearer \S+/.test(req.headers.get('authorization') ?? '')) {
        return Response.json({ error: { type: 'OAuthException', code: 190 } }, { status: 401 })
      }
      const phone = node[1] as string
      if (req.method === 'GET') {
        const override = mappings.find((m) => m.phone === phone)?.url
        return Response.json({ id: phone, webhook_configuration: override ? { phone_number: override } : {} })
      }
      const body = (await req.json()) as { webhook_configuration: { override_callback_uri: string } }
      configures.push(body)
      mappings.push({ phone, url: body.webhook_configuration.override_callback_uri })
      return Response.json({ success: true })
    },
  })
  return { url: `http://localhost:${fake.port}`, mappings, configures }
}

async function boot(whatsappUrl: string) {
  h = await createHarness({
    notify: {
      mailpitUrl: undefined,
      whatsappUrl,
      whatsappPhoneNumberId: '5511400000000',
      whatsappWabaId: '100000000000001',
      fromEmail: 'notificacoes@asaas.localhost',
      maxAttempts: 5,
      callbackBaseUrl: 'http://asaas:45445',
      mailpitUiUrl: 'http://localhost:8025',
      whatsappUiUrl: 'http://localhost:3010',
    },
  })
}

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

describe('the payer templates come up in the WhatsApp mock', () => {
  it('creates the missing ones through Meta\'s call, approved at once, and keeps an existing one', async () => {
    const library = new Map<string, any>([['asaas_cobranca_criada', { name: 'asaas_cobranca_criada', language: 'pt_BR' }]])
    const created: any[] = []
    fake = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname !== '/v23.0/100000000000001/message_templates') return new Response('not found', { status: 404 })
        if (req.method === 'GET') {
          const t = library.get(url.searchParams.get('name') ?? '')
          return Response.json({ data: t ? [t] : [] })
        }
        const body = (await req.json()) as any
        created.push({ body, review: req.headers.get('x-mock-template-review-delay') })
        library.set(body.name, { name: body.name, language: body.language })
        return Response.json({ id: '1', status: 'PENDING', category: 'UTILITY' })
      },
    })
    await boot(`http://localhost:${fake.port}`)
    const { ensureWhatsappTemplates, WHATSAPP_TEMPLATES } = await import('../../src/notify/channels.ts')

    expect(await ensureWhatsappTemplates(h.app.ctx)).toEqual({ ready: true })
    expect(created.map((c) => c.body.name)).toEqual(
      WHATSAPP_TEMPLATES.map((t) => t.name).filter((n) => n !== 'asaas_cobranca_criada'),
    )
    expect(created[0].review).toBe('0')
    expect(created[0].body.components[1].example.body_text[0]).toHaveLength(5)

    // A second pass finds them all and creates nothing.
    expect(await ensureWhatsappTemplates(h.app.ctx)).toEqual({ ready: true })
    expect(created).toHaveLength(WHATSAPP_TEMPLATES.length - 1)
  })
})

describe('payer channels come up configured', () => {
  it('registers the sender number with this server webhook when it is missing', async () => {
    const wa = startFakeWhatsapp()
    await boot(wa.url)

    const r = await ensureWhatsappSender(h.app.ctx)
    expect(r.registered).toBe(true)
    expect(wa.configures).toEqual([
      {
        webhook_configuration: {
          override_callback_uri: 'http://asaas:45445/_mock/whatsapp/webhook',
          verify_token: 'asaas-mock',
        },
      },
    ])
    expect(wa.mappings).toEqual([{ phone: '5511400000000', url: 'http://asaas:45445/_mock/whatsapp/webhook' }])

    // Already there: nothing is sent again.
    await ensureWhatsappSender(h.app.ctx)
    expect(wa.configures).toHaveLength(1)
  })

  it('keeps a registration a person made', async () => {
    const wa = startFakeWhatsapp([{ phone: '5511400000000', url: 'http://elsewhere/hook' }])
    await boot(wa.url)
    expect((await ensureWhatsappSender(h.app.ctx)).registered).toBe(true)
    expect(wa.configures).toHaveLength(0)
    expect(wa.mappings[0]?.url).toBe('http://elsewhere/hook')
  })

  it('an unreachable WhatsApp mock is reported, and the tick registers it once it is up', async () => {
    await boot('http://localhost:1')
    const down = await ensureWhatsappSender(h.app.ctx)
    expect(down.registered).toBe(false)
    expect(down.error).toBeTruthy()

    const wa = startFakeWhatsapp()
    h.app.ctx.config.notify.whatsappUrl = wa.url
    await h.tick()
    expect(wa.configures).toHaveLength(1)
  })

  it('records template statuses and replies posted to the webhook, and reports both channels', async () => {
    const wa = startFakeWhatsapp()
    await boot(wa.url)

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                template_statuses: [
                  { status: 'delivered', recipient_id: '5547988887777', template: { name: 'asaas_cobranca_criada' } },
                ],
                messages: [{ from: '5547988887777', type: 'text', text: { body: 'Já paguei' } }],
              },
            },
          ],
        },
      ],
    }
    const posted = await admin('/_mock/whatsapp/webhook', 'POST', payload)
    expect(posted.body.received).toBe(2)
    expect((await admin('/_mock/whatsapp/webhook?hub.challenge=abc')).status).toBe(200)

    const status = await admin('/_admin/notify/status')
    expect(status.body.whatsapp).toMatchObject({ on: true, reachable: true, registered: true, sender: '5511400000000' })
    expect(status.body.email.on).toBe(false)
    expect(status.body.replies.map((r: any) => r.detail)).toContain('Já paguei')
    expect(status.body.replies.map((r: any) => r.detail)).toContain('delivered · asaas_cobranca_criada')
  })
})
