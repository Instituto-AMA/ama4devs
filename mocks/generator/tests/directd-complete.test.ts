import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import {
  DIRECTD_TOKEN,
  ROUTE_BOA_VISTA,
  ROUTE_BOA_VISTA_COMPLETO,
  ROUTE_DOSSIE,
  ROUTE_SCORE,
  answerFor,
  boaVistaCompletoReturn,
  dossieReturn,
  profileOf,
} from '../src/core/credit.js'

const SPEC_DIR = join(import.meta.dir, '../spec/directd')
const dossieSpec = JSON.parse(readFileSync(join(SPEC_DIR, 'dossie-credito-completo.response.json'), 'utf8'))
const dossieMcp = JSON.parse(readFileSync(join(SPEC_DIR, 'dossie-credito-completo.mcp.json'), 'utf8'))
const completoSpec = JSON.parse(readFileSync(join(SPEC_DIR, 'boavista-acerta-completo-positivo-pf.response.json'), 'utf8'))
const completoMcp = JSON.parse(readFileSync(join(SPEC_DIR, 'boavista-acerta-completo-positivo-pf.mcp.json'), 'utf8'))

const NOW = new Date(Date.UTC(2026, 9, 31, 12, 0, 0))
const CALL = { now: NOW, uid: '9f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', ip: '10.0.0.1', startedAt: NOW }

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
function call(h: Harness, path: string): Promise<Response> {
  return h.app.fetch(new Request(`http://localhost:45450${path}`))
}

/** A request to the mock with the token in the header, the way the account routes take it. */
function callWithToken(h: Harness, path: string): Promise<Response> {
  return h.app.fetch(new Request(`http://localhost:45450${path}`, { headers: { Token: DIRECTD_TOKEN } }))
}

/** The body of an answer. */
async function bodyOf(response: Response): Promise<any> {
  return (await response.json()) as any
}

/** The key paths of a value: objects as `a.b`, arrays through their first element. */
function keysOf(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    const path = `${prefix}[]`
    if (value.length === 0) return [path]
    return keysOf(value[0], path)
  }
  if (value !== null && typeof value === 'object') {
    const out: string[] = []
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (child !== null && typeof child === 'object') out.push(...keysOf(child, path))
      else out.push(path)
    }
    return out
  }
  return [prefix]
}

/** The leaves of a value with their paths. */
function leavesOf(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    return leavesOf(value[0], `${prefix}[]`)
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leavesOf(child, prefix ? `${prefix}.${key}` : key))
  }
  return [[prefix, value]]
}

/** The paths the spec has that the answer misses, skipping arrays empty in the answer. */
function specMissing(specValue: any, answerValue: any, prefix = ''): string[] {
  const missing: string[] = []
  for (const [key, child] of Object.entries(specValue)) {
    const path = prefix ? `${prefix}.${key}` : key
    const answerChild = answerValue?.[key]
    if (answerChild === undefined) missing.push(path)
    else if (Array.isArray(child) && Array.isArray(answerChild)) {
      if (child.length > 0 && answerChild.length > 0) missing.push(...specMissing(child[0], answerChild[0], `${path}[]`))
    } else if (child !== null && typeof child === 'object') {
      missing.push(...specMissing(child, answerChild, path))
    }
  }
  return missing
}

describe('the Dossiê QUOD route', () => {
  test('answers 200 with the envelope of the provider', async () => {
    const h = harness()

    const response = await call(h, `/api/DossieCreditoCompleto?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(200)
    const body = await bodyOf(response)
    expect(Object.keys(body.metaDados)).toEqual(Object.keys(dossieSpec.metaDados))
    expect(body.metaDados.consultaNome).toBe('Dossiê QUOD - Completo')
    expect(body.metaDados.resultado).toBe('Sucesso')
    expect(body.metaDados.chave).toBe('CPF=11100000143;')
    expect(body.retorno).toBeTruthy()
  })

  test('the top-level keys are the four of the catalog', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/DossieCreditoCompleto?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`))

    expect(Object.keys(body.retorno)).toEqual(Object.keys(dossieSpec.retorno))
  })

  test('every MCP field of the return is a top-level key', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/DossieCreditoCompleto?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`))

    for (const field of dossieMcp.camposRetorno) expect(field.nome in body.retorno).toBe(true)
  })

  test('the fields the Hub reads are present and consistent', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/DossieCreditoCompleto?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`))
    const ef = body.retorno.entidadeFisica

    expect(ef.dadosCadastrais.status).toBe('REGULAR')
    expect(ef.dadosCadastrais.possuiObito).toBe(false)
    expect(ef.scoreEntidade.entidadeFisica.score).toBe(850)
    expect(typeof ef.scoreEntidade.entidadeFisica.score).toBe('number')
    expect(body.retorno.entidadeJuridica).toBeNull()
    expect(Array.isArray(ef.pendenciaFinanceira.negativacoes)).toBe(true)
    expect(Array.isArray(ef.pendenciaFinanceira.protestos)).toBe(true)
    expect(Array.isArray(ef.pendenciaFinanceira.acoesJudiciais)).toBe(true)
    expect(Array.isArray(ef.pendenciaFinanceira.recuperacoesJudiciaisFalencia)).toBe(true)
    expect(Array.isArray(ef.pendenciaFinanceira.chequesSemFundo)).toBe(true)
  })

  test('the restricted CPF carries its debts, its protests and its score', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/DossieCreditoCompleto?CPF=11100333460&TOKEN=${DIRECTD_TOKEN}`))
    const ef = body.retorno.entidadeFisica
    const pendencia = ef.pendenciaFinanceira

    expect(ef.scoreEntidade.entidadeFisica.score).toBe(380)
    expect(pendencia.negativacoes).toHaveLength(3)
    expect(typeof pendencia.negativacoes[0].valor).toBe('number')
    expect(pendencia.negativacoes[0].valor).toBeGreaterThan(0)
    expect(pendencia.protestos).toHaveLength(1)
    expect(pendencia.protestos[0].valorTotal).toBe(800)
  })

  test('the deceased CPF carries the obito flag', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/DossieCreditoCompleto?CPF=11100444530&TOKEN=${DIRECTD_TOKEN}`))

    expect(body.retorno.entidadeFisica.dadosCadastrais.possuiObito).toBe(true)
  })

  test('the irregular CPF carries the suspended status', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/DossieCreditoCompleto?CPF=11100555609&TOKEN=${DIRECTD_TOKEN}`))

    expect(body.retorno.entidadeFisica.dadosCadastrais.status).toBe('SUSPENSA')
  })

  test('the answer adds no key beyond the spec', () => {
    const specPaths = keysOf(dossieSpec.retorno)
    const retorno = dossieReturn('11100000143', profileOf('lowRisk'), NOW)
    const extra = keysOf(retorno).filter(
      (path) => !specPaths.includes(path) && !specPaths.some((specPath) => specPath.startsWith(path)),
    )

    expect(extra).toEqual([])
  })

  test('every spec path is present unless its array is empty in the answer', () => {
    for (const outcome of ['lowRisk', 'restrictions'] as const) {
      const retorno = dossieReturn('11100000143', profileOf(outcome), NOW)
      const missing = specMissing(dossieSpec.retorno, retorno).filter(
        (path) => !path.includes('entidadeJuridica'),
      )

      expect(missing).toEqual([])
    }
  })

  test('the entity of a person carries no juridical block', () => {
    const retorno = dossieReturn('11100000143', profileOf('lowRisk'), NOW)

    expect(retorno.entidadeJuridica).toBeNull()
    expect(retorno.entidadeFisica.scoreEntidade.entidadeJuridica).toBeNull()
  })

  test('the leaves the Hub reads are numbers, not strings', () => {
    const retorno = dossieReturn('11100333460', profileOf('restrictions'), NOW)
    const ef = retorno.entidadeFisica

    expect(typeof ef.scoreEntidade.entidadeFisica.score).toBe('number')
    expect(typeof ef.pendenciaFinanceira.totalPendencia).toBe('number')
    expect(typeof ef.pendenciaFinanceira.negativacoes[0]!.valor).toBe('number')
    expect(typeof ef.pendenciaFinanceira.protestos[0]!.valorTotal).toBe('number')
    expect(typeof ef.dadosCadastrais.possuiObito).toBe('boolean')
  })
})

describe('the Acerta Completo route', () => {
  test('answers 200 with the envelope of the provider', async () => {
    const h = harness()

    const response = await call(h, `/api/BoaVistaAcertaCompletoPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(200)
    const body = await bodyOf(response)
    expect(Object.keys(body.metaDados)).toEqual(Object.keys(completoSpec.metaDados))
    expect(body.metaDados.consultaNome).toBe('Boa Vista - Acerta Completo Positivo Pessoa Física')
    expect(body.metaDados.resultado).toBe('Sucesso')
    expect(body.retorno).toBeTruthy()
  })

  test('the top-level keys are the 43 of the catalog, in its order', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/BoaVistaAcertaCompletoPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`))

    expect(Object.keys(body.retorno)).toEqual(Object.keys(completoSpec.retorno))
    expect(Object.keys(body.retorno)).toHaveLength(43)
  })

  test('every MCP field of the return is a top-level key', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/BoaVistaAcertaCompletoPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`))

    for (const field of completoMcp.camposRetorno) expect(field.nome in body.retorno).toBe(true)
  })

  test('every leaf is a string', () => {
    for (const outcome of ['lowRisk', 'restrictions'] as const) {
      const retorno = boaVistaCompletoReturn('11100000143', profileOf(outcome))
      for (const [, leaf] of leavesOf(retorno)) expect(leaf).toBeTypeOf('string')
    }
  })

  test('the restricted CPF carries its debts, its protests and its restrictions', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/BoaVistaAcertaCompletoPositivoPF?CPF=11100333460&TOKEN=${DIRECTD_TOKEN}`))
    const retorno = body.retorno

    expect(retorno.cpfSituacao).toBe('REGULAR')
    expect(retorno.nome).toBe('CARLOS RESTRICOES LIMA')
    expect(retorno.pendenciasFinanceiras.quantidadeOcorrencia).toBe('3')
    expect(retorno.pendenciasFinanceiras.valorTotal).toBe('4.230,50')
    expect(retorno.protestos.quantidadeOcorrencia).toBe('1')
    expect(retorno.protestos.valorTotal).toBe('800,00')
    expect(retorno.restricoes.quantidadeOcorrencias).toBe('2')
    expect(retorno.scores.ocorrencias[0].score).toBe('380')
  })

  test('the phone and the address come as the arrays of the catalog', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/BoaVistaAcertaCompletoPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`))
    const retorno = body.retorno

    expect(Array.isArray(retorno.telefones)).toBe(true)
    expect(Array.isArray(retorno.enderecos)).toBe(true)
    expect(retorno.telefones[0].ddd).toBe('11')
    expect(retorno.enderecos[0].cidade).toBe('SAO PAULO')
  })

  test('the deceased CPF carries the obito flag', async () => {
    const h = harness()

    const body = await bodyOf(await call(h, `/api/BoaVistaAcertaCompletoPositivoPF?CPF=11100444530&TOKEN=${DIRECTD_TOKEN}`))

    expect(body.retorno.indicacaoObito).toBe('SIM')
  })
})

describe('the profile behind the new routes', () => {
  const ROUTES = [ROUTE_SCORE, ROUTE_BOA_VISTA, ROUTE_BOA_VISTA_COMPLETO, ROUTE_DOSSIE]

  test('the score is the same across the four products for one CPF', () => {
    for (const cpf of ['11100000143', '11100111212', '11100222391', '11100333460']) {
      const scores = ROUTES.map((route) => {
        const retorno = answerFor(route, { CPF: cpf }, CALL).body.retorno
        if (route === ROUTE_DOSSIE) return retorno.entidadeFisica.scoreEntidade.entidadeFisica.score
        if (route === ROUTE_SCORE) return retorno.pessoaFisica.score
        return Number(retorno.scores.ocorrencias[0].score)
      })

      expect(new Set(scores).size).toBe(1)
    }
  })

  test('the debts, the protests and the restrictions match across the products', () => {
    const cpf = '11100333460'
    const mais = answerFor(ROUTE_BOA_VISTA, { CPF: cpf }, CALL).body.retorno
    const completo = answerFor(ROUTE_BOA_VISTA_COMPLETO, { CPF: cpf }, CALL).body.retorno
    const dossie = answerFor(ROUTE_DOSSIE, { CPF: cpf }, CALL).body.retorno.entidadeFisica

    expect(mais.pendenciasFinanceiras.quantidadeOcorrencia).toBe(completo.pendenciasFinanceiras.quantidadeOcorrencia)
    expect(mais.protestos.valorTotal).toBe(completo.protestos.valorTotal)
    expect(mais.restricoes.quantidadeOcorrencias).toBe(completo.restricoes.quantidadeOcorrencias)
    expect(dossie.pendenciaFinanceira.negativacoes).toHaveLength(3)
    expect(dossie.pendenciaFinanceira.protestos[0].valorTotal).toBe(800)
  })

  test('the deceased and the irregular CPFs answer alike on every product', () => {
    for (const route of ROUTES) {
      const deceased = answerFor(route, { CPF: '11100444530' }, CALL).body.retorno
      const irregular = answerFor(route, { CPF: '11100555609' }, CALL).body.retorno

      if (route === ROUTE_DOSSIE) {
        expect(deceased.entidadeFisica.dadosCadastrais.possuiObito).toBe(true)
        expect(irregular.entidadeFisica.dadosCadastrais.status).toBe('SUSPENSA')
      } else if (route === ROUTE_SCORE) {
        expect(deceased.pessoaFisica.score).toBe(0)
        expect(irregular.pessoaFisica.score).toBe(500)
      } else {
        expect(deceased.indicacaoObito).toBe('SIM')
        expect(irregular.cpfSituacao).toBe('SUSPENSA')
      }
    }
  })
})

describe('the async consultation of the new routes', () => {
  for (const route of [ROUTE_DOSSIE, ROUTE_BOA_VISTA_COMPLETO]) {
    test(`${route} answers 201, then 202, then 200`, async () => {
      const h = harness()

      const created = await call(h, `/api/${route}?CPF=11100000143&Async=habilitar&TOKEN=${DIRECTD_TOKEN}`)
      expect(created.status).toBe(201)

      const createdBody = await bodyOf(created)
      expect(createdBody.metaDados.consultaUid).toBe('direct-id-1')
      expect(createdBody.metaDados.resultado).toBe('Sucesso')
      expect(createdBody.retorno).toBeNull()

      const processing = await call(
        h,
        `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-1&TOKEN=${DIRECTD_TOKEN}`,
      )
      expect(processing.status).toBe(202)
      expect((await bodyOf(processing)).retorno).toBeNull()

      const ready = await call(
        h,
        `/api/Historico/ObterRetornoConsultaAsync?ConsultaUid=direct-id-1&TOKEN=${DIRECTD_TOKEN}`,
      )
      expect(ready.status).toBe(200)
      expect((await bodyOf(ready)).retorno).toBeTruthy()
    })
  }
})

describe('the charge of the new products', () => {
  test('a consultation of each new product subtracts its own cost', async () => {
    const h = harness()

    const before = await bodyOf(await callWithToken(h, '/api/Marketplace/GetBalance'))

    await call(h, `/api/DossieCreditoCompleto?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    const afterDossie = await bodyOf(await callWithToken(h, '/api/Marketplace/GetBalance'))

    expect(afterDossie.balance.balance).toBe(Number((before.balance.balance - 6.99).toFixed(2)))

    await call(h, `/api/BoaVistaAcertaCompletoPositivoPF?CPF=11100000143&TOKEN=${DIRECTD_TOKEN}`)
    const afterCompleto = await bodyOf(await callWithToken(h, '/api/Marketplace/GetBalance'))

    expect(afterCompleto.balance.balance).toBe(Number((before.balance.balance - 6.99 - 14.03).toFixed(2)))
  })

  test('the warnings CPF is charged like the successful one', async () => {
    const h = harness()

    const response = await call(h, `/api/DossieCreditoCompleto?CPF=11101666641&TOKEN=${DIRECTD_TOKEN}`)
    const body = await bodyOf(response)

    expect(body.metaDados.resultado).toBe('Sucesso com Ressalvas')

    const state = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(state.counters.charged.byRoute.DossieCreditoCompleto).toBe(1)
  })

  test('a refusal is not charged', async () => {
    const h = harness()

    const response = await call(h, `/api/DossieCreditoCompleto?CPF=11100666788&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(404)

    const state = await bodyOf(await call(h, '/_mock/directd/state'))
    expect(state.counters.charged.total).toBe(0)
  })
})

describe('the failures of the new routes', () => {
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

  for (const route of [ROUTE_DOSSIE, ROUTE_BOA_VISTA_COMPLETO]) {
    for (const failure of failures) {
      test(`${route} answers ${failure.status} for ${failure.cpf}`, async () => {
        const h = harness()

        const response = await call(h, `/api/${route}?CPF=${failure.cpf}&TOKEN=${DIRECTD_TOKEN}`)

        expect(response.status).toBe(failure.status)
      })
    }
  }

  test('the slow CPF waits on the new routes too', async () => {
    const h = harness()

    const response = await call(h, `/api/DossieCreditoCompleto?CPF=11101444401&TOKEN=${DIRECTD_TOKEN}`)

    expect(response.status).toBe(200)
    expect(h.sleeps).toEqual([25000])
  })

  test('the token is checked on the new routes', async () => {
    const h = harness()

    const response = await call(h, '/api/DossieCreditoCompleto?CPF=11100000143&TOKEN=nope')

    expect(response.status).toBe(401)
    expect((await bodyOf(response)).metaDados.consultaUid).toBeNull()
  })
})
