// Writes the generator's static API for GitHub Pages: every kind, for seeds
// 1 to SEEDS, as the JSON the container answers for the same call. Pages runs
// no code, so each answer is a file, built from the very core the container
// runs (mocks/generator/src/core).
//
//   <out>/index.json                 what is here and how the URLs are made
//   <out>/kinds.json                 = GET /v1/kinds
//   <out>/<kind>/<seed>.json         = GET /v1/<kind>?count=COUNT&seed=<seed>&now=NOW
//   <out>/<kind>/<seed>-formatted.json  the same with formatted=true (kinds that mask)
//
//   <out>/validate/<type>/<digits>.json  = GET /v1/validate/<type>/<digits>, for every
//                                        document the files above hold and the docs' examples
//
// Every answer also has an .html twin holding the same JSON, because Pages
// answers an address without an extension from the .html file of that name:
// /v1/person is seed 1 (<out>/person.html), /v1/person/42 is seed 42
// (<out>/person/42.html), /v1/kinds the list. So the short address is the one
// a person types: curl .../api/v1/person
//
// `now` is fixed, so a file never changes between builds: ages and due dates
// count from NOW.
//
// The Direct Data credit check rides along, one level up (<out>/../): the
// container's synchronous answer for every test CPF on both routes, at the
// provider's own route names:
//
//   <out>/../Score/<cpf>                          = GET /api/Score?CPF=<cpf>&TOKEN=<token>
//   <out>/../BoaVistaAcertaMaisPositivoPF/<cpf>   = GET /api/BoaVistaAcertaMaisPositivoPF?CPF=<cpf>&TOKEN=<token>
//   <out>/../BoaVistaAcertaCompletoPositivoPF/<cpf> = GET /api/BoaVistaAcertaCompletoPositivoPF?CPF=<cpf>&TOKEN=<token>
//   <out>/../DossieCreditoCompleto/<cpf>          = GET /api/DossieCreditoCompleto?CPF=<cpf>&TOKEN=<token>
//   <out>/../directd.json                         the test CPFs, their outcome and the status the container answers
//
// The body is the provider's, byte for byte as the container builds it (the
// envelope with `metaDados` and `retorno`, the 429 body); Pages always answers
// HTTP 200, so the status the container would answer is in directd.json. A
// static file checks no token and runs no async query: those live in the
// container and in the playground's own page.
//
// usage: node scripts/build-generator-api.mjs <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_TEST_CPFS,
  DIRECTD_TOKEN,
  KINDS,
  OUTCOMES,
  ROUTE_BOA_VISTA,
  ROUTE_BOA_VISTA_COMPLETO,
  ROUTE_DOSSIE,
  ROUTE_SCORE,
  answerFor,
  createRng,
  generate,
  isValidCnh,
  isValidCnpj,
  isValidCpf,
  isValidPis,
} from '../mocks/generator/src/core/index.js'

const SEEDS = 100
const COUNT = 10
const NOW = '2026-01-01'
/** The validation route's document types (app.ts, VALIDATORS). */
const VALIDATORS = { cpf: isValidCpf, cnpj: isValidCnpj, cnh: isValidCnh, pis: isValidPis }
/** The documents the site's examples validate, valid or not. */
const EXAMPLES = { cpf: ['11144477735', '11111111111'], cnpj: ['11222333000181'] }
/** The kinds that read `formatted` (masked documents and phones). */
const FORMATTED = new Set(['person', 'company', 'address'])

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/build-generator-api.mjs <out-dir>')
  process.exit(2)
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`
let files = 0
/** The answer as <path>.json and, for the address without an extension, <path>.html. */
const write = (path, value) => {
  writeFileSync(`${path}.json`, json(value))
  writeFileSync(`${path}.html`, json(value))
  files += 2
}

mkdirSync(out, { recursive: true })
write(join(out, 'kinds'), { kinds: KINDS.map(({ id, label }) => ({ id, label })) })

/** Every document the files hold, by type: what the validation route can answer here. */
const documents = { cpf: new Set(EXAMPLES.cpf), cnpj: new Set(EXAMPLES.cnpj), cnh: new Set(), pis: new Set() }
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const collect = (id, item) => {
  if (['cpf', 'cnpj', 'cnh', 'pis'].includes(id)) documents[id].add(digits(item.value))
  if (id === 'person') for (const type of ['cpf', 'cnh', 'pis']) documents[type].add(digits(item[type]))
  if (id === 'company') documents.cnpj.add(digits(item.cnpj))
  if (id === 'pix-key' && (item.type === 'CPF' || item.type === 'CNPJ')) documents[item.type.toLowerCase()].add(digits(item.key))
}

for (const { id } of KINDS) {
  const dir = join(out, id)
  mkdirSync(dir, { recursive: true })
  for (let seed = 1; seed <= SEEDS; seed++) {
    const batch = generate(id, { count: COUNT, seed: String(seed), now: NOW })
    for (const item of batch.items) collect(id, item)
    write(join(dir, String(seed)), batch)
    if (seed === 1) write(join(out, id), batch)
    if (FORMATTED.has(id)) {
      write(join(dir, `${seed}-formatted`), generate(id, { count: COUNT, seed: String(seed), now: NOW, formatted: true }))
    }
  }
}

// The validation answers: what the container's validation route says of each one.
let validated = 0
for (const [type, values] of Object.entries(documents)) {
  const dir = join(out, 'validate', type)
  mkdirSync(dir, { recursive: true })
  for (const value of values) {
    if (!value) continue
    write(join(dir, value), { type, value, valid: VALIDATORS[type](value) })
    validated++
  }
}

write(join(out, 'index'), {
  description: 'Static answers of the ama4devs generator: the same JSON its container gives for the same call.',
  count: COUNT,
  now: NOW,
  seeds: { from: 1, to: SEEDS },
  kinds: KINDS.map(({ id }) => id),
  formatted: [...FORMATTED],
  urls: {
    kinds: 'kinds',
    batch: '<kind>',
    seeded: '<kind>/<seed>',
    formatted: '<kind>/<seed>-formatted',
    validate: 'validate/<cpf|cnpj|cnh|pis>/<digits>: every document the files above hold, and the examples',
    json: 'any of them with .json, served as application/json',
  },
  sameAs: `GET /v1/<kind>?count=${COUNT}&seed=<seed>&now=${NOW}[&formatted=true] on the container`,
})

// The Direct Data credit check: the synchronous answer of every test CPF.
const creditOut = dirname(out)
/** A stable consultaUid per route and CPF, so a file never changes between builds. */
const stableUid = (seed) => {
  const rng = createRng(seed)
  const hex = (n) => Array.from({ length: n }, () => rng.int(0, 15).toString(16)).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[rng.int(0, 3)]}${hex(3)}-${hex(12)}`
}
const creditNow = new Date(`${NOW}T12:00:00-03:00`)
const creditIndex = []
for (const route of [ROUTE_SCORE, ROUTE_BOA_VISTA, ROUTE_BOA_VISTA_COMPLETO, ROUTE_DOSSIE]) {
  mkdirSync(join(creditOut, route), { recursive: true })
  for (const { cpf, outcome } of DEFAULT_TEST_CPFS) {
    const answer = answerFor(route, { CPF: cpf }, { now: creditNow, startedAt: creditNow, uid: stableUid(`directd:${route}:${cpf}`), ip: '127.0.0.1' })
    write(join(creditOut, route, cpf), answer.body)
    if (route === ROUTE_SCORE) {
      creditIndex.push({ cpf, outcome, status: answer.status, summary: OUTCOMES.find((o) => o.id === outcome)?.summary })
    }
  }
}
write(join(creditOut, 'directd'), {
  description: 'Static answers of the Direct Data credit check simulated by the ama4devs generator: the body its container gives, for every test CPF. Pages answers HTTP 200; `status` is what the container answers.',
  token: DIRECTD_TOKEN,
  now: NOW,
  routes: [ROUTE_SCORE, ROUTE_BOA_VISTA, ROUTE_BOA_VISTA_COMPLETO, ROUTE_DOSSIE],
  urls: { answer: '<route>/<cpf>', json: '<route>/<cpf>.json' },
  sameAs: 'GET /api/<route>?CPF=<cpf>&TOKEN=<token> on the container (synchronous; async, the token check and other CPFs live in the container and the playground)',
  cpfs: creditIndex,
})

console.log(`generator api: ${files} files (${validated} validated documents, ${creditIndex.length} credit CPFs) in ${out}`)
