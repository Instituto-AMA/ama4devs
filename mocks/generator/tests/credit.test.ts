import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_TEST_CPFS, MESSAGES, OUTCOMES, RESULT, ROUTE_BOA_VISTA, ROUTE_SCORE,
  answerFor, boaVistaReturn, envelope, formatDirectdDate, profileOf, quodReturn, rateLimitBody, resolveCpf,
} from '../src/core/credit.js'

const SPEC_DIR = join(import.meta.dir, '../spec/directd')
const scoreSpec = JSON.parse(readFileSync(join(SPEC_DIR, 'score.response.json'), 'utf8'))
const boaSpec = JSON.parse(readFileSync(join(SPEC_DIR, 'boavista-acerta-mais-positivo-pf.response.json'), 'utf8'))
const boaMcp = JSON.parse(readFileSync(join(SPEC_DIR, 'boavista-acerta-mais-positivo-pf.mcp.json'), 'utf8'))

const NOW = new Date(Date.UTC(2026, 9, 31, 12, 0, 0))
const CALL = { now: NOW, uid: '9f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', ip: '10.0.0.1', startedAt: NOW }
const SUCCESS_OUTCOMES = ['lowRisk', 'mediumRisk', 'highRisk', 'restrictions', 'deceased', 'irregular', 'warnings']

/** The paths of the phones and the addresses, the two keys outside the spec. */
const PHONE_ADDRESS_PATHS = [
  'telefones[]', 'telefones[].ddd', 'telefones[].numero', 'telefones[].telefoneComDDD',
  'enderecos[]', 'enderecos[].logradouro', 'enderecos[].numero', 'enderecos[].complemento',
  'enderecos[].bairro', 'enderecos[].cidade', 'enderecos[].uf', 'enderecos[].cep',
]

/**
 * The key paths of a value: objects as `a.b`, arrays through their first
 * element as `a[].b`; an empty array yields only `a[]`.
 */
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

/** A path of the spec is inside the answer even when the answer's array is empty. */
function inSpec(path: string, specPaths: string[]): boolean {
  return specPaths.includes(path) || specPaths.some((specPath) => specPath.startsWith(path))
}

/** The paths the spec has that the answer misses, skipping arrays empty in the answer. */
function specMissing(specValue: any, answerValue: any, prefix = ''): string[] {
  const missing: string[] = []
  for (const [key, child] of Object.entries(specValue)) {
    const path = prefix ? `${prefix}.${key}` : key
    const answerChild = (answerValue as any)?.[key]
    if (answerChild === undefined) missing.push(path)
    else if (Array.isArray(child) && Array.isArray(answerChild)) {
      if (child.length > 0 && answerChild.length > 0) missing.push(...specMissing(child[0], answerChild[0], `${path}[]`))
    } else if (child !== null && typeof child === 'object') {
      missing.push(...specMissing(child, answerChild, path))
    }
  }
  return missing
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

describe('boaVistaReturn', () => {
  const specPaths = keysOf(boaSpec.retorno)

  test('the answer adds no key beyond the spec plus the phones and the addresses', () => {
    for (const outcome of SUCCESS_OUTCOMES) {
      const row = DEFAULT_TEST_CPFS.find((item) => item.outcome === outcome)!
      const retorno = boaVistaReturn(row.cpf, profileOf(outcome), NOW)
      const extra = keysOf(retorno).filter((path) => !inSpec(path, specPaths) && !PHONE_ADDRESS_PATHS.includes(path))
      expect(extra).toEqual([])
    }
  })

  test('every spec path is present unless its array is empty in the answer', () => {
    for (const outcome of SUCCESS_OUTCOMES) {
      const row = DEFAULT_TEST_CPFS.find((item) => item.outcome === outcome)!
      const retorno = boaVistaReturn(row.cpf, profileOf(outcome), NOW)
      expect(specMissing(boaSpec.retorno, retorno)).toEqual([])
    }
  })

  test('the restrictions profile fills the debts, the protests and the restrictions', () => {
    const row = DEFAULT_TEST_CPFS.find((item) => item.outcome === 'restrictions')!
    const retorno = boaVistaReturn(row.cpf, profileOf('restrictions'), NOW)
    expect(retorno.pendenciasFinanceiras.ocorrencias).toHaveLength(3)
    expect(retorno.pendenciasFinanceiras.quantidadeOcorrencia).toBe('3')
    expect(retorno.pendenciasFinanceiras.valorTotal).toBe('4.230,50')
    expect(retorno.pendenciasFinanceiras.totalCredores).toBe('2')
    expect(retorno.protestos.ocorrencias).toHaveLength(1)
    expect(retorno.protestos.valorTotal).toBe('800,00')
    expect(retorno.restricoes.ocorrencias).toHaveLength(2)
    expect(retorno.restricoes.ocorrencias[0].titulo).toBe('RESTRICAO FINANCEIRA')
    const clean = boaVistaReturn(DEFAULT_TEST_CPFS[0].cpf, profileOf('lowRisk'), NOW)
    expect(clean.pendenciasFinanceiras.quantidadeOcorrencia).toBe('0')
    expect(clean.pendenciasFinanceiras.valorTotal).toBe('0,00')
    expect(clean.restricoes.ocorrencias).toEqual([])
  })

  test('the top-level key order is the spec order with the phones and the addresses inserted', () => {
    const retorno = boaVistaReturn(DEFAULT_TEST_CPFS[0].cpf, profileOf('lowRisk'), NOW)
    const specKeys = Object.keys(boaSpec.retorno)
    const at = specKeys.indexOf('qtdDependentesBolsaFamilia')
    const expected = [...specKeys.slice(0, at + 1), 'telefones', 'enderecos', ...specKeys.slice(at + 1)]
    expect(Object.keys(retorno)).toEqual(expected)
  })

  test('every MCP field of the return is a top-level key', () => {
    const retorno = boaVistaReturn(DEFAULT_TEST_CPFS[0].cpf, profileOf('lowRisk'), NOW)
    for (const field of boaMcp.camposRetorno) expect(field.nome in retorno).toBe(true)
  })

  test('every leaf is a string', () => {
    for (const outcome of ['lowRisk', 'restrictions'] as const) {
      const row = DEFAULT_TEST_CPFS.find((item) => item.outcome === outcome)!
      const retorno = boaVistaReturn(row.cpf, profileOf(outcome), NOW)
      for (const [, leaf] of leavesOf(retorno)) expect(leaf).toBeTypeOf('string')
    }
  })
})

describe('quodReturn', () => {
  test('the key paths equal the spec, with a null pessoaJuridica as a leaf', () => {
    const specPaths = keysOf(scoreSpec.retorno)
    const collapsed = specPaths.filter((path) => !path.startsWith('pessoaJuridica.'))
    collapsed.splice(specPaths.findIndex((path) => path.startsWith('pessoaJuridica.')), 0, 'pessoaJuridica')

    const retorno = quodReturn('11100000143', profileOf('lowRisk'), NOW)
    expect(keysOf(retorno)).toEqual(collapsed)
    expect(typeof retorno.pessoaFisica.score).toBe('number')
  })
})

describe('envelope', () => {
  test('the keys follow the documented order and the chave carries the CPF', () => {
    const metaDados = envelope({ route: ROUTE_SCORE, uid: CALL.uid, cpf: '11100000143', result: RESULT.success, message: MESSAGES.success, ip: CALL.ip, now: NOW, startedAt: NOW }, null)
    expect(Object.keys(metaDados)).toEqual(Object.keys(scoreSpec.metaDados))
    expect(metaDados.chave).toBe('CPF=11100000143;')
    expect(metaDados.consultaUid).toBe(`direct-${CALL.uid}`)
  })

  test('the data is dd/MM/yyyy HH:mm:ss at UTC−3', () => {
    expect(formatDirectdDate(new Date(Date.UTC(2026, 0, 1, 12, 0, 0)))).toBe('01/01/2026 09:00:00')
  })
})

describe('answerFor', () => {
  test('every default test CPF answers its status', () => {
    for (const row of DEFAULT_TEST_CPFS) {
      const expected = OUTCOMES.find((item) => item.id === row.outcome)!.status
      expect(answerFor(ROUTE_SCORE, { CPF: row.cpf }, CALL).status).toBe(expected)
    }
  })

  test('a formatted CPF answers 200 like its digits', () => {
    const answer = answerFor(ROUTE_SCORE, { CPF: '111.000.001-43' }, CALL)
    expect(answer.status).toBe(200)
    expect(answer.body.metaDados.chave).toBe('CPF=11100000143;')
    expect(answer.body.retorno.documentoConsultado).toBe('111.000.001-43')
    expect(answer.charged).toBe(true)
  })

  test('the warnings CPF answers Sucesso com Ressalvas and is charged', () => {
    const answer = answerFor(ROUTE_SCORE, { CPF: '11101666641' }, CALL)
    expect(answer.status).toBe(200)
    expect(answer.body.metaDados.resultado).toBe('Sucesso com Ressalvas')
    expect(answer.body.metaDados.mensagem).toBe(MESSAGES.warnings)
    expect(answer.charged).toBe(true)
  })

  test('a refusal before the consultation answers a null consultaUid and chave', () => {
    for (const outcome of ['unauthorized', 'badDocument', 'noBalance'] as const) {
      const row = DEFAULT_TEST_CPFS.find((item) => item.outcome === outcome)!
      const answer = answerFor(ROUTE_SCORE, { CPF: row.cpf }, CALL)
      expect(answer.body.metaDados.consultaUid).toBeNull()
      expect(answer.body.metaDados.chave).toBeNull()
    }
  })

  test('the rate limited answer is the flat body with the Retry-After header', () => {
    const answer = answerFor(ROUTE_SCORE, { CPF: '11101111186' }, CALL)
    expect(answer.status).toBe(429)
    expect(answer.body).toEqual(rateLimitBody(30))
    expect(answer.headers['Retry-After']).toBe('30')
  })

  test('a CNPJ alone on the Score route is refused', () => {
    const answer = answerFor(ROUTE_SCORE, { CNPJ: '12345678000195' }, CALL)
    expect(answer.status).toBe(400)
    expect(answer.body.metaDados.mensagem).toBe(MESSAGES.cnpj)
  })

  test('the flags land in the envelope whatever their case', () => {
    const answer = answerFor(ROUTE_SCORE, { CPF: '11100000143', Callback: 'habilitar', GERARCOMPROVANTE: 'Habilitar' }, CALL)
    expect(answer.body.metaDados.enviarCallback).toBe(true)
    expect(answer.body.metaDados.gerarComprovante).toBe(true)
    expect(answer.body.metaDados.urlComprovante).toBeNull()
  })

  test('the Boa Vista route answers its own retorno shape', () => {
    const answer = answerFor(ROUTE_BOA_VISTA, { CPF: '11100000143' }, CALL)
    expect(answer.status).toBe(200)
    expect(answer.body.retorno.scores.ocorrencias[0].score).toBe('850')
  })
})

describe('resolveCpf', () => {
  test('a listed row profile overrides the preset', () => {
    const resolved = resolveCpf('11100000143', { testCpfs: [{ cpf: '11100000143', outcome: 'lowRisk', profile: { score: 999 } }] })
    expect(resolved.outcome).toBe('lowRisk')
    expect(resolved.listed).toBe(true)
    expect(resolved.profile!.score).toBe(999)
    expect(resolved.profile!.classificacaoABC).toBe('A')
  })

  test('an unlisted CPF follows the lowRisk policy', () => {
    const resolved = resolveCpf('52998224725')
    expect(resolved.outcome).toBe('lowRisk')
    expect(resolved.listed).toBe(false)
    expect(resolved.profile).toEqual(profileOf('lowRisk'))
  })

  test('the derived policy is stable per CPF and differs between CPFs', () => {
    const first = resolveCpf('11144477735', { unlisted: 'derived' })
    const second = resolveCpf('11144477735', { unlisted: 'derived' })
    const other = resolveCpf('98765432100', { unlisted: 'derived' })
    expect(first.profile).toEqual(second.profile)
    expect(first.profile).not.toEqual(other.profile)
    expect(first.profile!.score).toBeGreaterThanOrEqual(300)
    expect(first.profile!.score).toBeLessThanOrEqual(950)
  })

  test('the notFound policy answers not found with no profile', () => {
    const resolved = resolveCpf('52998224725', { unlisted: 'notFound' })
    expect(resolved.outcome).toBe('notFound')
    expect(resolved.profile).toBeNull()
  })

  test('invalid digits answer badDocument with no profile', () => {
    const resolved = resolveCpf('11111111112')
    expect(resolved.outcome).toBe('badDocument')
    expect(resolved.profile).toBeNull()
  })
})

describe('the source of the core', () => {
  test('it has no fetch, no Math.random and no provider host', () => {
    const source = readFileSync(join(import.meta.dir, '../src/core/credit.js'), 'utf8')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('Math.random')
    expect(source).not.toContain('directd.com.br')
  })
})
