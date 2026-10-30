// @ts-check
/**
 * The state container of the panel: one object that is replaced instead of
 * mutated, so the view can compare the old and the new one, and the selectors
 * that turn the messages into the conversations the sidebar draws.
 *
 * The module is pure: no runtime import, no DOM, no fetch. The types are
 * type-only references to `src/types.ts`, which the browser never loads.
 */

/**
 * @typedef {import('../src/types.ts').Message} Message
 * @typedef {import('../src/types.ts').Settings} Settings
 * @typedef {import('../src/types.ts').Delivery} Delivery
 * @typedef {import('../src/types.ts').LiveEvent} LiveEvent
 */

/**
 * @typedef {'all' | 'noreply' | 'failed'} Filter The chip of the sidebar.
 */

/**
 * @typedef {object} State
 * @property {'connecting' | 'open' | 'closed'} connection How the socket stands.
 * @property {string} version The version of the mock.
 * @property {Message[]} messages The messages of the store, oldest first.
 * @property {Settings | null} settings The settings of the mock.
 * @property {Delivery[]} deliveries The webhook deliveries, newest first.
 * @property {string | null} selected The number of the conversation on screen.
 * @property {string | null} selectedMessageId The message open in the inspector.
 * @property {string} search What the user is looking for.
 * @property {Filter} filter The chip the user pressed in the sidebar.
 * @property {string | null} sender The sender the user chose, null for every one.
 * @property {'json' | 'webhooks' | 'guide'} tab The tab of the inspector.
 * @property {'light' | 'dark' | 'system'} theme The theme of the panel.
 */

/**
 * @typedef {object} Conversation
 * @property {string} number The number on the other side.
 * @property {Message} last The newest message of the conversation.
 * @property {number} count How many messages the conversation holds.
 * @property {number} unread How many messages wait for a reply.
 */

/** How many deliveries the panel keeps in memory. */
const MAX_DELIVERIES = 200

/**
 * The number on the other side of a message: the one it was sent to when the
 * app sent it, the one that sent it when the handset answered.
 * @param {Message} message
 * @returns {string}
 */
export function counterparty(message) {
  return message.direction === 'outbound' ? message.to : message.from
}

/**
 * The container of the panel state: the current object, the listeners and the
 * two ways of changing it, a live event from the socket or a local patch.
 * @returns {{
 *   get: () => State,
 *   subscribe: (fn: (state: State) => void) => () => void,
 *   apply: (event: LiveEvent) => void,
 *   set: (patch: Partial<State>) => void,
 * }}
 */
export function createState() {
  /** @type {State} */
  let state = {
    connection: 'connecting',
    version: '',
    messages: [],
    settings: null,
    deliveries: [],
    selected: null,
    selectedMessageId: null,
    search: '',
    filter: 'all',
    sender: null,
    tab: 'json',
    theme: 'system',
  }

  /** @type {Set<(state: State) => void>} */
  const listeners = new Set()

  /**
   * Replaces the state with the patched one and tells the listeners.
   * @param {Partial<State>} patch
   */
  const replace = (patch) => {
    state = Object.assign({}, state, patch)
    for (const listener of listeners) listener(state)
  }

  return {
    get: () => state,

    /**
     * @param {(state: State) => void} fn The listener of the changes.
     * @returns {() => void} The way to leave the list of listeners.
     */
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },

    /**
     * Applies an event of the socket to the state.
     * @param {LiveEvent} event
     */
    apply(event) {
      switch (event.type) {
        case 'snapshot': {
          replace({
            messages: event.messages,
            settings: event.settings,
            deliveries: event.deliveries,
            version: event.version,
          })
          break
        }

        case 'message.created': {
          const message = event.message
          if (state.messages.some((one) => one.id === message.id)) break
          const messages = [...state.messages, message]
          if (state.selected === null) replace({ messages, selected: counterparty(message) })
          else replace({ messages })
          break
        }

        case 'message.updated': {
          const message = event.message
          const at = state.messages.findIndex((one) => one.id === message.id)
          const messages =
            at === -1
              ? [...state.messages, message]
              : state.messages.map((one, index) => (index === at ? message : one))
          replace({ messages })
          break
        }

        case 'message.deleted': {
          const messages = state.messages.filter((one) => one.id !== event.id)
          /** @type {Partial<State>} */
          const patch = { messages }
          if (state.selectedMessageId === event.id) patch.selectedMessageId = null
          replace(patch)
          break
        }

        case 'reset': {
          // The search and the filters of the sidebar survive the reset.
          replace({ messages: [], deliveries: [], selected: null, selectedMessageId: null })
          break
        }

        case 'settings.updated': {
          replace({ settings: event.settings })
          break
        }

        case 'delivery': {
          const deliveries = [event.delivery, ...state.deliveries].slice(0, MAX_DELIVERIES)
          replace({ deliveries })
          break
        }

        case 'deliveries.cleared': {
          replace({ deliveries: [] })
          break
        }
      }
    },

    /**
     * Merges a patch into the state.
     * @param {Partial<State>} patch
     */
    set(patch) {
      replace(patch)
    },
  }
}

/**
 * The conversations of the panel: one per counterparty, the newest activity
 * first, narrowed by the search, the chip and the sender the user chose.
 * @param {State} state
 * @returns {Conversation[]}
 */
export function conversations(state) {
  /** @type {Map<string, Message[]>} */
  const groups = new Map()

  for (const message of state.messages) {
    const number = counterparty(message)
    const group = groups.get(number)
    if (group) group.push(message)
    else groups.set(number, [message])
  }

  const search = state.search.trim().toLowerCase()
  /** @type {Conversation[]} */
  const list = []

  for (const [number, group] of groups) {
    const messages = [...group].sort(oldestFirst)
    if (search && !matchesSearch(messages, number, search)) continue
    const last = messages[messages.length - 1]
    if (!last) continue
    const unread = unreadOf(messages)
    if (!matchesFilter(messages, unread, state.filter)) continue
    if (state.sender !== null && !hasSender(messages, state.sender)) continue
    list.push({ number, last, count: messages.length, unread })
  }

  list.sort((one, other) => newestFirst(one.last, other.last))
  return list
}

/**
 * The senders the sidebar offers: the distinct senders of the outbound
 * messages plus the one the person chose, sorted by name.
 * @param {State} state
 * @returns {string[]}
 */
export function senders(state) {
  /** @type {Set<string>} */
  const names = new Set()

  for (const message of state.messages) {
    if (message.direction !== 'outbound') continue
    names.add(message.from)
  }
  // The sender the person chose stays offered, so the selector always shows the filter in force.
  if (state.sender !== null) names.add(state.sender)

  return [...names].sort()
}

/**
 * The messages of one conversation, oldest first.
 * @param {State} state
 * @param {string} number The number of the conversation.
 * @returns {Message[]}
 */
export function thread(state, number) {
  return state.messages.filter((message) => counterparty(message) === number).sort(oldestFirst)
}

/**
 * The oldest of two messages comes first.
 * @param {Message} one
 * @param {Message} other
 * @returns {number}
 */
function oldestFirst(one, other) {
  if (one.createdAt === other.createdAt) return 0
  return one.createdAt < other.createdAt ? -1 : 1
}

/**
 * The newest of two messages comes first.
 * @param {Message} one
 * @param {Message} other
 * @returns {number}
 */
function newestFirst(one, other) {
  if (one.createdAt === other.createdAt) return 0
  return one.createdAt > other.createdAt ? -1 : 1
}

/**
 * Whether the conversation answers the search: the number, the body or a code
 * of any of its messages.
 * @param {Message[]} messages The messages of the conversation.
 * @param {string} number The number of the conversation.
 * @param {string} search The search, already lowercased.
 * @returns {boolean}
 */
function matchesSearch(messages, number, search) {
  if (number.toLowerCase().includes(search)) return true
  for (const message of messages) {
    if (message.body.toLowerCase().includes(search)) return true
    for (const code of message.codes) {
      if (code.toLowerCase().includes(search)) return true
    }
  }
  return false
}

/**
 * Whether the conversation passes the chip of the sidebar: `noreply` keeps the
 * ones the handset never answered, `failed` the ones with a message that did
 * not reach it.
 * @param {Message[]} messages The messages of the conversation, oldest first.
 * @param {number} unread How many messages wait for a reply.
 * @param {Filter} filter The chip the user pressed.
 * @returns {boolean}
 */
function matchesFilter(messages, unread, filter) {
  if (filter === 'noreply') return unread > 0
  if (filter === 'failed') {
    return messages.some((message) => message.status === 'failed' || message.status === 'undelivered')
  }
  return true
}

/**
 * Whether the conversation has an outbound message the given sender sent.
 * @param {Message[]} messages The messages of the conversation, oldest first.
 * @param {string} sender The sender the user chose.
 * @returns {boolean}
 */
function hasSender(messages, sender) {
  return messages.some((message) => message.direction === 'outbound' && message.from === sender)
}

/**
 * How many messages wait for a reply: the outbound ones sent after the last
 * inbound message of the conversation.
 * @param {Message[]} messages The messages of the conversation, oldest first.
 * @returns {number}
 */
function unreadOf(messages) {
  let last = -1
  for (let at = 0; at < messages.length; at++) {
    const message = messages[at]
    if (message && message.direction === 'inbound') last = at
  }

  let count = 0
  for (let at = last + 1; at < messages.length; at++) {
    const message = messages[at]
    if (message && message.direction === 'outbound') count += 1
  }
  return Math.min(count, 99)
}

/**
 * The number a reply of the handset goes to: the sender of the newest outbound
 * message of the conversation, or null when the app never wrote to it.
 * @param {State} state
 * @param {string} number The number of the conversation.
 * @returns {string | null}
 */
export function replyTo(state, number) {
  const outbound = thread(state, number).filter((message) => message.direction === 'outbound')
  return outbound.at(-1)?.from ?? null
}
