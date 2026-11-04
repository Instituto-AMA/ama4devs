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

/** A task the mock scheduled: the tests run it by hand, they never sleep. */
interface Scheduled {
  ms: number
  task: () => Promise<void>
}

/** The harness: the clock, the ids, the wait, the schedule and the post are fakes. */
interface Harness {
  app: ReturnType<typeof createApp>
  sent: Sent[]
  scheduled: Scheduled[]
}

function harness(balance?: number): Harness {
  const sent: Sent[] = []
  const scheduled: Scheduled[] = []
  let counter = 0

  const app = createApp(loadConfig(balance === undefined ? {} : { DIRECTD_BALANCE: String(balance) }), {
    now: () => new Date('2026-11-04T12:36:08.000Z'),
    newId: () => `id-${++counter}`,
    sleep: async () => {},
    schedule: (ms: number, task: () => Promise<void>) => {
      scheduled.push({ ms, task })
    },
    post: async (url: string, body: unknown) => {
      sent.push({ url, body })
      return { status: 201 }
    },
  })

  return { app, sent, scheduled }
}

/**
 * A harness whose receiver holds the callbacks of the consultations until the
 * test answers them, so a test can act while a post is on its way.
 */
function holdingCallbacks(): Harness & { answers: Array<(value: { status: number }) => void> } {
  const scheduled: Scheduled[] = []
  const answers: Array<(value: { status: number }) => void> = []
  let counter = 0

  const app = createApp(loadConfig({}), {
    now: () => new Date('2026-11-04T12:36:08.000Z'),
    newId: () => `id-${++counter}`,
    sleep: async () => {},
    schedule: (ms: number, task: () => Promise<void>) => {
      scheduled.push({ ms, task })
    },
    post: (_url: string, body: unknown) =>
      (body as { Product?: string }).Product === 'APIv3'
        ? new Promise((resolve) => {
            answers.push(resolve)
          })
        : Promise.resolve({ status: 201 }),
  })

  return { app, sent: [], scheduled, answers }
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

/**
 * A registration of a callback URL that is ready for the callbacks: the code
 * comes back through `ConfirmUrlCallBack`.
 * @param h The harness.
 */
async function confirmed(h: Harness): Promise<void> {
  await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9999/callback' })

  const state = await bodyOf(await call(h, '/_mock/directd/webhook'))
  await provider(h, '/api/Webhook/ConfirmUrlCallBack', { Code: state.code })
}

/**
 * The callbacks of the consultations, the way the receiver sees them.
 * @param h The harness.
 */
function apiV3Callbacks(h: Harness): Sent[] {
  return h.sent.filter((entry) => entry.body.Product === 'APIv3')
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

    // The URL is not ready: the code has not come back yet.
    const before = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(before.confirmed).toBe(false)

    const confirmed = await provider(h, '/api/Webhook/ConfirmUrlCallBack', {
      Code: h.sent[0]!.body.Code,
    })
    expect(confirmed.status).toBe(200)

    const confirmedBody = await bodyOf(confirmed)
    expect(confirmedBody.result).toBe('Confirmed')
    expect(confirmedBody.status).toBe('OK')
    expect(confirmedBody.id).toBe(createdBody.id)

    const after = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(after.confirmed).toBe(true)
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

    await confirmed(h)

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

    await confirmed(h)

    const state = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(Object.keys(state)).toEqual(['url', 'confirmed', 'code'])
    expect(state.url).toBe('http://localhost:9999/callback')
    expect(state.confirmed).toBe(true)

    const firedOk = await control(h, '/_mock/directd/webhook/fire', 'POST', {
      product: 'APIv3',
      id: 'direct-id-9',
      status: 'Modified',
    })
    expect(firedOk.status).toBe(200)

    const last = h.sent[h.sent.length - 1]!
    expect(last.body.Product).toBe('APIv3')
    expect(last.body.Id).toBe('direct-id-9')
    expect(last.body.Status).toBe('Modified')

    const cleared = await control(h, '/_mock/directd/webhook', 'DELETE')
    expect(cleared.status).toBe(200)

    const after = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(after.url).toBeNull()
    expect(after.confirmed).toBe(false)
  })

  test('a receiver that answers 201 is not confirmed until the code comes back', async () => {
    const h = harness()

    await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9999/callback' })

    // The 201 of the receiver is not the confirmation: the code has to come back.
    const state = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(state.confirmed).toBe(false)

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)

    // Nothing is scheduled and nothing is posted: the URL is not ready.
    expect(h.scheduled).toHaveLength(0)
    expect(apiV3Callbacks(h)).toHaveLength(0)
  })

  test('a consultation announces itself with no read', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)
    const uid = (await bodyOf(created)).metaDados.consultaUid

    // The consultation announces itself after a second, with no read.
    expect(h.scheduled).toHaveLength(1)
    expect(h.scheduled[0]!.ms).toBe(1000)
    expect(apiV3Callbacks(h)).toHaveLength(0)

    await h.scheduled[0]!.task()

    const posted = apiV3Callbacks(h)
    expect(posted).toHaveLength(1)
    expect(Object.keys(posted[0]!.body)).toEqual(['Product', 'Id', 'Status', 'Url'])
    expect(posted[0]!.body.Product).toBe('APIv3')
    expect(posted[0]!.body.Id).toBe(uid)
    expect(posted[0]!.body.Status).toBe('Finished')

    // The consultation is over: the first read answers at once.
    const ready = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(ready.status).toBe(200)

    // A second read posts nothing more.
    await call(h, `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`)
    expect(apiV3Callbacks(h)).toHaveLength(1)
  })

  test('the slow CPF announces after its wait', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11101444401&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)

    expect(h.scheduled).toHaveLength(1)
    expect(h.scheduled[0]!.ms).toBe(25000)
  })

  test('a query that never settles waits for the release', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11101555572&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)
    const uid = (await bodyOf(created)).metaDados.consultaUid

    // The consultation never settles on its own.
    expect(h.scheduled).toHaveLength(0)

    const pending = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(pending.status).toBe(202)
    expect(apiV3Callbacks(h)).toHaveLength(0)

    const released = await control(h, `/_mock/directd/queries/${uid}/release`, 'POST')
    expect(released.status).toBe(200)

    const posted = apiV3Callbacks(h)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.body.Status).toBe('Finished')

    const ready = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(ready.status).toBe(200)
    expect(apiV3Callbacks(h)).toHaveLength(1)
  })

  test('a failed query announces Error', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11101555572&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)
    const uid = (await bodyOf(created)).metaDados.consultaUid

    const balanceBefore = await bodyOf(await call(h, '/_mock/directd/balance'))

    const failed = await control(h, `/_mock/directd/queries/${uid}/fail`, 'POST', {
      outcome: 'internalError',
    })
    expect(failed.status).toBe(200)

    const posted = apiV3Callbacks(h)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.body.Status).toBe('Error')

    // The read answers the failure of the provider.
    const read = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(read.status).toBe(500)
    const readBody = await bodyOf(read)
    expect(readBody.metaDados.resultado).toBe('Erro Interno')
    expect(readBody.retorno).toBeNull()

    // The failure charges nothing.
    const balanceAfter = await bodyOf(await call(h, '/_mock/directd/balance'))
    expect(balanceAfter.balance.balance).toBe(balanceBefore.balance.balance)

    // The query is settled: it cannot fail twice.
    const again = await control(h, `/_mock/directd/queries/${uid}/fail`, 'POST', {
      outcome: 'internalError',
    })
    expect(again.status).toBe(409)
    expect((await bodyOf(again)).error.code).toBe('already_settled')

    // A failure that happens before the consultation cannot be forced.
    const other = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    const otherUid = (await bodyOf(other)).metaDados.consultaUid

    const invalid = await control(h, `/_mock/directd/queries/${otherUid}/fail`, 'POST', {
      outcome: 'noBalance',
    })
    expect(invalid.status).toBe(400)
    expect((await bodyOf(invalid)).error.code).toBe('invalid_outcome')

    // An unknown query answers 404.
    const unknown = await control(h, '/_mock/directd/queries/direct-nope/fail', 'POST', {
      outcome: 'internalError',
    })
    expect(unknown.status).toBe(404)
    expect((await bodyOf(unknown)).error.code).toBe('not_found')
  })

  test('a reset drops a scheduled announce', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)
    expect(h.scheduled).toHaveLength(1)

    const reset = await control(h, '/_mock/directd/state', 'DELETE')
    expect(reset.status).toBe(200)

    // The timer of a forgotten query posts nothing.
    await h.scheduled[0]!.task()
    expect(apiV3Callbacks(h)).toHaveLength(0)
  })

  test('a fail after the callback said Finished is refused and the read stays the success', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    const uid = (await bodyOf(created)).metaDados.consultaUid

    await h.scheduled[0]!.task()
    expect(apiV3Callbacks(h)[0]!.body.Status).toBe('Finished')

    const failed = await control(h, `/_mock/directd/queries/${uid}/fail`, 'POST', {
      outcome: 'internalError',
    })
    expect(failed.status).toBe(409)
    expect((await bodyOf(failed)).error.code).toBe('already_settled')

    // The receiver was told Finished, and that is what the read answers.
    const read = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(read.status).toBe(200)
    expect((await bodyOf(read)).metaDados.resultado).toBe('Sucesso')
    expect(apiV3Callbacks(h)).toHaveLength(1)
  })

  test('a fail before the timer announces Error and the timer posts nothing more', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    const uid = (await bodyOf(created)).metaDados.consultaUid

    const failed = await control(h, `/_mock/directd/queries/${uid}/fail`, 'POST', {
      outcome: 'timeout',
    })
    expect(failed.status).toBe(200)

    await h.scheduled[0]!.task()

    const posted = apiV3Callbacks(h)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.body.Status).toBe('Error')

    const read = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(read.status).toBe(408)
  })

  test('a failed query keeps the caller and the flags of its consultation', async () => {
    const h = harness()

    const created = await h.app.fetch(
      new Request(
        `http://localhost:45450/api/Score?CPF=11101555572&Async=habilitar&GERARCOMPROVANTE=Habilitar&TOKEN=${DIRECTD_TOKEN}`,
      ),
      '10.0.0.7',
    )
    const uid = (await bodyOf(created)).metaDados.consultaUid

    await control(h, `/_mock/directd/queries/${uid}/fail`, 'POST', { outcome: 'unavailable' })

    const read = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(read.status).toBe(503)

    const meta = (await bodyOf(read)).metaDados
    expect(meta.ip).toBe('10.0.0.7')
    expect(meta.gerarComprovante).toBe(true)
  })

  test('a uid with a malformed encoding answers 404', async () => {
    const h = harness()

    const released = await control(h, '/_mock/directd/queries/%ZZ/release', 'POST')
    expect(released.status).toBe(404)

    const failed = await control(h, '/_mock/directd/queries/%ZZ/fail', 'POST', {
      outcome: 'internalError',
    })
    expect(failed.status).toBe(404)
  })

  test('a timer that outlives its registration posts nothing and the query settles', async () => {
    const h = harness()
    await confirmed(h)

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    const uid = (await bodyOf(created)).metaDados.consultaUid

    await control(h, '/_mock/directd/webhook', 'DELETE')
    await h.scheduled[0]!.task()

    expect(apiV3Callbacks(h)).toHaveLength(0)

    const read = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(read.status).toBe(200)
  })

  test('a timer posts nothing to a registration that replaced its own and is not confirmed', async () => {
    const h = harness()
    await confirmed(h)

    await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )

    await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9998/other' })
    await h.scheduled[0]!.task()

    expect(apiV3Callbacks(h)).toHaveLength(0)
  })

  test('a timer posts to the URL confirmed when it fires', async () => {
    const h = harness()
    await confirmed(h)

    await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )

    await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9998/other' })
    const state = await bodyOf(await call(h, '/_mock/directd/webhook'))
    await provider(h, '/api/Webhook/ConfirmUrlCallBack', { Code: state.code })

    await h.scheduled[0]!.task()

    const posted = apiV3Callbacks(h)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.url).toBe('http://localhost:9998/other')
  })

  test('a registration cleared while the callback is on its way breaks nothing', async () => {
    const h = holdingCallbacks()
    await confirmed(h)

    await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )

    const running = h.scheduled[0]!.task()
    await control(h, '/_mock/directd/webhook', 'DELETE')
    h.answers[0]!({ status: 201 })

    // The timer has no one to report to: a rejection here would go unhandled.
    await running
    const webhook = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(webhook.url).toBeNull()
  })

  test('the answer of a callback lands on the registration that got it', async () => {
    const h = holdingCallbacks()
    await confirmed(h)

    await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )

    const running = h.scheduled[0]!.task()
    await provider(h, '/api/Webhook/CreateUrlCallBack', { Url: 'http://localhost:9998/other' })
    h.answers[0]!({ status: 500 })
    await running

    const state = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(state.webhook.url).toBe('http://localhost:9998/other')
    expect(state.webhook.lastStatus).toBeNull()
  })

  test('a synchronous consultation that asks for a callback posts nothing', async () => {
    const h = harness()
    await confirmed(h)

    const answered = await call(h, `/api/Score?CPF=11100000143&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`)
    expect(answered.status).toBe(200)
    expect((await bodyOf(answered)).metaDados.enviarCallback).toBe(true)

    expect(h.scheduled).toHaveLength(0)
    expect(apiV3Callbacks(h)).toHaveLength(0)
  })

  test('without a confirmed URL the read rule stays', async () => {
    const h = harness()

    const created = await call(
      h,
      `/api/Score?CPF=11100000143&Async=habilitar&Callback=habilitar&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(created.status).toBe(201)
    const uid = (await bodyOf(created)).metaDados.consultaUid

    // Without a confirmed URL nothing is scheduled.
    expect(h.scheduled).toHaveLength(0)

    const pending = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(pending.status).toBe(202)

    const ready = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${uid}&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(ready.status).toBe(200)

    // And nothing is posted.
    expect(h.sent).toHaveLength(0)
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

describe('the notice, the billing switch and the forced failure', () => {
  test('fires an availability notice with its own status word', async () => {
    const h = harness()
    await confirmed(h)

    const fired = await control(h, '/_mock/directd/webhook/fire', 'POST', {
      product: 'APIv3-StatusAvailability',
      status: 'unavailable',
    })
    expect(fired.status).toBe(200)

    // The notice carries the product and its status word, and nothing else.
    const last = h.sent[h.sent.length - 1]!
    expect(Object.keys(last.body)).toEqual(['Product', 'Status'])
    expect(last.body.Product).toBe('APIv3-StatusAvailability')
    expect(last.body.Status).toBe('unavailable')

    // Without a status word there is no notice.
    const noStatus = await control(h, '/_mock/directd/webhook/fire', 'POST', {
      product: 'APIv3-StatusAvailability',
    })
    expect(noStatus.status).toBe(400)
    expect((await bodyOf(noStatus)).error.code).toBe('invalid_status')
    expect(h.sent).toHaveLength(2)

    // Without a confirmed URL there is no notice either.
    const fresh = harness()
    const noRegistration = await control(fresh, '/_mock/directd/webhook/fire', 'POST', {
      product: 'APIv3-StatusAvailability',
      status: 'unavailable',
    })
    expect(noRegistration.status).toBe(409)
  })

  test('the billing switch answers on the consumption route', async () => {
    const h = harness()

    const off = await control(h, '/_mock/directd/account', 'POST', { active: false })
    expect(off.status).toBe(200)
    expect((await bodyOf(off)).consumption.active).toBe(false)

    const consumption = await bodyOf(
      await call(h, '/api/Billing/GetConsumptionApiV3', { headers: { Token: DIRECTD_TOKEN } }),
    )
    expect(consumption.consumption.active).toBe(false)

    const on = await control(h, '/_mock/directd/account', 'POST', { active: true })
    expect((await bodyOf(on)).consumption.active).toBe(true)

    const invalid = await control(h, '/_mock/directd/account', 'POST', { active: 'no' })
    expect(invalid.status).toBe(400)
    expect((await bodyOf(invalid)).error.code).toBe('invalid_active')
  })

  test('the forced failure answers the management routes and only them', async () => {
    const h = harness()

    const forced = await control(h, '/_mock/directd/management-failure', 'PUT', { status: 429 })
    expect(forced.status).toBe(200)
    expect((await bodyOf(forced)).managementFailure).toBe(429)

    const balance = await call(h, '/api/Marketplace/GetBalance', { headers: { Token: DIRECTD_TOKEN } })
    expect(balance.status).toBe(429)
    expect(balance.headers.get('Retry-After')).toBe('30')

    const balanceBody = await bodyOf(balance)
    expect(balanceBody.status).toBe(429)
    expect(balanceBody.retryAfterSeconds).toBe(30)

    // A consultation is not a management route: it still answers.
    const consult = await call(h, `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    expect(consult.status).toBe(200)

    const internal = await control(h, '/_mock/directd/management-failure', 'PUT', { status: 500 })
    expect(internal.status).toBe(200)

    const consumption = await call(h, '/api/Billing/GetConsumptionApiV3', {
      headers: { Token: DIRECTD_TOKEN },
    })
    expect(consumption.status).toBe(500)

    const created = await provider(h, '/api/Webhook/CreateUrlCallBack', {
      Url: 'http://localhost:9999/callback',
    })
    expect(created.status).toBe(500)

    // A wrong token still answers 401: the forced failure comes after it.
    const wrong = await call(h, '/api/Marketplace/GetBalance', { headers: { Token: 'nope' } })
    expect(wrong.status).toBe(401)

    const cleared = await control(h, '/_mock/directd/management-failure', 'DELETE')
    expect(cleared.status).toBe(200)
    expect((await bodyOf(cleared)).managementFailure).toBeNull()

    const restored = await call(h, '/api/Marketplace/GetBalance', { headers: { Token: DIRECTD_TOKEN } })
    expect(restored.status).toBe(200)

    const unknown = await control(h, '/_mock/directd/management-failure', 'PUT', { status: 418 })
    expect(unknown.status).toBe(400)
    expect((await bodyOf(unknown)).error.code).toBe('invalid_status')
  })

  test('the reset forgets the account and the registration', async () => {
    const h = harness(500)

    const consult = await call(h, `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    expect(consult.status).toBe(200)

    const topUp = await control(h, '/_mock/directd/balance', 'POST', { add: 100 })
    expect(topUp.status).toBe(200)

    await confirmed(h)

    const off = await control(h, '/_mock/directd/account', 'POST', { active: false })
    expect(off.status).toBe(200)

    const forced = await control(h, '/_mock/directd/management-failure', 'PUT', { status: 500 })
    expect(forced.status).toBe(200)

    const reset = await control(h, '/_mock/directd/state', 'DELETE')
    expect(reset.status).toBe(200)

    const state = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(state.balance).toBe(500)
    expect(state.addedLast30Days).toBe(0)
    expect(state.consumedLast30Days).toBe(0)
    expect(state.billingActive).toBe(true)
    expect(state.managementFailure).toBeNull()

    const webhook = await bodyOf(await call(h, '/_mock/directd/webhook'))
    expect(webhook.url).toBeNull()
    expect(webhook.confirmed).toBe(false)

    const consumption = await bodyOf(
      await call(h, '/api/Billing/GetConsumptionApiV3', { headers: { Token: DIRECTD_TOKEN } }),
    )
    expect(consumption.consumption.active).toBe(true)
  })

  test('the account routes do not touch the counters', async () => {
    const h = harness()

    await call(h, '/api/Marketplace/GetBalance', { headers: { Token: DIRECTD_TOKEN } })
    await call(h, '/api/Billing/GetConsumptionApiV3', { headers: { Token: DIRECTD_TOKEN } })
    await call(h, '/api/Marketplace/GetBalance', { headers: { Token: DIRECTD_TOKEN } })

    const state = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(state.counters.notCharged.total).toBe(0)
    expect(state.counters.charged.total).toBe(0)
  })
})

describe('the post of the mock', () => {
  test('never follows a redirect of the receiver', async () => {
    const hits: string[] = []
    const receiver = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        const { pathname } = new URL(request.url)
        hits.push(pathname)
        return pathname === '/callback'
          ? new Response(null, { status: 307, headers: { Location: '/elsewhere' } })
          : new Response(null, { status: 201 })
      },
    })

    try {
      // No fake post here: this is the real one, against a receiver on this machine.
      const app = createApp(loadConfig({}))
      const created = await app.fetch(
        new Request('http://localhost:45450/api/Webhook/CreateUrlCallBack', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Token: DIRECTD_TOKEN },
          body: JSON.stringify({ Url: `http://127.0.0.1:${receiver.port}/callback` }),
        }),
      )

      expect(created.status).toBe(200)
      expect(hits).toEqual(['/callback'])
    } finally {
      receiver.stop(true)
    }
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
