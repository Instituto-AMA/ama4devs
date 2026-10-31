// @ts-check
/**
 * The Direct Data credit core: the test CPFs and the outcome each of them
 * answers, the profile behind every outcome, the documented `retorno` of both
 * routes and the documented envelope. The server and the browser share this
 * file; everything is deterministic — the caller passes `now`, the derived
 * profile comes from a seeded rng, and nothing here calls any host.
 */

import { createRng } from './rng.js'
import { onlyDigits, isValidCpf, formatCpf } from './documents.js'

/** The public token of the simulation: a GUID in the query string, never a secret. */
export const DIRECTD_TOKEN = '00000000-0000-4000-8000-00000000d1d1'

export const ROUTE_SCORE = 'Score'
export const ROUTE_BOA_VISTA = 'BoaVistaAcertaMaisPositivoPF'
export const ROUTE_ASYNC_READ = 'Historico/ObterRetornoConsultaAsync'

/**
 * The display name of each route, as the provider writes it.
 * @type {Record<string, string>}
 */
export const CONSULTA_NAMES = {
  Score: 'Score de Crédito - QUOD',
  BoaVistaAcertaMaisPositivoPF: 'Boa Vista - Acerta Mais Positivo Pessoa Física',
  'Historico/ObterRetornoConsultaAsync': 'Obter Retorno Consulta Async',
}

/** @typedef {'lowRisk'|'mediumRisk'|'highRisk'|'restrictions'|'deceased'|'irregular'|'warnings'|'badDocument'|'notFound'|'timeout'|'noBalance'|'unauthorized'|'rateLimited'|'unavailable'|'internalError'|'slow'|'neverSettles'} Outcome */
/** @typedef {'lowRisk'|'derived'|'notFound'} UnlistedPolicy */
/** @typedef {{ name: string, score: number, faixaScore: string, capacidadePagamento: string, perfil: string, classificacaoABC: string, probabilidade: string, debts: { count: number, total: string }, creditors: number, protests: { count: number, total: string }, restrictions: number, deceased: boolean, cpfSituacao: string, rendaFaixa: string }} CreditProfile */
/** @typedef {{ cpf: string, outcome: Outcome, profile?: Partial<CreditProfile> }} TestCpf */
/** @typedef {{ id: Outcome, kind: 'success'|'failure'|'behavior', status: number, summary: { en: string, pt: string } }} OutcomeInfo */
/** @typedef {{ status: number, result: { id: number, text: string }, message: string, beforeConsultation: boolean, retryAfterSeconds?: number }} Failure */
/** @typedef {{ status: number, error: string, message: string, retryAfterSeconds: number }} RateLimitBody */
/** @typedef {{ status: number, body: Record<string, any>, headers: Record<string, string>, outcome: Outcome, charged: boolean }} CreditAnswer */

/**
 * Every outcome the simulation knows, in the order of the test CPF table.
 * RESULT: only `1 Sucesso` and `3 Não Autorizado` are documented/observed; the
 * rest are the simulator's own choice, stable, never claimed as the provider's.
 * @type {OutcomeInfo[]}
 */
export const OUTCOMES = [
  { id: 'lowRisk', kind: 'success', status: 200, summary: { en: '200, score 850, 3,5% default probability', pt: '200, score 850, 3,5% de probabilidade de inadimplência' } },
  { id: 'mediumRisk', kind: 'success', status: 200, summary: { en: '200, score 650, 18% default probability', pt: '200, score 650, 18% de probabilidade de inadimplência' } },
  { id: 'highRisk', kind: 'success', status: 200, summary: { en: '200, score 420, 41% default probability', pt: '200, score 420, 41% de probabilidade de inadimplência' } },
  { id: 'restrictions', kind: 'success', status: 200, summary: { en: '200, score 380, debts, protests and restrictions', pt: '200, score 380, dívidas, protestos e restrições' } },
  { id: 'deceased', kind: 'success', status: 200, summary: { en: '200, score 0, deceased person', pt: '200, score 0, pessoa falecida' } },
  { id: 'irregular', kind: 'success', status: 200, summary: { en: '200, score 500, suspended CPF', pt: '200, score 500, CPF suspenso' } },
  { id: 'warnings', kind: 'success', status: 200, summary: { en: '200 with warnings, score 700', pt: '200 com ressalvas, score 700' } },
  { id: 'badDocument', kind: 'failure', status: 400, summary: { en: '400, invalid CPF digits', pt: '400, CPF com dígitos inválidos' } },
  { id: 'notFound', kind: 'failure', status: 404, summary: { en: '404, no record for the document', pt: '404, nenhum registro para o documento' } },
  { id: 'timeout', kind: 'failure', status: 408, summary: { en: '408, the provider did not answer in time', pt: '408, o fornecedor não respondeu a tempo' } },
  { id: 'noBalance', kind: 'failure', status: 403, summary: { en: '403, insufficient balance', pt: '403, saldo insuficiente' } },
  { id: 'unauthorized', kind: 'failure', status: 401, summary: { en: '401, invalid IP or token', pt: '401, IP ou Token inválido' } },
  { id: 'rateLimited', kind: 'failure', status: 429, summary: { en: '429, more than 30 requests per second', pt: '429, mais de 30 requisições por segundo' } },
  { id: 'unavailable', kind: 'failure', status: 503, summary: { en: '503, consultation under maintenance', pt: '503, consulta em manutenção' } },
  { id: 'internalError', kind: 'failure', status: 500, summary: { en: '500, internal error', pt: '500, erro interno' } },
  { id: 'slow', kind: 'behavior', status: 200, summary: { en: '200, after a 25 s wait', pt: '200, após 25 s de espera' } },
  { id: 'neverSettles', kind: 'behavior', status: 200, summary: { en: '200, the async read stays 202', pt: '200, a leitura async fica em 202' } },
]

/**
 * The CPFs the simulation answers by heart, one per outcome, kept in the same
 * order as `OUTCOMES`. A row's `profile` overrides the preset of its outcome.
 * @type {TestCpf[]}
 */
export const DEFAULT_TEST_CPFS = [
  { cpf: '11100000143', outcome: 'lowRisk' },
  { cpf: '11100111212', outcome: 'mediumRisk' },
  { cpf: '11100222391', outcome: 'highRisk' },
  { cpf: '11100333460', outcome: 'restrictions', profile: { debts: { count: 3, total: '4.230,50' }, creditors: 2, protests: { count: 1, total: '800,00' }, restrictions: 2 } },
  { cpf: '11100444530', outcome: 'deceased' },
  { cpf: '11100555609', outcome: 'irregular' },
  { cpf: '11101666641', outcome: 'warnings' },
  { cpf: '11111111112', outcome: 'badDocument' },
  { cpf: '11100666788', outcome: 'notFound' },
  { cpf: '11100777857', outcome: 'timeout' },
  { cpf: '11100888926', outcome: 'noBalance' },
  { cpf: '11101000007', outcome: 'unauthorized' },
  { cpf: '11101111186', outcome: 'rateLimited' },
  { cpf: '11101222255', outcome: 'unavailable' },
  { cpf: '11101333324', outcome: 'internalError' },
  { cpf: '11101444401', outcome: 'slow' },
  { cpf: '11101555572', outcome: 'neverSettles' },
]

/** How an unlisted CPF answers: the low risk preset, a profile derived from the CPF, or not found. */
export const UNLISTED_POLICIES = ['lowRisk', 'derived', 'notFound']

/** The `resultadoId`/`resultado` pairs of the envelope; the provider documents 1 and 3. */
export const RESULT = {
  success: { id: 1, text: 'Sucesso' },
  notFound: { id: 2, text: 'Não Encontrado' },
  unauthorized: { id: 3, text: 'Não Autorizado' },
  noBalance: { id: 4, text: 'Saldo insuficiente' },
  badRequest: { id: 5, text: 'Requisição Inválida' },
  timeout: { id: 6, text: 'Tempo Esgotado' },
  rateLimited: { id: 7, text: 'Limite Excedido' },
  unavailable: { id: 8, text: 'Serviço Indisponível' },
  internal: { id: 9, text: 'Erro Interno' },
  processing: { id: 10, text: 'Processando' },
  successWithWarnings: { id: 11, text: 'Sucesso com Ressalvas' },
}

/** The envelope messages, in the provider's Portuguese wire format. */
export const MESSAGES = {
  success: 'Sucesso',
  warnings: 'Consulta realizada com ressalvas.',
  asyncCreated: 'Requisição async criada com sucesso. Utilize o ConsultaUid para consultar o resultado.',
  processing: 'Consulta em processamento.',
  cnpj: 'O simulador atende apenas consultas por CPF.',
  missingCpf: 'Informe o CPF.',
}

/**
 * How each failing outcome answers. `beforeConsultation` → `consultaUid` and
 * `chave` are null, because the call was refused before a consultation existed.
 * @type {Record<'badDocument'|'notFound'|'timeout'|'noBalance'|'unauthorized'|'rateLimited'|'unavailable'|'internalError', Failure>}
 */
export const FAILURES = {
  badDocument: { status: 400, result: RESULT.badRequest, message: 'CPF inválido.', beforeConsultation: true },
  notFound: { status: 404, result: RESULT.notFound, message: 'Nenhum registro encontrado para o documento.', beforeConsultation: false },
  timeout: { status: 408, result: RESULT.timeout, message: 'Tempo de resposta do fornecedor esgotado.', beforeConsultation: false },
  noBalance: { status: 403, result: RESULT.noBalance, message: 'Saldo insuficiente para realizar a consulta.', beforeConsultation: true },
  unauthorized: { status: 401, result: RESULT.unauthorized, message: 'IP ou Token inválido. Verifique.', beforeConsultation: true },
  rateLimited: { status: 429, result: RESULT.rateLimited, message: '', beforeConsultation: true, retryAfterSeconds: 30 },
  unavailable: { status: 503, result: RESULT.unavailable, message: 'Serviço temporariamente indisponível.', beforeConsultation: false },
  internalError: { status: 500, result: RESULT.internal, message: 'Erro interno no servidor.', beforeConsultation: false },
}

/** A consultation the provider charges: only these two `resultado` texts. */
export const CHARGED_RESULTS = ['Sucesso', 'Sucesso com Ressalvas']

/** How long the slow CPF makes the caller wait before the 200 arrives. */
export const SLOW_DELAY_MS = 25000

/** The default income range of every profile. */
const RENDA_FAIXA = 'R$ 3.001 a R$ 5.000'

/**
 * The preset profile of each success outcome; the clean blocks are zeroed.
 * @type {Record<string, CreditProfile>}
 */
const PRESETS = {
  lowRisk: {
    name: 'JOAO BAIXO RISCO SANTOS', score: 850, faixaScore: '801 a 900', capacidadePagamento: 'R$ 2.500,00',
    perfil: 'Bom pagador', classificacaoABC: 'A', probabilidade: '3,5%',
    debts: { count: 0, total: '0,00' }, creditors: 0, protests: { count: 0, total: '0,00' }, restrictions: 0,
    deceased: false, cpfSituacao: 'REGULAR', rendaFaixa: RENDA_FAIXA,
  },
  mediumRisk: {
    name: 'MARIA MEDIA DA SILVA', score: 650, faixaScore: '601 a 700', capacidadePagamento: 'R$ 1.500,00',
    perfil: 'Pagador regular', classificacaoABC: 'C', probabilidade: '18%',
    debts: { count: 0, total: '0,00' }, creditors: 0, protests: { count: 0, total: '0,00' }, restrictions: 0,
    deceased: false, cpfSituacao: 'REGULAR', rendaFaixa: RENDA_FAIXA,
  },
  highRisk: {
    name: 'JOSE ALTO RISCO SOUZA', score: 420, faixaScore: '401 a 500', capacidadePagamento: 'R$ 600,00',
    perfil: 'Mau pagador', classificacaoABC: 'E', probabilidade: '41%',
    debts: { count: 0, total: '0,00' }, creditors: 0, protests: { count: 0, total: '0,00' }, restrictions: 0,
    deceased: false, cpfSituacao: 'REGULAR', rendaFaixa: RENDA_FAIXA,
  },
  restrictions: {
    name: 'CARLOS RESTRICOES LIMA', score: 380, faixaScore: '301 a 400', capacidadePagamento: 'R$ 400,00',
    perfil: 'Mau pagador', classificacaoABC: 'E', probabilidade: '52%',
    debts: { count: 3, total: '4.230,50' }, creditors: 2, protests: { count: 1, total: '800,00' }, restrictions: 2,
    deceased: false, cpfSituacao: 'REGULAR', rendaFaixa: RENDA_FAIXA,
  },
  deceased: {
    name: 'ANA FALECIDA PEREIRA', score: 0, faixaScore: '0 a 100', capacidadePagamento: 'R$ 0,00',
    perfil: 'Sem perfil', classificacaoABC: 'E', probabilidade: '0%',
    debts: { count: 0, total: '0,00' }, creditors: 0, protests: { count: 0, total: '0,00' }, restrictions: 0,
    deceased: true, cpfSituacao: 'REGULAR', rendaFaixa: RENDA_FAIXA,
  },
  irregular: {
    name: 'PAULO IRREGULAR COSTA', score: 500, faixaScore: '401 a 500', capacidadePagamento: 'R$ 1.000,00',
    perfil: 'Pagador regular', classificacaoABC: 'D', probabilidade: '30%',
    debts: { count: 0, total: '0,00' }, creditors: 0, protests: { count: 0, total: '0,00' }, restrictions: 0,
    deceased: false, cpfSituacao: 'SUSPENSA', rendaFaixa: RENDA_FAIXA,
  },
  warnings: {
    name: 'LUCIA RESSALVAS ROCHA', score: 700, faixaScore: '601 a 700', capacidadePagamento: 'R$ 1.800,00',
    perfil: 'Pagador regular', classificacaoABC: 'B', probabilidade: '12%',
    debts: { count: 0, total: '0,00' }, creditors: 0, protests: { count: 0, total: '0,00' }, restrictions: 0,
    deceased: false, cpfSituacao: 'REGULAR', rendaFaixa: RENDA_FAIXA,
  },
}

/** The default probability the derived profile draws from, per ABC class. */
const PROBABILITY_BY_ABC = {
  A: ['2,1%', '3,5%', '4,8%'],
  B: ['10%', '12%', '14%', '16%'],
  C: ['18%', '20%', '22%', '25%'],
  D: ['28%', '30%', '33%', '36%'],
  E: ['41%', '45%', '52%', '58%', '63%'],
}

/** The payment capacity range of the derived profile, in cents, per ABC class. */
/** @type {Record<string, [number, number]>} */
const CAPACITY_CENTS_BY_ABC = {
  A: [200000, 300000],
  B: [120000, 180000],
  C: [80000, 120000],
  D: [50000, 100000],
  E: [20000, 60000],
}

/**
 * The fake person the Boa Vista retorno carries: one phone and one address,
 * repeated in every documented shape.
 */
const PHONE = { ddd: '11', numero: '999990000' }
const ADDRESS = { logradouro: 'RUA EXEMPLO', numero: '100', complemento: '', bairro: 'CENTRO', cidade: 'SAO PAULO', uf: 'SP', cep: '01001000' }

/** A debt occurrence pair the filled blocks repeat; dates stay dd/MM/yyyy. */
const DEBT_DATES = { inclusion: '10/01/2025', due: '15/03/2026' }
const PROTEST_DATE = '10/02/2025'
const CREDITORS = ['BANCO EXEMPLO S.A.', 'TELECOM EXEMPLO LTDA.']

/**
 * A copy of a preset, deep enough that a caller cannot mutate the table.
 * @param {CreditProfile} profile
 * @returns {CreditProfile}
 */
function presetCopy(profile) {
  return { ...profile, debts: { ...profile.debts }, protests: { ...profile.protests } }
}

/**
 * The preset behind an outcome: a full profile for every success outcome; any
 * other outcome answers the low risk preset.
 * @param {Outcome} outcome
 * @returns {CreditProfile}
 */
export function profileOf(outcome) {
  return presetCopy(PRESETS[outcome] ?? /** @type {CreditProfile} */ (PRESETS.lowRisk))
}

/**
 * Cents rendered the way the provider writes money: `4.230,50`.
 * @param {number} cents
 * @returns {string}
 */
function formatMoney(cents) {
  const value = Math.round(cents)
  const whole = String(Math.trunc(value / 100))
  const frac = String(Math.abs(value % 100)).padStart(2, '0')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac}`
}

/**
 * A money string read back as cents: `'4.230,50'` → `423050`.
 * @param {string} text
 * @returns {number}
 */
function moneyCents(text) {
  return Math.round(Number(String(text).replace(/\./g, '').replace(',', '.')) * 100)
}

/**
 * A total split across `count` occurrences; the first one keeps the remainder.
 * @param {number} cents
 * @param {number} count
 * @returns {number[]}
 */
function splitCents(cents, count) {
  if (count <= 0) return []
  const base = Math.floor(cents / count)
  return Array.from({ length: count }, (_, i) => (i === 0 ? cents - base * (count - 1) : base))
}

/**
 * `count` occurrences, each built by `make`.
 * @template T
 * @param {number} count
 * @param {(index: number) => T} make
 * @returns {T[]}
 */
function occurrenceList(count, make) {
  const out = []
  for (let i = 0; i < count; i++) out.push(make(i))
  return out
}

/**
 * The score band text of a score: `850` → `'801 a 900'`, `0` → `'0 a 100'`.
 * @param {number} score
 * @returns {string}
 */
function faixaFor(score) {
  if (score <= 0) return '0 a 100'
  const start = Math.min(901, Math.floor((score - 1) / 100) * 100 + 1)
  return `${start} a ${start + 99}`
}

/**
 * The ABC class and the payer profile a score carries.
 * @param {number} score
 * @returns {{ abc: string, perfil: string }}
 */
function classificationFor(score) {
  if (score >= 800) return { abc: 'A', perfil: 'Bom pagador' }
  if (score >= 700) return { abc: 'B', perfil: 'Pagador regular' }
  if (score >= 600) return { abc: 'C', perfil: 'Pagador regular' }
  if (score >= 500) return { abc: 'D', perfil: 'Pagador regular' }
  return { abc: 'E', perfil: 'Mau pagador' }
}

/**
 * A stable profile for an unlisted CPF: the score comes from the seeded rng of
 * `'directd:' + cpf`, the classes follow the score, and restrictions appear
 * only when the score is below 400. The same CPF always draws the same person.
 * @param {string} cpf
 * @returns {CreditProfile}
 */
export function derivedProfile(cpf) {
  const rng = createRng(`directd:${cpf}`)
  const score = rng.int(300, 950)
  const band = classificationFor(score)
  const [minCapacity, maxCapacity] = CAPACITY_CENTS_BY_ABC[band.abc] ?? [0, 0]
  const restrictive = score < 400
  const debtCount = restrictive ? rng.int(1, 3) : 0
  const debtCents = restrictive ? rng.int(50000, 500000) : 0
  const protestCount = restrictive ? rng.int(0, 2) : 0
  const protestCents = restrictive ? rng.int(20000, 150000) : 0
  return {
    name: 'PESSOA SIMULADA DA BASE',
    score,
    faixaScore: faixaFor(score),
    capacidadePagamento: `R$ ${formatMoney(rng.int(minCapacity, maxCapacity))}`,
    perfil: band.perfil,
    classificacaoABC: band.abc,
    probabilidade: rng.pick(PROBABILITY_BY_ABC[/** @type {keyof typeof PROBABILITY_BY_ABC} */ (band.abc)]),
    debts: { count: debtCount, total: debtCount > 0 ? formatMoney(debtCents) : '0,00' },
    creditors: debtCount > 0 ? rng.int(1, debtCount) : 0,
    protests: { count: protestCount, total: protestCount > 0 ? formatMoney(protestCents) : '0,00' },
    restrictions: restrictive ? rng.int(1, 3) : 0,
    deceased: false,
    cpfSituacao: 'REGULAR',
    rendaFaixa: RENDA_FAIXA,
  }
}

/**
 * Every digit of a value, whatever mask it carries.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeCpf(raw) {
  return onlyDigits(raw)
}

/**
 * The Direct Data clock: `dd/MM/yyyy HH:mm:ss`, read over an epoch shifted
 * three hours back, so the wall time is São Paulo's whatever the host zone is.
 * @param {Date} date
 * @returns {string}
 */
export function formatDirectdDate(date) {
  const shifted = new Date(date.getTime() - 3 * 3600000)
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}/${shifted.getUTCFullYear()} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
}

/**
 * What a CPF answers: its digits, its outcome, the profile it carries and
 * whether it is one of the listed test CPFs. Invalid digits answer
 * `badDocument` with no profile; a listed row merges its preset with the
 * row's overrides; an unlisted CPF follows the policy.
 * @param {unknown} raw
 * @param {{ testCpfs?: TestCpf[], unlisted?: UnlistedPolicy }} [options]
 * @returns {{ cpf: string, outcome: Outcome, profile: CreditProfile | null, listed: boolean }}
 */
export function resolveCpf(raw, { testCpfs = DEFAULT_TEST_CPFS, unlisted = 'lowRisk' } = {}) {
  const cpf = normalizeCpf(raw)
  if (!isValidCpf(cpf)) return { cpf, outcome: 'badDocument', profile: null, listed: false }

  const row = testCpfs.find((item) => normalizeCpf(item.cpf) === cpf)
  if (row) {
    const profile = { ...profileOf(row.outcome), ...row.profile }
    return { cpf, outcome: row.outcome, profile, listed: true }
  }
  if (unlisted === 'notFound') return { cpf, outcome: 'notFound', profile: null, listed: false }
  if (unlisted === 'derived') return { cpf, outcome: 'lowRisk', profile: derivedProfile(cpf), listed: false }
  return { cpf, outcome: 'lowRisk', profile: profileOf('lowRisk'), listed: false }
}

/**
 * The `retorno` of the Score route, in the key order of the documented example.
 * @param {string} cpf
 * @param {CreditProfile} profile
 * @param {Date} now
 */
export function quodReturn(cpf, profile, now) {
  return {
    dataConsulta: formatDirectdDate(now),
    documentoConsultado: formatCpf(cpf),
    pessoaFisica: {
      score: profile.score,
      faixaScore: profile.faixaScore,
      capacidadePagamento: profile.capacidadePagamento,
      perfil: profile.perfil,
    },
    pessoaJuridica: null,
    observacao: null,
  }
}

/** The `restricoes` block: one occurrence per restriction, empty when clean. */
/** @param {CreditProfile} profile */
function restricoesBlock(profile) {
  return {
    quantidadeOcorrencias: String(profile.restrictions),
    ocorrencias: occurrenceList(profile.restrictions, () => ({
      codigoInformacao: '199',
      descricaoInformacao: 'RESTRICAO FINANCEIRA',
      titulo: 'RESTRICAO FINANCEIRA',
      observacoes: '',
    })),
  }
}

/** The `pendenciasFinanceiras` block: the total split across the occurrences. */
/** @param {CreditProfile} profile */
function pendenciasBlock(profile) {
  const count = profile.debts.count
  const parts = splitCents(moneyCents(profile.debts.total), count)
  const informante = (/** @type {number} */ i) => CREDITORS[i % CREDITORS.length] ?? ''
  return {
    quantidadeOcorrencia: String(count),
    valorTotal: profile.debts.total,
    ultimoVencimento: count > 0 ? DEBT_DATES.due : '',
    dataPrimeiro: count > 0 ? DEBT_DATES.inclusion : '',
    totalCredores: String(profile.creditors),
    valorMaior: count > 0 ? formatMoney(Math.max(...parts)) : '',
    valorPrimeiro: count > 0 ? formatMoney(parts[0] ?? 0) : '',
    periodoInicial: count > 0 ? DEBT_DATES.inclusion : '',
    periodoFinal: count > 0 ? DEBT_DATES.due : '',
    dataMaior: count > 0 ? DEBT_DATES.due : '',
    provedores: [],
    ocorrencias: occurrenceList(count, (i) => ({
      dataVencimento: DEBT_DATES.due,
      dataInclusao: DEBT_DATES.inclusion,
      informante: informante(i),
      tipoDevedor: 'F',
      credor: informante(i),
      moeda: 'R$',
      valor: formatMoney(parts[i] ?? 0),
      contrato: '',
      origem: '',
      subjudice: 'NAO',
      modalidade: '',
      entidade: '',
    })),
  }
}

/** The `protestos` block, shaped like the debts one. */
/** @param {CreditProfile} profile */
function protestosBlock(profile) {
  const count = profile.protests.count
  const parts = splitCents(moneyCents(profile.protests.total), count)
  return {
    quantidadeOcorrencia: String(count),
    valorTotal: profile.protests.total,
    ultimoProtesto: count > 0 ? PROTEST_DATE : '',
    dataPrimeiro: count > 0 ? PROTEST_DATE : '',
    valorPrimeiro: count > 0 ? formatMoney(parts[0] ?? 0) : '',
    dataUltimo: count > 0 ? PROTEST_DATE : '',
    valorUltimo: count > 0 ? formatMoney(parts[parts.length - 1] ?? 0) : '',
    dataMaior: count > 0 ? PROTEST_DATE : '',
    valorMaior: count > 0 ? formatMoney(Math.max(...parts)) : '',
    ocorrencias: occurrenceList(count, (i) => ({
      data: PROTEST_DATE,
      moeda: 'R$',
      valor: formatMoney(parts[i] ?? 0),
      valorCustas: '',
      quantidade: '1',
      cartorio: 'CARTORIO EXEMPLO',
      origem: '',
      credor: CREDITORS[i % CREDITORS.length],
      anuencia: 'NAO',
      tipoAnotacao: 'PROTESTO',
      subjudice: 'NAO',
      vencimento: '',
    })),
  }
}

/** The single `scores` occurrence, filling every documented key of the example. */
/** @param {CreditProfile} profile */
function scoresBlock(profile) {
  return {
    quantidadeOcorrencias: '1',
    ocorrencias: [{
      layout: '',
      tipoScore: '',
      score: String(profile.score),
      execucao: '',
      descricaoPlano: '',
      descricaoScore: '',
      classificacaoNro: '',
      classificacaoABC: profile.classificacaoABC,
      probabilidadeInadimplencia: profile.probabilidade,
      texto: '',
      risco: '',
      modeloScore: '',
      informante: '',
    }],
  }
}

/**
 * The `retorno` of the Boa Vista route: every key of the documented example in
 * that order, every leaf a string, the phones and the addresses after
 * `qtdDependentesBolsaFamilia` in both documented shapes.
 * @param {string} cpf
 * @param {CreditProfile} profile
 * @param {Date} now
 */
export function boaVistaReturn(cpf, profile, now) {
  const phoneFull = PHONE.ddd + PHONE.numero
  return {
    cpf: formatCpf(cpf),
    cpfSituacao: profile.cpfSituacao,
    cpfOrigem: '',
    cpfDataAtualizacaoReceita: '',
    rg: '',
    rguf: '',
    rgDataEmissao: '',
    nome: profile.name,
    nomeSocial: '',
    nomePai: '',
    mae: '',
    nascimento: '',
    sexo: '',
    nacionalidade: '',
    naturalidade: '',
    grauInstrucao: '',
    estadoCivil: '',
    numeroDependentes: '',
    indicacaoObito: profile.deceased ? 'SIM' : 'NAO',
    tituloEleitor: '',
    numeroPIS: '',
    cartaoNacionalSaude: '',
    email: '',
    telefone: phoneFull,
    faixaRenda: profile.rendaFaixa,
    classeSocial: '',
    poderAquisitivo: '',
    ultimoImpostoRenda: '',
    qtdDependentesBolsaFamilia: '',
    telefones: [{ ddd: PHONE.ddd, numero: PHONE.numero, telefoneComDDD: phoneFull }],
    enderecos: [{ ...ADDRESS }],
    rua: `${ADDRESS.logradouro} ${ADDRESS.numero}`,
    bairro: ADDRESS.bairro,
    cidade: ADDRESS.cidade,
    uf: ADDRESS.uf,
    cep: ADDRESS.cep,
    restricoes: restricoesBlock(profile),
    participacaoEmEmpresas: { quantidadeOcorrencias: '0', ocorrencias: [] },
    pendenciasFinanceiras: pendenciasBlock(profile),
    protestos: protestosBlock(profile),
    chequeSemFundoVarejo: { quantidadeOcorrencia: '0', correntista: '', tipoPessoa: '', documento: '' },
    chequeSemFundoBacen: { quantidadeOcorrencia: '0', correntista: '', tipoPessoa: '', documento: '' },
    falenciasAcoesRecuperacoes: { quantidadeOcorrencia: '0', valorTotal: '0,00', ultimoRegistro: '', ocorrencias: [] },
    scores: scoresBlock(profile),
    somenteTelefone: {
      registroLocalizado: '1',
      dados: [{
        codigoIdentificacaoTelefone: '',
        tipoPessoa: '',
        documento: '',
        ddd: PHONE.ddd,
        numeroTelefone: PHONE.numero,
        tipoTelefone: '',
        pontuacao: '',
      }],
    },
    somenteEndereco: {
      registroLocalizado: '1',
      dados: [{
        codigoIdentificacaoEndereco: '',
        tipoPessoa: '',
        documento: '',
        endereco: ADDRESS.logradouro,
        numero: ADDRESS.numero,
        complemento: ADDRESS.complemento,
        bairro: ADDRESS.bairro,
        cidade: ADDRESS.cidade,
        uf: ADDRESS.uf,
        cep: ADDRESS.cep,
        pontuacao: '',
        latitude: '',
        longitude: '',
      }],
    },
    passagensComerciais: { quantidadeOcorrencias: '0', ocorrencias: [] },
    acoesCiveis: {
      quantidadeOcorrencia: '0',
      valorTotal: '0,00',
      valorPrimeiro: '',
      valorUltimo: '',
      dataPrimeiro: '',
      dataUltimo: '',
      valorMaior: '',
      valorMenor: '',
      dataMaior: '',
      dataMenor: '',
      ocorrencias: [],
    },
    decisao: { codigoSituacao: '', descricao: '', observacoes: '', layout: '' },
    rendaPresumida: {
      descricao: '',
      faixa: profile.rendaFaixa,
      rendaAnual: '',
      mensagem: '',
      dataReferencia: '',
      valorPresumido: '',
      dadosCadastroPositivo: '',
    },
    controlePositivo: {
      ocorrenciasFaturasEmAtraso: [],
      ocorrenciasNotaComportamentosContratosRecentes: [],
    },
  }
}

/**
 * The `retorno` a route carries for a profile; the async read keeps the shape
 * of the consultation it returns, the Score one by default.
 * @param {string} route
 * @param {string} cpf
 * @param {CreditProfile} profile
 * @param {Date} now
 */
export function returnFor(route, cpf, profile, now) {
  if (route === ROUTE_BOA_VISTA) return boaVistaReturn(cpf, profile, now)
  return quodReturn(cpf, profile, now)
}

/**
 * The documented envelope, keys in documented order. A null `uid` or `cpf`
 * gives a null `consultaUid` or `chave`; the execution time never goes below
 * zero.
 * @param {{ route: string, uid?: string | null, cpf?: string | null, result: { id: number, text: string }, message: string, ip?: string, async?: boolean, callback?: boolean, receipt?: boolean, now?: Date, startedAt?: Date }} options
 * @param {unknown} retorno
 * @returns {{ metaDados: Record<string, unknown>, retorno: unknown }}
 */
export function envelope({ route, uid, cpf, result, message, ip = '', async = false, callback = false, receipt = false, now = new Date(), startedAt = now }, retorno) {
  const metaDados = {
    consultaNome: CONSULTA_NAMES[route] ?? route,
    consultaUid: uid ?? null,
    chave: cpf ? `CPF=${cpf};` : null,
    usuario: 'usuario@ama4devs.local',
    mensagem: message,
    ip,
    resultadoId: result.id,
    resultado: result.text,
    apiVersao: 'v3',
    enviarCallback: Boolean(callback),
    gerarComprovante: Boolean(receipt),
    urlComprovante: null,
    assincrono: Boolean(async),
    data: formatDirectdDate(now),
    tempoExecucaoMs: Math.max(0, now.getTime() - startedAt.getTime()),
  }
  return { metaDados, retorno: retorno ?? null }
}

/**
 * The body of a rate limited answer, which is not an envelope.
 * @param {number} seconds
 */
export function rateLimitBody(seconds) {
  return {
    status: 429,
    error: 'Too Many Requests',
    message: `Você realizou muitas requisições. Aguarde ${seconds} segundos e tente novamente.`,
    retryAfterSeconds: seconds,
  }
}

/**
 * True when a query flag asks for the feature; the value compares case-insensitively.
 * @param {unknown} value
 */
function isHabilitar(value) {
  return String(value ?? '').trim().toLowerCase() === 'habilitar'
}

/**
 * The synchronous answer of a route for a CPF, as the provider gives it. A
 * CNPJ on the Score route and an empty CPF are refused with 400 before any
 * consultation; a failing outcome answers through `FAILURES`; a success
 * outcome answers 200 with the `retorno` of the route (`slow` and
 * `neverSettles` answer like the low risk one here — the server adds the wait
 * and the async states). The token is not checked here.
 * @param {string} route
 * @param {{ CPF?: unknown, CNPJ?: unknown, Async?: unknown, Callback?: unknown, GERARCOMPROVANTE?: unknown }} params
 * @param {{ testCpfs?: TestCpf[], unlisted?: UnlistedPolicy, now?: Date, uid?: string, ip?: string, startedAt?: Date }} [options]
 * @returns {CreditAnswer}
 */
export function answerFor(route, params = {}, { testCpfs = DEFAULT_TEST_CPFS, unlisted = 'lowRisk', now = new Date(), uid, ip = '', startedAt = now } = {}) {
  const cpf = normalizeCpf(params.CPF)
  const asyncFlag = isHabilitar(params.Async)
  const callbackFlag = isHabilitar(params.Callback)
  const receiptFlag = isHabilitar(params.GERARCOMPROVANTE)
  const consultaUid = uid ? `direct-${uid}` : null

  if (route === ROUTE_SCORE && normalizeCpf(params.CNPJ) !== '' && cpf === '') {
    return {
      status: 400,
      body: envelope({ route, uid: null, cpf: null, result: RESULT.badRequest, message: MESSAGES.cnpj, ip, now, startedAt }, null),
      headers: {},
      outcome: 'badDocument',
      charged: false,
    }
  }
  if (cpf === '') {
    return {
      status: 400,
      body: envelope({ route, uid: null, cpf: null, result: RESULT.badRequest, message: MESSAGES.missingCpf, ip, now, startedAt }, null),
      headers: {},
      outcome: 'badDocument',
      charged: false,
    }
  }

  const { outcome, profile } = resolveCpf(cpf, { testCpfs, unlisted })
  const failure = /** @type {Partial<Record<Outcome, Failure>>} */ (FAILURES)[outcome]

  if (failure && outcome === 'rateLimited') {
    return {
      status: failure.status,
      body: rateLimitBody(failure.retryAfterSeconds ?? 30),
      headers: { 'Retry-After': String(failure.retryAfterSeconds ?? 30) },
      outcome,
      charged: false,
    }
  }
  if (failure) {
    const before = failure.beforeConsultation
    return {
      status: failure.status,
      body: envelope({ route, uid: before ? null : consultaUid, cpf: before ? null : cpf, result: failure.result, message: failure.message, ip, async: asyncFlag, callback: callbackFlag, receipt: receiptFlag, now, startedAt }, null),
      headers: {},
      outcome,
      charged: false,
    }
  }

  const withWarnings = outcome === 'warnings'
  const retorno = returnFor(route, cpf, /** @type {CreditProfile} */ (profile), now)
  const body = envelope(
    { route, uid: consultaUid, cpf, result: withWarnings ? RESULT.successWithWarnings : RESULT.success, message: withWarnings ? MESSAGES.warnings : MESSAGES.success, ip, async: asyncFlag, callback: callbackFlag, receipt: receiptFlag, now, startedAt },
    retorno,
  )
  return {
    status: 200,
    body,
    headers: {},
    outcome,
    charged: CHARGED_RESULTS.includes(String(body.metaDados.resultado)),
  }
}
