// @ts-check
/**
 * The panel of the SMS mock: it draws the conversations, the thread, the
 * composer and the drawer of the details out of the state, and wires every
 * control of `index.html` to the routes of the mock.
 *
 * The script is a browser ES module: no build step, no bundler, no npm.
 * The helpers of the mock live in `./core/`, served by the mock itself.
 * Every text a person reads comes from `t()`, the strings of the shell live
 * in `./strings-shell.js` and the control panel lives in `./control.js`.
 */

import { api, connect } from './api.js'
import { conversations, createState, replyTo, senders, thread } from './state.js'
import { analyze } from './core/segments.js'
import { formatPhone, isAlphaSender, normalizePhone } from './core/phone.js'
import { extractCodes } from './core/otp.js'
import { applyTranslations, getLang, onLangChange, setLang, t } from './i18n.js'
import { mountTools } from './control.js'
import './strings-shell.js'

/**
 * @typedef {import('./state.js').State} State
 * @typedef {import('./state.js').Conversation} Conversation
 * @typedef {import('../src/types.ts').Message} Message
 */

/** How long a toast stays on the screen, and how long an error stays. */
const TOAST_MS = 2600
const TOAST_ERROR_MS = 4000

/** The room the composer grows to, in pixels. */
const COMPOSER_MAX_HEIGHT = 160

// ───────── DOM Elements ─────────

/**
 * The element of the page with this id: the panel stops when one is missing.
 * @param {string} id The id of the element.
 * @returns {HTMLElement}
 */
function byId(id) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing element: #${id}`)
  return element
}

const el = {
  app: byId('app'),
  dot: byId('dot'),
  connText: byId('conn-text'),
  langButtons: Array.from(document.querySelectorAll('[data-lang]')),
  senderFilter: /** @type {HTMLSelectElement} */ (byId('sender-filter')),
  search: /** @type {HTMLInputElement} */ (byId('search')),
  filters: Array.from(document.querySelectorAll('.filter[data-filter]')),
  list: byId('conversation-list'),
  chatEmpty: byId('chat-empty'),
  chatView: byId('chat-view'),
  chatAvatar: byId('chat-avatar'),
  chatTitle: byId('chat-title'),
  chatSub: byId('chat-sub'),
  btnBack: byId('btn-back'),
  btnNew: byId('btn-new'),
  btnTools: byId('btn-tools'),
  btnDetails: byId('btn-details'),
  emptyNew: byId('empty-new'),
  emptyDemo: byId('empty-demo'),
  emptyTools: byId('empty-tools'),
  details: byId('details'),
  detailsBody: byId('details-body'),
  detailsClose: byId('details-close'),
  thread: byId('thread'),
  composer: /** @type {HTMLFormElement} */ (byId('composer')),
  composerInput: /** @type {HTMLTextAreaElement} */ (byId('composer-input')),
  composerMeta: byId('composer-meta'),
  composerSend: /** @type {HTMLButtonElement} */ (byId('composer-send')),
  dlgNew: /** @type {HTMLDialogElement} */ (byId('dlg-new')),
  newTo: /** @type {HTMLInputElement} */ (byId('new-to')),
  newFrom: /** @type {HTMLInputElement} */ (byId('new-from')),
  newBody: /** @type {HTMLTextAreaElement} */ (byId('new-body')),
  newMeta: byId('new-meta'),
  newSubmit: /** @type {HTMLButtonElement} */ (byId('new-submit')),
  toolsRoot: byId('tools'),
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
  if (sameDay(date, today)) return t('day.today')
  const yesterday = new Date(today.getTime() - 86400000)
  if (sameDay(date, yesterday)) return t('day.yesterday')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

/**
 * The label of the moment of a message inside the thread: the hour of today
 * or the date.
 * @param {string} iso The moment of the message.
 * @returns {string}
 */
function timeLabel(iso) {
  const date = new Date(iso)
  if (sameDay(date, new Date())) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}

/**
 * The label of the moment of a message in the list of conversations: the hour
 * of today, "Ontem" for yesterday, the date otherwise.
 * @param {string} iso The moment of the message.
 * @returns {string}
 */
function listTimeLabel(iso) {
  const date = new Date(iso)
  const today = new Date()
  if (sameDay(date, today)) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const yesterday = new Date(today.getTime() - 86400000)
  if (sameDay(date, yesterday)) return t('day.yesterday')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}

/**
 * The full moment of a message, in the language of the panel.
 * @param {string} iso The moment of the message.
 * @returns {string}
 */
function dateTime(iso) {
  return new Date(iso).toLocaleString(getLang() === 'pt' ? 'pt-BR' : 'en-GB')
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
 * The centered empty text of a list.
 * @param {string} title The title of the state.
 * @param {string} hint The hint under the title.
 * @returns {HTMLElement}
 */
function emptyBlock(title, hint) {
  return h(
    'div',
    { class: 'empty' },
    h('h3', { class: 'empty-title' }, title),
    h('p', { class: 'empty-hint' }, hint),
  )
}

/**
 * Refreshes the labels of time: they go stale as the minutes pass.
 */
function refreshTimes() {
  for (const node of document.querySelectorAll('time[datetime]')) {
    const at = node.getAttribute('datetime')
    if (!at) continue
    node.textContent = node.classList.contains('chat-item-time') ? listTimeLabel(at) : timeLabel(at)
  }
  for (const node of document.querySelectorAll('[data-day]')) {
    const at = node.getAttribute('data-day')
    if (at) node.textContent = dayLabel(at)
  }
}

// ───────── State ─────────

const state = createState()

/** Whether the chat pane is open on the narrow layout. */
let chatOpen = false

/** Whether the drawer of the details is open. */
let detailsOpen = false

/** The conversation the thread is showing, to know when it changes. */
let lastConversation = null

/** The senders of the last drawing of the selector, to rebuild it once. */
let lastSenders = ''

// ───────── Toasts ─────────

/**
 * Shows a message on the corner of the screen.
 * @param {string} message The text of the toast.
 * @param {boolean} [isError] True when the toast reports a failure.
 */
function toast(message, isError = false) {
  const node = h('div', { class: isError ? 'toast error' : 'toast' }, message)
  el.toasts.append(node)
  setTimeout(() => node.remove(), isError ? TOAST_ERROR_MS : TOAST_MS)
}

// ───────── Rendering ─────────

/**
 * A selector that finds the focused control again after a render, or null.
 * @param {Element | null} node The focused element.
 * @returns {string | null}
 */
function focusSelector(node) {
  if (!(node instanceof HTMLElement)) return null
  const bubble = node.closest('.bubble')
  if (bubble instanceof HTMLElement && bubble.dataset.id) {
    const base = `.bubble[data-id="${CSS.escape(bubble.dataset.id)}"]`
    if (node.dataset.action) return `${base} [data-action="${CSS.escape(node.dataset.action)}"]`
    if (node.dataset.code) return `${base} [data-code="${CSS.escape(node.dataset.code)}"]`
    return base
  }
  if (node.classList.contains('chat-item') && node.dataset.number) {
    return `.chat-item[data-number="${CSS.escape(node.dataset.number)}"]`
  }
  return null
}

/**
 * Draws the whole panel out of the state.
 * @param {State} view The state to draw.
 */
function render(view) {
  const refocus = focusSelector(document.activeElement)

  renderConnection(view)
  renderSenders(view)
  renderFilters(view)
  renderConversations(view)
  renderChat(view)
  renderThread(view)
  renderComposer(view)
  renderDetails(view)

  if (refocus && (document.activeElement === null || document.activeElement === document.body)) {
    const again = document.querySelector(refocus)
    if (again instanceof HTMLElement) again.focus({ preventScroll: true })
  }
}

/**
 * Draws the state of the live socket on the header.
 * @param {State} view The state to draw.
 */
function renderConnection(view) {
  const open = view.connection === 'open'
  const closed = view.connection === 'closed'
  el.dot.className = open ? 'dot on' : closed ? 'dot off' : 'dot'
  el.connText.textContent = t(open ? 'conn.open' : closed ? 'conn.closed' : 'conn.connecting')
}

/**
 * Draws the selector of the senders: every sender of the store, plus the
 * option that keeps all of them.
 * @param {State} view The state to draw.
 */
function renderSenders(view) {
  const list = senders(view)
  const key = `${getLang()}|${list.join(' ')}`
  if (key !== lastSenders) {
    lastSenders = key
    const fragment = document.createDocumentFragment()
    fragment.append(h('option', { value: '' }, t('shell.allSenders')))
    for (const sender of list) fragment.append(h('option', { value: sender }, formatPhone(sender)))
    el.senderFilter.replaceChildren(fragment)
  }
  const sender = view.sender ?? null
  el.senderFilter.value = sender === null ? '' : sender
}

/**
 * Draws the chips of the filters: the one of the state is pressed.
 * @param {State} view The state to draw.
 */
function renderFilters(view) {
  const filter = view.filter ?? 'all'
  for (const button of el.filters) {
    button.setAttribute('aria-pressed', button.dataset.filter === filter ? 'true' : 'false')
  }
}

/**
 * Draws the list of conversations.
 * @param {State} view The state to draw.
 */
function renderConversations(view) {
  const list = conversations(view)
  const scrollTop = el.list.scrollTop
  const fragment = document.createDocumentFragment()

  if (list.length === 0) {
    fragment.append(emptyBlock(t('list.empty'), t('list.emptyHint')))
  } else {
    for (const conversation of list) fragment.append(conversationItem(view, conversation))
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
function conversationItem(view, conversation) {
  const { number, last, unread } = conversation
  const classes = ['chat-item']
  if (number === view.selected) classes.push('is-active')

  const button = h('button', { class: classes.join(' '), type: 'button', 'data-number': number })

  button.append(
    h('span', { class: 'avatar', style: `--hue:${hueOf(number)}` }, avatarText(number)),
    h(
      'span',
      { class: 'chat-item-main' },
      h(
        'span',
        { class: 'chat-item-top' },
        h('span', { class: 'chat-item-name' }, formatPhone(number)),
        h('time', { class: 'chat-item-time', datetime: last.createdAt }, listTimeLabel(last.createdAt)),
      ),
      h(
        'span',
        { class: 'chat-item-bottom' },
        h(
          'span',
          { class: 'chat-item-last' },
          last.direction === 'inbound' ? `${t('list.you')}${last.body}` : last.body,
        ),
        unread > 0 ? h('span', { class: 'unread-badge' }, String(unread)) : null,
      ),
    ),
  )

  button.addEventListener('click', () => {
    chatOpen = true
    state.set({ selected: number, selectedMessageId: null })
  })

  return button
}

/**
 * Draws the chat: the empty state when no conversation is on screen, the
 * conversation itself otherwise.
 * @param {State} view The state to draw.
 */
function renderChat(view) {
  const selected = view.selected
  const onScreen = selected !== null

  el.chatEmpty.hidden = onScreen
  el.chatView.hidden = !onScreen
  el.app.classList.toggle('is-chat', chatOpen)

  if (!onScreen) {
    el.chatTitle.textContent = ''
    el.chatSub.textContent = ''
    el.chatAvatar.textContent = ''
    return
  }

  const messages = thread(view, selected)
  el.chatTitle.textContent = formatPhone(selected)
  el.chatSub.textContent = t(messages.length === 1 ? 'chat.subOne' : 'chat.sub', { count: messages.length })
  el.chatAvatar.textContent = avatarText(selected)
  el.chatAvatar.style.setProperty('--hue', String(hueOf(selected)))
}

/**
 * Draws the thread of the conversation on screen.
 * @param {State} view The state to draw.
 */
function renderThread(view) {
  const selected = view.selected
  const messages = selected === null ? [] : thread(view, selected)

  const scrollTop = el.thread.scrollTop
  const atBottom = el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 40
  const changed = lastConversation !== selected

  const fragment = document.createDocumentFragment()
  if (messages.length === 0) {
    fragment.append(emptyBlock(t('thread.empty'), t('thread.emptyHint')))
  } else {
    let lastDay = ''
    for (const message of messages) {
      const day = dayKey(new Date(message.createdAt))
      if (day !== lastDay) {
        lastDay = day
        fragment.append(h('div', { class: 'day', 'data-day': message.createdAt }, dayLabel(message.createdAt)))
      }
      fragment.append(bubble(view, message))
    }
  }

  el.thread.replaceChildren(fragment)

  if (atBottom || changed) el.thread.scrollTop = el.thread.scrollHeight
  else el.thread.scrollTop = scrollTop

  lastConversation = selected
  if (changed) detailsOpen = false
}

/**
 * Draws one message of the thread: the app wrote it (the handset received it)
 * or the handset wrote it (the app received it).
 * @param {State} view The state to draw.
 * @param {Message} message The message to draw.
 * @returns {HTMLElement}
 */
function bubble(view, message) {
  const outbound = message.direction === 'outbound'
  const selected = view.selectedMessageId === message.id

  const node = h('div', {
    class: `bubble ${outbound ? 'in' : 'out'}`,
    'data-id': message.id,
    role: 'button',
    tabindex: '0',
    'aria-current': selected ? 'true' : 'false',
  })

  node.append(h('span', { class: 'bubble-from' }, formatPhone(message.from)))
  node.append(h('span', { class: 'bubble-text' }, message.body))

  const codes = message.codes.length > 0 ? message.codes : extractCodes(message.body)
  for (const code of codes) node.append(otpChip(code))

  const meta = h('div', { class: 'bubble-meta' })
  meta.append(h('time', { datetime: message.createdAt }, timeLabel(message.createdAt)))
  if (message.segments > 0) {
    meta.append(
      h('span', { class: 'seg-badge' }, t('bubble.segments', { count: message.segments, encoding: message.encoding })),
    )
  }

  const status = outbound ? t(`status.${message.status}`) : t('bubble.fromPhone')
  const withError = (message.status === 'failed' || message.status === 'undelivered') && message.errorCode !== null
  meta.append(
    h(
      'span',
      { class: 'status', 'data-status': message.status },
      withError ? `${status} · ${t('bubble.error', { code: message.errorCode })}` : status,
    ),
  )
  node.append(meta)

  if (outbound) node.append(messageActions(message))

  const select = (event) => {
    event.stopPropagation()
    detailsOpen = true
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
    add('deliver', t('action.deliver'), () => setStatus(message.id, 'delivered'))
    add('fail', t('action.fail'), () => setStatus(message.id, 'failed', 30003))
    add('undeliver', t('action.undeliver'), () => setStatus(message.id, 'undelivered', 30005))
  }

  add('delete', t('action.delete'), () => removeMessage(message.id))

  return actions
}

/**
 * The button that copies an OTP code.
 * @param {string} code The code to copy.
 * @returns {HTMLElement}
 */
function otpChip(code) {
  const chip = h('button', { class: 'chip chip-otp', type: 'button', 'data-code': code }, code)
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
    if (!clipboard) throw new Error('clipboard is unavailable')
    void clipboard.writeText(code).then(
      () => toast(t('toast.copied')),
      () => toast(t('toast.copyFailed'), true),
    )
  } catch {
    toast(t('toast.copyFailed'), true)
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
 * Deletes a message, after the user confirms it.
 * @param {string} id The id of the message.
 */
function removeMessage(id) {
  if (!window.confirm(t('confirm.delete'))) return
  api.remove(id).catch((error) => toast(String(error.message), true))
}

/**
 * Draws the composer: the counter of the message and the state of the button.
 * @param {State} view The state to draw.
 */
function renderComposer(view) {
  const enabled = view.selected !== null
  el.composerInput.disabled = !enabled
  el.composerSend.disabled = !enabled || el.composerInput.value.trim() === ''
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
    target.classList.remove('warn')
    delete target.dataset.segments
    return
  }
  const info = analyze(text)
  target.textContent = t('composer.counter', {
    length: info.length,
    perSegment: info.perSegment,
    encoding: info.encoding,
    segments: info.segments,
  })
  target.dataset.segments = String(info.segments)
  target.classList.toggle('warn', info.segments > 1)
}

/**
 * Grows the text box with the text, up to the room the panel gives it.
 * @param {HTMLTextAreaElement} textarea The box that grows.
 */
function autoGrow(textarea) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
}

/**
 * Draws the drawer of the details: the message the user picked, or the newest
 * of the thread when nobody picked one.
 * @param {State} view The state to draw.
 */
function renderDetails(view) {
  const open = detailsOpen && view.selected !== null
  el.details.hidden = !open
  if (!open) {
    el.detailsBody.replaceChildren()
    return
  }

  const messages = thread(view, view.selected ?? '')
  const message = findMessage(messages, view.selectedMessageId)
  const fragment = document.createDocumentFragment()

  if (!message) {
    fragment.append(h('div', { class: 'empty' }, h('p', { class: 'empty-hint' }, t('details.empty'))))
    el.detailsBody.replaceChildren(fragment)
    return
  }

  const rows = [
    [t('details.id'), message.id],
    [t('details.status'), t(`status.${message.status}`)],
    [t('details.api'), message.api],
    [t('details.encoding'), message.encoding],
    [t('details.segments'), String(message.segments)],
    [t('details.from'), formatPhone(message.from)],
    [t('details.to'), formatPhone(message.to)],
    [
      t('details.error'),
      message.errorCode === null
        ? '—'
        : `${message.errorCode}${message.errorMessage ? ` · ${message.errorMessage}` : ''}`,
    ],
    [t('details.created'), dateTime(message.createdAt)],
    [t('details.sent'), message.sentAt ? dateTime(message.sentAt) : '—'],
    [t('details.delivered'), message.deliveredAt ? dateTime(message.deliveredAt) : '—'],
  ]

  for (const [key, value] of rows) {
    fragment.append(
      h('div', { class: 'kv-row' }, h('span', { class: 'kv-key' }, key), h('span', { class: 'kv-val' }, value)),
    )
  }

  fragment.append(h('pre', { class: 'json' }, JSON.stringify(message, null, 2)))

  const history = h('div', { class: 'history' })
  for (const entry of message.history) {
    history.append(
      h(
        'div',
        { class: 'history-item' },
        h('span', { class: 'status', 'data-status': entry.status }, t(`status.${entry.status}`)),
        h('time', { datetime: entry.at }, timeLabel(entry.at)),
      ),
    )
  }
  fragment.append(history)

  el.detailsBody.replaceChildren(fragment)
}

/**
 * The message the drawer shows: the one the user picked, or the newest of the
 * thread.
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

// ───────── Wiring ─────────

/** The control panel on top of the app. */
const tools = mountTools({ root: el.toolsRoot, state, api, toast })

/**
 * Mirrors the language of the panel on the buttons of the switch.
 */
function syncLangButtons() {
  const lang = getLang()
  for (const button of el.langButtons) {
    button.setAttribute('aria-pressed', button.dataset.lang === lang ? 'true' : 'false')
  }
}

for (const button of el.langButtons) {
  button.addEventListener('click', () => {
    const next = button.dataset.lang
    if (next === 'pt' || next === 'en') setLang(next)
    syncLangButtons()
  })
}

el.senderFilter.addEventListener('change', () => {
  const value = el.senderFilter.value
  state.set({ sender: value === '' ? null : value })
})

el.search.addEventListener('input', () => {
  state.set({ search: el.search.value })
})

for (const button of el.filters) {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter
    if (filter === 'all' || filter === 'noreply' || filter === 'failed') state.set({ filter })
  })
}

el.btnNew.addEventListener('click', () => openNewDialog())
el.emptyNew.addEventListener('click', () => openNewDialog())

el.emptyDemo.addEventListener('click', () => {
  api.demo().then(
    () => toast(t('toast.demo')),
    (error) => toast(String(error.message), true),
  )
})

el.btnTools.addEventListener('click', () => tools.open())
el.emptyTools.addEventListener('click', () => tools.open())

el.btnBack.addEventListener('click', () => {
  chatOpen = false
  el.app.classList.remove('is-chat')
})

el.btnDetails.addEventListener('click', () => {
  detailsOpen = !detailsOpen
  render(state.get())
})

el.detailsClose.addEventListener('click', () => {
  detailsOpen = false
  render(state.get())
})

// Composer: the handset replies to the app.

el.composer.addEventListener('submit', (event) => {
  event.preventDefault()
  const selected = state.get().selected
  const body = el.composerInput.value.trim()
  if (selected === null || body === '') return
  api
    .inbound({ from: selected, to: replyTo(state.get(), selected) ?? undefined, body })
    .then(
      () => {
        el.composerInput.value = ''
        updateCounter(el.composerMeta, '')
        el.composerSend.disabled = true
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
  el.composerSend.disabled = el.composerInput.value.trim() === ''
  autoGrow(el.composerInput)
})

// Dialog of the new SMS.

/**
 * Opens the dialog of the new message.
 */
function openNewDialog() {
  el.dlgNew.showModal()
  el.newTo.focus()
}

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

/**
 * Sends the message of the dialog of the new SMS.
 */
async function sendNewMessage() {
  const raw = el.newTo.value.trim()
  const number = normalizePhone(raw)
  if (number === null) {
    toast(t('toast.invalidNumber'), true)
    return
  }

  const body = el.newBody.value
  if (body.trim() === '') {
    toast(t('toast.emptyBody'), true)
    return
  }

  try {
    const message = await api.send({ to: number, body, from: el.newFrom.value.trim() })
    el.dlgNew.close()
    const conversation = message?.to ?? number
    chatOpen = true
    state.set({ selected: conversation, selectedMessageId: null })
    toast(t('toast.sent'))
  } catch (error) {
    toast(String(error.message), true)
  }
}

// Keyboard: the slash looks for a conversation, the escape closes the drawer.

document.addEventListener('keydown', (event) => {
  if (el.dlgNew.open || !el.toolsRoot.hidden) return

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

  if (event.key === 'Escape' && detailsOpen) {
    detailsOpen = false
    render(state.get())
  }
})

// The labels of time go stale: the panel refreshes them every minute.
setInterval(refreshTimes, 60000)

// ───────── Boot ─────────

document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en'
applyTranslations(document)
syncLangButtons()

state.subscribe((view) => render(view))
connect({
  onEvent: (event) => state.apply(event),
  onState: (status) => state.set({ connection: status }),
})

onLangChange(() => {
  syncLangButtons()
  render(state.get())
  tools.refresh()
})

render(state.get())
