import { charge, company, creditCard, createRng, person, randomSeed } from './core/index.js'
import type { Config } from './config.ts'
import { findAsaas } from './discovery.ts'

/** The ways a charge can be paid. */
export type BillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

/** Every billing type, in the order the API offers them. */
const BILLING_TYPES: BillingType[] = ['PIX', 'BOLETO', 'CREDIT_CARD']

/** How many tries the boot seed gives the Asaas to come up. */
const BOOT_SEED_TRIES = 20

/** How long the boot seed waits between two tries, in milliseconds. */
const BOOT_SEED_WAIT_MS = 3000

/** What the caller asks the population to create. */
export interface PopulateInput {
  people?: number
  companies?: number
  chargesPerCustomer?: number
  billingTypes?: BillingType[]
  confirm?: number
  seed?: string
  /** The account to fill: its key is used instead of the configured one. */
  apiKey?: string
}

/** A customer the Asaas accepted. */
export interface PopulateCustomer {
  id: string
  name: string
  cpfCnpj: string
  personType: string
}

/** A charge the Asaas accepted. */
export interface PopulatePayment {
  id: string
  customer: string
  billingType: string
  value: number
  dueDate: string
  status: string
  invoiceUrl: string | null
}

/** A step the Asaas refused. */
export interface PopulateError {
  step: string
  status: number
  message: string
}

/** What the population created, and what it could not create. */
export interface PopulateResult {
  seed: string
  panelUrl: string
  customers: PopulateCustomer[]
  payments: PopulatePayment[]
  errors: PopulateError[]
}

/** The state of the Asaas mock, as the panel shows it. */
export interface AsaasStatus {
  asaasUrl: string | null
  panelUrl: string
  reachable: boolean
  customers: number | null
}

/**
 * Creates the customers and the charges of the Asaas mock.
 *
 * The requests run one after the other: the Asaas mock keeps its data in
 * SQLite, and the order of the calls is the order of the data.
 * @param config The configuration of the server.
 * @param input What to create; the out of range numbers are clamped.
 * @param fetchImpl The fetch the calls go through.
 * @param now The day of the population: the charges are due from it.
 */
export async function populate(
  config: Config,
  input: PopulateInput,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<PopulateResult> {
  const people = clamp(input.people ?? 5, 0, 100)
  const companies = clamp(input.companies ?? 2, 0, 100)
  const chargesPerCustomer = clamp(input.chargesPerCustomer ?? 2, 0, 10)
  const confirmRate = clampRate(input.confirm ?? 0)
  const billingTypes = billingTypesOf(input.billingTypes)
  const seed = input.seed?.trim() ? input.seed.trim() : randomSeed()
  const asaasUrl = config.asaasUrl
  const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : config.asaasApiKey

  // Without an Asaas there is nothing to call: the run says why it did nothing.
  if (!asaasUrl) {
    return {
      seed,
      panelUrl: config.asaasPanelUrl,
      customers: [],
      payments: [],
      errors: [
        {
          step: 'asaas',
          status: 0,
          message: 'Asaas não encontrado: defina ASAAS_URL ou suba o mock do Asaas.',
        },
      ],
    }
  }

  const rng = createRng(seed)
  const customers: PopulateCustomer[] = []
  const payments: PopulatePayment[] = []
  const errors: PopulateError[] = []

  const subjects: Array<{ kind: 'person' | 'company'; data: any }> = [
    ...Array.from({ length: people }, () => ({ kind: 'person' as const, data: person(rng, { now }) })),
    ...Array.from({ length: companies }, () => ({ kind: 'company' as const, data: company(rng, { now }) })),
  ]

  for (const [index, subject] of subjects.entries()) {
    const body = customerBody(subject.kind, subject.data, seed, index)

    const created = await fetchImpl(`${asaasUrl}/v3/customers`, {
      method: 'POST',
      headers: asaasHeaders(apiKey),
      body: JSON.stringify(body),
    })
    const createdBody = await readJson(created)

    if (!created.ok) {
      errors.push({
        step: `customer ${body.name}`,
        status: created.status,
        message: errorMessage(createdBody, created),
      })
      continue
    }

    const customer: PopulateCustomer = {
      id: String(createdBody?.id ?? ''),
      name: String(createdBody?.name ?? body.name),
      cpfCnpj: String(createdBody?.cpfCnpj ?? body.cpfCnpj),
      personType: String(createdBody?.personType ?? personTypeOf(body.cpfCnpj)),
    }
    customers.push(customer)

    for (let chargeIndex = 0; chargeIndex < chargesPerCustomer; chargeIndex++) {
      const due = charge(rng, { billingType: rng.pick(billingTypes), now })
      const paymentBody: Record<string, any> = {
        customer: customer.id,
        billingType: due.billingType,
        value: due.value,
        dueDate: due.dueDate,
        description: due.description,
        externalReference: due.externalReference,
      }

      if (due.billingType === 'CREDIT_CARD') {
        const card = creditCard(rng, { outcome: 'APPROVE', now })
        paymentBody.creditCard = {
          holderName: card.holderName,
          number: card.number,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          ccv: card.ccv,
        }
        paymentBody.creditCardHolderInfo = {
          name: customer.name,
          email: body.email,
          cpfCnpj: customer.cpfCnpj,
          postalCode: body.postalCode,
          addressNumber: body.addressNumber,
          // `phone` is required by the spec; a person without a landline gives the mobile.
          phone: body.phone ?? body.mobilePhone,
          mobilePhone: body.mobilePhone,
        }
        paymentBody.remoteIp = '127.0.0.1'
      }

      const charged = await fetchImpl(`${asaasUrl}/v3/payments`, {
        method: 'POST',
        headers: asaasHeaders(apiKey),
        body: JSON.stringify(paymentBody),
      })
      const chargedBody = await readJson(charged)

      if (!charged.ok) {
        errors.push({
          step: `payment ${customer.name}`,
          status: charged.status,
          message: errorMessage(chargedBody, charged),
        })
        continue
      }

      const payment: PopulatePayment = {
        id: String(chargedBody?.id ?? ''),
        customer: customer.id,
        billingType: String(chargedBody?.billingType ?? due.billingType),
        value: Number(chargedBody?.value ?? due.value),
        dueDate: String(chargedBody?.dueDate ?? due.dueDate),
        status: String(chargedBody?.status ?? 'PENDING'),
        invoiceUrl: chargedBody?.invoiceUrl ?? null,
      }

      // A card charge is paid at its creation, so only the other ones wait
      // for the sandbox confirmation.
      if (payment.billingType !== 'CREDIT_CARD' && payment.status === 'PENDING' && rng.bool(confirmRate)) {
        const confirmed = await fetchImpl(`${asaasUrl}/v3/sandbox/payment/${payment.id}/confirm`, {
          method: 'POST',
          headers: asaasHeaders(apiKey),
        })
        if (confirmed.ok) {
          const confirmedBody = await readJson(confirmed)
          if (confirmedBody?.status) payment.status = String(confirmedBody.status)
        } else {
          errors.push({
            step: `confirm ${payment.id}`,
            status: confirmed.status,
            message: errorMessage(await readJson(confirmed), confirmed),
          })
        }
      }

      payments.push(payment)
    }
  }

  return { seed, panelUrl: config.asaasPanelUrl, customers, payments, errors }
}

/**
 * The state of the Asaas mock: whether it answers and how many customers it
 * already has.
 * @param config The configuration of the server.
 * @param fetchImpl The fetch the calls go through.
 */
export async function asaasStatus(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): Promise<AsaasStatus> {
  const asaasUrl = config.asaasUrl
  const state = { asaasUrl: asaasUrl ?? null, panelUrl: config.asaasPanelUrl }

  // The Asaas was not found yet: there is nobody to ask.
  if (!asaasUrl) return { ...state, reachable: false, customers: null }

  try {
    const health = await fetchImpl(`${asaasUrl}/health`, { headers: asaasHeaders(config.asaasApiKey) })
    if (!health.ok) return { ...state, reachable: false, customers: null }

    const list = await fetchImpl(`${asaasUrl}/v3/customers?limit=1`, {
      headers: asaasHeaders(config.asaasApiKey),
    })
    if (!list.ok) return { ...state, reachable: true, customers: null }

    const body = await readJson(list)
    const total = Number(body?.totalCount ?? 0)
    return { ...state, reachable: true, customers: Number.isFinite(total) ? total : 0 }
  } catch {
    return { ...state, reachable: false, customers: null }
  }
}

/**
 * The boot seed spec of the environment: `people=10,companies=3,charges=2,confirm=0.5`.
 * @param spec The raw ASAAS_SEED_ON_BOOT value.
 */
export function parseSeedSpec(spec: string): PopulateInput | null {
  const text = String(spec ?? '').trim()
  if (!text) return null

  const input: PopulateInput = {}
  for (const part of text.split(',')) {
    const [rawKey, rawValue] = part.split('=')
    const key = String(rawKey ?? '').trim().toLowerCase()
    const value = String(rawValue ?? '').trim()
    if (!key || !value) continue

    switch (key) {
      case 'people':
        input.people = toNumber(value)
        break
      case 'companies':
        input.companies = toNumber(value)
        break
      case 'charges':
      case 'chargespercustomer':
        input.chargesPerCustomer = toNumber(value)
        break
      case 'confirm':
        input.confirm = toNumber(value)
        break
      case 'seed':
        input.seed = value
        break
      default:
        break
    }
  }

  return Object.keys(input).length > 0 ? input : null
}

/**
 * Populates the Asaas when the server boots, if the environment asks for it.
 * It never throws: a seed that fails is a log line, not a broken boot.
 * @param config The configuration of the server.
 * @param fetchImpl The fetch the calls go through.
 * @param log Where the seed writes what it did.
 */
export async function seedOnBoot(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = console.log,
): Promise<void> {
  try {
    const spec = parseSeedSpec(config.seedOnBoot)
    if (!spec) return

    let status = await asaasStatus(config, fetchImpl)
    for (let attempt = 1; attempt < BOOT_SEED_TRIES && !status.reachable; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, BOOT_SEED_WAIT_MS))
      // The Asaas may still be coming up: it is looked for again before each try.
      if (config.asaasPlaces.length) await findAsaas(config, fetchImpl, log)
      status = await asaasStatus(config, fetchImpl)
    }

    if (!status.reachable) {
      log('generator: the Asaas mock did not answer, boot seed skipped')
      return
    }

    if ((status.customers ?? 0) > 0) {
      log('generator: Asaas already has customers, boot seed skipped')
      return
    }

    const result = await populate(config, spec, fetchImpl)
    log(
      `generator: seeded the Asaas with ${result.customers.length} customers and ${result.payments.length} charges`,
    )
    for (const error of result.errors) {
      log(`generator: ${error.step} failed (${error.status}): ${error.message}`)
    }
  } catch (error) {
    log(`generator: boot seed failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The body the Asaas mock reads for a customer.
 * @param kind Whether the customer is a person or a company.
 * @param data The generated subject.
 * @param seed The seed of the population.
 * @param index The position of the subject in the population.
 */
function customerBody(
  kind: 'person' | 'company',
  data: any,
  seed: string,
  index: number,
): Record<string, any> {
  const address = data?.address ?? {}

  const body: Record<string, any> = {
    email: data?.email,
    mobilePhone: data?.mobilePhone,
    phone: data?.phone,
    postalCode: address.postalCode,
    address: address.street,
    addressNumber: addressNumberOf(address.number),
    complement: address.complement,
    province: address.district,
    externalReference: `gen-${seed}-${index}`,
  }

  if (kind === 'company') {
    body.name = data?.corporateName
    body.company = data?.tradeName
    body.cpfCnpj = data?.cnpj
    return body
  }

  body.name = data?.name
  body.cpfCnpj = data?.cpf
  return body
}

/**
 * The headers every call to the Asaas mock carries.
 * @param apiKey The key of the account the calls act on.
 */
function asaasHeaders(apiKey: string): Record<string, string> {
  return {
    access_token: apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'ama4devs-generator',
  }
}

/**
 * The body of a JSON answer, or null when it is not JSON.
 * @param response The answer of the Asaas mock.
 */
async function readJson(response: Response): Promise<any> {
  try {
    const text = await response.text()
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * What the Asaas mock said about a refused request: the description of its
 * first error, or the status of the answer.
 * @param body The body of the answer.
 * @param response The answer itself.
 */
function errorMessage(body: any, response: Response): string {
  const first = body?.errors?.[0]
  if (first?.description) return String(first.description)
  if (first?.message) return String(first.message)
  if (body?.message) return String(body.message)
  return response.statusText || `HTTP ${response.status}`
}

/**
 * The number of the address of a subject, as the Asaas API takes it: a string
 * (`addressNumber` is `string` in the spec), `S/N` included.
 * @param value The number the core made.
 */
function addressNumberOf(value: unknown): string {
  return String(value ?? '')
}

/**
 * Whether a document belongs to a person or to a company: told apart by the
 * number of its digits.
 * @param cpfCnpj The document.
 */
function personTypeOf(cpfCnpj: unknown): string {
  return String(cpfCnpj ?? '').replace(/\D/g, '').length === 14 ? 'JURIDICA' : 'FISICA'
}

/**
 * The billing types the caller asked for, without the ones the Asaas does not
 * know. An empty list means all of them.
 * @param requested The types of the request.
 */
function billingTypesOf(requested: BillingType[] | undefined): BillingType[] {
  const types = (requested ?? []).filter((type): type is BillingType =>
    BILLING_TYPES.includes(type),
  )
  return types.length > 0 ? types : [...BILLING_TYPES]
}

/**
 * A number inside a range.
 * @param value The number of the request.
 * @param min The lowest value.
 * @param max The highest value.
 */
/**
 * A share between 0 and 1, kept fractional: `confirm: 0.5` confirms about half.
 * @param value The share asked for.
 */
function clampRate(value: number): number {
  const rate = Number(value)
  if (!Number.isFinite(rate)) return 0
  return Math.min(1, Math.max(0, rate))
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * A number of a spec; anything that is not a number is zero.
 * @param value The raw value.
 */
function toNumber(value: string): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}
