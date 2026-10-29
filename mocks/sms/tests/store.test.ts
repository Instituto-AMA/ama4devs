import { describe, expect, test } from 'bun:test'
import { createSettings, createStore, type ListFilter, type NewMessage } from '../src/store.ts'
import type { Settings, StoreEvent } from '../src/types.ts'

/** The moment the fake clock starts from. */
const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z')

/**
 * A clock that walks one second per call, so every time in the store differs.
 */
function fakeNow(): () => Date {
  let tick = 0
  return () => new Date(BASE_TIME + tick++ * 1000)
}

/**
 * An id maker that counts: `SM` and the counter as thirty-two hex digits.
 */
function fakeNewId(): () => string {
  let counter = 0
  return () => `SM${(counter++).toString(16).padStart(32, '0')}`
}

/** The timers the store waits on, kept in memory so the test fires them. */
interface FakeTimers {
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
  /** Fires the callbacks that are still waiting. */
  fire: () => void
  /** How many timers are waiting. */
  pending: () => number
}

/**
 * The timers the store uses, captured instead of waited on.
 */
function fakeTimers(): FakeTimers {
  const waiting = new Map<number, () => void>()
  let next = 1

  const setTimer = ((fn: () => void): number => {
    const handle = next++
    waiting.set(handle, fn)
    return handle
  }) as unknown as typeof setTimeout
  const clearTimer = ((handle: number): void => {
    waiting.delete(handle)
  }) as unknown as typeof clearTimeout

  return {
    setTimer,
    clearTimer,
    fire: () => {
      const callbacks = [...waiting.values()]
      waiting.clear()
      for (const callback of callbacks) callback()
    },
    pending: () => waiting.size,
  }
}

/**
 * A store with the fake clock, the fake ids and, when the test needs it, the
 * fake timers.
 * @param maxMessages How many messages are kept.
 * @param timers The timers the store waits on.
 */
function newStore(maxMessages = 10, timers?: FakeTimers) {
  const now = fakeNow()
  const newId = fakeNewId()
  const store = createStore({
    now,
    newId,
    maxMessages,
    ...(timers ? { setTimer: timers.setTimer, clearTimer: timers.clearTimer } : {}),
  })
  return { store, now, newId }
}

/**
 * A message as a caller sends it, with the fields the test wants to change.
 * @param overrides The fields to change.
 */
function newMessage(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    direction: 'outbound',
    from: 'AMA4DEVS',
    to: '+5511912340000',
    body: 'Your code is 123456',
    api: 'native',
    status: 'queued',
    ...overrides,
  }
}

describe('createStore', () => {
  test('add computes the encoding, the segments, the codes and the history', () => {
    const { store } = newStore()
    const message = store.add(newMessage())

    expect(message.id).toMatch(/^SM[0-9a-f]{32}$/)
    expect(message.encoding).toBe('GSM-7')
    expect(message.segments).toBe(1)
    expect(message.codes).toEqual(['123456'])
    expect(message.status).toBe('queued')
    expect(message.history).toEqual([{ status: 'queued', at: message.createdAt }])
    expect(message.createdAt).toBe(message.updatedAt)
    expect(message.sentAt).toBeNull()
    expect(message.deliveredAt).toBeNull()
    expect(message.errorCode).toBeNull()
    expect(message.errorMessage).toBeNull()
    expect(message.callbackUrl).toBeNull()
    expect(store.get(message.id)).toEqual(message)
  })

  test('add announces the message it stored', () => {
    const { store } = newStore()
    const events: StoreEvent[] = []
    store.subscribe((event) => events.push(event))

    const message = store.add(newMessage())

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('message.created')
    expect(events[0]).toEqual({ type: 'message.created', message })
  })

  test('the cap drops the oldest message and announces it', () => {
    const { store } = newStore(2)
    const events: StoreEvent[] = []
    store.subscribe((event) => events.push(event))

    const first = store.add(newMessage({ body: 'one' }))
    const second = store.add(newMessage({ body: 'two' }))
    const third = store.add(newMessage({ body: 'three' }))

    expect(store.list().map((message) => message.id)).toEqual([second.id, third.id])
    expect(store.get(first.id)).toBeUndefined()
    expect(events.map((event) => event.type)).toEqual([
      'message.created',
      'message.created',
      'message.deleted',
      'message.created',
    ])
    expect(events[2]).toEqual({ type: 'message.deleted', id: first.id })
  })

  test('update joins the history and keeps the first sent and delivered times', () => {
    const { store } = newStore()
    const message = store.add(newMessage())

    const sent = store.update(message.id, { status: 'sent' })
    expect(sent?.status).toBe('sent')
    expect(sent?.history).toHaveLength(2)
    expect(sent?.history[1]?.status).toBe('sent')
    expect(sent?.sentAt).toBe(sent?.history[1]?.at)
    expect(sent?.deliveredAt).toBeNull()
    expect(sent?.updatedAt).not.toBe(message.updatedAt)

    const delivered = store.update(message.id, { status: 'delivered' })
    expect(delivered?.history).toHaveLength(3)
    expect(delivered?.sentAt).toBe(sent?.sentAt)
    expect(delivered?.deliveredAt).toBe(delivered?.history[2]?.at)

    const again = store.update(message.id, { status: 'sent' })
    expect(again?.sentAt).toBe(sent?.sentAt)
    expect(again?.history).toHaveLength(4)

    expect(store.update('SMunknown', { status: 'sent' })).toBeUndefined()
  })

  test('update announces the message it changed', () => {
    const { store } = newStore()
    const events: StoreEvent[] = []
    store.subscribe((event) => events.push(event))

    const message = store.add(newMessage())
    events.length = 0

    const updated = store.update(message.id, { status: 'failed', errorCode: 30003, errorMessage: 'failed' })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('message.updated')
    expect(updated?.errorCode).toBe(30003)
    expect(updated?.errorMessage).toBe('failed')
    expect(updated?.history).toHaveLength(2)
  })

  test('a patch that changes nothing announces nothing', () => {
    const { store } = newStore()
    const events: StoreEvent[] = []
    store.subscribe((event) => events.push(event))

    const message = store.add(newMessage())
    events.length = 0

    const same = store.update(message.id, { status: 'queued' })

    expect(same?.status).toBe('queued')
    expect(same?.updatedAt).toBe(message.updatedAt)
    expect(events).toEqual([])
  })

  test('the filters narrow the list', () => {
    const { store } = newStore()
    const first = store.add(newMessage({ to: '+5511912340000', body: 'code 111111' }))
    const second = store.add(newMessage({ to: '+5511912340001', body: 'ola 222222', status: 'sent' }))
    const third = store.add(
      newMessage({ from: '+5511987654321', to: '+5511912340002', body: 'ping', direction: 'inbound', status: 'received' }),
    )

    const ids = (filter?: ListFilter): string[] =>
      store.list(filter).map((message) => message.id)

    expect(ids({ to: '+5511912340001' })).toEqual([second.id])
    expect(ids({ from: '+5511987654321' })).toEqual([third.id])
    expect(ids({ number: '+5511912340001' })).toEqual([second.id])
    expect(ids({ number: '+5511987654321' })).toEqual([third.id])
    expect(ids({ number: '+5511912340002' })).toEqual([third.id])
    expect(ids({ q: 'CODE' })).toEqual([first.id])
    expect(ids({ q: '222222' })).toEqual([second.id])
    expect(ids({ q: 'ping' })).toEqual([third.id])
    expect(ids({ q: '+5511912340000' })).toEqual([first.id])
    expect(ids({ q: 'AMA4DEVS' })).toEqual([first.id, second.id])
    expect(ids({ status: 'sent' })).toEqual([second.id])
    expect(ids({ direction: 'inbound' })).toEqual([third.id])
    expect(ids({ afterId: first.id })).toEqual([second.id, third.id])
    expect(ids({ afterId: 'SMunknown' })).toEqual([first.id, second.id, third.id])
    expect(ids({ limit: 2 })).toEqual([second.id, third.id])
    expect(ids({ status: 'sent', direction: 'outbound' })).toEqual([second.id])
    expect(ids({ status: 'sent', direction: 'inbound' })).toEqual([])
    expect(ids()).toEqual([first.id, second.id, third.id])
  })

  test('the messages the store gives are copies', () => {
    const { store } = newStore()
    const added = store.add(newMessage())

    added.body = 'changed'
    added.history.push({ status: 'failed', at: added.createdAt })
    expect(store.get(added.id)?.body).toBe('Your code is 123456')
    expect(store.get(added.id)?.history).toHaveLength(1)

    const listed = store.list()
    const first = listed[0]
    if (first) first.status = 'failed'
    expect(store.get(added.id)?.status).toBe('queued')
  })

  test('remove and reset announce what they did', () => {
    const { store } = newStore()
    const events: StoreEvent[] = []
    store.subscribe((event) => events.push(event))

    const message = store.add(newMessage())
    expect(store.remove(message.id)).toBe(true)
    expect(store.remove(message.id)).toBe(false)
    expect(store.remove('SMunknown')).toBe(false)

    store.add(newMessage())
    store.reset()

    expect(store.list()).toEqual([])
    expect(events.map((event) => event.type)).toEqual([
      'message.created',
      'message.deleted',
      'message.created',
      'reset',
    ])
  })

  test('a listener that throws does not break the store', () => {
    const { store } = newStore()
    store.subscribe(() => {
      throw new Error('broken listener')
    })
    const seen: string[] = []
    store.subscribe((event) => seen.push(event.type))

    const message = store.add(newMessage())

    expect(seen).toEqual(['message.created'])
    expect(store.get(message.id)).toBeDefined()
  })
})

describe('waitFor', () => {
  test('it answers at once when the list already has a match', async () => {
    const { store } = newStore()
    store.add(newMessage({ to: '+5511912340000' }))

    const found = await store.waitFor({ to: '+5511912340000' }, 1000)

    expect(found).toHaveLength(1)
    expect(found[0]?.to).toBe('+5511912340000')
  })

  test('it answers when a later message matches', async () => {
    const timers = fakeTimers()
    const { store } = newStore(10, timers)

    const pending = store.waitFor({ to: '+5511912340000' }, 1000)
    store.add(newMessage({ to: '+5511912340000' }))
    const found = await pending

    expect(found).toHaveLength(1)
    expect(found[0]?.to).toBe('+5511912340000')
    expect(timers.pending()).toBe(0)
  })

  test('it gives up empty when the timer fires', async () => {
    const timers = fakeTimers()
    const { store } = newStore(10, timers)

    const pending = store.waitFor({ to: '+5511912340000' }, 1000)
    expect(timers.pending()).toBe(1)

    timers.fire()

    expect(await pending).toEqual([])
    expect(timers.pending()).toBe(0)
  })

  test('it gives up empty at once when the timeout is not positive', async () => {
    const timers = fakeTimers()
    const { store } = newStore(10, timers)

    expect(await store.waitFor({ to: '+5511912340000' }, 0)).toEqual([])
    expect(timers.pending()).toBe(0)
  })
})

describe('createSettings', () => {
  const initial: Settings = {
    deliveryDelayMs: 1500,
    autoDeliver: true,
    webhookUrl: '',
    webhookSecret: '',
    defaultFrom: 'AMA4DEVS',
  }

  test('it keeps the settings it starts with', () => {
    const settings = createSettings({ ...initial })

    expect(settings.get()).toEqual(initial)
  })

  test('it merges only the values of the right type', () => {
    const settings = createSettings({ ...initial })

    const updated = settings.update({
      deliveryDelayMs: -1,
      autoDeliver: 'yes',
      webhookUrl: ' http://localhost/hook ',
      webhookSecret: 42,
      defaultFrom: 'AMA',
    } as unknown as Partial<Settings>)

    expect(updated.deliveryDelayMs).toBe(1500)
    expect(updated.autoDeliver).toBe(true)
    expect(updated.webhookUrl).toBe('http://localhost/hook')
    expect(updated.webhookSecret).toBe('')
    expect(updated.defaultFrom).toBe('AMA')
    expect(settings.update({ deliveryDelayMs: 0 }).deliveryDelayMs).toBe(0)
  })

  test('it tells the subscribers and stops when they leave', () => {
    const settings = createSettings({ ...initial })
    const seen: Settings[] = []
    const unsubscribe = settings.subscribe((value) => seen.push(value))

    settings.update({ defaultFrom: 'AMA' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.defaultFrom).toBe('AMA')

    unsubscribe()
    settings.update({ defaultFrom: 'OTHER' })
    expect(seen).toHaveLength(1)
    expect(settings.get().defaultFrom).toBe('OTHER')
  })

  test('the settings it gives are copies', () => {
    const settings = createSettings({ ...initial })

    const copy = settings.get()
    copy.defaultFrom = 'hacked'
    expect(settings.get().defaultFrom).toBe('AMA4DEVS')
  })
})
