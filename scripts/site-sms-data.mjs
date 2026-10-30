#!/usr/bin/env bun
// Writes the API reference data of the SMS mock for the Pages site (site/data/),
// from the catalog in mocks/sms/src/core/operations.js — the same source the
// panel's "API" tab and the tests read — so the pages list exactly what the mock
// answers. Nothing here is typed by hand.
//
//   sms-api.json / sms-api-pt.json      the list of what an app calls:
//                                       [{ tag, ops: [{ id, method, path, summary, live }] }]
//   sms-api-details.json / -pt-         what a row opens to, loaded on the first click:
//                                       { [id]: { description, contentType, params, fields,
//                                                 examples, responses } }
//   sms-mock.json / sms-mock-pt.json    the same for the mock's own routes (kind "mock":
//                                       what only a test or the panel calls) and their
//   (+ the "-details" siblings)         "-details" siblings.
//
// Every response example is captured from a real run: each documented answer is replayed
// against a fresh in-process app (clock, ids and timers injected, as the tests do), and the
// script fails when the app answers anything but the documented status. The capture happens
// once; both languages carry the same values.
//
// usage: bun scripts/site-sms-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApp } from '../mocks/sms/src/app.ts'
import { loadConfig } from '../mocks/sms/src/config.ts'
import {
  OPERATIONS,
  buildRequest,
  curlOf,
  groupOperations,
  withOverride,
} from '../mocks/sms/src/core/operations.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'http://localhost:8899'
const out = join(root, 'site', 'data')
mkdirSync(out, { recursive: true })

/** The instant the captured clock starts at; it moves one second per call. */
const START = Date.UTC(2026, 9, 29, 12, 0, 0)

/** The id a path's `{messageId}` carries until a replay creates the real one. */
const PLACEHOLDER_ID = 'SM00000000000000000000000000000000'

/** A fresh app with counted ids, a stepping clock and no timer, as the tests build it. */
function makeApp() {
  let counter = 0
  let ticks = 0
  return createApp(loadConfig({}), {
    now: () => new Date(START + ticks++ * 1000),
    newId: () => `SM${(++counter).toString(16).padStart(32, '0')}`,
    schedule: () => {},
  })
}

/** Sends a catalog request to the app, the way the panel and the tests do. */
async function send(app, method, request, messageId) {
  const call = buildRequest(method, request, { origin: ORIGIN, messageId })
  const init = { method: call.method, headers: call.headers }
  if (call.body !== undefined) init.body = call.body
  const response = await app.fetch(new Request(call.url, init))
  if (!response) throw new Error('no response')
  return response
}

/** The body as the page prints it: the JSON the app answered, null for 204 or empty. */
async function bodyOf(response) {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text.trim()) return null
  return JSON.parse(text)
}

// ── The capture: every documented answer, replayed once, shared by both languages ──

const version = JSON.parse(readFileSync(join(root, 'mocks/sms/package.json'), 'utf8')).version

/** The first frame the WebSocket answers with, built from the real default settings. */
const snapshot = {
  type: 'snapshot',
  messages: [],
  settings: loadConfig({}).settings,
  deliveries: [],
  version,
}

/** The example of each response, by operation id, in the order the responses are documented. */
const captured = new Map()

for (const op of OPERATIONS) {
  const examples = []
  if (op.request === null) {
    // The WebSocket has no request to send: its documented answer is the snapshot.
    for (const _ of op.responses) examples.push(snapshot)
  } else {
    for (const answer of op.responses) {
      const app = makeApp()
      let messageId = PLACEHOLDER_ID
      if (op.setup === 'message') {
        const created = await send(app, 'POST', { path: '/v1/messages', json: { to: '+5511912340010', body: 'Seu código é 482913' } }, messageId)
        messageId = (await created.json()).id
      }
      const response = await send(app, op.method, withOverride(op.request, answer.request), messageId)
      if (String(response.status) !== answer.status) {
        console.error(`sms: ${op.id} answered ${response.status}, the catalog documents ${answer.status}`)
        process.exit(1)
      }
      examples.push(await bodyOf(response))
    }
  }
  captured.set(op.id, examples)
}

// ── The files: one pair per kind, one per language, same captured examples ──

const write = (name, data) => {
  // The page prints descriptions as plain text: the catalog's `code` marks go.
const plain = (key, value) => (key === 'description' || key === 'summary') && typeof value === 'string' ? value.replaceAll('`', '') : value
writeFileSync(join(out, name), `${JSON.stringify(data, plain)}\n`)
  console.log(`sms: wrote site/data/${name}`)
}

/** The list of one kind in one language: the catalog's groups with the text of the language. */
function listOf(kind, lang) {
  return groupOperations(OPERATIONS.filter((op) => op.kind === kind)).map((group) => ({
    tag: group.tag[lang],
    ops: group.ops.map((op) => ({ id: op.id, method: op.method, path: op.path, summary: op.summary[lang], live: true })),
  }))
}

/** The examples of a request: the body the catalog carries, then the curl that sends it. */
function examplesOf(op) {
  if (op.request === null) return []
  const examples = []
  if (op.request.json !== undefined) examples.push({ name: op.id, value: op.request.json })
  else if (op.request.form !== undefined) examples.push({ name: op.id, value: op.request.form })
  examples.push({ name: 'curl', value: curlOf(op.method, op.request, { origin: ORIGIN }) })
  return examples
}

/** What a row opens to, in one language, keyed by operation id. */
function detailsOf(kind, lang) {
  const details = {}
  for (const op of OPERATIONS.filter((one) => one.kind === kind)) {
    details[op.id] = {
      description: op.description[lang],
      contentType: op.contentType ?? null,
      params: (op.params ?? []).map((p) => ({ in: p.in, name: p.name, required: !!p.required, type: p.type, description: p.description[lang] })),
      fields: (op.fields ?? []).map((f) => ({ name: f.name, required: !!f.required, type: f.type, description: f.description[lang] })),
      examples: examplesOf(op),
      responses: op.responses.map((r, i) => ({ status: r.status, description: r.description[lang], example: captured.get(op.id)[i] })),
    }
  }
  return details
}

for (const kind of ['api', 'mock']) {
  const stem = kind === 'api' ? 'sms-api' : 'sms-mock'
  write(`${stem}.json`, listOf(kind, 'en'))
  write(`${stem}-pt.json`, listOf(kind, 'pt'))
  write(`${stem}-details.json`, detailsOf(kind, 'en'))
  write(`${stem}-pt-details.json`, detailsOf(kind, 'pt'))
}
