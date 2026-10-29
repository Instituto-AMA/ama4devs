/**
 * The Asaas mock finds the generator of fake data by itself and fills an
 * account through it.
 *
 * Small stand-ins answer as the generator (`/health` with `service:
 * 'generator'`) and receive the population (`/_mock/asaas/populate`). What this
 * file proves: the places the generator is looked for (and that `GENERATOR_URL`
 * empty turns it off), that only a service which says it is the generator is
 * taken, that the status says whether it answers and which version it is, and
 * that the population carries the account's own API key — an account without an
 * active key is refused, and a generator that is off is refused too.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { generatorStatus, populateThroughGenerator } from '../../src/admin/generator.ts'
import { notifyDiscoveryFromEnv, type NotifyDiscovery } from '../../src/core/config.ts'
import { lookForChannels } from '../../src/notify/discovery.ts'
import { createHarness, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

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

/** The generator: its health, and the population it answers. */
function fakeGenerator() {
  const received: Array<Record<string, unknown>> = []
  const url = serve(async (req) => {
    const path = new URL(req.url).pathname
    if (path === '/health') {
      return Response.json({ status: 'ok', service: 'generator', version: '0.1.0' })
    }
    if (path === '/_mock/asaas/populate') {
      const body = (await req.json()) as Record<string, unknown>
      received.push(body)
      return Response.json({ seed: body.seed ?? 'seed', customers: [], payments: [], errors: [] })
    }
    return new Response('not found', { status: 404 })
  })
  return { url, received }
}

/** Something else on a port the generator might answer on. */
const someoneElse = () => serve(() => Response.json({ status: 'ok', hello: 'world' }))

const dead = 'http://127.0.0.1:1'

async function boot(discover: NotifyDiscovery) {
  h = await createHarness({
    generator: { url: undefined, uiUrl: 'http://localhost:45450' },
    notify: { mailpitUrl: undefined, whatsappUrl: undefined, discover },
  })
}

describe('the generator is looked for where it answers', () => {
  it('is looked for in the compose names, this machine and the Docker host', () => {
    const env = notifyDiscoveryFromEnv({})
    expect(env.generator[0]).toBe('http://generator:45450')
    expect(env.generator[1]).toBe('http://generator-mock:45450')
    expect(env.generator).toContain('http://localhost:45450')
  })

  it('is off when GENERATOR_URL is empty, and not looked for when it is set', () => {
    expect(notifyDiscoveryFromEnv({ GENERATOR_URL: '' }).generator).toEqual([])
    expect(notifyDiscoveryFromEnv({ GENERATOR_URL: 'http://gerador:45450' }).generator).toEqual([])
  })

  it('takes the place that says it is the generator, and no other', async () => {
    const generator = fakeGenerator()
    await boot({ mailpit: [], whatsapp: [], generator: [dead, someoneElse(), generator.url], callback: false })

    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.generator.url).toBe(generator.url)
  })

  it('does not take a place that answers something else', async () => {
    await boot({ mailpit: [], whatsapp: [], generator: [someoneElse()], callback: false })

    await lookForChannels(h.app.ctx)
    expect(h.app.ctx.config.generator.url).toBeUndefined()
  })
})

describe('the status of the generator', () => {
  it('says that it answers, and which version it is', async () => {
    const generator = fakeGenerator()
    await boot({ mailpit: [], whatsapp: [], generator: [], callback: false })
    h.app.ctx.config.generator.url = generator.url

    const status = await generatorStatus(h.app.ctx)
    expect(status).toMatchObject({
      on: true,
      reachable: true,
      version: '0.1.0',
      url: generator.url,
      error: null,
    })
  })

  it('says that it is off when it is not found', async () => {
    await boot({ mailpit: [], whatsapp: [], generator: [], callback: false })

    const status = await generatorStatus(h.app.ctx)
    expect(status.on).toBe(false)
    expect(status.url).toBeNull()
    expect(status.reachable).toBe(false)
    expect(status.error).toContain('Gerador desligado')
  })

  it('is on the panel route', async () => {
    const generator = fakeGenerator()
    await boot({ mailpit: [], whatsapp: [], generator: [], callback: false })
    h.app.ctx.config.generator.url = generator.url

    const res = await h.app.app.handle(new Request('http://localhost/_admin/generator/status'))
    expect(res.status).toBe(200)
    expect((await res.json()) as any).toMatchObject({ on: true, reachable: true, version: '0.1.0' })
  })
})

describe('populating an account through the generator', () => {
  it('sends the account’s own API key and the counts', async () => {
    const generator = fakeGenerator()
    await boot({ mailpit: [], whatsapp: [], generator: [], callback: false })
    h.app.ctx.config.generator.url = generator.url

    const result = await populateThroughGenerator(h.app.ctx, {
      accountId: h.accountId,
      people: 3,
      companies: 2,
      chargesPerCustomer: 2,
      billingTypes: ['PIX', 'BOLETO'],
      confirm: 0.5,
      seed: 'h1',
    })

    expect(result.status).toBe(200)
    expect(generator.received).toHaveLength(1)
    expect(generator.received[0]).toEqual({
      people: 3,
      companies: 2,
      chargesPerCustomer: 2,
      billingTypes: ['PIX', 'BOLETO'],
      confirm: 0.5,
      seed: 'h1',
      apiKey: TEST_API_KEY,
    })
  })

  it('refuses an account without an active key', async () => {
    const generator = fakeGenerator()
    await boot({ mailpit: [], whatsapp: [], generator: [], callback: false })
    h.app.ctx.config.generator.url = generator.url

    await expect(
      populateThroughGenerator(h.app.ctx, { accountId: 'conta-que-nao-existe' }),
    ).rejects.toMatchObject({ errors: [{ code: 'account_without_key' }] })
    expect(generator.received).toHaveLength(0)
  })

  it('refuses when the generator is off', async () => {
    await boot({ mailpit: [], whatsapp: [], generator: [], callback: false })

    await expect(
      populateThroughGenerator(h.app.ctx, { accountId: h.accountId }),
    ).rejects.toMatchObject({ errors: [{ code: 'generator_off' }] })
  })

  it('is on the panel route', async () => {
    const generator = fakeGenerator()
    await boot({ mailpit: [], whatsapp: [], generator: [], callback: false })
    h.app.ctx.config.generator.url = generator.url

    const res = await h.app.app.handle(
      new Request('http://localhost/_admin/generator/populate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: h.accountId, people: 1 }),
      }),
    )
    expect(res.status).toBe(200)
    expect(generator.received[0]).toMatchObject({ people: 1, apiKey: TEST_API_KEY })
  })
})
