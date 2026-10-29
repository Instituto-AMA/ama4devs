/**
 * The message store: the messages the mock keeps in memory, the events it
 * announces, the long-poll the routes wait on, and the settings the panel
 * changes at runtime.
 */
import { analyze } from './core/segments.js'
import { extractCodes } from './core/otp.js'
import type { Api, Direction, Message, Settings, Status, StoreEvent } from './types.ts'

/**
 * A message as it enters the store: what the caller knows before the store
 * computes the encoding, the segments and the codes.
 */
export interface NewMessage {
  direction: Direction
  from: string
  to: string
  body: string
  api: Api
  status: Status
  /** Per-message status callback; none when the caller names none. */
  callbackUrl?: string | null
}

/**
 * The filters of a listing: every filter that is given narrows the result.
 */
export interface ListFilter {
  /** Keeps the messages sent to this number. */
  to?: string
  /** Keeps the messages sent from this number. */
  from?: string
  /** Keeps the messages with this number on either side. */
  number?: string
  status?: Status
  direction?: Direction
  /** Text the body, the numbers or the codes must contain. */
  q?: string
  /** Keeps the messages created after the one with this id. */
  afterId?: string
  /** Keeps the newest messages, the oldest first among them. */
  limit?: number
}

/**
 * The messages of the mock: what the routes read, what the panel watches and
 * what the long-poll waits for.
 */
export interface MessageStore {
  /** Stores a message, computes its encoding, its segments and its codes, and announces it. */
  add(input: NewMessage): Message
  /** One message by its id, or nothing when the store does not know it. */
  get(id: string): Message | undefined
  /** Changes a message; a status change joins the history and sets the times. */
  update(id: string, patch: Partial<Pick<Message, 'status' | 'errorCode' | 'errorMessage'>>): Message | undefined
  /** Drops a message and announces it; false when the store does not know it. */
  remove(id: string): boolean
  /** The messages that answer the filter, the oldest first. */
  list(filter?: ListFilter): Message[]
  /** Drops every message and announces it. */
  reset(): void
  /** Listens to the events of the store; the function returned stops it. */
  subscribe(fn: (event: StoreEvent) => void): () => void
  /** Waits for the first message that answers the filter, or gives up empty. */
  waitFor(filter: ListFilter, timeoutMs: number): Promise<Message[]>
}

/** The settings of the mock, as the panel and the control routes change them. */
export interface SettingsStore {
  /** The settings as they are now. */
  get(): Settings
  /** Merges the values of the right type and tells the subscribers. */
  update(patch: Partial<Settings>): Settings
  /** Listens to the changes; the function returned stops it. */
  subscribe(fn: (settings: Settings) => void): () => void
}

/**
 * The outside world the store uses: the clock, the id maker and the timers.
 */
export interface StoreDeps {
  now: () => Date
  newId: () => string
  /** How many messages are kept; the oldest are dropped beyond it. */
  maxMessages: number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

/**
 * The message store: the messages in memory, the events they announce and the
 * long-poll the routes wait on.
 * @param deps The clock, the id maker, the cap and the timers.
 */
export function createStore(deps: StoreDeps): MessageStore {
  const messages: Message[] = []
  const listeners = new Set<(event: StoreEvent) => void>()
  const setTimer = deps.setTimer ?? setTimeout
  const clearTimer = deps.clearTimer ?? clearTimeout

  /**
   * Announces an event to every listener; a listener that breaks is ignored.
   * @param event What happened.
   */
  const emit = (event: StoreEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // One broken listener must not stop the others nor the store.
      }
    }
  }

  /**
   * Stores a message: the id, the times, the encoding, the segments and the
   * codes are computed, the oldest message is dropped when the cap is passed,
   * and the message is announced.
   * @param input What the caller knows about the message.
   */
  const add = (input: NewMessage): Message => {
    const createdAt = deps.now().toISOString()
    const analysis = analyze(input.body)
    const message: Message = {
      id: deps.newId(),
      direction: input.direction,
      from: input.from,
      to: input.to,
      body: input.body,
      status: input.status,
      api: input.api,
      encoding: analysis.encoding === 'UCS-2' ? 'UCS-2' : 'GSM-7',
      segments: analysis.segments,
      codes: extractCodes(input.body),
      errorCode: null,
      errorMessage: null,
      callbackUrl: input.callbackUrl ?? null,
      createdAt,
      updatedAt: createdAt,
      sentAt: null,
      deliveredAt: null,
      history: [{ status: input.status, at: createdAt }],
    }

    messages.push(message)
    while (messages.length > deps.maxMessages) {
      const dropped = messages.shift()
      if (dropped) emit({ type: 'message.deleted', id: dropped.id })
    }

    emit({ type: 'message.created', message: structuredClone(message) })
    return structuredClone(message)
  }

  /**
   * One message by its id, as a copy the caller cannot change the store with.
   * @param id The id of the message.
   */
  const get = (id: string): Message | undefined => {
    const found = messages.find((message) => message.id === id)
    return found ? structuredClone(found) : undefined
  }

  /**
   * Changes a message: a new status joins the history, the first time sent
   * and the delivered time are kept, and the change is announced. A patch
   * that changes nothing announces nothing.
   * @param id The id of the message.
   * @param patch The status and the error of the message.
   */
  const update = (
    id: string,
    patch: Partial<Pick<Message, 'status' | 'errorCode' | 'errorMessage'>>,
  ): Message | undefined => {
    const message = messages.find((entry) => entry.id === id)
    if (!message) return undefined

    const status = patch.status !== undefined ? patch.status : message.status
    const errorCode = patch.errorCode !== undefined ? patch.errorCode : message.errorCode
    const errorMessage = patch.errorMessage !== undefined ? patch.errorMessage : message.errorMessage
    if (status === message.status && errorCode === message.errorCode && errorMessage === message.errorMessage) {
      return structuredClone(message)
    }

    const at = deps.now().toISOString()
    const previous = message.status
    message.status = status
    message.errorCode = errorCode
    message.errorMessage = errorMessage
    message.updatedAt = at

    if (status !== previous) {
      message.history.push({ status, at })
    }
    if (status === 'sent' && message.sentAt === null) message.sentAt = at
    if (status === 'delivered') message.deliveredAt = at

    emit({ type: 'message.updated', message: structuredClone(message) })
    return structuredClone(message)
  }

  /**
   * Drops a message and announces it.
   * @param id The id of the message.
   */
  const remove = (id: string): boolean => {
    const index = messages.findIndex((message) => message.id === id)
    if (index < 0) return false
    messages.splice(index, 1)
    emit({ type: 'message.deleted', id })
    return true
  }

  /**
   * The messages that answer the filter, the oldest first, as copies the
   * caller cannot change the store with.
   * @param filter The filters every message must answer.
   */
  const list = (filter: ListFilter = {}): Message[] => {
    let found = messages

    if (filter.afterId !== undefined) {
      const index = found.findIndex((message) => message.id === filter.afterId)
      if (index >= 0) found = found.slice(index + 1)
    }

    const answered = found.filter((message) => matches(message, filter))
    const limited =
      filter.limit !== undefined && filter.limit >= 0 && filter.limit < answered.length
        ? answered.slice(answered.length - filter.limit)
        : answered

    return limited.map((message) => structuredClone(message))
  }

  /**
   * Drops every message and announces it.
   */
  const reset = (): void => {
    messages.length = 0
    emit({ type: 'reset' })
  }

  /**
   * Listens to the events of the store; the function returned stops it.
   * @param fn The listener.
   */
  const subscribe = (fn: (event: StoreEvent) => void): (() => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  /**
   * Waits for the first message that answers the filter: the list is read at
   * once, the created messages are watched afterwards, and the wait gives up
   * empty when the timer fires.
   * @param filter The filters the message must answer.
   * @param timeoutMs How long to wait; zero gives up at once.
   */
  const waitFor = (filter: ListFilter, timeoutMs: number): Promise<Message[]> => {
    const already = list(filter)
    if (already.length > 0) return Promise.resolve(already)
    if (timeoutMs <= 0) return Promise.resolve([])

    return new Promise<Message[]>((resolve) => {
      let unsubscribe = (): void => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      let done = false

      /**
       * Ends the wait with the messages that answered the filter.
       * @param found The messages that answered it.
       */
      const finish = (found: Message[]): void => {
        if (done) return
        done = true
        unsubscribe()
        if (timer !== undefined) clearTimer(timer)
        resolve(found)
      }

      unsubscribe = subscribe((event) => {
        if (event.type !== 'message.created') return
        const found = list(filter)
        if (found.length > 0) finish(found)
      })

      timer = setTimer(() => finish([]), timeoutMs)
    })
  }

  return { add, get, update, remove, list, reset, subscribe, waitFor }
}

/**
 * The settings of the mock: the values the panel changes, kept in memory and
 * told to the subscribers.
 * @param initial The settings the mock starts with.
 */
export function createSettings(initial: Settings): SettingsStore {
  let settings: Settings = { ...initial }
  const listeners = new Set<(settings: Settings) => void>()

  /**
   * The settings as they are now, as a copy the caller cannot change them with.
   */
  const get = (): Settings => structuredClone(settings)

  /**
   * Merges the values of the patch that are of the right type, tells the
   * subscribers and gives the new settings back.
   * @param patch The values to merge.
   */
  const update = (patch: Partial<Settings>): Settings => {
    settings = { ...settings, ...accepted(patch) }

    for (const listener of [...listeners]) {
      try {
        listener(structuredClone(settings))
      } catch {
        // One broken listener must not stop the others nor the settings.
      }
    }

    return structuredClone(settings)
  }

  /**
   * Listens to the changes of the settings; the function returned stops it.
   * @param fn The listener.
   */
  const subscribe = (fn: (settings: Settings) => void): (() => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  return { get, update, subscribe }
}

/**
 * Whether a message answers a filter: every filter that is given must answer.
 * @param message The message to test.
 * @param filter The filters to test it against.
 */
function matches(message: Message, filter: ListFilter): boolean {
  if (filter.to !== undefined && message.to !== filter.to) return false
  if (filter.from !== undefined && message.from !== filter.from) return false
  if (filter.number !== undefined && message.to !== filter.number && message.from !== filter.number) return false
  if (filter.status !== undefined && message.status !== filter.status) return false
  if (filter.direction !== undefined && message.direction !== filter.direction) return false
  if (filter.q !== undefined && !hasText(message, filter.q)) return false
  return true
}

/**
 * Whether the text of a message carries the needle, ignoring the case.
 * @param message The message to read.
 * @param needle The text to look for.
 */
function hasText(message: Message, needle: string): boolean {
  const wanted = needle.toLowerCase()
  return (
    message.body.toLowerCase().includes(wanted) ||
    message.from.toLowerCase().includes(wanted) ||
    message.to.toLowerCase().includes(wanted) ||
    message.codes.some((code) => code.toLowerCase().includes(wanted))
  )
}

/**
 * The values of a patch the settings accept: a delay from zero up, a
 * boolean, or a trimmed string; anything else is ignored.
 * @param patch The values to read.
 */
function accepted(patch: Partial<Settings>): Partial<Settings> {
  const kept: Partial<Settings> = {}

  const delay = patch.deliveryDelayMs
  if (typeof delay === 'number' && Number.isFinite(delay) && delay >= 0) kept.deliveryDelayMs = delay
  if (typeof patch.autoDeliver === 'boolean') kept.autoDeliver = patch.autoDeliver
  if (typeof patch.webhookUrl === 'string') kept.webhookUrl = patch.webhookUrl.trim()
  if (typeof patch.webhookSecret === 'string') kept.webhookSecret = patch.webhookSecret.trim()
  if (typeof patch.defaultFrom === 'string') kept.defaultFrom = patch.defaultFrom.trim()

  return kept
}
