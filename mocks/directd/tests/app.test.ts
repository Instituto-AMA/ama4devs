import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SLOW_DELAY_MS, createApp } from '../src/app.ts'
import { MOCK_TOKEN, ROUTE_BOA_VISTA, ROUTE_QUOD, SCENARIO_CPFS, isValidCpf } from '../src/scenarios.ts'

function harness() {
  let counter = 0
  const sleeps: number[] = []
  const app = createApp({
    now: () => new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
    newId: () => `id-${++counter}`,
    sleep: async (ms) => void sleeps.push(ms),
  })
  const get = (path: string) => app.fetch(new Request(`http://mock${path}`))
  const consult = (route: string, cpf: string, extra = '', token = MOCK_TOKEN) =>
    get(`/api/${route}?CPF=${cpf}&TOKEN=${token}${extra}`)
  return { app, get, consult, sleeps }
}

type Envelope = { metaDados: Record<string, unknown>; retorno: any }

async function body(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope
}

describe('scenario CPFs', () => {
  test('every scenario CPF except the bad document has valid check digits', () => {
    for (const [scenario, cpf] of Object.entries(SCENARIO_CPFS)) {
      expect(isValidCpf(cpf)).toBe(scenario !== 'badDocument')
    }
  })
})

describe('sync success', () => {
  test('Quod returns the person with a score range', async () => {
    const { consult } = harness()
    const response = await consult(ROUTE_QUOD, SCENARIO_CPFS.lowRisk)
    expect(response.status).toBe(200)
    const data = await body(response)
    expect(data.metaDados).toMatchObject({
      consultaNome: ROUTE_QUOD,
      consultaUid: 'direct-id-1',
      chave: SCENARIO_CPFS.lowRisk,
      resultadoId: 1,
      resultado: 'Sucesso',
      mensagem: '',
      apiVersao: 'v3',
      assincrono: false,
    })
    expect(data.retorno.pessoaFisica).toMatchObject({ score: '850', faixaScore: '801 a 900', capacidadePagamento: 'R$ 2.500,00' })
  })

  test('Boa Vista low risk', async () => {
    const { consult } = harness()
    const data = await body(await consult(ROUTE_BOA_VISTA, SCENARIO_CPFS.lowRisk))
    expect(data.retorno.cpfSituacao).toBe('REGULAR')
    expect(data.retorno.indicacaoObito).toBe('NAO')
    expect(data.retorno.scores.ocorrencias[0]).toEqual({ score: '850', classificacaoABC: 'A', probabilidadeInadimplencia: '3,5%' })
  })

  test('an unknown valid CPF is low risk', async () => {
    const { consult } = harness()
    const data = await body(await consult(ROUTE_BOA_VISTA, '52998224725'))
    expect(data.retorno.scores.ocorrencias[0].score).toBe('850')
  })

  test('medium and high risk', async () => {
    const { consult } = harness()
    const medium = await body(await consult(ROUTE_BOA_VISTA, SCENARIO_CPFS.mediumRisk))
    expect(medium.retorno.scores.ocorrencias[0]).toMatchObject({ score: '650', probabilidadeInadimplencia: '18%' })
    const high = await body(await consult(ROUTE_BOA_VISTA, SCENARIO_CPFS.highRisk))
    expect(high.retorno.scores.ocorrencias[0]).toMatchObject({ score: '420', probabilidadeInadimplencia: '41%' })
  })

  test('restrictions', async () => {
    const { consult } = harness()
    const { retorno } = await body(await consult(ROUTE_BOA_VISTA, SCENARIO_CPFS.restrictions))
    expect(retorno.pendenciasFinanceiras).toMatchObject({ quantidade: '3', valorTotal: '4.230,50' })
    expect(retorno.protestos).toMatchObject({ quantidade: '1', valorTotal: '800,00' })
    expect(retorno.restricoes.quantidade).toBe('2')
  })

  test('deceased and irregular CPF', async () => {
    const { consult } = harness()
    const dead = await body(await consult(ROUTE_BOA_VISTA, SCENARIO_CPFS.deceased))
    expect(dead.retorno.indicacaoObito).toBe('SIM')
    const irregular = await body(await consult(ROUTE_BOA_VISTA, SCENARIO_CPFS.irregular))
    expect(irregular.retorno.cpfSituacao).toBe('SUSPENSA')
  })
})

describe('failures', () => {
  const cases: [string, string, number, string][] = [
    ['badDocument', SCENARIO_CPFS.badDocument, 400, 'Requisição Inválida'],
    ['invalid check digits', '12345678900', 400, 'Requisição Inválida'],
    ['notFound', SCENARIO_CPFS.notFound, 404, 'Não Encontrado'],
    ['timeout', SCENARIO_CPFS.timeout, 408, 'Tempo Esgotado'],
    ['noBalance', SCENARIO_CPFS.noBalance, 403, 'Saldo insuficiente'],
    ['unauthorized', SCENARIO_CPFS.unauthorized, 401, 'Não Autorizado'],
    ['unavailable', SCENARIO_CPFS.unavailable, 503, 'Serviço Indisponível'],
    ['internalError', SCENARIO_CPFS.internalError, 500, 'Erro Interno'],
  ]
  for (const [name, cpf, status, resultado] of cases) {
    test(`${name} answers ${status}`, async () => {
      const { consult } = harness()
      const response = await consult(ROUTE_QUOD, cpf)
      expect(response.status).toBe(status)
      const data = await body(response)
      expect(data.metaDados.resultado).toBe(resultado)
      expect(data.retorno).toBeNull()
    })
  }

  test('429 carries retryAfterSeconds in the body and Retry-After', async () => {
    const { consult } = harness()
    const response = await consult(ROUTE_QUOD, SCENARIO_CPFS.rateLimited)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect((await body(response)).metaDados.retryAfterSeconds).toBe(30)
  })

  test('slow waits 25 s before answering', async () => {
    const { consult, sleeps } = harness()
    const response = await consult(ROUTE_QUOD, SCENARIO_CPFS.slow)
    expect(response.status).toBe(200)
    expect(sleeps).toEqual([SLOW_DELAY_MS])
  })

  test('only the slow scenario waits', async () => {
    const { consult, sleeps } = harness()
    await consult(ROUTE_QUOD, SCENARIO_CPFS.lowRisk)
    expect(sleeps).toEqual([])
  })
})

describe('token', () => {
  test('a wrong token answers 401 with the envelope', async () => {
    const { consult } = harness()
    const response = await consult(ROUTE_QUOD, SCENARIO_CPFS.lowRisk, '', 'nope')
    expect(response.status).toBe(401)
    const data = await body(response)
    expect(data.metaDados).toMatchObject({ resultadoId: 3, resultado: 'Não Autorizado', mensagem: 'IP ou Token inválido. Verifique.', apiVersao: 'v3', assincrono: false })
    expect(data.retorno).toBeNull()
  })

  test('a missing token answers 401', async () => {
    const { get } = harness()
    expect((await get(`/api/${ROUTE_QUOD}?CPF=${SCENARIO_CPFS.lowRisk}`)).status).toBe(401)
  })
})

describe('async', () => {
  test('201, then 202, then 200', async () => {
    const { consult, get } = harness()
    const created = await consult(ROUTE_BOA_VISTA, SCENARIO_CPFS.lowRisk, '&Async=habilitar')
    expect(created.status).toBe(201)
    const meta = (await body(created)).metaDados
    expect(meta).toMatchObject({ assincrono: true, resultado: 'Processando' })
    const read = () => get(`/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${meta.consultaUid}&TOKEN=${MOCK_TOKEN}`)
    expect((await read()).status).toBe(202)
    const done = await read()
    expect(done.status).toBe(200)
    const data = await body(done)
    expect(data.metaDados.resultado).toBe('Sucesso')
    expect(data.retorno.scores.ocorrencias[0].score).toBe('850')
  })

  test('never settles stays 202', async () => {
    const { consult, get } = harness()
    const created = await body(await consult(ROUTE_QUOD, SCENARIO_CPFS.neverSettles, '&Async=habilitar'))
    for (let i = 0; i < 4; i++) {
      const response = await get(`/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=${created.metaDados.consultaUid}&TOKEN=${MOCK_TOKEN}`)
      expect(response.status).toBe(202)
    }
  })

  test('an unknown uid answers 404', async () => {
    const { get } = harness()
    const response = await get(`/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-unknown&TOKEN=${MOCK_TOKEN}`)
    expect(response.status).toBe(404)
  })

  test('a wrong token on the read answers 401', async () => {
    const { get } = harness()
    expect((await get('/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=x&TOKEN=bad')).status).toBe(401)
  })

  test('an async failure scenario answers its error at once', async () => {
    const { consult } = harness()
    expect((await consult(ROUTE_QUOD, SCENARIO_CPFS.unavailable, '&Async=habilitar')).status).toBe(503)
  })
})

describe('control endpoints', () => {
  test('health, request log and reset', async () => {
    const { app, get, consult } = harness()
    expect((await get('/health')).status).toBe(200)
    await consult(ROUTE_QUOD, SCENARIO_CPFS.lowRisk)
    const log = (await (await get('/__mock/requests')).json()) as { requests: { path: string; status: number }[] }
    expect(log.requests).toEqual([expect.objectContaining({ path: `/api/${ROUTE_QUOD}`, status: 200 })])
    await app.fetch(new Request('http://mock/__mock/state', { method: 'DELETE' }))
    const after = (await (await get('/__mock/requests')).json()) as { requests: unknown[] }
    expect(after.requests).toEqual([])
  })

  test('an unknown route answers 404', async () => {
    const { get } = harness()
    expect((await get('/api/Nothing?TOKEN=' + MOCK_TOKEN)).status).toBe(404)
  })
})

describe('no outbound call', () => {
  test('the source tree has no client code and no provider URL', () => {
    const dir = join(import.meta.dir, '..', 'src')
    const forbidden = [/\bawait fetch\(/, /\bfetch\(\s*['"`]/, /http\.request/, /https\.request/, /XMLHttpRequest/, /directd\.com\.br/, /new WebSocket\(/]
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), 'utf8')
      for (const pattern of forbidden) expect({ file, hit: pattern.test(text) }).toEqual({ file, hit: false })
    }
  })
})
