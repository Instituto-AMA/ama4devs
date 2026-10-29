#!/usr/bin/env node
// Writes the reference of the mocks' own routes for the Pages site (site/data/): the
// Asaas mock's /_admin and /_mock routes and the WhatsApp mock's /settings routes.
// Every example answer is CAPTURED: the script calls each route, with the body the page
// shows, against FRESH instances, and records the status and the body that came back,
// errors included. Lists are cut to two items so the pages stay readable.
//
//   asaas-admin.json, asaas-admin-details.json
//   whatsapp-settings.json, whatsapp-settings-details.json
//
// usage: node scripts/site-routes-data.mjs <fresh-asaas-url> <fresh-whatsapp-url>
//   The Asaas instance must run with CLOCK_MODE=VIRTUAL_FROZEN and
//   ASAAS_API_KEY=$aact_hmlg_local; it moves the clock and creates data, so never point
//   it at a mock you use. Example:
//     docker run -d --rm -p 45999:45445 -e CLOCK_MODE=VIRTUAL_FROZEN \
//       -e 'ASAAS_API_KEY=$aact_hmlg_local' ghcr.io/instituto-ama/asaas-mock:latest
//     docker run -d --rm -p 3999:3010 -e WHAP_DB=:memory: ghcr.io/instituto-ama/whatsapp-mock:latest
//     node scripts/site-routes-data.mjs http://localhost:45999 http://localhost:3999
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [asaasUrl, whatsappUrl] = process.argv.slice(2)
if (!asaasUrl || !whatsappUrl) {
  console.error('usage: node scripts/site-routes-data.mjs <fresh-asaas-url> <fresh-whatsapp-url>')
  process.exit(2)
}
const out = join(root, 'site', 'data')
mkdirSync(out, { recursive: true })

const KEY = '$aact_hmlg_local'

/** Lists cut to two items, long strings cut, so an example reads on a page. */
function trim(value, depth = 0) {
  if (Array.isArray(value)) {
    const kept = value.slice(0, 2).map((v) => trim(v, depth + 1))
    return value.length > 2 ? [...kept, `… ${value.length - 2} more`] : kept
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v, depth + 1)]))
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`
  return value
}

async function call(base, method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // plain text answer
  }
  return { status: res.status, body: parsed }
}

const v3 = (method, path, body) => call(asaasUrl, method, `/v3${path}`, body, { access_token: KEY })

/**
 * A route of the catalog. `run(ctx)` returns the path actually called (ids filled in)
 * and the body sent; `errors` are calls that show a failure answer.
 */
function route(group, method, path, summary, opts = {}) {
  return { group, method, path, summary, ...opts }
}

async function capture(base, catalog, ctx) {
  const groups = new Map()
  const details = {}
  for (const r of catalog) {
    const id = `${r.method.toLowerCase()}-${r.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`
    if (r.before) await r.before(ctx)
    const body = typeof r.body === 'function' ? r.body(ctx) : r.body
    const path = typeof r.call === 'function' ? r.call(ctx) : (r.call ?? r.path)
    const res = await call(base, r.method, path, body)
    if (r.after) await r.after(ctx, res)
    const responses = [{ status: String(res.status), description: 'Captured from a run of the image.', example: trim(res.body) }]
    for (const e of r.errors ?? []) {
      const errBody = typeof e.body === 'function' ? e.body(ctx) : e.body
      const errPath = typeof e.call === 'function' ? e.call(ctx) : (e.call ?? path)
      const er = await call(base, r.method, errPath, errBody)
      responses.push({ status: String(er.status), description: e.why, example: trim(er.body) })
    }
    const group = groups.get(r.group) ?? { tag: r.group, ops: [] }
    group.ops.push({ id, method: r.method, path: r.path, summary: r.summary, live: true })
    groups.set(r.group, group)
    details[id] = {
      description: r.description ?? '',
      contentType: body === undefined ? null : 'application/json',
      params: r.params ?? [],
      fields: r.fields ?? [],
      examples: body === undefined ? [] : [{ name: 'Example', value: body }],
      responses,
    }
  }
  return { groups: [...groups.values()], details }
}

const write = (name, data) => writeFileSync(join(out, name), `${JSON.stringify(data)}\n`)
const f = (name, type, description, required = false) => ({ name, type, description, required })
const p = (name, where, type, description, required = false) => ({ in: where, name, type, description, required })

// ── Asaas: state the routes need ──
const actx = {}
actx.accountId = (await call(asaasUrl, 'GET', '/_admin/accounts')).body.accounts?.[0]?.id
actx.customer = (await v3('POST', '/customers', { name: 'Maria Souza', cpfCnpj: '24971563792', email: 'maria@example.com', mobilePhone: '11987654321' })).body.id
const holder = { name: 'Maria Souza', email: 'maria@example.com', cpfCnpj: '24971563792', postalCode: '01310100', addressNumber: '100', phone: '11987654321' }
actx.token = (await v3('POST', '/creditCard/tokenizeCreditCard', {
  customer: actx.customer,
  creditCard: { holderName: 'MARIA SOUZA', number: '5162306219378829', expiryMonth: '05', expiryYear: '2030', ccv: '318' },
  creditCardHolderInfo: holder,
  remoteIp: '127.0.0.1',
})).body.creditCardToken
actx.cardPayment = (await v3('POST', '/payments', {
  customer: actx.customer, billingType: 'CREDIT_CARD', value: 350, dueDate: '2026-11-10', creditCardToken: actx.token, remoteIp: '127.0.0.1',
})).body.id
/** A note of a fresh charge, scheduled for today (the clock moves between routes). */
const scheduledNote = async () => {
  const today = (await call(asaasUrl, 'GET', '/_admin/clock')).body.today
  const payment = (await v3('POST', '/payments', { customer: actx.customer, billingType: 'PIX', value: 150, dueDate: '2030-01-10' })).body.id
  return (await v3('POST', '/invoices', {
    payment, serviceDescription: 'Sessão de fisioterapia', observations: '', value: 150, deductions: 0, effectiveDate: today,
    municipalServiceName: '4.08 - Terapia ocupacional, fisioterapia e fonoaudiologia',
    taxes: { retainIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
  })).body.id
}
/** An authorized note whose cancellation is waiting for the city hall. */
const cancellingNote = async () => {
  const id = await scheduledNote()
  await call(asaasUrl, 'POST', `/_mock/invoices/${id}/authorize`, {})
  await v3('POST', `/invoices/${id}/cancel`, {})
  return id
}
// Charges for the /_mock routes are created right before each call: the clock routes
// tick, and a tick would turn an earlier charge overdue on its own.
const pix = async () => (await v3('POST', '/payments', { customer: actx.customer, billingType: 'PIX', value: 89.9, dueDate: '2030-01-10' })).body.id
actx.p1 = await pix()
actx.p2 = await pix()
await v3('POST', '/webhooks', {
  name: 'my-app', url: 'http://localhost:4000/webhooks/asaas', email: 'dev@example.com', enabled: true, interrupted: false,
  apiVersion: 3, sendType: 'SEQUENTIALLY', authToken: 'whsec_local_demo_token_0123456789abcdef', events: ['PAYMENT_CREATED'],
})

const ASAAS = [
  route('Clock and jobs', 'GET', '/_admin/clock', 'Where the clock is and its mode'),
  route('Clock and jobs', 'POST', '/_admin/clock/advance', 'Move the clock forward; every simulated day runs a full tick', {
    body: { days: 1 },
    fields: [f('days', 'integer, 0 to 3650', 'Days to skip'), f('hours', 'integer', 'Hours to skip'), f('minutes', 'integer', 'Minutes to skip'), f('seconds', 'integer', 'Seconds to skip')],
    description: 'Needs CLOCK_MODE=VIRTUAL_FLOWING or VIRTUAL_FROZEN. Answers the new time and one report per tick: the transitions, the charges created and the webhooks delivered.',
    errors: [{ body: { days: -1 }, why: 'A negative or malformed amount.' }],
  }),
  route('Clock and jobs', 'POST', '/_admin/clock/set', 'Jump to a date', {
    body: { date: '2026-12-01' },
    fields: [f('date', 'string, date', 'The day to jump to', true)],
  }),
  route('Clock and jobs', 'POST', '/_admin/tick', 'Run the day\'s jobs without moving the clock'),
  route('Clock and jobs', 'GET', '/_admin/jobs', 'The jobs a tick runs, in order'),
  route('Clock and jobs', 'POST', '/_admin/clock/reset', 'Back to the present; deliveries scheduled in the future are pulled back'),
  route('Payments', 'POST', '/_admin/payments/:id/chargeback', 'Open a chargeback on a paid card charge', {
    call: (c) => `/_admin/payments/${c.cardPayment}/chargeback`,
    body: { reason: 'NOT_RECOGNIZED' },
    params: [p('id', 'path', 'string', 'A card charge, CONFIRMED or RECEIVED', true)],
    fields: [f('reason', 'string', 'The chargeback reason')],
  }),
  route('Simulator', 'GET', '/_admin/summary', 'Totals by status for the dashboard', {
    call: (c) => `/_admin/summary?accountId=${c.accountId}`,
    params: [p('accountId', 'query', 'string', 'The account (profile)')],
  }),
  route('Simulator', 'GET', '/_admin/customers', 'Customers of an account, removed ones on request', {
    call: (c) => `/_admin/customers?accountId=${c.accountId}`,
    params: [p('accountId', 'query', 'string', 'The account (profile)'), p('removed', 'query', 'boolean', 'true lists the removed ones')],
  }),
  route('Simulator', 'GET', '/_admin/coverage', 'Which /v3 operations have a business engine'),
  route('Simulator', 'GET', '/_admin/fees', 'The fee table in force'),
  route('Webhooks', 'GET', '/_admin/webhooks/events', 'Every webhook event name Asaas sends'),
  route('Webhooks', 'GET', '/_admin/webhooks/queue', 'The delivery queue: pending, failing, interrupted'),
  route('Webhooks', 'GET', '/_admin/webhooks/deliveries', 'Every delivery attempt with your endpoint\'s answer, and the events no webhook took (NO_WEBHOOK)', {
    call: (c) => `/_admin/webhooks/deliveries?accountId=${c.accountId}`,
    params: [p('accountId', 'query', 'string', 'Only this account\'s deliveries')],
  }),
  route('Request logs', 'GET', '/_admin/request-logs', 'The account\'s calls to /v3, newest first, without their bodies', {
    call: (c) => `/_admin/request-logs?accountId=${c.accountId}`,
    params: [
      p('accountId', 'query', 'string', 'Only this account\'s calls'),
      p('status', 'query', 'enum: success | error', 'Only 2xx, or only the rest'),
      p('limit', 'query', 'integer', 'How many, newest first (100 by default, 1000 at most)'),
    ],
  }),
  route('Request logs', 'GET', '/_admin/request-logs/:id', 'One call, with the body that went in and the one that came back', {
    before: async (c) => {
      c.requestLog = (await call(asaasUrl, 'GET', `/_admin/request-logs?accountId=${c.accountId}&limit=1`)).body.data[0].id
    },
    call: (c) => `/_admin/request-logs/${c.requestLog}`,
    params: [p('id', 'path', 'integer', 'A call of the list', true)],
    errors: [{ call: () => '/_admin/request-logs/999999', why: 'No call with this id.' }],
  }),
  route('Webhooks', 'POST', '/_admin/webhooks/pause', 'Freeze the dispatcher: events queue up, nothing is delivered'),
  route('Webhooks', 'POST', '/_admin/webhooks/resume', 'Deliver again'),
  route('Cards', 'GET', '/_admin/test-cards', 'The test cards, the accept-any policy, the errors no number triggers'),
  route('Cards', 'PUT', '/_admin/test-cards/policy', 'Accept any well-formed card, or only the listed ones', {
    body: { acceptAny: true },
    fields: [f('acceptAny', 'boolean', 'On: an unlisted number approves. Off: it is refused', true)],
  }),
  route('Cards', 'POST', '/_admin/test-cards', 'Add a card that forces an outcome', {
    body: { outcome: 'DECLINE', label: 'Limite estourado', number: '4000000000009995' },
    fields: [
      f('outcome', 'enum: APPROVE | DECLINE | DECLINE_ON_CHARGE | EXPIRED | INVALID_NUMBER', 'What the card does', true),
      f('number', 'string', 'The number; empty generates one for brand'),
      f('brand', 'string', 'The brand of a generated number'),
      f('label', 'string', 'What the panel shows'),
    ],
  }),
  route('Cards', 'DELETE', '/_admin/test-cards/:number', 'Remove a card added in the panel', {
    call: '/_admin/test-cards/4000000000009995',
    params: [p('number', 'path', 'string', 'The card number', true)],
    errors: [{ call: '/_admin/test-cards/4444444444444444', why: 'A built-in card cannot be removed.' }],
  }),
  route('Cards', 'GET', '/_admin/credit-cards', 'The saved (tokenized) cards and how each answers its next charge'),
  route('Cards', 'PUT', '/_admin/credit-cards/:token', 'Make a saved card approve, decline, or approve N more and then decline', {
    call: (c) => `/_admin/credit-cards/${c.token}`,
    body: { approvalsLeft: 3 },
    params: [p('token', 'path', 'string', 'The creditCardToken', true)],
    fields: [f('outcome', 'enum: APPROVE | DECLINE', 'How every next charge answers'), f('approvalsLeft', 'integer or null', 'Approve this many more charges, then decline; null clears it')],
    errors: [{ call: '/_admin/credit-cards/no-such-token', body: { outcome: 'DECLINE' }, why: 'A token the simulator does not know.' }],
  }),
  route('Cards', 'GET', '/_admin/card-capture/schedule', 'When a recurring card charge is tried'),
  route('Cards', 'PUT', '/_admin/card-capture/schedule', 'Change the retry schedule of recurring card charges', {
    body: { schedule: '0@08:00,0@14:00,0@20:00,1@08:00,1@14:00,1@20:00' },
    fields: [f('schedule', 'string', 'days after the due date @ local time, comma separated; "" is Asaas\'s default', true)],
    errors: [{ body: { schedule: 'soon' }, why: 'A slot that is not <days>@<hour>[:<minute>].' }],
  }),
  route('Payer notifications', 'GET', '/_admin/notifications', 'What was sent to the payer of a charge', {
    call: (c) => `/_admin/notifications?paymentId=${c.p1}`,
    params: [p('paymentId', 'query', 'string', 'One charge'), p('accountId', 'query', 'string', 'Every charge of an account')],
  }),
  route('Payer notifications', 'POST', '/_admin/notifications', 'Send a charge\'s notification again', {
    body: (c) => ({ paymentId: c.p1, event: 'PAYMENT_CREATED', channels: ['EMAIL', 'WHATSAPP'] }),
    fields: [f('paymentId', 'string', 'The charge', true), f('event', 'string', 'The notification, e.g. PAYMENT_CREATED', true), f('channels', 'array of EMAIL | WHATSAPP', 'Where to send', true)],
  }),
  route('Payer notifications', 'GET', '/_admin/notify/status', 'Which channels are on (Mailpit, the WhatsApp mock)'),
  route('Payer notifications', 'GET', '/_admin/notify/arrivals', 'What arrived in Mailpit or the WhatsApp mock', {
    call: '/_admin/notify/arrivals?channel=EMAIL',
    params: [p('channel', 'query', 'enum: EMAIL | WHATSAPP', 'Which inbox')],
  }),
  route('Payer notifications', 'POST', '/_admin/notify/test', 'Send a test message through a channel', {
    body: { channel: 'EMAIL', to: 'dev@example.com' },
    fields: [f('channel', 'enum: EMAIL | WHATSAPP', 'The channel', true), f('to', 'string', 'An e-mail or a phone number', true)],
  }),
  route('Accounts and keys', 'GET', '/_admin/accounts', 'Every account with its balance and a working key'),
  route('Accounts and keys', 'POST', '/_admin/accounts', 'A new root account (profile), without a restart', {
    body: { name: 'Clínica Norte', cpfCnpj: '11222333000181', email: 'norte@example.com' },
    fields: [f('name', 'string', 'The account name', true), f('cpfCnpj', 'string', 'CPF or CNPJ'), f('email', 'string', 'E-mail'), f('apiKey', 'string', 'Pin the key; empty generates one')],
    after: (c, res) => { c.newAccount = res.body.accountId },
  }),
  route('Accounts and keys', 'GET', '/_admin/accounts/:id/keys', 'The API keys of an account', {
    call: (c) => `/_admin/accounts/${c.newAccount}/keys`,
    params: [p('id', 'path', 'string', 'The account', true)],
  }),
  route('Accounts and keys', 'POST', '/_admin/accounts/:id/keys', 'Generate a key', {
    call: (c) => `/_admin/accounts/${c.newAccount}/keys`,
    body: { name: 'ci', expirationDate: null },
    params: [p('id', 'path', 'string', 'The account', true)],
    fields: [f('name', 'string', 'A name for the key'), f('expirationDate', 'string, date-time, or null', 'Expires on the virtual clock'), f('enabled', 'boolean', 'Off refuses the key')],
    after: (c, res) => { c.newKey = res.body.id },
  }),
  route('Accounts and keys', 'POST', '/_admin/accounts/:id/keys/:keyId/rotate', 'Replace a key with a new value', {
    call: (c) => `/_admin/accounts/${c.newAccount}/keys/${c.newKey}/rotate`,
    params: [p('id', 'path', 'string', 'The account', true), p('keyId', 'path', 'string', 'The key', true)],
    after: (c, res) => { c.newKey = res.body.id ?? c.newKey },
  }),
  route('Accounts and keys', 'PUT', '/_admin/accounts/:id/keys/:keyId', 'Rename, expire or disable a key', {
    call: (c) => `/_admin/accounts/${c.newAccount}/keys/${c.newKey}`,
    body: { enabled: false },
    params: [p('id', 'path', 'string', 'The account', true), p('keyId', 'path', 'string', 'The key', true)],
    fields: [f('name', 'string', 'A name for the key'), f('expirationDate', 'string, date-time, or null', 'Expires on the virtual clock'), f('enabled', 'boolean', 'Off refuses the key')],
  }),
  route('Accounts and keys', 'DELETE', '/_admin/accounts/:id/keys/:keyId', 'Remove a key', {
    call: (c) => `/_admin/accounts/${c.newAccount}/keys/${c.newKey}`,
    params: [p('id', 'path', 'string', 'The account', true), p('keyId', 'path', 'string', 'The key', true)],
  }),
  route('Accounts and keys', 'POST', '/_admin/accounts/:id/reset', 'Empty a root account and keep it: same id, same keys', {
    call: (c) => `/_admin/accounts/${c.newAccount}/reset`,
    body: { cancelCharges: true, remove: { charges: true, logs: true } },
    params: [p('id', 'path', 'string', 'The root account', true)],
    fields: [
      f('cancelCharges', 'boolean', 'First remove the open charges and subscriptions through the API path, sending PAYMENT_DELETED and SUBSCRIPTION_DELETED to the webhooks'),
      f('remove', 'object of booleans', 'The groups to delete: customers, subaccounts, charges (with the statement; the balance goes to zero), invoices, webhooks, logs. Customers take charges and invoices along; charges take invoices'),
    ],
    errors: [{ call: (c) => `/_admin/accounts/${c.newAccount}/reset`, body: {}, why: 'Nothing chosen to cancel or delete.' }],
  }),
  route('Accounts and keys', 'DELETE', '/_admin/accounts/:id', 'Delete an account with everything it owns', {
    call: (c) => `/_admin/accounts/${c.newAccount}`,
    params: [p('id', 'path', 'string', 'The account', true)],
    errors: [{ call: '/_admin/accounts/no-such-account', why: 'An account the simulator does not know.' }],
  }),
  route('Payment controls (/_mock)', 'GET', '/_mock/payments', 'Charges of every account, newest first, with no key', {
    call: '/_mock/payments?limit=2',
    params: [p('limit', 'query', 'integer', 'Page size'), p('offset', 'query', 'integer', 'Page start'), p('status', 'query', 'string', 'Only this status')],
  }),
  route('Payment controls (/_mock)', 'POST', '/_mock/payments/:id/confirm', 'Mark a charge paid (CONFIRMED)', {
    call: (c) => `/_mock/payments/${c.p1}/confirm`,
    params: [p('id', 'path', 'string', 'The charge', true)],
    errors: [{ call: '/_mock/payments/pay_000000000000/confirm', why: 'A charge that does not exist.' }],
  }),
  route('Payment controls (/_mock)', 'POST', '/_mock/payments/:id/receive', 'Mark a charge received (money in the balance)', {
    call: (c) => `/_mock/payments/${c.p2}/receive`,
    params: [p('id', 'path', 'string', 'The charge', true)],
  }),
  route('Payment controls (/_mock)', 'POST', '/_mock/payments/:id/overdue', 'Mark a charge overdue', {
    call: (c) => `/_mock/payments/${c.p3}/overdue`,
    params: [p('id', 'path', 'string', 'The charge', true)],
    before: async (c) => { c.p3 = await pix() },
    errors: [{ call: (c) => `/_mock/payments/${c.p1}/overdue`, why: 'A charge already paid cannot go overdue.' }],
  }),
  route('Payment controls (/_mock)', 'POST', '/_mock/payments/:id/fail', 'The same as overdue', {
    before: async (c) => { c.p4 = await pix() },
    call: (c) => `/_mock/payments/${c.p4}/fail`,
    params: [p('id', 'path', 'string', 'The charge', true)],
  }),
  route('Payment controls (/_mock)', 'POST', '/_mock/payments/:id/refund', 'Refund a paid charge, all or part', {
    call: (c) => `/_mock/payments/${c.p2}/refund`,
    body: { value: 10 },
    params: [p('id', 'path', 'string', 'A paid charge', true)],
    fields: [f('value', 'number', 'The amount; empty refunds all')],
  }),
  route('Invoice controls (/_mock)', 'POST', '/_mock/invoices/:id/authorize', 'The city hall authorizes a note now, fiscal information or not', {
    before: async (c) => { c.note = await scheduledNote() },
    call: (c) => `/_mock/invoices/${c.note}/authorize`,
    params: [p('id', 'path', 'string', 'A note SCHEDULED, SYNCHRONIZED or in ERROR', true)],
    errors: [{ call: '/_mock/invoices/inv_000000000000/authorize', why: 'A note the simulator does not know.' }],
  }),
  route('Invoice controls (/_mock)', 'POST', '/_mock/invoices/:id/error', 'The city hall refuses a note, with its reason', {
    before: async (c) => { c.note = await scheduledNote() },
    call: (c) => `/_mock/invoices/${c.note}/error`,
    body: { description: 'Rejeitada pela prefeitura: inscrição municipal não encontrada.' },
    params: [p('id', 'path', 'string', 'A note SCHEDULED or SYNCHRONIZED', true)],
    fields: [f('description', 'string', 'The reason; empty uses a default one')],
  }),
  route('Invoice controls (/_mock)', 'POST', '/_mock/invoices/:id/confirm-cancellation', 'The city hall cancels a note now', {
    before: async (c) => { c.note = await cancellingNote() },
    call: (c) => `/_mock/invoices/${c.note}/confirm-cancellation`,
    params: [p('id', 'path', 'string', 'A note in PROCESSING_CANCELLATION', true)],
    errors: [{ call: (c) => `/_mock/invoices/${c.note}/confirm-cancellation`, why: 'The note is no longer waiting for its cancellation.' }],
  }),
  route('Invoice controls (/_mock)', 'POST', '/_mock/invoices/:id/deny-cancellation', 'The city hall refuses to cancel a note', {
    before: async (c) => { c.note = await cancellingNote() },
    call: (c) => `/_mock/invoices/${c.note}/deny-cancellation`,
    body: { description: 'Cancelamento negado pela prefeitura: prazo de cancelamento expirado.' },
    params: [p('id', 'path', 'string', 'A note in PROCESSING_CANCELLATION', true)],
    fields: [f('description', 'string', 'The reason; empty uses a default one')],
  }),
]
const asaas = await capture(asaasUrl, ASAAS, actx)
write('asaas-admin.json', asaas.groups)
write('asaas-admin-details.json', asaas.details)

// ── WhatsApp: the routes for what Meta has no endpoint for ──
const wctx = {}
const W = [
  route('Delivery', 'GET', '/settings/delivery-mode', 'auto walks sent, delivered, read; manual stops at sent'),
  route('Delivery', 'PUT', '/settings/delivery-mode', 'Set the delivery mode', {
    body: { mode: 'manual' },
    fields: [f('mode', 'enum: auto | manual', 'manual: ticks move only when the user\'s phone gives a receipt', true)],
    errors: [{ body: { mode: 'sometimes' }, why: 'A mode that is not auto or manual.' }],
    after: async () => { await call(whatsappUrl, 'PUT', '/settings/delivery-mode', { mode: 'auto' }) },
  }),
  route('Delivery', 'GET', '/settings/webhook-delay', 'How long the mock waits before it delivers an event'),
  route('Delivery', 'PUT', '/settings/webhook-delay', 'Set the wait', {
    body: { delayMs: 0 },
    fields: [f('delayMs', 'integer, ms', 'The wait before each delivery', true)],
    errors: [{ body: { delayMs: -5 }, why: 'Out of range.' }],
  }),
  route('Webhooks', 'GET', '/settings/webhooks', 'Where events go: the app callback and each number\'s override'),
  route('Webhooks', 'GET', '/settings/events', 'Every call the mock made to a webhook, newest first'),
  route('Webhooks', 'DELETE', '/settings/events', 'Clear the event log'),
  route('Conversations', 'GET', '/settings/conversations', 'Every conversation of every number, both sides, oldest first', {
    before: async () => {
      await call(whatsappUrl, 'POST', '/v23.0/1234567890/messages',
        { messaging_product: 'whatsapp', type: 'text', text: { body: 'Oi! Quero remarcar.' } },
        { authorization: 'Bearer test', 'x-mock-from': '5511987654321', 'x-mock-contact-name': 'Maria Souza' })
    },
  }),
  route('Conversations', 'DELETE', '/settings/conversations', 'Start from zero: every conversation and the event log'),
  route('Accounts', 'GET', '/settings/accounts', 'The tree of businesses, WABAs and numbers, with the code a number waits for'),
  route('Accounts', 'POST', '/settings/accounts/wabas', 'A new WABA (Meta makes it in the embedded signup)', {
    body: { business_id: '100000000000002', name: 'Clínica Norte' },
    fields: [f('business_id', 'string', 'The business', true), f('name', 'string', 'The WABA name', true)],
    errors: [{ body: { business_id: '100000000000002', name: '' }, why: 'A WABA with no name.' }],
  }),
  route('Calls', 'GET', '/settings/calls', 'The calls the mock knows, ringing or ended'),
  route('Templates', 'GET', '/settings/examples', 'The example templates of templates/examples, one per component Meta allows'),
  route('Health', 'GET', '/health', 'Is the mock up'),
]
const whatsapp = await capture(whatsappUrl, W, wctx)
write('whatsapp-settings.json', whatsapp.groups)
write('whatsapp-settings-details.json', whatsapp.details)

const n = (g) => g.flatMap((x) => x.ops).length
console.log(`asaas-admin: ${n(asaas.groups)} routes; whatsapp-settings: ${n(whatsapp.groups)} routes`)
