/** The one token the mock accepts. It is public and opens nothing: the mock holds no real credential. */
export const MOCK_TOKEN = '00000000-0000-4000-8000-00000000d1d1'

export const ROUTE_QUOD = 'Score'
export const ROUTE_BOA_VISTA = 'BoaVistaAcertaMaisPositivoPF'

/** The result the provider reports in `metaDados`. */
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
} as const

export type ResultInfo = (typeof RESULT)[keyof typeof RESULT]

/** What a CPF makes the mock do. */
export type Scenario =
  | 'lowRisk'
  | 'mediumRisk'
  | 'highRisk'
  | 'restrictions'
  | 'deceased'
  | 'irregular'
  | 'badDocument'
  | 'notFound'
  | 'timeout'
  | 'noBalance'
  | 'unauthorized'
  | 'rateLimited'
  | 'unavailable'
  | 'internalError'
  | 'slow'
  | 'neverSettles'
  | 'warnings'

/** The CPFs of the scenarios, all with valid check digits. */
export const SCENARIO_CPFS: Record<Scenario, string> = {
  lowRisk: '11100000143',
  mediumRisk: '11100111212',
  highRisk: '11100222391',
  restrictions: '11100333460',
  deceased: '11100444530',
  irregular: '11100555609',
  badDocument: '11111111112',
  notFound: '11100666788',
  timeout: '11100777857',
  noBalance: '11100888926',
  unauthorized: '11101000007',
  rateLimited: '11101111186',
  unavailable: '11101222255',
  internalError: '11101333324',
  slow: '11101444401',
  neverSettles: '11101555572',
  warnings: '11101666641',
}

const BY_CPF = new Map<string, Scenario>(
  (Object.keys(SCENARIO_CPFS) as Scenario[]).map((scenario) => [SCENARIO_CPFS[scenario], scenario]),
)

/** Whether the 11 digits carry valid check digits (and are not a repeated digit). */
export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false
  const digits = [...cpf].map(Number)
  for (const length of [9, 10]) {
    const sum = digits.slice(0, length).reduce((acc, digit, i) => acc + digit * (length + 1 - i), 0)
    if (((sum * 10) % 11) % 10 !== digits[length]) return false
  }
  return true
}

/** The scenario a CPF selects: invalid digits are a bad document, an unknown valid CPF is low risk. */
export function scenarioFor(cpf: string): Scenario {
  if (!isValidCpf(cpf)) return 'badDocument'
  return BY_CPF.get(cpf) ?? 'lowRisk'
}

/** How a failing scenario answers. */
export interface Failure {
  status: number
  result: ResultInfo
  message: string
  retryAfterSeconds?: number
}

export const FAILURES: Partial<Record<Scenario, Failure>> = {
  badDocument: { status: 400, result: RESULT.badRequest, message: 'CPF inválido.' },
  notFound: { status: 404, result: RESULT.notFound, message: 'Nenhum registro encontrado para o documento.' },
  timeout: { status: 408, result: RESULT.timeout, message: 'Tempo de resposta do fornecedor esgotado.' },
  noBalance: { status: 403, result: RESULT.noBalance, message: 'Saldo insuficiente para realizar a consulta.' },
  unauthorized: { status: 401, result: RESULT.unauthorized, message: 'IP ou Token inválido. Verifique.' },
  rateLimited: { status: 429, result: RESULT.rateLimited, message: 'Limite de requisições excedido.', retryAfterSeconds: 30 },
  unavailable: { status: 503, result: RESULT.unavailable, message: 'Serviço temporariamente indisponível.' },
  internalError: { status: 500, result: RESULT.internal, message: 'Erro interno no servidor.' },
}

/** The risk profile behind the success payloads. */
interface Profile {
  name: string
  score: number
  probability: string
  abc: string
  capacity: string
  profile: string
  debts: { count: number; total: string }
  protests: { count: number; total: string }
  restrictions: number
  deceased: boolean
  cpfStatus: string
}

const CLEAN = { debts: { count: 0, total: '0,00' }, protests: { count: 0, total: '0,00' }, restrictions: 0 }

function profileFor(scenario: Scenario): Profile {
  const base = { ...CLEAN, deceased: false, cpfStatus: 'REGULAR' }
  switch (scenario) {
    case 'mediumRisk':
      return { ...base, name: 'MARIA MEDIA DA SILVA', score: 650, probability: '18%', abc: 'C', capacity: 'R$ 1.500,00', profile: 'Pagador regular' }
    case 'highRisk':
      return { ...base, name: 'JOSE ALTO RISCO SOUZA', score: 420, probability: '41%', abc: 'E', capacity: 'R$ 600,00', profile: 'Mau pagador' }
    case 'restrictions':
      return {
        ...base,
        name: 'CARLOS RESTRICOES LIMA',
        score: 380,
        probability: '52%',
        abc: 'E',
        capacity: 'R$ 400,00',
        profile: 'Mau pagador',
        debts: { count: 3, total: '4.230,50' },
        protests: { count: 1, total: '800,00' },
        restrictions: 2,
      }
    case 'deceased':
      return { ...base, name: 'ANA FALECIDA PEREIRA', score: 0, probability: '0%', abc: 'E', capacity: 'R$ 0,00', profile: 'Sem perfil', deceased: true }
    case 'irregular':
      return { ...base, name: 'PAULO IRREGULAR COSTA', score: 500, probability: '30%', abc: 'D', capacity: 'R$ 1.000,00', profile: 'Pagador regular', cpfStatus: 'SUSPENSA' }
    default:
      return { ...base, name: 'JOAO BAIXO RISCO SANTOS', score: 850, probability: '3,5%', abc: 'A', capacity: 'R$ 2.500,00', profile: 'Bom pagador' }
  }
}

function scoreRange(score: number): string {
  const low = Math.floor((score - 1) / 100) * 100 + 1
  return `${Math.max(low, 0)} a ${low + 99}`
}

/** The `retorno` of the Quod score route. */
export function quodReturn(cpf: string, scenario: Scenario): unknown {
  const p = profileFor(scenario)
  return {
    pessoaFisica: {
      nome: p.name,
      cpf,
      score: String(p.score),
      faixaScore: scoreRange(p.score),
      capacidadePagamento: p.capacity,
      perfil: p.profile,
    },
  }
}

/** The `retorno` of the Boa Vista route: every value is a string, in Brazilian number format. */
export function boaVistaReturn(cpf: string, scenario: Scenario): unknown {
  const p = profileFor(scenario)
  return {
    cpf,
    nome: p.name,
    cpfSituacao: p.cpfStatus,
    indicacaoObito: p.deceased ? 'SIM' : 'NAO',
    rendaPresumida: { faixa: 'R$ 3.001 a R$ 5.000' },
    scores: { ocorrencias: [{ score: String(p.score), classificacaoABC: p.abc, probabilidadeInadimplencia: p.probability }] },
    pendenciasFinanceiras: {
      quantidade: String(p.debts.count),
      valorTotal: p.debts.total,
      ocorrencias: p.debts.count > 0 ? [{ credor: 'BANCO EXEMPLO S.A.', valor: p.debts.total, data: '15/03/2026' }] : [],
    },
    protestos: {
      quantidade: String(p.protests.count),
      valorTotal: p.protests.total,
      ocorrencias: p.protests.count > 0 ? [{ cartorio: '1 CARTORIO DE PROTESTOS', valor: p.protests.total, data: '02/02/2026' }] : [],
    },
    chequeSemFundoVarejo: { quantidade: '0' },
    chequeSemFundoBacen: { quantidade: '0' },
    acoesCiveis: { quantidade: '0' },
    falenciasAcoesRecuperacoes: { quantidade: '0' },
    restricoes: { quantidade: String(p.restrictions) },
    telefones: [{ ddd: '11', numero: '999990000' }],
    enderecos: [{ logradouro: 'RUA EXEMPLO', numero: '100', bairro: 'CENTRO', cidade: 'SAO PAULO', uf: 'SP', cep: '01001000' }],
  }
}

/** The `retorno` of a route, or undefined when the route does not exist. */
export function returnFor(route: string, cpf: string, scenario: Scenario): unknown {
  if (route === ROUTE_QUOD) return quodReturn(cpf, scenario)
  if (route === ROUTE_BOA_VISTA) return boaVistaReturn(cpf, scenario)
  return undefined
}

export function isKnownRoute(route: string): boolean {
  return route === ROUTE_QUOD || route === ROUTE_BOA_VISTA
}
