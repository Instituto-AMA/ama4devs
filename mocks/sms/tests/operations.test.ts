import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { OPERATIONS, buildRequest, curlOf, withOverride } from '../src/core/operations.js'
import type { Operation, Request as CatalogRequest } from '../src/core/operations.js'

const ORIGIN = 'http://localhost:8899'

/** A fresh app with counted ids and no timer: a message stays `queued`. */
function makeApp() {
  let counter = 0
  return createApp(loadConfig({}), {
    now: () => new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
    newId: () => `SM${(++counter).toString(16).padStart(32, '0')}`,
    schedule: () => {},
  })
}

/** Sends a catalog request to the app, the way the panel and the site generator do. */
async function send(app: ReturnType<typeof makeApp>, method: string, request: CatalogRequest, messageId: string) {
  const call = buildRequest(method, request, { origin: ORIGIN, messageId })
  const init: RequestInit = { method: call.method, headers: call.headers }
  if (call.body !== undefined) init.body = call.body
  const response = await app.fetch(new Request(call.url, init))
  if (!response) throw new Error('no response')
  return response
}

describe('the operations catalog', () => {
  test('lists the operations with unique ids and unique method and path', () => {
    const ids = OPERATIONS.map((op) => op.id)
    expect(new Set(ids).size).toBe(ids.length)
    const routes = OPERATIONS.map((op) => `${op.method} ${op.path}`)
    expect(new Set(routes).size).toBe(routes.length)
    expect(OPERATIONS.length).toBeGreaterThanOrEqual(17)
  })

  test('every text exists in both languages', () => {
    const missing: string[] = []
    const check = (where: string, text: { pt: string; en: string }) => {
      if (!text.pt.trim() || !text.en.trim()) missing.push(where)
    }
    for (const op of OPERATIONS) {
      check(`${op.id}.tag`, op.tag)
      check(`${op.id}.summary`, op.summary)
      check(`${op.id}.description`, op.description)
      for (const param of op.params ?? []) check(`${op.id}.params.${param.name}`, param.description)
      for (const field of op.fields ?? []) check(`${op.id}.fields.${field.name}`, field.description)
      for (const response of op.responses) check(`${op.id}.responses.${response.status}`, response.description)
    }
    expect(missing).toEqual([])
  })

  test('curlOf prints a runnable command', () => {
    const curl = curlOf('POST', { path: '/v1/messages', json: { to: '+5511912340010', body: "it's ok" } }, { origin: ORIGIN })
    expect(curl).toBe(
      `curl -X POST 'http://localhost:8899/v1/messages' -H 'content-type: application/json' -d '{"to":"+5511912340010","body":"it'\\''s ok"}'`,
    )
  })
})

describe('every documented answer is what the mock answers', () => {
  const runnable = OPERATIONS.filter((op): op is Operation & { request: CatalogRequest } => op.request !== null)

  for (const op of runnable) {
    for (const answer of op.responses) {
      test(`${op.id} → ${answer.status}`, async () => {
        const app = makeApp()
        let messageId = 'SM00000000000000000000000000000000'
        if (op.setup === 'message') {
          const created = await send(app, 'POST', { path: '/v1/messages', json: { to: '+5511912340010', body: 'Seu código é 482913' } }, messageId)
          messageId = ((await created.json()) as { id: string }).id
        }
        const request = withOverride(op.request, answer.request)
        const response = await send(app, op.method, request, messageId)
        expect(String(response.status)).toBe(answer.status)
      })
    }
  }
})

describe('the operations that change the running mock', () => {
  test('the ones the panel asks about before Testar exist in the catalog', () => {
    for (const id of ['mock-reset', 'mock-deliveries-clear', 'mock-settings-put']) {
      expect(OPERATIONS.some((op) => op.id === id)).toBe(true)
    }
  })
})
