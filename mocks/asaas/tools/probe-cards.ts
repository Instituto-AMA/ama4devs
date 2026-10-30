/**
 * Asks Asaas's REAL sandbox what each card number does.
 *
 *   ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun tools/probe-cards.ts
 *
 * It exists because Asaas's documentation lists a few test cards without saying
 * WHICH error each one produces — and "declined" is not one error: antifraud,
 * insufficient funds, expired card and wrong CVV are different outcomes, with
 * different codes, and a serious application handles each one differently.
 *
 * The script creates a real charge in the sandbox and tries to pay it with each
 * number. It records the pair (number → raw response) in `tests/golden/probes/card-probe.json`.
 * What the response says is the truth; what the doc says is a guess.
 */
const apiKey = process.env.ASAAS_SANDBOX_API_KEY ?? ''
const BASE = 'https://api-sandbox.asaas.com/v3'

// The SAME guard as capture.ts: a production key would create real charges.
if (!apiKey.startsWith('$aact_hmlg_')) {
  console.error('The key does not look like a sandbox one (it should start with "$aact_hmlg_").')
  process.exit(1)
}

/**
 * The candidates. They come from three places: Asaas's doc, the numbers that are
 * already in our mock, and the brands' "canonical" test cards (Visa 4000…0002 is
 * the universal "generic decline" — it is worth knowing whether Asaas recognizes them).
 */
const CANDIDATES: Array<{ number: string; hunch: string }> = [
  { number: '5162306219378829', hunch: 'Asaas doc — approved' },
  { number: '4444444444444444', hunch: 'our mock — approved (fails Luhn!)' },
  { number: '5184019740373151', hunch: 'our mock — declined' },
  { number: '4916561358240741', hunch: 'our mock — declined' },
  { number: '4000000000000002', hunch: 'canonical — generic decline' },
  { number: '4000000000009995', hunch: 'canonical — insufficient funds' },
  { number: '4000000000000069', hunch: 'canonical — expired card' },
  { number: '4000000000000127', hunch: 'canonical — incorrect CVC' },
  { number: '4000000000000119', hunch: 'canonical — processing error' },
  { number: '4111111111111111', hunch: 'classic test Visa (passes Luhn)' },
]

const HOLDER = {
  name: 'Marcelo H V Almeida',
  email: 'marcelo.almeida@gmail.com',
  cpfCnpj: '24971563792',
  postalCode: '89223-005',
  addressNumber: '277',
  phone: '4738010919',
}

async function api(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      access_token: apiKey,
      'content-type': 'application/json',
      'User-Agent': 'asaas-mock-server/probe',
      ...(init?.headers ?? {}),
    },
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

async function main() {
  const customer = await api('/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Card Probe', cpfCnpj: '24971563792' }),
  })
  const customerId = (customer.body as { id?: string })?.id
  if (!customerId) throw new Error(`did not create the customer: ${JSON.stringify(customer.body)}`)
  console.log('customer:', customerId, '\n')

  const results: unknown[] = []

  for (const { number, hunch } of CANDIDATES) {
    // Each card needs its OWN charge: an already paid charge does not accept a
    // second attempt, and a declined one can enter a retry state.
    const payment = await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: 100.0,
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        description: `probe ${number.slice(-4)}`,
      }),
    })
    const paymentId = (payment.body as { id?: string })?.id
    if (!paymentId) {
      console.log(`${number}  ✗ did not create the charge:`, JSON.stringify(payment.body))
      continue
    }

    const pay = await api(`/payments/${paymentId}/payWithCreditCard`, {
      method: 'POST',
      body: JSON.stringify({
        creditCard: {
          holderName: HOLDER.name,
          number,
          expiryMonth: '05',
          expiryYear: '2035',
          ccv: '318',
        },
        creditCardHolderInfo: HOLDER,
        remoteIp: '116.213.42.98',
      }),
    })

    const b = pay.body as { status?: string; errors?: Array<{ code: string; description: string }> }
    const verdict =
      pay.status === 200
        ? `HTTP 200  status=${b?.status}`
        : `HTTP ${pay.status}  ${b?.errors?.map((e) => `${e.code}: ${e.description}`).join(' | ')}`

    console.log(`${number}  ${verdict}`)
    console.log(`${' '.repeat(number.length)}  (palpite: ${hunch})\n`)

    results.push({ number, hunch, httpStatus: pay.status, response: pay.body })
  }

  await Bun.write('tests/golden/probes/card-probe.json', JSON.stringify(results, null, 2) + '\n')
  console.log('gravado em tests/golden/probes/card-probe.json')
}

await main()
