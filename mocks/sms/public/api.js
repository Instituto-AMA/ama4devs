// @ts-check
/**
 * The client of the panel: a thin JSON client for the routes the panel uses
 * and the socket that keeps the view in sync with the store of the mock.
 */

/**
 * One JSON request to the mock: the body goes as JSON, the answer comes back
 * as JSON, and a status that is not ok throws with the message of the server.
 * @param {string} method The HTTP method.
 * @param {string} path The path, relative to the origin of the panel.
 * @param {unknown} [body] The body, when the request carries one.
 * @returns {Promise<any>} The parsed answer, or null when the answer is empty.
 */
export async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return null

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = /** @type {any} */ (data)
    throw new Error(String(detail?.error?.message ?? detail?.message ?? `HTTP ${response.status}`))
  }
  return data
}

/**
 * The routes of the mock the panel uses: the app sending a message, the
 * handset answering, the statuses set by hand, the settings and the demo.
 */
export const api = {
  /**
   * Sends a message the way an application would.
   * @param {{ to: string, body: string, from?: string }} input
   */
  send: ({ to, body, from }) => request('POST', '/v1/messages', { to, body, ...(from ? { from } : {}) }),

  /**
   * Delivers a message the way the handset would.
   * @param {{ from: string, to?: string, body: string }} input
   */
  inbound: ({ from, to, body }) => request('POST', '/_mock/sms/inbound', { from, ...(to ? { to } : {}), body }),

  /**
   * Moves a message to another status by hand.
   * @param {string} id The id of the message.
   * @param {string} status The status to set.
   * @param {number} [errorCode] The error code, when the status carries one.
   */
  setStatus: (id, status, errorCode) =>
    request('POST', `/_mock/sms/messages/${id}/status`, { status, ...(errorCode ? { errorCode } : {}) }),

  /**
   * Deletes a message.
   * @param {string} id The id of the message.
   */
  remove: (id) => request('DELETE', `/v1/messages/${id}`),

  /**
   * Reads the settings of the mock.
   */
  settings: () => request('GET', '/_mock/sms/settings'),

  /**
   * Changes the settings of the mock.
   * @param {Record<string, unknown>} patch The fields to change.
   */
  putSettings: (patch) => request('PUT', '/_mock/sms/settings', patch),

  /**
   * Empties the store of the mock.
   */
  reset: () => request('POST', '/_mock/sms/reset'),

  /**
   * Seeds a sample inbox.
   */
  demo: () => request('POST', '/_mock/sms/demo'),

  /**
   * Clears the webhook deliveries.
   */
  clearDeliveries: () => request('DELETE', '/_mock/sms/webhooks/deliveries'),
}

/**
 * The wait between the reconnects: half a second, a second, two, four and
 * five seconds at most.
 */
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 5000]

/**
 * The live socket of the panel: it opens the WebSocket the mock serves on
 * `/ws`, hands every frame to `onEvent`, tells `onState` how the connection
 * stands and reconnects itself with a backoff when the socket closes.
 * @param {{
 *   onEvent: (event: any) => void,
 *   onState: (state: 'connecting' | 'open' | 'closed') => void,
 * }} handlers The callbacks of the panel.
 * @returns {{ close: () => void }} The handle that stops the socket.
 */
export function connect({ onEvent, onState }) {
  const url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws'

  let socket = /** @type {WebSocket | null} */ (null)
  let timer = /** @type {ReturnType<typeof setTimeout> | null} */ (null)
  let attempt = 0
  let closed = false

  const open = () => {
    if (closed) return
    onState('connecting')

    const current = new WebSocket(url)
    socket = current

    current.onopen = () => {
      attempt = 0
      onState('open')
    }

    current.onmessage = (event) => {
      /** @type {unknown} */
      let frame
      try {
        frame = JSON.parse(String(event.data))
      } catch {
        return
      }
      onEvent(frame)
    }

    current.onclose = () => {
      if (closed) return
      onState('closed')
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)] ?? 500
      attempt += 1
      timer = setTimeout(open, delay)
    }

    current.onerror = () => {
      current.close()
    }
  }

  open()

  return {
    close() {
      closed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (socket) socket.close()
    },
  }
}
