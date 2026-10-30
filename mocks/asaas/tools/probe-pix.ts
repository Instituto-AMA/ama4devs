/**
 * The PIX cycle, asked of the REAL sandbox — and of the mock, with the same script.
 *
 *   ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun tools/probe-pix.ts
 *   BASE=http://localhost:45445/v3 ASAAS_SANDBOX_API_KEY='whatever' bun tools/probe-pix.ts
 *
 * The questions:
 *
 *   1. What does `POST /payments` with PIX return? (initial status)
 *   2. The QR Code: which fields, and is the payload a real BR Code?
 *   3. `POST /v3/sandbox/payment/{id}/confirm` — is THIS what simulates the payment?
 *      Is it what Asaas's panel's "simulate payment" button does?
 *   4. After being paid: status, netValue, creditDate, confirmedDate, paymentDate.
 *      (PIX credits RIGHT AWAY — if the credit date is not today, we are wrong)
 *   5. Does the statement move? Which entries?
 *   6. Confirming TWICE: what happens?
 */
const BASE = process.env.BASE ?? 'https://api-sandbox.asaas.com/v3'
const apiKey = process.env.ASAAS_SANDBOX_API_KEY ?? ''
const againstMock = !BASE.includes('asaas.com')

if (!againstMock && !apiKey.startsWith('$aact_hmlg_')) {
  console.error('A SANDBOX key is required (it starts with "$aact_hmlg_").')
  process.exit(1)
}

async function api(path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { access_token: apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}

const today = new Date().toISOString().slice(0, 10)
const cus = (await api('/customers', { name: 'Probe PIX', cpfCnpj: '24971563792' })).body.id

// ── 1. criar ────────────────────────────────────────────────────────────────
const created = await api('/payments', {
  customer: cus,
  billingType: 'PIX',
  value: 250.0,
  dueDate: today,
})
const p = created.body
console.log('1. POST /payments (PIX)')
console.log(`   status=${p.status}  value=${p.value}  netValue=${p.netValue}`)
console.log(`   dueDate=${p.dueDate}  creditDate=${p.creditDate ?? '—'}\n`)

// ── 2. the QR Code ──────────────────────────────────────────────────────────
const qr = await api(`/payments/${p.id}/pixQrCode`)
const q = qr.body
console.log('2. GET /payments/{id}/pixQrCode')
console.log(`   campos: ${Object.keys(q ?? {}).join(', ')}`)
console.log(`   payload starts with: ${String(q?.payload ?? '').slice(0, 24)}…`)
console.log(`   encodedImage: ${q?.encodedImage ? `base64, ${q.encodedImage.length} chars` : '—'}`)
console.log(`   expirationDate: ${q?.expirationDate ?? '—'}\n`)

// ── 3. simulating the payment ───────────────────────────────────────────────
const confirmed = await api(`/sandbox/payment/${p.id}/confirm`, {})
console.log('3. POST /v3/sandbox/payment/{id}/confirm  ← the "simulate payment"')
console.log(`   HTTP ${confirmed.status}`)
if (confirmed.status !== 200) {
  console.log(`   ${JSON.stringify(confirmed.body)}\n`)
} else {
  console.log(`   response fields: ${Object.keys(confirmed.body ?? {}).slice(0, 12).join(', ')}\n`)
}

// ── 4. the state afterwards ─────────────────────────────────────────────────
const after = (await api(`/payments/${p.id}`)).body
console.log('4. the charge, after being paid')
for (const k of [
  'status',
  'value',
  'netValue',
  'creditDate',
  'confirmedDate',
  'paymentDate',
  'clientPaymentDate',
  'estimatedCreditDate',
]) {
  console.log(`   ${k.padEnd(20)} ${JSON.stringify(after?.[k])}`)
}
console.log()

// ── 5. the statement ──────────────────────────────────────────────────────────
const tx = await api('/financialTransactions?limit=5')
console.log('5. statement')
for (const t of tx.body?.data ?? []) {
  console.log(`   ${t.date}  ${String(t.type).padEnd(22)} ${String(t.value).padStart(8)}`)
}
console.log()

// ── 6. confirm again ────────────────────────────────────────────────────
const again = await api(`/sandbox/payment/${p.id}/confirm`, {})
console.log('6. confirmar DUAS vezes')
console.log(
  `   HTTP ${again.status}  ` +
    (again.body?.errors?.map((e: any) => `[${e.code}] ${e.description}`).join(' | ') ??
      `status=${again.body?.status}`),
)
