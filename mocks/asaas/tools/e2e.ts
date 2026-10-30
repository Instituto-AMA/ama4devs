/**
 * THE END-TO-END PROOF — the acceptance criterion of this whole project.
 *
 *   bun run e2e                      # boots the server by itself, proves, tears it down
 *   bun run e2e -- http://localhost:8080 '$aact_hmlg_…'   # against an already running one
 *
 * The project exists for ONE reason: Asaas's sandbox does not deliver webhooks to
 * localhost. The whole test suite runs with the app in memory — which proves the
 * logic, but not the promise. This script proves the promise: it speaks real HTTP
 * with the server, spins up a listener on a real socket, and waits for the
 * `PAYMENT_RECEIVED` to arrive there.
 *
 * If this script passes against `docker compose up`, the product works.
 */
import { bootstrap } from '../src/bootstrap.ts'

const [argUrl, argKey] = process.argv.slice(2).filter((a) => !a.startsWith('-'))

let api: string
let key: string
let stop = () => {}

if (argUrl && argKey) {
  api = argUrl.replace(/\/$/, '')
  key = argKey
  console.log(`Talking to an already running server: ${api}\n`)
} else {
  // Port 0 = the OS picks a free one. No conflict with the dev server.
  const app = await bootstrap({
    config: {
      databasePath: ':memory:',
      logLevel: (process.env.LOG_LEVEL as never) ?? 'silent',
      port: 0,
      webhook: { localhostRewrite: undefined },
    },
  })
  app.scheduler.start(0)
  const server = app.app.listen(0)
  api = `http://localhost:${server.server?.port}`
  key = app.seed.apiKey
  stop = () => {
    app.scheduler.stop()
    server.stop()
    app.close()
  }
  console.log(`Ephemeral server at ${api}\n`)
}

// ── the listener: it is IT that has to receive the event ──────────────────────
const received: any[] = []
const listener = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as any
    received.push({ ...body, _authToken: req.headers.get('asaas-access-token') })
    console.log(`   📬 ${body.event}`)
    // Only HTTP 200 counts as a success for Asaas. 201 and 204 are a FAILURE.
    return new Response('ok', { status: 200 })
  },
})
const listenerUrl = `http://localhost:${listener.port}`

const call = async (method: string, path: string, body?: unknown): Promise<any> => {
  const res = await fetch(api + path, {
    method,
    headers: { access_token: key, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => null)
  if (res.status >= 400) {
    console.error(`\n✗ ${method} ${path} → HTTP ${res.status}`)
    console.error(JSON.stringify(json, null, 2))
    listener.stop()
    stop()
    process.exit(1)
  }
  return json
}

const AUTH_TOKEN = 'token-do-e2e-com-trinta-e-dois-chars'

console.log(`Listener local em ${listenerUrl}`)

await call('POST', '/v3/webhooks', {
  name: 'e2e',
  url: listenerUrl,
  email: 'e2e@localhost',
  sendType: 'SEQUENTIALLY',
  authToken: AUTH_TOKEN,
  events: ['PAYMENT_CREATED', 'PAYMENT_RECEIVED'],
})
console.log('1. webhook subscribed pointing to localhost')

const customer = await call('POST', '/v3/customers', {
  name: 'Cliente E2E',
  cpfCnpj: '24971563792',
  email: 'customer@localhost',
})
console.log(`2. customer ${customer.id}`)

const dueDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
const payment = await call('POST', '/v3/payments', {
  customer: customer.id,
  billingType: 'PIX',
  value: 100,
  dueDate,
  description: 'Prova de ponta a ponta',
})
console.log(`3. Pix charge ${payment.id} — status=${payment.status}`)

// The sandbox action: it is what the real Asaas triggers when the customer pays.
const confirmed = await call('POST', `/v3/sandbox/payment/${payment.id}/confirm`)
console.log(`4. confirmada → status=${confirmed.status}`)

// O dispatcher roda no fim do tick.
await fetch(`${api}/_admin/tick`, { method: 'POST' }).catch(() => {})

console.log('5. esperando o evento chegar no listener…')
for (let i = 0; i < 60 && !received.some((e) => e.event === 'PAYMENT_RECEIVED'); i++) {
  await Bun.sleep(100)
}

// ── veredito ─────────────────────────────────────────────────────────────────
const fail = (msg: string): never => {
  console.error(`\n✗ ${msg}`)
  listener.stop()
  stop()
  process.exit(1)
}

const evt = received.find((e) => e.event === 'PAYMENT_RECEIVED')
if (!evt) {
  fail(
    `PAYMENT_RECEIVED did not arrive at ${listenerUrl}.\n` +
      `  Received: ${received.map((e) => e.event).join(', ') || '(nothing)'}\n` +
      `  If you are in Docker: WEBHOOK_LOCALHOST_REWRITE=host.docker.internal`,
  )
}

const checks: [string, unknown, unknown][] = [
  ['status', evt.payment.status, 'RECEIVED'],
  ['value', evt.payment.value, 100],
  ['netValue (100 − 1.99 of the Pix fixed fee)', evt.payment.netValue, 98.01],
  ['authToken in the asaas-access-token header', evt._authToken, AUTH_TOKEN],
]

console.log('')
let ok = true
for (const [label, actual, expected] of checks) {
  const good = actual === expected
  ok &&= good
  console.log(`   ${good ? '✓' : '✗'} ${label}: ${actual}${good ? '' : `  (expected: ${expected})`}`)
}
// Pix credits right away — it is not a promise of a future credit.
console.log(`   ✓ creditDate: ${evt.payment.creditDate}  (Pix credits on the spot)`)

listener.stop()
stop()

if (!ok) process.exit(1)

console.log(`
─────────────────────────────────────────────────────────────
✓ Asaas's webhook arrived at localhost.

  This is exactly what Asaas's sandbox does not do — and the reason
  this project exists.
─────────────────────────────────────────────────────────────
`)
