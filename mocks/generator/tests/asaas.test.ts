import { describe, expect, test } from 'bun:test'
import { asaasStatus, parseSeedSpec, populate } from '../src/asaas.ts'
import { loadConfig } from '../src/config.ts'

const API_KEY = '$aact_hmlg_local_master'
const config = loadConfig({ ASAAS_API_KEY: API_KEY })

/** A call the population made. */
interface RecordedCall {
  url: string
  method: string
  headers: Headers
  body: any
}

/** The Asaas mock as a fake: it records the calls and answers them. */
interface FakeAsaas {
  calls: RecordedCall[]
  fetch: typeof fetch
}

/**
 * The fake Asaas: it answers the customers, the charges, the confirmations and
 * the status, and it records every call.
 * @param options The customer creation may fail, the way the real mock does
 * with an invalid document.
 */
function fakeAsaas(options: { customerError?: { status: number; body: unknown } } = {}): FakeAsaas {
  const calls: RecordedCall[] = []
  let customers = 0
  let payments = 0

  const impl = async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = String(init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? {})
    const body = init?.body ? JSON.parse(String(init.body)) : undefined

    calls.push({ url, method, headers, body })

    if (method === 'POST' && url.includes('/v3/sandbox/payment/')) {
      return jsonResponse({ status: 'RECEIVED' })
    }

    if (method === 'POST' && url.endsWith('/v3/customers')) {
      if (options.customerError && customers === 0) {
        return jsonResponse(options.customerError.body, options.customerError.status)
      }
      customers += 1
      return jsonResponse({
        id: `cus_${customers}`,
        name: body.name,
        cpfCnpj: body.cpfCnpj,
        personType: String(body.cpfCnpj).replace(/\D/g, '').length === 14 ? 'JURIDICA' : 'FISICA',
      })
    }

    if (method === 'POST' && url.endsWith('/v3/payments')) {
      payments += 1
      return jsonResponse({
        id: `pay_${payments}`,
        status: 'PENDING',
        invoiceUrl: `https://localhost:45445/i/pay_${payments}`,
      })
    }

    if (url.endsWith('/health')) return jsonResponse({ status: 'ok' })

    if (url.includes('/v3/customers')) return jsonResponse({ totalCount: customers })

    return jsonResponse({ error: 'not found' }, 404)
  }

  return { calls, fetch: impl as unknown as typeof fetch }
}

/**
 * A JSON answer of the fake.
 * @param payload The body of the answer.
 * @param status The status of the answer.
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('populate', () => {
  test('creates the customers, their charges and confirms them', async () => {
    const asaas = fakeAsaas()
    const result = await populate(
      config,
      {
        people: 2,
        companies: 1,
        chargesPerCustomer: 2,
        billingTypes: ['PIX'],
        confirm: 1,
        seed: 's',
      },
      asaas.fetch,
      new Date('2026-10-29T12:00:00Z'),
    )

    expect(result.seed).toBe('s')
    expect(result.customers).toHaveLength(3)
    expect(result.payments).toHaveLength(6)
    expect(result.errors).toHaveLength(0)
    expect(result.payments.every((payment) => payment.status === 'RECEIVED')).toBe(true)

    // Three customers, six charges and six confirmations.
    expect(asaas.calls).toHaveLength(15)
    expect(asaas.calls.filter((call) => call.url.endsWith('/v3/customers'))).toHaveLength(3)
    expect(asaas.calls.filter((call) => call.url.endsWith('/v3/payments'))).toHaveLength(6)
    expect(asaas.calls.filter((call) => call.url.endsWith('/confirm'))).toHaveLength(6)
    expect(asaas.calls.every((call) => call.headers.get('access_token') === API_KEY)).toBe(true)
  })

  test('records the refused customer and creates no charge for it', async () => {
    const asaas = fakeAsaas({
      customerError: {
        status: 400,
        body: { errors: [{ description: 'O CPF/CNPJ informado é inválido.' }] },
      },
    })
    const result = await populate(
      config,
      { people: 1, companies: 0, chargesPerCustomer: 2, billingTypes: ['PIX'], confirm: 0, seed: 's' },
      asaas.fetch,
    )

    expect(result.customers).toHaveLength(0)
    expect(result.payments).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.status).toBe(400)
    expect(result.errors[0]!.message).toBe('O CPF/CNPJ informado é inválido.')
    expect(asaas.calls.filter((call) => call.url.endsWith('/v3/payments'))).toHaveLength(0)
  })

  test('sends the approved test card and never confirms a card charge', async () => {
    const asaas = fakeAsaas()
    const result = await populate(
      config,
      {
        people: 1,
        companies: 0,
        chargesPerCustomer: 1,
        billingTypes: ['CREDIT_CARD'],
        confirm: 1,
        seed: 's',
      },
      asaas.fetch,
    )

    const payment = asaas.calls.find((call) => call.url.endsWith('/v3/payments'))
    expect(payment?.body.creditCard.number).toBe('4444444444444444')
    expect(payment?.body.creditCardHolderInfo).toBeDefined()
    expect(payment?.body.remoteIp).toBe('127.0.0.1')
    expect(asaas.calls.filter((call) => call.url.endsWith('/confirm'))).toHaveLength(0)
    expect(result.payments[0]!.status).toBe('PENDING')
  })

  test('clamps the numbers of the request', async () => {
    const asaas = fakeAsaas()
    const result = await populate(
      config,
      {
        people: 1000,
        companies: 0,
        chargesPerCustomer: 0,
        billingTypes: ['PIX'],
        confirm: 0,
        seed: 's',
      },
      asaas.fetch,
    )

    expect(result.customers).toHaveLength(100)
    expect(result.payments).toHaveLength(0)
  })

  test('clamps the charges of each customer', async () => {
    const asaas = fakeAsaas()
    const result = await populate(
      config,
      {
        people: 3,
        companies: 0,
        chargesPerCustomer: 50,
        billingTypes: ['PIX'],
        confirm: 0,
        seed: 's',
      },
      asaas.fetch,
    )

    expect(result.payments).toHaveLength(30)
  })
})

describe('parseSeedSpec', () => {
  test('reads the boot seed of the environment', () => {
    expect(parseSeedSpec('')).toBeNull()
    expect(parseSeedSpec('   ')).toBeNull()
    expect(parseSeedSpec('people=10,companies=3,charges=2,confirm=0.5')).toEqual({
      people: 10,
      companies: 3,
      chargesPerCustomer: 2,
      confirm: 0.5,
    })
  })
})

describe('asaasStatus', () => {
  test('is unreachable when the Asaas does not answer', async () => {
    const throwing = (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch

    const status = await asaasStatus(config, throwing)

    expect(status.reachable).toBe(false)
    expect(status.customers).toBeNull()
    expect(status.asaasUrl).toBe(config.asaasUrl)
    expect(status.panelUrl).toBe(config.asaasPanelUrl)
  })

  test('counts the customers of the Asaas', async () => {
    const asaas = fakeAsaas()
    await populate(config, { people: 2, companies: 0, chargesPerCustomer: 0, seed: 's' }, asaas.fetch)

    const status = await asaasStatus(config, asaas.fetch)

    expect(status.reachable).toBe(true)
    expect(status.customers).toBe(2)
  })
})
