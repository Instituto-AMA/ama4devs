import { describe, expect, test } from 'bun:test'
import { createApp, deliveryUrl } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { DIRECTD_TOKEN } from '../src/core/credit.js'
import { isLocalDestination } from '../src/directd.ts'

/** A post the mock sent to a receiver. */
interface Sent {
  url: string
  body: any
}

/** The harness: the clock, the ids, the wait and the post are fakes. */
interface Harness {
  app: ReturnType<typeof createApp>
  sent: Sent[]
}

function harness(balance?: number): Harness {
  const sent: Sent[] = []
  let counter = 0

  const app = createApp(loadConfig(balance === undefined ? {} : { DIRECTD_BALANCE: String(balance) }), {
    now: () => new Date('2026-11-04T12:36:08.000Z'),
    newId: () => `id-${++counter}`,
    sleep: async () => {},
    post: async (url: string, body: unknown) => {
      sent.push({ url, body })
      return { status: 201 }
    },
  })

  return { app, sent }
}

/** A request to the mock. */
function call(h: Harness, path: string, init?: RequestInit): Promise<Response> {
  return h.app.fetch(new Request(`http://localhost:45450${path}`, init))
}

/** The body of an answer. */
async function bodyOf(response: Response): Promise<any> {
  return (await response.json()) as any
}

/** A control request with a JSON body. */
function control(h: Harness, path: string, method: string, payload?: unknown): Promise<Response> {
  return call(h, path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

/** A request to the provider's webhook routes, with the public token. */
function provider(h: Harness, path: string, payload: unknown, token = DIRECTD_TOKEN): Promise<Response> {
  return call(h, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Token: token },
    body: JSON.stringify(payload),
  })
}

describe('the webhook of the provider', () => {
  test('registers the URL, posts the code and confirms it', async () => {
    const h = harness()

    const created = await provider(h, '/api/Webhook/CreateUrlCallBack', {
      Url: 'http://localhost:9999/callback',
    })
    expect(created.status).toBe(200)

    const createdBody = await bodyOf(created)
    expect(Object.keys(createdBody)).toEqual([
      'id',
      'result',
      'status',
      'elapsedTimeMs',
      'dateTimeExecution',
    ])
    expect(createdBody.result).toBe('Created')
    expect(createdBody.status).toBe('OK')

    // The provider posts the code to the registered URL.
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]!.url).toBe('http://localhost:9999/callback')
    expect(Object.keys(h.sent[0]!.body)).toEqual(['MessageStep', 'Code', 'Status'])
    expect(h.sent[0]!.body.MessageStep).toBe(
      "Send this code to 'POST Webhook/ConfirmUrlCallBack'",
    )
    expect(h.sent[0]!.body.Status).toBe('Created')
    expect(h.sent[0]!.body.Code).toMatch(/^CALL-[A-Z0-9]{4}$/)

    const confirmed = await provider(h, '/api/Webhook/ConfirmUrlCallBack', {
      Code: h.sent[0]!.body.Code,
    })
    expect(confirmed.status).toBe(200)

    const confirmedBody = await bodyOf(confirmed)
    expect(confirmedBody.result).toBe('Confirmed')
    expect(confirmedBody.status).toBe('OK')
    expect(confirmedBody.id).toBe(createdBody.id)
  })

  test('refuses a token that is wrong or missing', async () => {
    const h = harness()

    const wrong = await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9999/cb' }, 'nope')
    expect(wrong.status).toBe(401)

    const missing = await call(h, '/api/Webhook/CreateUrlCallBack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Url: 'http://localhost:9999/cb' }),
    })
    expect(missing.status).toBe(401)
    expect(h.sent).toHaveLength(0)
  })

  test('refuses a body that is invalid', async () => {
    const h = harness()

    const noJson = await call(h, '/api/Webhook/CreateUrlCallBack', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Token: DIRECTD_TOKEN },
      body: 'not json',
    })
    expect(noJson.status).toBe(400)

    const noUrl = await provider(h, '/api/Webhook/CreateUrlCallBack', {})
    expect(noUrl.status).toBe(400)

    const foreignScheme = await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'ftp://localhost/cb' })
    expect(foreignScheme.status).toBe(400)

    expect(h.sent).toHaveLength(0)
  })

  test('refuses a URL that is not local and posts nothing', async () => {
    const h = harness()

    const response = await provider(h, '/api/Webhook/CreateUrlCallBack', {
      Url: 'https://example.com.br/YourPostCallBack',
    })

    expect(response.status).toBe(400)
    expect((await bodyOf(response)).error.code).toBe('forbidden_destination')
    expect(h.sent).toHaveLength(0)
  })

  test('refuses a code it does not know', async () => {
    const h = harness()

    const response = await provider(h, '/api/Webhook/ConfirmUrlCallBack', { Code: 'CALL-NOPE' })

    expect(response.status).toBe(400)
    expect((await bodyOf(response)).error.code).toBe('unknown_code')
  })

  test('a receiver that does not answer 201 leaves the URL unconfirmed', async () => {
    const sent: Sent[] = []
    const app = createApp(loadConfig({}), {
      now: () => new Date('2026-11-04T12:36:08.000Z'),
      newId: () => 'id-1',
      sleep: async () => {},
      post: async (url: string, body: unknown) => {
        sent.push({ url, body })
        return { status: 200 }
      },
    })

    await app.fetch(
      new Request('http://localhost:45450/api/Webhook/CreateUrlCallBack', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Token: DIRECTD_TOKEN },
        body: JSON.stringify({ Url: 'http://localhost:9999/callback' }),
      }),
    )

    const state = await (await app.fetch(new Request('http://localhost:45450/_mock/directd/webhook'))).json()
    expect((state as any).confirmed).toBe(false)
    expect((state as any).code).toMatch(/^CALL-[A-Z0-9]{4}$/)
    expect(sent).toHaveLength(1)
  })

  test('posts the callback of a consultation that settles', async () => {
    const h = harness()

    await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9999/callback' })

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)

    // The first read is still running, the second settles the consultation.
    await call(h, `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-2&TOKEN=${DIRECTD_TOKEN}`)
    const ready = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-2&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(ready.status).toBe(200)

    const callbacks = h.sent.filter((entry) => entry.body.Product === 'APIv3')
    expect(callbacks).toHaveLength(1)
    expect(Object.keys(callbacks[0]!.body)).toEqual(['Product', 'Id', 'Status', 'Url'])
    expect(callbacks[0]!.body.Product).toBe('APIv3')
    expect(callbacks[0]!.body.Id).toBe('direct-id-2')
    expect(callbacks[0]!.body.Status).toBe('Finished')
    expect(callbacks[0]!.body.Url).toBe(
      'http://localhost:45450/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-2',
    )
  })

  test('the control routes read, fire and clear the registration', async () => {
    const h = harness()

    const fired = await control(h, '/_mock/directd/webhook/fire', 'POST', {
      product: 'APIv3',
      id: 'direct-id-9',
      status: 'Modified',
    })
    expect(fired.status).toBe(409)

    await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9999/callback' })

    const state = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(Object.keys(state)).toEqual(['url', 'confirmed', 'code'])
    expect(state.url).toBe('http://localhost:9999/callback')
    expect(state.confirmed).toBe(true)

    const firedOk = await control(h, '/_mock/directd/webhook/fire', 'POST', {
      product: 'APIv3-StatusAvailability',
      id: 'direct-id-9',
      status: 'Modified',
    })
    expect(firedOk.status).toBe(200)

    const last = h.sent[h.sent.length - 1]!
    expect(last.body.Product).toBe('APIv3-StatusAvailability')
    expect(last.body.Id).toBe('direct-id-9')
    expect(last.body.Status).toBe('Modified')

    const cleared = await control(h, '/_mock/directd/webhook', 'DELETE')
    expect(cleared.status).toBe(200)

    const after = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(after.url).toBeNull()
    expect(after.confirmed).toBe(false)
  })
})

describe('the destination guard', () => {
  const cases: Array<[string, boolean]> = [
    ['http://127.0.0.1:9999/callback', true],
    ['http://localhost:9999/callback', true],
    ['http://[::1]:9999/callback', true],
    ['http://hub-webhooks:8080/callback', true],
    ['http://generator:45450/callback', true],
    ['https://example.com.br/YourPostCallBack', false],
    ['http://example.com.br/callback', false],
    ['http://api.directd.com.br/callback', false],
    ['http://127.0.0.1.evil.com/callback', false],
    ['ftp://localhost/callback', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
  ]

  for (const [url, allowed] of cases) {
    test(`${allowed ? 'admits' : 'refuses'} ${url}`, () => {
      expect(isLocalDestination(url)).toBe(allowed)
    })
  }
})

describe('the balance of the account', () => {
  test('answers the balance and the consumption with the documented shape', async () => {
    const h = harness(25)

    const balance = await call(h, '/api/Marketplace/GetBalance', { headers: { Token: DIRECTD_TOKEN } })
    expect(balance.status).toBe(200)

    const balanceBody = await bodyOf(balance)
    expect(Object.keys(balanceBody)).toEqual([
      'balance',
      'success',
      'status',
      'elapsedTimeMs',
      'dateTimeExecution',
      'error',
    ])
    expect(Object.keys(balanceBody.balance)).toEqual([
      'description',
      'type',
      'balance',
      'addedLast30Days',
      'consumedLast30Days',
    ])
    expect(balanceBody.balance.description).toBe('Faturamento Saldo (Pré)')
    expect(balanceBody.balance.type).toBe('Prepaid')
    expect(balanceBody.balance.balance).toBe(25)
    expect(balanceBody.balance.addedLast30Days).toBe(0)
    expect(balanceBody.balance.consumedLast30Days).toBe(0)
    expect(balanceBody.success).toBe(true)
    expect(balanceBody.status).toBe('OK')
    expect(balanceBody.error).toBeNull()

    const consumption = await call(h, '/api/Billing/GetConsumptionApiV3', {
      headers: { Token: DIRECTD_TOKEN },
    })
    expect(consumption.status).toBe(200)

    const consumptionBody = await bodyOf(consumption)
    expect(Object.keys(consumptionBody)).toEqual([
      'consumption',
      'success',
      'status',
      'elapsedTimeMs',
      'dateTimeExecution',
      'error',
    ])
    expect(Object.keys(consumptionBody.consumption)).toEqual(['details', 'description', 'active'])
    expect(Object.keys(consumptionBody.consumption.details)).toEqual(['balance'])
    expect(consumptionBody.consumption.details.balance).toBe(25)
    expect(consumptionBody.consumption.description).toBe('Faturamento Saldo (Pré)')
    expect(consumptionBody.consumption.active).toBe(true)
  })

  test('refuses a token that is wrong or missing', async () => {
    const h = harness()

    const wrong = await call(h, '/api/Marketplace/GetBalance', { headers: { Token: 'nope' } })
    expect(wrong.status).toBe(401)

    const missing = await call(h, '/api/Billing/GetConsumptionApiV3')
    expect(missing.status).toBe(401)
  })

  test('a charged consultation subtracts the cost of the product', async () => {
    const h = harness(500)

    const consult = await call(h, `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    expect(consult.status).toBe(200)

    const balance = await bodyOf(await call(h, '/_mock/directd/balance'))
    expect(balance.balance.balance).toBe(498.02)
    expect(balance.balance.consumedLast30Days).toBe(1.98)

    const boaVista = await call(h, `/api/BoaVistaAcertaMaisPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    expect(boaVista.status).toBe(200)

    const after = await bodyOf(await call(h, '/_mock/directd/balance'))
    expect(after.balance.balance).toBe(486.84)
    expect(after.balance.consumedLast30Days).toBe(13.16)
  })

  test('a balance shorter than the cost answers 403 and charges nothing', async () => {
    const h = harness(500)

    const set = await control(h, '/_mock/directd/balance', 'POST', { set: 1 })
    expect(set.status).toBe(200)
    expect((await bodyOf(set)).balance.balance).toBe(1)

    const score = await call(h, `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    expect(score.status).toBe(403)
    expect((await bodyOf(score)).metaDados.resultado).toBe('Saldo insuficiente')

    const boaVista = await call(
      h,
      `/api/BoaVistaAcertaMaisPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(boaVista.status).toBe(403)

    const balance = await bodyOf(await call(h, '/_mock/directd/balance'))
    expect(balance.balance.balance).toBe(1)
    expect(balance.balance.consumedLast30Days).toBe(0)
  })

  test('sets and adds the balance', async () => {
    const h = harness(500)

    const set = await control(h, '/_mock/directd/balance', 'POST', { set: 12.5 })
    expect(set.status).toBe(200)
    expect((await bodyOf(set)).balance.balance).toBe(12.5)

    const added = await control(h, '/_mock/directd/balance', 'POST', { add: 100 })
    expect(added.status).toBe(200)

    const body = await bodyOf(added)
    expect(body.balance.balance).toBe(112.5)
    expect(body.balance.addedLast30Days).toBe(100)

    const invalid = await control(h, '/_mock/directd/balance', 'POST', { nope: 1 })
    expect(invalid.status).toBe(400)
  })
})

describe('the delivery address of a local receiver', () => {
  const cases: Array<[string, string, string]> = [
    ['http://localhost:18081/hooks/directdata/t', 'host.docker.internal', 'http://host.docker.internal:18081/hooks/directdata/t'],
    ['http://127.0.0.1:18081/hooks/directdata/t', 'host.docker.internal', 'http://host.docker.internal:18081/hooks/directdata/t'],
    ['http://hub-webhooks:8081/hooks/directdata/t', 'host.docker.internal', 'http://hub-webhooks:8081/hooks/directdata/t'],
    ['http://localhost:18081/hooks/directdata/t', '', 'http://localhost:18081/hooks/directdata/t'],
  ]
  for (const [registered, rewrite, delivered] of cases) {
    test(`${registered} with rewrite '${rewrite}'`, () => {
      expect(deliveryUrl(registered, rewrite)).toBe(delivered)
    })
  }
})
