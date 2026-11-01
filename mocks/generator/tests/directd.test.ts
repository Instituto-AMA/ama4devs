import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { DIRECTD_TOKEN } from '../src/core/credit.js'

/** The envelope of the provider, as the documentation shows it. */
const spec = JSON.parse(
  readFileSync(new URL('../spec/directd/score.response.json', import.meta.url), 'utf8'),
)

/** The harness: the clock, the ids and the wait are fakes, nothing sleeps. */
interface Harness {
  app: ReturnType<typeof createApp>
  sleeps: number[]
}

function harness(): Harness {
  const sleeps: number[] = []
  let counter = 0

  const app = createApp(loadConfig({}), {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    newId: () => `id-${++counter}`,
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
  })

  return { app, sleeps }
}

/** A request to the mock. */
function call(
  h: Harness,
  path: string,
  init?: RequestInit,
  clientIp?: string,
): Promise<Response> {
  return h.app.fetch(new Request(`http://localhost:45450${path}`, init), clientIp)
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

describe('the Direct Data routes', () => {
  test('answers the Score of a test CPF', async () => {
    const h = harness()

    const response = await call(
      h,
      `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`,
      undefined,
      '203.0.113.9',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    const body = await bodyOf(response)
    expect(Object.keys(body.metaDados)).toEqual(Object.keys(spec.metaDados))
    expect(body.metaDados.consultaUid).toBe('direct-id-1')
    expect(body.metaDados.chave).toBe('CPF=11100000143;')
    expect(body.metaDados.ip).toBe('203.0.113.9')
    expect(body.metaDados.consultaNome).toBe('Score de Crédito - QUOD')
    expect(body.metaDados.resultado).toBe('Sucesso')
    expect(body.retorno.pessoaFisica.score).toBe(850)
  })

  test('answers the Boa Vista of a test CPF', async () => {
    const h = harness()

    const response = await call(h, `/api/BoaVistaAcertaMaisPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(200)
    const body = await bodyOf(response)
    expect(body.metaDados.consultaNome).toBe('Boa Vista - Acerta Mais Positivo Pessoa Física')
    expect(body.metaDados.consultaUid).toBe('direct-id-1')
    expect(body.retorno).toBeTruthy()
  })

  test('reads the parameter names whatever their case', async () => {
    const h = harness()

    const response = await call(h, `/api/Score?cpf=11100000143&async=habilitar&token=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(201)
    const body = await bodyOf(response)
    expect(body.metaDados.chave).toBe('CPF=11100000143;')
    expect(body.metaDados.assincrono).toBe(true)
  })

  test('refuses a route it does not know', async () => {
    const h = harness()

    const response = await call(h, `/api/Nope?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(404)
    expect((await bodyOf(response)).error.code).toBe('not_found')
  })
})

describe('the failing test CPFs', () => {
  const failures = [
    { cpf: '11111111112', status: 400 },
    { cpf: '11100666788', status: 404 },
    { cpf: '11100777857', status: 408 },
    { cpf: '11100888926', status: 403 },
    { cpf: '11101000007', status: 401 },
    { cpf: '11101111186', status: 429 },
    { cpf: '11101222255', status: 503 },
    { cpf: '11101333324', status: 500 },
  ]

  for (const failure of failures) {
    test(`answers ${failure.status} for ${failure.cpf}`, async () => {
      const h = harness()

      const response = await call(h, `/api/Score?CPF=${failure.cpf}&TOKEN=${DIRECTD_TOKEN}`)

      expect(response.status).toBe(failure.status)
    })
  }

  test('the rate limit is not an envelope', async () => {
    const h = harness()

    const response = await call(h, `/api/Score?CPF=11101111186&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')

    const body = await bodyOf(response)
    expect(body.metaDados).toBeUndefined()
    expect(body.status).toBe(429)
  })
})

describe('the token', () => {
  test('refuses a token that is wrong', async () => {
    const h = harness()

    const response = await call(h, '/api/Score?CPF=11100000143&TOKEN=nope')

    expect(response.status).toBe(401)
    const body = await bodyOf(response)
    expect(body.metaDados.consultaUid).toBeNull()
    expect(body.metaDados.chave).toBeNull()
    expect(body.metaDados.resultado).toBe('Não Autorizado')
  })

  test('refuses a token that is missing', async () => {
    const h = harness()

    const response = await call(h, '/api/Score?CPF=11100000143')

    expect(response.status).toBe(401)
    expect((await bodyOf(response)).metaDados.consultaUid).toBeNull()
  })
})

describe('the async consultation', () => {
  test('answers 201, then 202, then 200', async () => {
    const h = harness()

    const created = await call(h, `/api/Score?CPF=11100000143&Async=habilitar&TOKEN=${DIRECTD_TOKEN}`)
    expect(created.status).toBe(201)

    const createdBody = await bodyOf(created)
    expect(createdBody.metaDados.consultaUid).toBe('direct-id-1')
    expect(createdBody.metaDados.resultado).toBe('Sucesso')
    expect(createdBody.metaDados.mensagem).toBe(
      'Requisição async criada com sucesso. Utilize o ConsultaUid para consultar o resultado.',
    )
    expect(createdBody.retorno).toBeNull()

    const processing = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-1&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(processing.status).toBe(202)

    const processingBody = await bodyOf(processing)
    expect(processingBody.metaDados.consultaUid).toBe('direct-id-1')
    expect(processingBody.metaDados.chave).toBe('CPF=11100000143;')
    expect(processingBody.metaDados.mensagem).toBe('Consulta em processamento.')
    expect(processingBody.retorno).toBeNull()

    const ready = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-1&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(ready.status).toBe(200)

    const readyBody = await bodyOf(ready)
    expect(readyBody.metaDados.assincrono).toBe(true)
    expect(readyBody.metaDados.consultaUid).toBe('direct-id-1')
    expect(readyBody.retorno.pessoaFisica.score).toBe(850)
  })

  test('never settles until it is released', async () => {
    const h = harness()

    await call(h, `/api/Score?CPF=11101555572&Async=habilitar&TOKEN=${DIRECTD_TOKEN}`)

    for (let read = 0; read < 4; read += 1) {
      const response = await call(
        h,
        `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-1&TOKEN=${DIRECTD_TOKEN}`,
      )
      expect(response.status).toBe(202)
    }

    const released = await control(h, '/_mock/directd/queries/direct-id-1/release', 'POST')
    expect(released.status).toBe(200)
    expect((await bodyOf(released)).released).toBe('direct-id-1')

    const ready = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-1&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(ready.status).toBe(200)
  })

  test('a released query answers its final body at the next read', async () => {
    const h = harness()

    await call(h, `/api/Score?CPF=11100000143&Async=habilitar&TOKEN=${DIRECTD_TOKEN}`)
    await control(h, '/_mock/directd/queries/direct-id-1/release', 'POST')

    const before = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(before.asyncQueries[0].delivered).toBe(false)

    const ready = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-1&TOKEN=${DIRECTD_TOKEN}`,
    )
    expect(ready.status).toBe(200)

    const after = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(after.asyncQueries[0].delivered).toBe(true)
  })

  test('does not know a query that does not exist', async () => {
    const h = harness()

    const response = await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-nope&TOKEN=${DIRECTD_TOKEN}`,
    )

    expect(response.status).toBe(404)
    const body = await bodyOf(response)
    expect(body.metaDados.consultaNome).toBe('Obter Retorno Consulta Async')
    expect(body.retorno).toBeNull()
  })
})

describe('the slow CPF', () => {
  test('waits for the slow outcome', async () => {
    const h = harness()

    const response = await call(h, `/api/Score?CPF=11101444401&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(200)
    expect(h.sleeps).toEqual([25000])
  })

  test('an async consultation of the slow CPF is created at once', async () => {
    const h = harness()

    const response = await call(h, `/api/Score?CPF=11101444401&Async=habilitar&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(201)
    expect(h.sleeps).toEqual([])
  })

  test('does not wait for the others', async () => {
    const h = harness()

    await call(h, `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)

    expect(h.sleeps).toEqual([])
  })
})

describe('the counters', () => {
  test('charges a consultation once', async () => {
    const h = harness()

    await call(h, `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    await call(h, `/api/Score?CPF=11101666641&TOKEN=${DIRECTD_TOKEN}`)
    await call(h, `/api/Score?CPF=11100666788&TOKEN=${DIRECTD_TOKEN}`)
    await call(h, `/api/Score?CPF=11100000143&Async=habilitar&TOKEN=${DIRECTD_TOKEN}`)
    await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-4&TOKEN=${DIRECTD_TOKEN}`,
    )
    await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-4&TOKEN=${DIRECTD_TOKEN}`,
    )
    await call(
      h,
      `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-4&TOKEN=${DIRECTD_TOKEN}`,
    )

    const state = await bodyOf(await call(h, '/_mock/directd/state'))

    expect(state.counters.charged.total).toBe(3)
    expect(state.counters.charged.byRoute.Score).toBe(3)
    expect(state.counters.notCharged.byStatus['404']).toBe(1)
  })
})

describe('the request log', () => {
  test('keeps the token out of the log', async () => {
    const h = harness()

    await call(h, `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)

    const log = await bodyOf(await call(h, '/_mock/directd/requests'))
    expect(log.requests[0].query.TOKEN).toBe('valid')
    expect(log.requests[0].cpf).toBe('11100000143')
    expect(log.requests[0].charged).toBe(true)
    expect(JSON.stringify(log.requests)).not.toContain(DIRECTD_TOKEN)
  })
})

describe('the test CPFs', () => {
  test('adds a CPF at runtime and removes it', async () => {
    const h = harness()

    const created = await control(h, '/_mock/directd/test-cpfs', 'POST', {
      cpf: '529.982.247-25',
      outcome: 'highRisk',
    })
    expect(created.status).toBe(201)
    expect((await bodyOf(created)).cpf).toBe('52998224725')

    const consult = await call(h, `/api/Score?CPF=52998224725&TOKEN=${DIRECTD_TOKEN}`)
    expect((await bodyOf(consult)).retorno.pessoaFisica.score).toBe(420)

    const removed = await control(h, '/_mock/directd/test-cpfs/52998224725', 'DELETE')
    expect(removed.status).toBe(200)
    expect((await bodyOf(removed)).removed).toBe('52998224725')

    const unlisted = await call(h, `/api/Score?CPF=52998224725&TOKEN=${DIRECTD_TOKEN}`)
    expect((await bodyOf(unlisted)).retorno.pessoaFisica.score).toBe(850)
  })

  test('the policy of the CPFs that are not in the table', async () => {
    const h = harness()

    const put = await control(h, '/_mock/directd/test-cpfs/policy', 'PUT', { unlisted: 'notFound' })
    expect(put.status).toBe(200)
    expect((await bodyOf(put)).unlisted).toBe('notFound')

    const consult = await call(h, `/api/Score?CPF=52998224725&TOKEN=${DIRECTD_TOKEN}`)
    expect(consult.status).toBe(404)

    const unknown = await control(h, '/_mock/directd/test-cpfs/policy', 'PUT', { unlisted: 'nope' })
    expect(unknown.status).toBe(400)
  })

  test('restores the defaults', async () => {
    const h = harness()

    await control(h, '/_mock/directd/test-cpfs', 'POST', { cpf: '52998224725', outcome: 'highRisk' })
    await control(h, '/_mock/directd/test-cpfs/policy', 'PUT', { unlisted: 'notFound' })

    const restored = await control(h, '/_mock/directd/test-cpfs', 'DELETE')
    expect(restored.status).toBe(200)
    expect((await bodyOf(restored)).restored).toBe(true)

    const table = await bodyOf(await call(h, '/_mock/directd/test-cpfs'))
    expect(table.unlisted).toBe('lowRisk')
    expect(table.testCpfs).toHaveLength(17)
  })

  test('a row may override one count of its preset', async () => {
    const h = harness()

    const created = await control(h, '/_mock/directd/test-cpfs', 'POST', {
      cpf: '52998224725',
      outcome: 'restrictions',
      profile: { debts: { count: 2 } },
    })
    expect(created.status).toBe(201)

    const consult = await call(h, `/api/BoaVistaAcertaMaisPositivoPF?CPF=52998224725&TOKEN=${DIRECTD_TOKEN}`)
    const debts = (await bodyOf(consult)).retorno.pendenciasFinanceiras
    expect(debts.quantidadeOcorrencia).toBe('2')
    expect(debts.valorTotal).toBe('4.230,50')
    expect(debts.ocorrencias).toHaveLength(2)
  })

  test('refuses a profile that would break the documented answer', async () => {
    const h = harness()

    for (const profile of [{ score: '850' }, { debts: 3 }, { debts: { total: '12.5' } }, { nope: 1 }]) {
      const response = await control(h, '/_mock/directd/test-cpfs', 'POST', {
        cpf: '52998224725',
        outcome: 'lowRisk',
        profile,
      })
      expect(response.status).toBe(400)
      expect((await bodyOf(response)).error.code).toBe('invalid_profile')
    }
  })

  test('refuses an outcome it does not know', async () => {
    const h = harness()

    const response = await control(h, '/_mock/directd/test-cpfs', 'POST', {
      cpf: '52998224725',
      outcome: 'nope',
    })

    expect(response.status).toBe(400)
    expect((await bodyOf(response)).error.code).toBe('invalid_outcome')
  })
})

describe('the local guard', () => {
  test('keeps the control routes bound to this machine', async () => {
    const h = harness()

    const response = await call(h, '/_mock/directd/state', { headers: { host: 'evil.example' } })

    expect(response.status).toBe(403)
    expect((await bodyOf(response)).error.code).toBe('forbidden_host')
  })

  test('the provider routes are open to the other containers', async () => {
    const h = harness()

    const response = await call(
      h,
      `/api/Score?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`,
      { headers: { host: 'hub.example' } },
    )

    expect(response.status).toBe(200)
  })
})

describe('the reset', () => {
  test('empties the log, the queries and the counters', async () => {
    const h = harness()

    await call(h, `/api/Score?CPF=11100000143&Async=habilitar&TOKEN=${DIRECTD_TOKEN}`)

    const reset = await control(h, '/_mock/directd/state', 'DELETE')
    expect((await bodyOf(reset)).reset).toBe(true)

    const state = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(state.requests).toBe(0)
    expect(state.asyncQueries).toHaveLength(0)
    expect(state.counters.charged.total).toBe(0)
    expect(state.counters.notCharged.total).toBe(0)
  })
})

describe('the source', () => {
  test('never calls out', () => {
    const source = readFileSync(new URL('../src/directd.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('directd.com.br')
  })
})
