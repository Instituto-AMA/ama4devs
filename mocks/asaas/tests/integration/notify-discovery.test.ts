/**
 * The payer channels find themselves.
 *
 * Small stand-ins answer as Mailpit (`/api/v1/info` with its version) and the
 * WhatsApp mock (`/health` with its template library, the phone number node with
 * the callback check Meta does). What this file proves: each channel is taken
 * from the first place that says it is that service, a program that answers on a
 * place but is something else is skipped, a channel that stops answering is
 * dropped and found again, the callback is the first address the WhatsApp mock
 * verifies and only that one is admitted by the guard, an earlier run's callback
 * is replaced, and calls by a service name name themselves `localhost`.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { notifyDiscoveryFromEnv, type NotifyDiscovery } from '../../src/core/config.ts'
import { callbackCandidates, ensureWhatsappSender, whatsappHeaders } from '../../src/notify/channels.ts'
import { lookForChannels } from '../../src/notify/discovery.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(() => {
  h?.close()
  for (const s of servers.splice(0)) s.stop(true)
})

const serve = (fetch: (req: Request) => Response | Promise<Response>) => {
  const s = Bun.serve({ port: 0, fetch })
  servers.push(s)
  return `http://127.0.0.1:${s.port}`
}

const fakeMailpit = () =>
  serve((req) =>
    new URL(req.url).pathname === '/api/v1/info' ? Response.json({ Version: 'v1.31.4' }) : new Response('', { status: 404 }),
  )

/** Something else on a port the WhatsApp mock or Mailpit might use. */
const someoneElse = () => serve(() => Response.json({ hello: 'world' }))

/**
 * The WhatsApp mock: its health, and the number node that checks a callback by
 * calling it, like Meta. `reaches` says which callback addresses it can call.
 */
function fakeWhatsapp(opts: { reaches?: (uri: string) => boolean; registered?: string } = {}) {
  let override = opts.registered
  const offered: string[] = []
  const url = serve(async (req) => {
    const path = new URL(req.url).pathname
    if (path === '/health') return Response.json({ ok: true, templates: { totalTemplates: 0 } })
    if (path !== '/v23.0/5511400000000') return new Response('not found', { status: 404 })
    if (req.method === 'GET') return Response.json({ id: '5511400000000', webhook_configuration: override ? { phone_number: override } : {} })
    const body = (await req.json()) as { webhook_configuration: { override_callback_uri: string } }
    const uri = body.webhook_configuration.override_callback_uri
    offered.push(uri)
    if (!(opts.reaches ?? (() => true))(uri)) {
      return Response.json({ error: { message: '(#2200) Callback verification failed', code: 2200 } }, { status: 400 })
    }
    override = uri
    return Response.json({ success: true })
  })
  return { url, offered, current: () => override }
}

async function boot(discover: NotifyDiscovery) {
  h = await createHarness({
    notify: {
      mailpitUrl: undefined,
      whatsappUrl: undefined,
      whatsappPhoneNumberId: '5511400000000',
      whatsappWabaId: '100000000000001',
      fromEmail: 'notificacoes@asaas.localhost',
      maxAttempts: 5,
      callbackBaseUrl: 'http://localhost:45445',
      mailpitUiUrl: 'http://localhost:8025',
      whatsappUiUrl: 'http://localhost:3010',
      discover,
    },
  })
}

const dead = 'http://127.0.0.1:1'

describe('the channels are found where they answer', () => {
  it('takes the first place that is the service, skipping one that is something else', async () => {
    const mailpit = fakeMailpit()
    const wa = fakeWhatsapp()
    await boot({ mailpit: [dead, someoneElse(), mailpit], whatsapp: [someoneElse(), wa.url, dead], callback: true })

    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.notify.mailpitUrl).toBe(mailpit)
    expect(h.app.ctx.config.notify.whatsappUrl).toBe(wa.url)
  })

  it('moves to a closer place once it comes up, even when a farther one answered first', async () => {
    const far = fakeMailpit()
    let closeUp = false
    const close = serve((req) =>
      closeUp && new URL(req.url).pathname === '/api/v1/info'
        ? Response.json({ Version: 'v1.31.4' })
        : new Response('starting', { status: 503 }),
    )
    await boot({ mailpit: [close, far], whatsapp: [], callback: true })
    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.notify.mailpitUrl).toBe(far)

    closeUp = true
    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.notify.mailpitUrl).toBe(close)
  })

  it('drops a channel that stops answering and finds it again', async () => {
    const mailpit = fakeMailpit()
    await boot({ mailpit: [mailpit], whatsapp: [dead], callback: true })
    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.notify.mailpitUrl).toBe(mailpit)
    expect(h.app.ctx.config.notify.whatsappUrl).toBeUndefined()

    servers[0]!.stop(true)
    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.notify.mailpitUrl).toBeUndefined()

    const again = fakeMailpit()
    h.app.ctx.config.notify.discover!.mailpit = [mailpit, again]
    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.notify.mailpitUrl).toBe(again)
  })

  it('a channel set by its variable is not looked for', async () => {
    const env = notifyDiscoveryFromEnv({ MAILPIT_URL: 'http://mail:8025', WHATSAPP_MOCK_URL: '' })
    expect(env).toMatchObject({ mailpit: [], whatsapp: [], callback: true })
    const looked = notifyDiscoveryFromEnv({ NOTIFY_CALLBACK_BASE_URL: 'http://asaas:45445' })
    expect(looked.mailpit.slice(0, 3)).toEqual(['http://mailpit:8025', 'http://localhost:8025', 'http://host.docker.internal:8025'])
    expect(looked.whatsapp.slice(0, 3)).toEqual(['http://whatsapp:3010', 'http://whatsapp-mock:3010', 'http://localhost:3010'])
    expect(looked.callback).toBe(false)
  })

  it('an off channel says in Integrações where it was looked for', async () => {
    await boot({ mailpit: [dead], whatsapp: [dead], callback: true })
    await lookForChannels(h.app.ctx)
    const status = await h.app.app.handle(new Request('http://localhost/_admin/notify/status'))
    const body = (await status.json()) as any
    expect(body.email).toMatchObject({ on: false, reachable: false })
    expect(body.email.error).toContain('nenhum Mailpit respondendo')
  })
})

describe('the callback is the address the WhatsApp mock verifies', () => {
  it('offers each address in turn and admits only the one that works', async () => {
    await boot({ mailpit: [], whatsapp: [], callback: true })
    const ctx = h.app.ctx
    const wa = fakeWhatsapp({ reaches: (uri) => uri.startsWith('http://host.docker.internal:') })
    ctx.config.notify.whatsappUrl = wa.url
    const before = [...ctx.config.allowedHosts]

    expect((await ensureWhatsappSender(ctx)).registered).toBe(true)
    // A WhatsApp mock on loopback is offered this machine first, then the Docker host.
    expect(wa.offered[0]).toBe(`http://localhost:${ctx.config.port}/_mock/whatsapp/webhook`)
    expect(wa.current()).toBe(`http://host.docker.internal:${ctx.config.port}/_mock/whatsapp/webhook`)
    expect(ctx.config.notify.callbackBaseUrl).toBe(`http://host.docker.internal:${ctx.config.port}`)
    expect(ctx.config.allowedHosts).toEqual(before)

    // Registered and in use: nothing is offered again.
    await ensureWhatsappSender(ctx)
    expect(wa.offered).toHaveLength(2)
  })

  it('a container address that works joins the guard, the refused ones do not', async () => {
    await boot({ mailpit: [], whatsapp: [], callback: true })
    const ctx = h.app.ctx
    const own = callbackCandidates(ctx, 'http://whatsapp:3010').filter((u) => !/localhost|host\.docker/.test(u))
    if (own.length === 0) return // no network interface but loopback: nothing to offer
    const chosen = own[own.length - 1]!
    const wa = fakeWhatsapp({ reaches: (uri) => uri.startsWith(chosen) })
    ctx.config.notify.whatsappUrl = wa.url

    expect((await ensureWhatsappSender(ctx)).registered).toBe(true)
    expect(ctx.config.notify.callbackBaseUrl).toBe(chosen)
    const host = new URL(chosen).hostname
    expect(ctx.config.allowedHosts).toContain(host)
    for (const refused of own.slice(0, -1)) expect(ctx.config.allowedHosts).not.toContain(new URL(refused).hostname)

    const challenge = await h.app.app.handle(
      new Request(`${chosen}/_mock/whatsapp/webhook?hub.mode=subscribe&hub.challenge=42`, { headers: { host } }),
    )
    expect(await challenge.text()).toBe('42')
  })

  it("replaces an earlier run's callback and keeps a person's", async () => {
    await boot({ mailpit: [], whatsapp: [], callback: true })
    const ctx = h.app.ctx
    const stale = fakeWhatsapp({ registered: 'http://172.30.0.9:45445/_mock/whatsapp/webhook' })
    ctx.config.notify.whatsappUrl = stale.url
    await ensureWhatsappSender(ctx)
    expect(stale.current()).toBe(`http://localhost:${ctx.config.port}/_mock/whatsapp/webhook`)

    const person = fakeWhatsapp({ registered: 'http://my-app:4000/whatsapp' })
    ctx.config.notify.whatsappUrl = person.url
    await ensureWhatsappSender(ctx)
    expect(person.offered).toHaveLength(0)
    expect(person.current()).toBe('http://my-app:4000/whatsapp')
  })
})

describe('calls to the WhatsApp mock by a service name', () => {
  it('name themselves localhost, and leave known and dotted names alone', () => {
    expect(whatsappHeaders('http://whatsapp:3010').host).toBe('localhost')
    expect(whatsappHeaders('http://172.18.0.3:3010').host).toBe('localhost')
    expect(whatsappHeaders('http://localhost:3010').host).toBeUndefined()
    expect(whatsappHeaders('http://host.docker.internal:3010').host).toBeUndefined()
    expect(whatsappHeaders('https://whatsapp.example.com').host).toBeUndefined()
    expect(whatsappHeaders('http://whatsapp:3010').authorization).toBe('Bearer asaas-mock')
  })
})
