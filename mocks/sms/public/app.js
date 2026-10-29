// @ts-check
/**
 * The panel of the SMS mock: it draws the conversations, the thread, the
 * composer and the inspector out of the state, and wires every control of
 * `index.html` to the routes of the mock.
 *
 * The script is a browser ES module: no build step, no bundler, no npm.
 * The helpers of the mock live in `./core/`, served by the mock itself.
 */

import { api, connect } from './api.js'
import { conversations, createState, thread } from './state.js'
import { analyze } from './core/segments.js'
import { formatPhone, isAlphaSender, normalizePhone } from './core/phone.js'
import { extractCodes } from './core/otp.js'

/**
 * @typedef {import('./state.js').State} State
 * @typedef {import('./state.js').Conversation} Conversation
 * @typedef {import('../src/types.ts').Delivery} Delivery
 * @typedef {import('../src/types.ts').Message} Message
 */

/** The pt-BR label of every status a message can be in. */
const STATUS_LABELS = {
  queued: 'Na fila',
  sent: 'Enviada',
  delivered: 'Entregue',
  undelivered: 'Não entregue',
  failed: 'Falhou',
  received: 'Recebida',
}

/** The pt-BR label of the state of the socket. */
const CONNECTION_LABELS = {
  connecting: 'Conectando…',
  open: 'Ao vivo',
  closed: 'Reconectando…',
}

/** The themes the button cycles through, in order. */
const THEMES = /** @type {const} */ (['system', 'light', 'dark'])

/** Where the panel remembers the theme the user chose. */
const THEME_KEY = 'sms-theme'

/** How long a toast stays on the screen, and how long an error stays. */
const TOAST_MS = 2600
const TOAST_ERROR_MS = 4000

/** The number of the magic numbers, and what each one stages. */
const MAGIC_NUMBERS = [
  ['…0001', 'falha na entrega'],
  ['…0002', 'não entregue'],
  ['…0003', 'recusado pela API'],
  ['…0004', 'fica em "enviada"'],
  ['…0005', 'filtrado pela operadora'],
]

// ───────── DOM Elements ─────────

/**
 * The element of the page with this id: the panel stops when one is missing.
 * @param {string} id The id of the element.
 * @returns {HTMLElement}
 */
function byId(id) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`elemento ausente: #${id}`)
  return element
}

/**
 * The first element of the page with this class, inside a root.
 * @param {ParentNode} root Where to look for it.
 * @param {string} selector The class of the element.
 * @returns {HTMLElement}
 */
function byClass(root, selector) {
  const element = root.querySelector(selector)
  if (!element) throw new Error(`elemento ausente: ${selector}`)
  return /** @type {HTMLElement} */ (element)
}

const layout = byClass(document, '.layout')
const threadHeader = byId('thread-header')

const el = {
  conn: byId('conn'),
  count: byId('count'),
  list: byId('conversation-list'),
  threadTitle: byClass(threadHeader, '.thread-title'),
  threadSub: byClass(threadHeader, '.thread-sub'),
  thread: byId('thread'),
  composer: /** @type {HTMLFormElement} */ (byId('composer')),
  composerInput: /** @type {HTMLTextAreaElement} */ (byId('composer-input')),
  composerMeta: byId('composer-meta'),
  composerSend: /** @type {HTMLButtonElement} */ (byId('composer-send')),
  inspector: byId('inspector'),
  inspectorBody: byId('inspector-body'),
  tabs: /** @type {HTMLButtonElement[]} */ (Array.from(document.querySelectorAll('.tab'))),
  search: /** @type {HTMLInputElement} */ (byId('search')),
  btnNew: /** @type {HTMLButtonElement} */ (byId('btn-new')),
  btnDemo: /** @type {HTMLButtonElement} */ (byId('btn-demo')),
  btnInspector: /** @type {HTMLButtonElement} */ (byId('btn-inspector')),
  btnSettings: /** @type {HTMLButtonElement} */ (byId('btn-settings')),
  btnTheme: /** @type {HTMLButtonElement} */ (byId('btn-theme')),
  btnBack: /** @type {HTMLButtonElement} */ (byId('btn-back')),
  dlgNew: /** @type {HTMLDialogElement} */ (byId('dlg-new')),
  newTo: /** @type {HTMLInputElement} */ (byId('new-to')),
  newFrom: /** @type {HTMLInputElement} */ (byId('new-from')),
  newBody: /** @type {HTMLTextAreaElement} */ (byId('new-body')),
  newMeta: byId('new-meta'),
  newSubmit: /** @type {HTMLButtonElement} */ (byId('new-submit')),
  dlgSettings: /** @type {HTMLDialogElement} */ (byId('dlg-settings')),
  setDelay: /** @type {HTMLInputElement} */ (byId('set-delay')),
  setAuto: /** @type {HTMLInputElement} */ (byId('set-auto')),
  setWebhookUrl: /** @type {HTMLInputElement} */ (byId('set-webhook-url')),
  setWebhookSecret: /** @type {HTMLInputElement} */ (byId('set-webhook-secret')),
  setDefaultFrom: /** @type {HTMLInputElement} */ (byId('set-default-from')),
  setSubmit: /** @type {HTMLButtonElement} */ (byId('set-submit')),
  btnReset: /** @type {HTMLButtonElement} */ (byId('btn-reset')),
  toasts: byId('toasts'),
}

// ───────── Small helpers ─────────

/**
 * Builds an element with its attributes and children, without ever touching
 * `innerHTML`: every text that reaches the page goes through a text node.
 * @param {string} tag The name of the tag.
 * @param {Record<string, unknown>} [attrs] The attributes of the element.
 * @param {...unknown} children The children of the element.
 * @returns {HTMLElement}
 */
function h(tag, attrs, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') element.className = String(value)
    else if (key === 'style') element.setAttribute('style', String(value))
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2), /** @type {EventListener} */ (value))
    } else if (value === true) element.setAttribute(key, '')
    else element.setAttribute(key, String(value))
  }
  append(element, children)
  return element
}

/**
 * Appends children to an element: strings and numbers become text nodes.
 * @param {HTMLElement} element The element that receives the children.
 * @param {unknown[]} children The children to append.
 */
function append(element, children) {
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue
    if (typeof child === 'string' || typeof child === 'number') {
      element.append(document.createTextNode(String(child)))
    } else {
      element.append(/** @type {Node} */ (child))
    }
  }
}

/**
 * A date with two digits.
 * @param {number} value The number to pad.
 * @returns {string}
 */
function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * Whether two dates fall on the same day.
 * @param {Date} one
 * @param {Date} other
 * @returns {boolean}
 */
function sameDay(one, other) {
  return (
    one.getFullYear() === other.getFullYear() &&
    one.getMonth() === other.getMonth() &&
    one.getDate() === other.getDate()
  )
}

/**
 * The key of the day of a date: two dates with the same key are the same day.
 * @param {Date} date
 * @returns {string}
 */
function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * The label of the day of a message: today, yesterday or the date.
 * @param {string} iso The moment of the message.
 * @returns {string}
 */
function dayLabel(iso) {
  const date = new Date(iso)
  const today = new Date()
  if (sameDay(date, today)) return 'Hoje'
  const yesterday = new Date(today.getTime() - 86400000)
  if (sameDay(date, yesterday)) return 'Ontem'
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

/**
 * The label of the moment of a message: the hour of today or the date.
 * @param {string} iso The moment of the message.
 * @returns {string}
 */
function timeLabel(iso) {
  const date = new Date(iso)
  if (sameDay(date, new Date())) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}

/**
 * The hue of the avatar of a conversation: the same number always gets the
 * same color.
 * @param {string} text The number of the conversation.
 * @returns {number}
 */
function hueOf(text) {
  let hash = 0
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 31 + text.charCodeAt(index)) % 1000003
  }
  return hash % 360
}

/**
 * The text of the avatar of a conversation: the last two digits of the
 * number, or the first letter of an alphanumeric sender.
 * @param {string} number The number of the conversation.
 * @returns {string}
 */
function avatarText(number) {
  if (isAlphaSender(number)) return number.trim().slice(0, 1).toUpperCase()
  return number.replace(/\D/g, '').slice(-2)
}

/**
 * A JSON body as the panel shows it: indented, or as it came when it is not
 * JSON at all.
 * @param {string} text The body of the request.
 * @returns {string}
 */
function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return String(text)
  }
}

/**
 * The centered empty state of the panel.
 * @param {string} title The title of the state.
 * @param {string} hint The hint under the title.
 * @returns {HTMLElement}
 */
function emptyBlock(title, hint) {
  return h('div', { class: 'empty' }, h('h3', {}, title), h('p', {}, hint))
}

/**
 * Refreshes the labels of time: they go stale as the minutes pass.
 */
function refreshTimes() {
  for (const node of document.querySelectorAll('time[datetime]')) {
    const at = node.getAttribute('datetime')
    if (at) node.textContent = timeLabel(at)
  }
  for (const node of document.querySelectorAll('[data-day]')) {
    const at = node.getAttribute('data-day')
    if (at) node.textContent = dayLabel(at)
  }
}

// ───────── State ─────────

const state = createState()

/** The conversation the thread is showing, to know when it changes. */
let lastConversation = null

// ───────── Theme ─────────

/**
 * Reads the theme the user chose, when the browser lets the panel remember it.
 * @returns {'system' | 'light' | 'dark'}
 */
function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // The browser keeps the theme to itself: the system one is the fallback.
  }
  return 'system'
}

/**
 * Writes the theme the user chose, when the browser lets the panel remember it.
 * @param {'system' | 'light' | 'dark'} theme The theme to remember.
 */
function writeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Nothing to do: the theme still applies to this page.
  }
}

/**
 * Applies the theme to the page: the system one takes the attribute off.
 * @param {'system' | 'light' | 'dark'} theme The theme to apply.
 */
function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

// ───────── Toasts ─────────

/**
 * Shows a message on the corner of the screen.
 * @param {string} message The text of the toast.
 * @param {boolean} [isError] True when the toast reports a failure.
 */
function toast(message, isError = false) {
  const node = h('div', { class: isError ? 'toast toast--error' : 'toast' }, message)
  el.toasts.append(node)
  setTimeout(() => node.remove(), isError ? TOAST_ERROR_MS : TOAST_MS)
}

// ───────── Rendering ─────────

/**
 * Draws the whole panel out of the state.
 * @param {State} view The state to draw.
 */
function render(view) {
  const list = conversations(view)

  // A conversation nobody picked yet: the panel opens the newest one.
  if (view.selected === null && list.length > 0) {
    state.set({ selected: list[0].number })
    return
  }

  applyTheme(view.theme)

  el.conn.dataset.state = view.connection
  el.conn.textContent = CONNECTION_LABELS[view.connection] ?? CONNECTION_LABELS.connecting

  renderConversations(view, list)
  renderThread(view)
  renderComposer(view)
  renderInspector(view)

  if (view.selected === null) layout.classList.remove('is-thread')
}

/**
 * Draws the list of conversations.
 * @param {State} view The state to draw.
 * @param {Conversation[]} list The conversations of the sidebar.
 */
function renderConversations(view, list) {
  el.count.textContent = String(list.length)

  const scrollTop = el.list.scrollTop
  const fragment = document.createDocumentFragment()

  if (list.length === 0) {
    fragment.append(emptyBlock('Nenhum SMS ainda', 'Envie pela API ou toque em Exemplos.'))
  } else {
    for (const conversation of list) fragment.append(conversationRow(view, conversation))
  }

  el.list.replaceChildren(fragment)
  el.list.scrollTop = scrollTop
}

/**
 * Draws one row of the list of conversations.
 * @param {State} view The state to draw.
 * @param {Conversation} conversation The conversation of the row.
 * @returns {HTMLElement}
 */
function conversationRow(view, conversation) {
  const { number, last, unread } = conversation
  const classes = ['conv']
  if (number === view.selected) classes.push('is-active')
  if (unread > 0) classes.push('has-unread')

  const button = h('button', { class: classes.join(' '), type: 'button' })

  button.append(
    h('span', { class: 'conv-avatar', style: `--hue:${hueOf(number)}` }, avatarText(number)),
    h(
      'span',
      { class: 'conv-main' },
      h('span', { class: 'conv-title' }, formatPhone(number)),
      h(
        'span',
        { class: 'conv-snippet' },
        last.direction === 'inbound' ? `Você: ${last.body}` : last.body,
      ),
    ),
  )

  const meta = h(
    'span',
    { class: 'conv-meta' },
    h('time', { class: 'conv-time', datetime: last.createdAt }, timeLabel(last.createdAt)),
  )
  if (unread > 0) meta.append(h('span', { class: 'conv-badge' }, String(unread)))
  button.append(meta)

  button.addEventListener('click', () => {
    state.set({ selected: number, selectedMessageId: null })
    layout.classList.add('is-thread')
  })

  return button
}

/**
 * Draws the thread of the conversation on screen.
 * @param {State} view The state to draw.
 */
function renderThread(view) {
  const messages = view.selected === null ? [] : thread(view, view.selected)

  if (view.selected === null) {
    el.threadTitle.textContent = 'Selecione uma conversa'
    el.threadSub.textContent = ''
  } else {
    el.threadTitle.textContent = formatPhone(view.selected)
    el.threadSub.textContent = `${messages.length} ${
      messages.length === 1 ? 'mensagem' : 'mensagens'
    } · celular simulado`
  }

  const scrollTop = el.thread.scrollTop
  const atBottom = el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 40
  const changed = lastConversation !== view.selected

  const fragment = document.createDocumentFragment()
  if (messages.length === 0) {
    fragment.append(
      view.selected === null
        ? emptyBlock('Selecione uma conversa', 'Escolha uma conversa na lista para ver as mensagens.')
        : emptyBlock('Nenhuma mensagem', 'Envie um SMS para começar a conversa.'),
    )
  } else {
    let lastDay = ''
    for (const message of messages) {
      const day = dayKey(new Date(message.createdAt))
      if (day !== lastDay) {
        lastDay = day
        fragment.append(
          h('div', { class: 'day-sep', 'data-day': message.createdAt }, dayLabel(message.createdAt)),
        )
      }
      fragment.append(bubble(view, message))
    }
  }

  el.thread.replaceChildren(fragment)

  if (atBottom || changed) el.thread.scrollTop = el.thread.scrollHeight
  else el.thread.scrollTop = scrollTop

  lastConversation = view.selected
}

/**
 * Draws one message of the thread.
 * @param {State} view The state to draw.
 * @param {Message} message The message to draw.
 * @returns {HTMLElement}
 */
function bubble(view, message) {
  const outbound = message.direction === 'outbound'
  const selected = view.selectedMessageId === message.id

  const node = h('div', {
    class: `bubble ${outbound ? 'bubble--in' : 'bubble--out'}`,
    'data-id': message.id,
    role: 'button',
    tabindex: '0',
    'aria-current': selected ? 'true' : 'false',
  })

  if (selected) {
    node.style.outline = '2px solid var(--accent)'
    node.style.outlineOffset = '2px'
  }

  node.append(h('span', { class: 'bubble-from' }, message.from))
  node.append(h('span', { class: 'bubble-body' }, message.body))

  if (message.codes.length > 0) {
    const chips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px' })
    for (const code of message.codes) chips.append(otpChip(code))
    node.append(chips)
  }

  const meta = h('div', { class: 'bubble-meta' })
  meta.append(h('time', { datetime: message.createdAt }, timeLabel(message.createdAt)))
  if (message.segments > 0) {
    meta.append(h('span', { class: 'seg-badge' }, `${message.segments} SMS · ${message.encoding}`))
  }

  const status = outbound ? (STATUS_LABELS[message.status] ?? message.status) : 'Enviada pelo celular'
  const withError =
    (message.status === 'failed' || message.status === 'undelivered') && message.errorCode !== null
  meta.append(
    h(
      'span',
      { class: 'status', 'data-status': message.status },
      withError ? `${status} · erro ${message.errorCode}` : status,
    ),
  )
  node.append(meta)

  if (outbound) node.append(messageActions(message))

  const select = (event) => {
    event.stopPropagation()
    state.set({ selectedMessageId: message.id })
  }

  node.addEventListener('click', select)
  node.addEventListener('keydown', (event) => {
    if (event.target !== node) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    select(event)
  })

  return node
}

/**
 * The buttons that move a message by hand.
 * @param {Message} message The message of the buttons.
 * @returns {HTMLElement}
 */
function messageActions(message) {
  const actions = h('div', { class: 'msg-actions' })

  const add = (action, label, handler) => {
    const button = h('button', { class: 'btn small', type: 'button', 'data-action': action }, label)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      handler()
    })
    actions.append(button)
  }

  if (message.status === 'queued' || message.status === 'sent') {
    add('deliver', 'Entregar', () => setStatus(message.id, 'delivered'))
    add('fail', 'Falhar', () => setStatus(message.id, 'failed', 30003))
    add('undeliver', 'Não entregue', () => setStatus(message.id, 'undelivered', 30005))
  }

  add('delete', 'Apagar', () => removeMessage(message.id))

  return actions
}

/**
 * The button that copies an OTP code.
 * @param {string} code The code to copy.
 * @returns {HTMLElement}
 */
function otpChip(code) {
  const chip = h('button', { class: 'chip chip--otp', type: 'button', 'data-code': code }, code)
  chip.addEventListener('click', (event) => {
    event.stopPropagation()
    copyCode(code)
  })
  return chip
}

/**
 * Copies a code to the clipboard of the user.
 * @param {string} code The code to copy.
 */
function copyCode(code) {
  try {
    const clipboard = navigator.clipboard
    if (!clipboard) throw new Error('sem área de transferência')
    void clipboard.writeText(code).then(
      () => toast('Código copiado'),
      () => toast('Não foi possível copiar o código', true),
    )
  } catch {
    toast('Não foi possível copiar o código', true)
  }
}

/**
 * Moves a message to another status.
 * @param {string} id The id of the message.
 * @param {string} status The status to set.
 * @param {number} [errorCode] The error code, when the status carries one.
 */
function setStatus(id, status, errorCode) {
  api.setStatus(id, status, errorCode).catch((error) => toast(String(error.message), true))
}

/**
 * Deletes a message.
 * @param {string} id The id of the message.
 */
function removeMessage(id) {
  api.remove(id).catch((error) => toast(String(error.message), true))
}

/**
 * Draws the composer: the counter of the message and the state of the button.
 * @param {State} view The state to draw.
 */
function renderComposer(view) {
  const enabled = view.selected !== null
  el.composerInput.disabled = !enabled
  el.composerSend.disabled = !enabled
  el.composerInput.placeholder = enabled ? 'Responder como o celular…' : 'Selecione uma conversa'
  updateCounter(el.composerMeta, el.composerInput.value)
}

/**
 * The live counter of a text box: the length, the room of one segment and the
 * number of SMS the text costs.
 * @param {HTMLElement} target The element that shows the counter.
 * @param {string} text The text being written.
 */
function updateCounter(target, text) {
  if (text === '') {
    target.textContent = ''
    delete target.dataset.segments
    return
  }
  const info = analyze(text)
  target.textContent = `${info.length}/${info.perSegment} · ${info.encoding} · ${info.segments} SMS`
  target.dataset.segments = String(info.segments)
}

/**
 * Grows the text box with the text, up to the room the panel gives it.
 * @param {HTMLTextAreaElement} textarea The box that grows.
 */
function autoGrow(textarea) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
}

/**
 * Draws the inspector: the tab on top and the body under it.
 * @param {State} view The state to draw.
 */
function renderInspector(view) {
  for (const tab of el.tabs) {
    tab.setAttribute('aria-selected', tab.dataset.tab === view.tab ? 'true' : 'false')
  }

  const fragment = document.createDocumentFragment()
  if (view.tab === 'webhooks') fragment.append(webhooksTab(view))
  else if (view.tab === 'guide') fragment.append(guideTab(view))
  else fragment.append(jsonTab(view))

  el.inspectorBody.replaceChildren(fragment)
}

/**
 * The tab of the inspector that shows the message and its history.
 * @param {State} view The state to draw.
 * @returns {DocumentFragment}
 */
function jsonTab(view) {
  const fragment = document.createDocumentFragment()
  const messages = view.selected === null ? [] : thread(view, view.selected)
  const message = findMessage(messages, view.selectedMessageId)

  if (!message) {
    fragment.append(emptyBlock('Nenhuma mensagem', 'Selecione uma conversa para ver o JSON da mensagem.'))
    return fragment
  }

  const kv = h('div', { class: 'kv' })
  const rows = [
    ['ID', message.id],
    ['Status', STATUS_LABELS[message.status] ?? message.status],
    ['API', message.api],
    ['Codificação', message.encoding],
    ['Segmentos', String(message.segments)],
    ['De', message.from],
    ['Para', message.to],
    [
      'Erro',
      message.errorCode === null
        ? '—'
        : `${message.errorCode}${message.errorMessage ? ` · ${message.errorMessage}` : ''}`,
    ],
    ['Criada', new Date(message.createdAt).toLocaleString('pt-BR')],
    ['Enviada', message.sentAt ? new Date(message.sentAt).toLocaleString('pt-BR') : '—'],
    ['Entregue', message.deliveredAt ? new Date(message.deliveredAt).toLocaleString('pt-BR') : '—'],
  ]

  for (const [key, value] of rows) {
    kv.append(h('span', { class: 'kv-key' }, key))
    kv.append(h('span', { class: 'kv-val' }, value))
  }

  fragment.append(kv)
  fragment.append(h('pre', { class: 'json' }, JSON.stringify(message, null, 2)))
  fragment.append(
    h(
      'div',
      { class: 'guide-block' },
      h('h3', {}, 'Histórico de status'),
      h('pre', { class: 'json' }, JSON.stringify(message.history, null, 2)),
    ),
  )

  return fragment
}

/**
 * The message the inspector shows: the one the user picked, or the newest of
 * the thread.
 * @param {Message[]} messages The messages of the thread.
 * @param {string | null} selectedMessageId The message the user picked.
 * @returns {Message | undefined}
 */
function findMessage(messages, selectedMessageId) {
  if (selectedMessageId !== null) {
    const picked = messages.find((message) => message.id === selectedMessageId)
    if (picked) return picked
  }
  return messages[messages.length - 1]
}

/**
 * The tab of the inspector that shows the webhook deliveries.
 * @param {State} view The state to draw.
 * @returns {DocumentFragment}
 */
function webhooksTab(view) {
  const fragment = document.createDocumentFragment()

  if (view.deliveries.length === 0) {
    fragment.append(emptyBlock('Nenhum webhook', 'Configure uma URL em Configurações.'))
    return fragment
  }

  const toolbar = h('div', { class: 'dialog-actions' })
  const clear = h('button', { class: 'btn', type: 'button', 'data-action': 'clear-deliveries' }, 'Limpar')
  clear.addEventListener('click', () => {
    api.clearDeliveries().catch((error) => toast(String(error.message), true))
  })
  toolbar.append(clear)
  fragment.append(toolbar)

  for (const delivery of view.deliveries) fragment.append(deliveryCard(delivery))

  return fragment
}

/**
 * Draws one webhook delivery.
 * @param {Delivery} delivery The delivery to draw.
 * @returns {HTMLElement}
 */
function deliveryCard(delivery) {
  const card = h('div', { class: `delivery ${delivery.ok ? 'delivery--ok' : 'delivery--err'}` })

  const kv = h('div', { class: 'kv' })
  const rows = [
    ['Evento', delivery.event === 'inbound' ? 'Entrada' : 'Status'],
    ['Resposta', delivery.statusCode === null ? (delivery.error ?? 'sem resposta') : String(delivery.statusCode)],
    ['URL', delivery.url],
    ['Assinatura', delivery.signed ? 'HMAC-SHA256' : 'sem assinatura'],
  ]

  for (const [key, value] of rows) {
    kv.append(h('span', { class: 'kv-key' }, key))
    kv.append(h('span', { class: 'kv-val' }, value))
  }

  kv.append(h('span', { class: 'kv-key' }, 'Quando'))
  kv.append(h('time', { class: 'kv-val', datetime: delivery.at }, timeLabel(delivery.at)))

  card.append(kv)
  if (delivery.error) card.append(h('p', {}, delivery.error))
  card.append(h('pre', { class: 'json' }, prettyJson(delivery.requestBody)))

  return card
}

/**
 * The tab of the inspector that shows how to use the mock.
 * @param {State} view The state to draw.
 * @returns {DocumentFragment}
 */
function guideTab(view) {
  const fragment = document.createDocumentFragment()
  const origin = location.origin

  fragment.append(
    h(
      'div',
      { class: 'guide-block' },
      h('h3', {}, 'Enviar pela API'),
      h(
        'pre',
        {},
        `curl -X POST ${origin}/v1/messages \\\n  -H 'content-type: application/json' \\\n  -d '{"to":"+5511912345678","body":"Seu código é 482913"}'`,
      ),
    ),
  )

  fragment.append(
    h(
      'div',
      { class: 'guide-block' },
      h('h3', {}, 'Compatível com Twilio'),
      h('p', {}, `Aponte o SDK para ${origin}/2010-04-01 e envie para /Accounts/{AccountSid}/Messages.json.`),
      h(
        'pre',
        {},
        `curl -X POST ${origin}/2010-04-01/Accounts/AC123/Messages.json \\\n  -u 'AC123:seu-token' \\\n  -d 'To=%2B5511912345678&From=AMA4DEVS&Body=Ola'`,
      ),
    ),
  )

  const magic = h('div', { class: 'guide-block' }, h('h3', {}, 'Números mágicos'))
  const magicList = h('div', { class: 'magic-list' })
  for (const [number, description] of MAGIC_NUMBERS) {
    magicList.append(h('span', { class: 'magic-num' }, number))
    magicList.append(h('span', { class: 'magic-desc' }, description))
  }
  magic.append(magicList)
  fragment.append(magic)

  const otp = h('div', { class: 'guide-block' }, h('h3', {}, 'Códigos OTP'))
  const codes = codesOf(view)
  if (codes.length === 0) {
    otp.append(h('p', {}, 'O mock lê os códigos de 4 a 8 dígitos do corpo da mensagem.'))
  } else {
    const chips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' })
    for (const code of codes) chips.append(otpChip(code))
    otp.append(chips)
  }
  fragment.append(otp)

  fragment.append(
    h(
      'div',
      { class: 'guide-block' },
      h('h3', {}, 'Testes'),
      h('pre', {}, `curl "${origin}/v1/messages?to=%2B5511912345678&wait=5000"`),
      h('p', {}, 'A resposta espera até 5 segundos por uma mensagem nova.'),
    ),
  )

  return fragment
}

/**
 * The OTP codes the mock found in the messages of the panel.
 * @param {State} view The state to read.
 * @returns {string[]}
 */
function codesOf(view) {
  const messages = view.selected === null ? view.messages : thread(view, view.selected)
  /** @type {string[]} */
  const codes = []
  for (const message of messages) {
    for (const code of extractCodes(message.body)) {
      if (!codes.includes(code)) codes.push(code)
    }
  }
  return codes
}

// ───────── Wiring ─────────

/**
 * Sends the message of the dialog of the new SMS.
 */
async function sendNewMessage() {
  const raw = el.newTo.value.trim()
  const number = normalizePhone(raw)
  if (number === null) {
    toast('Número inválido: use +55 11 91234-5678', true)
    return
  }

  const body = el.newBody.value
  if (body.trim() === '') {
    toast('Escreva a mensagem antes de enviar', true)
    return
  }

  try {
    const message = await api.send({ to: number, body, from: el.newFrom.value.trim() })
    el.dlgNew.close()
    const conversation = message?.to ?? number
    state.set({ selected: conversation, selectedMessageId: null })
    layout.classList.add('is-thread')
    toast('SMS enviado')
  } catch (error) {
    toast(String(error.message), true)
  }
}

/**
 * Saves the settings of the mock.
 */
async function saveSettings() {
  const patch = {
    deliveryDelayMs: Number(el.setDelay.value) || 0,
    autoDeliver: el.setAuto.checked,
    webhookUrl: el.setWebhookUrl.value.trim(),
    webhookSecret: el.setWebhookSecret.value,
    defaultFrom: el.setDefaultFrom.value.trim() || 'AMA4DEVS',
  }

  try {
    await api.putSettings(patch)
    el.dlgSettings.close()
    toast('Configurações salvas')
  } catch (error) {
    toast(String(error.message), true)
  }
}

el.btnTheme.addEventListener('click', () => {
  const current = state.get().theme
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? 'system'
  writeTheme(next)
  state.set({ theme: next })
})

el.btnBack.addEventListener('click', () => {
  layout.classList.remove('is-thread')
})

el.btnInspector.addEventListener('click', () => {
  el.inspector.classList.toggle('is-open')
})

el.btnDemo.addEventListener('click', () => {
  api.demo().then(
    () => toast('Exemplos criados'),
    (error) => toast(String(error.message), true),
  )
})

el.search.addEventListener('input', () => {
  state.set({ search: el.search.value })
})

for (const tab of el.tabs) {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab
    if (name === 'json' || name === 'webhooks' || name === 'guide') state.set({ tab: name })
  })
}

// Composer: the handset replies to the app.

el.composer.addEventListener('submit', (event) => {
  event.preventDefault()
  const selected = state.get().selected
  const body = el.composerInput.value.trim()
  if (selected === null || body === '') return
  api
    .inbound({ from: selected, body })
    .then(
      () => {
        el.composerInput.value = ''
        updateCounter(el.composerMeta, '')
        autoGrow(el.composerInput)
        el.composerInput.focus()
      },
      (error) => toast(String(error.message), true),
    )
})

el.composerInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  el.composer.requestSubmit()
})

el.composerInput.addEventListener('input', () => {
  updateCounter(el.composerMeta, el.composerInput.value)
  autoGrow(el.composerInput)
})

// Dialog of the new SMS.

el.btnNew.addEventListener('click', () => {
  el.dlgNew.showModal()
  el.newTo.focus()
})

el.newBody.addEventListener('input', () => {
  updateCounter(el.newMeta, el.newBody.value)
})

el.newSubmit.addEventListener('click', () => {
  void sendNewMessage()
})

el.dlgNew.addEventListener('submit', (event) => {
  const submitter = event.submitter
  if (submitter?.getAttribute('value') === 'cancel') return
  event.preventDefault()
  void sendNewMessage()
})

// Dialog of the settings.

el.btnSettings.addEventListener('click', () => {
  const settings = state.get().settings
  if (settings) {
    el.setDelay.value = String(settings.deliveryDelayMs)
    el.setAuto.checked = settings.autoDeliver
    el.setWebhookUrl.value = settings.webhookUrl
    el.setWebhookSecret.value = settings.webhookSecret
    el.setDefaultFrom.value = settings.defaultFrom
  }
  el.dlgSettings.showModal()
})

el.setSubmit.addEventListener('click', () => {
  void saveSettings()
})

el.dlgSettings.addEventListener('submit', (event) => {
  const submitter = event.submitter
  if (submitter?.getAttribute('value') === 'cancel') return
  event.preventDefault()
  void saveSettings()
})

// The reset asks twice: the first click arms it, the second one empties the
// store of the mock.
let resetArmed = false
let resetTimer = 0

el.btnReset.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true
    el.btnReset.textContent = 'Confirmar?'
    resetTimer = window.setTimeout(() => {
      resetArmed = false
      el.btnReset.textContent = 'Apagar tudo'
    }, 3000)
    return
  }

  resetArmed = false
  window.clearTimeout(resetTimer)
  el.btnReset.textContent = 'Apagar tudo'
  api.reset().then(
    () => toast('Caixa apagada'),
    (error) => toast(String(error.message), true),
  )
})

// Keyboard: the slash looks for a message, the escape closes the inspector.

document.addEventListener('keydown', (event) => {
  if (el.dlgNew.open || el.dlgSettings.open) return

  const target = event.target
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)

  if (event.key === '/' && !typing) {
    event.preventDefault()
    el.search.focus()
    return
  }

  if (event.key === 'Escape') el.inspector.classList.remove('is-open')
})

// The labels of time go stale: the panel refreshes them every minute.
setInterval(refreshTimes, 60000)

// ───────── Boot ─────────

state.set({ theme: readTheme() })
state.subscribe((view) => render(view))
connect({
  onEvent: (event) => state.apply(event),
  onState: (status) => state.set({ connection: status }),
})
render(state.get())
