// @ts-check
/**
 * The catalog of the routes of the SMS mock: one source for the "API" tab of the
 * panel, for the API pages of the site and for the test that keeps both true.
 * The parts live in `./operations/*.js`; this module assembles them and builds
 * the requests the catalog describes.
 */
import { MOCK_OPERATIONS } from './operations/mock.js'
import { NATIVE_OPERATIONS } from './operations/native.js'
import { TWILIO_OPERATIONS } from './operations/twilio.js'

/** @typedef {{ pt: string, en: string }} Text A text in both languages. */

/**
 * @typedef {object} Param
 * @property {'path' | 'query' | 'header'} in Where the parameter travels.
 * @property {string} name
 * @property {boolean} [required]
 * @property {string} type
 * @property {Text} description
 */

/**
 * @typedef {object} Field
 * @property {string} name
 * @property {boolean} [required]
 * @property {string} type
 * @property {Text} description
 */

/**
 * The request an example sends. `path` may hold `{messageId}`: the id of a
 * message the runner creates first (see `setup`).
 * @typedef {object} Request
 * @property {string} [method] Overrides the method of the operation.
 * @property {string} path Runnable path, without the query string.
 * @property {Record<string, string>} [query]
 * @property {Record<string, string>} [headers]
 * @property {unknown} [json] A JSON body.
 * @property {Record<string, string>} [form] A urlencoded form body.
 * @property {'basic'} [auth] Sends `Authorization: Basic ...` (the mock accepts any).
 */

/**
 * One documented answer. The runner sends `request` (the operation's own, with
 * the overrides applied) and the status it gets must equal `status`.
 * @typedef {object} ResponseCase
 * @property {string} status The HTTP status, as a string ("201").
 * @property {Text} description
 * @property {Partial<Request>} [request] What differs from the operation's request to get this answer.
 */

/**
 * @typedef {object} Operation
 * @property {string} id Unique, kebab-case; the site links to `#op-<id>`.
 * @property {'api' | 'mock'} kind `api`: what an app calls; `mock`: what only a test or the panel calls.
 * @property {Text} tag The group of the list.
 * @property {string} method
 * @property {string} path The path as shown, with `{name}` for the variable parts.
 * @property {Text} summary One line.
 * @property {Text} description A short paragraph.
 * @property {string} [contentType] Of the request body.
 * @property {Param[]} [params]
 * @property {Field[]} [fields] The body fields.
 * @property {Request | null} request The example; null when it cannot be sent with fetch (the WebSocket).
 * @property {'message'} [setup] The runner first creates a message and gives its id as `{messageId}`.
 * @property {ResponseCase[]} responses
 */

/** The account sid every example uses: a fake, the same the mock puts in webhooks. */
export const EXAMPLE_ACCOUNT_SID = 'ACmock00000000000000000000000000'

/** Every operation, in the order the list shows them. @type {Operation[]} */
export const OPERATIONS = [...NATIVE_OPERATIONS, ...TWILIO_OPERATIONS, ...MOCK_OPERATIONS]

/**
 * The tags of the list in order, each with its operations.
 * @param {Operation[]} [operations]
 * @returns {{ tag: Text, kind: 'api' | 'mock', ops: Operation[] }[]}
 */
export function groupOperations(operations = OPERATIONS) {
  /** @type {{ tag: Text, kind: 'api' | 'mock', ops: Operation[] }[]} */
  const groups = []
  for (const op of operations) {
    let group = groups.find((one) => one.tag.en === op.tag.en)
    if (!group) {
      group = { tag: op.tag, kind: op.kind, ops: [] }
      groups.push(group)
    }
    group.ops.push(op)
  }
  return groups
}

/**
 * A request with the overrides of a response case applied.
 * @param {Request} request
 * @param {Partial<Request>} [override]
 * @returns {Request}
 */
export function withOverride(request, override) {
  if (!override) return request
  /** @type {Request} */
  const merged = { ...request, ...override }
  // A case that sends another kind of body drops the one the base request carried.
  if (override.json !== undefined || override.form !== undefined) {
    if (override.json === undefined) delete merged.json
    if (override.form === undefined) delete merged.form
  }
  return merged
}

/**
 * Fills `{messageId}` in a path.
 * @param {string} path
 * @param {string} messageId
 */
export function resolvePath(path, messageId) {
  return path.replaceAll('{messageId}', messageId)
}

/**
 * The call a request stands for: method, absolute URL, headers and body.
 * @param {string} method The method of the operation.
 * @param {Request} request
 * @param {{ origin: string, messageId?: string }} where
 * @returns {{ method: string, url: string, headers: Record<string, string>, body: string | undefined }}
 */
export function buildRequest(method, request, where) {
  const url = new URL(where.origin + resolvePath(request.path, where.messageId ?? 'SM00000000000000000000000000000000'))
  for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value)
  /** @type {Record<string, string>} */
  const headers = { ...(request.headers ?? {}) }
  /** @type {string | undefined} */
  let body
  if (request.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(request.json)
  } else if (request.form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(request.form).toString()
  }
  if (request.auth === 'basic') headers['authorization'] = `Basic ${btoa(`${EXAMPLE_ACCOUNT_SID}:mocktoken`)}`
  return { method: (request.method ?? method).toUpperCase(), url: url.toString(), headers, body }
}

/**
 * The `curl` command of a request, ready to paste in a terminal.
 * @param {string} method The method of the operation.
 * @param {Request} request
 * @param {{ origin: string, messageId?: string }} where
 */
export function curlOf(method, request, where) {
  const call = buildRequest(method, request, where)
  const quote = (/** @type {string} */ text) => `'${text.replaceAll("'", "'\\''")}'`
  const parts = ['curl']
  if (call.method !== 'GET') parts.push('-X', call.method)
  parts.push(quote(call.url))
  if (request.auth === 'basic') parts.push('-u', `${EXAMPLE_ACCOUNT_SID}:mocktoken`)
  for (const [name, value] of Object.entries(call.headers)) {
    if (name === 'authorization') continue
    parts.push('-H', quote(`${name}: ${value}`))
  }
  if (request.json !== undefined) parts.push('-d', quote(JSON.stringify(request.json)))
  else if (request.form !== undefined) {
    for (const [name, value] of Object.entries(request.form)) parts.push('-d', quote(`${name}=${value}`))
  }
  return parts.join(' ')
}
