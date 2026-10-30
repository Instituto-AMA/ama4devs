/**
 * The "save the card" cycle, asked of the REAL sandbox.
 *
 *   ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun tools/probe-tokenization.ts
 *
 * Tokenization is the feature where an "almost right" mock costs the most: it
 * works in the test, the user saves the card, and the second purchase fails in
 * production over a field the sandbox required and the mock did not. So nothing
 * here is deduced — every question becomes a real request:
 *
 *   1. What exactly does `tokenizeCreditCard` return?
 *   2. Can we charge with ONLY the token, without the number? (that is the whole feature)
 *   3. Is the CVV required on the second purchase?
 *   4. Is the token bound to the CUSTOMER who created it, or does it work for anyone?
 *   5. Does a charge paid with a card return a reusable token?
 *   6. Invalid token: which error?
 *   7. Does the token survive a decline? (tokenizing a card that declines)
 */
/**
 * Point it at the MOCK (`BASE=http://localhost:45445/v3`) and the same script runs
 * against it. Running both and telling the outputs apart is the whole test: any
 * line that changes is a divergence, and Asaas is the truth.
 */
const BASE = process.env.BASE ?? 'https://api-sandbox.asaas.com/v3'
const apiKey = process.env.ASAAS_SANDBOX_API_KEY ?? ''
const againstMock = !BASE.includes('asaas.com')

// The guard only matters for the real Asaas: a production key would create real
// charges. Against the mock, any key works.
if (!againstMock && !apiKey.startsWith('$aact_hmlg_')) {
  console.error('A SANDBOX key is required (it starts with "$aact_hmlg_").')
  process.exit(1)
}

const HOLDER_INFO = {
  name: 'Marcelo H V Almeida',
  email: 'marcelo.almeida@gmail.com',
  cpfCnpj: '24971563792',
  postalCode: '89223-005',
  addressNumber: '277',
  phone: '4738010919',
}
const CARD = {
  holderName: 'Marcelo H V Almeida',
  number: '5162306219378829',
  expiryMonth: '05',
  expiryYear: '2035',
  ccv: '318',
}
const IP = '116.213.42.98'

async function api(path: string, body?: unknown, method = 'POST') {
  const r = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : method,
    headers: { access_token: apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}

const show = (label: string, r: { status: number; body: any }) => {
  const err = r.body?.errors?.map((e: any) => `[${e.code}] ${e.description}`).join(' | ')
  console.log(`${label}\n   HTTP ${r.status}  ${err ?? ''}`)
}

const customer = async (name: string) =>
  (await api('/customers', { name, cpfCnpj: '24971563792' })).body.id as string

const payment = async (customerId: string) =>
  (
    await api('/payments', {
      customer: customerId,
      billingType: 'CREDIT_CARD',
      value: 100,
      dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    })
  ).body.id as string

const out: Record<string, unknown> = {}

// ── 1. what the tokenization returns ────────────────────────────────────────
const cusA = await customer('Token A')
const tok = await api('/creditCard/tokenizeCreditCard', {
  customer: cusA,
  creditCard: CARD,
  creditCardHolderInfo: HOLDER_INFO,
  remoteIp: IP,
})
console.log('1. tokenizeCreditCard')
console.log('   →', JSON.stringify(tok.body, null, 2).replace(/\n/g, '\n   '), '\n')
out.tokenize = { status: tok.status, body: tok.body }

const token = tok.body?.creditCardToken as string

// ── 2. charging with ONLY the token (the whole feature) ─────────────────────
const p2 = await payment(cusA)
const r2 = await api(`/payments/${p2}/payWithCreditCard`, { creditCardToken: token, remoteIp: IP })
show('2. pay with creditCardToken, WITHOUT the number and WITHOUT the ccv', r2)
console.log('   creditCard returned:', JSON.stringify(r2.body?.creditCard), '\n')
out.payWithTokenOnly = { status: r2.status, creditCard: r2.body?.creditCard, status_: r2.body?.status }

// ── 3. is the CVV required on the repeat purchase? ───────────────────────────
const p3 = await payment(cusA)
const r3 = await api(`/payments/${p3}/payWithCreditCard`, {
  creditCardToken: token,
  creditCard: { ccv: '318' },
  remoteIp: IP,
})
show('3. token + ccv (some PSPs require the CVV on the repeat purchase)', r3)
console.log()
out.payWithTokenAndCcv = { status: r3.status }

// ── 4. is the token bound to the customer who created it? ────────────────────
const cusB = await customer('Token B — ANOTHER customer')
const p4 = await payment(cusB)
const r4 = await api(`/payments/${p4}/payWithCreditCard`, { creditCardToken: token, remoteIp: IP })
show('4. use customer A\'s token to charge customer B', r4)
console.log('   → if it answers 200, the token is NOT bound to the customer\n')
out.tokenCrossCustomer = { status: r4.status, body: r4.body?.errors ?? r4.body?.status }

// ── 5. does the charge with a card return a reusable token? ─────────────────
const cusC = await customer('Token C')
const p5 = await api('/payments', {
  customer: cusC,
  billingType: 'CREDIT_CARD',
  value: 100,
  dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  creditCard: CARD,
  creditCardHolderInfo: HOLDER_INFO,
  remoteIp: IP,
})
const bornToken = p5.body?.creditCard?.creditCardToken
console.log('5. does POST /payments with creditCard return a token?')
console.log('   creditCard:', JSON.stringify(p5.body?.creditCard))
const p5b = await payment(cusC)
const r5b = await api(`/payments/${p5b}/payWithCreditCard`, {
  creditCardToken: bornToken,
  remoteIp: IP,
})
show('   and does that token charge again?', r5b)
console.log()
out.tokenFromPayment = { token: !!bornToken, reusable: r5b.status }

// ── 6. non-existent token ───────────────────────────────────────────────────
const p6 = await payment(cusA)
const r6 = await api(`/payments/${p6}/payWithCreditCard`, {
  creditCardToken: 'nao-existe-este-token',
  remoteIp: IP,
})
show('6. non-existent token', r6)
console.log()
out.badToken = { status: r6.status, errors: r6.body?.errors }

// ── 7. tokenizing a card that DECLINES ──────────────────────────────────────
const cusD = await customer('Token D')
const r7 = await api('/creditCard/tokenizeCreditCard', {
  customer: cusD,
  creditCard: { ...CARD, number: '5184019740373151' },
  creditCardHolderInfo: HOLDER_INFO,
  remoteIp: IP,
})
show('7. tokenize the DECLINING card (does the tokenization authorize?)', r7)
if (r7.status === 200) {
  const p7 = await payment(cusD)
  const r7b = await api(`/payments/${p7}/payWithCreditCard`, {
    creditCardToken: r7.body.creditCardToken,
    remoteIp: IP,
  })
  show('   → and does its token decline when charged?', r7b)
}
console.log()
out.tokenizeDeclined = { status: r7.status, errors: r7.body?.errors }

await Bun.write(process.env.OUT ?? 'tests/golden/probes/tokenization-probe.json', JSON.stringify(out, null, 2) + '\n')
console.log('gravado em tests/golden/probes/tokenization-probe.json')
