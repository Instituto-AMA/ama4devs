import { describe, expect, test } from 'bun:test'
import { applyStatus } from '../src/lifecycle.ts'
import type { Message } from '../src/types.ts'
import { makeHarness, type Harness } from './helpers.ts'

/** The number that delivers normally. */
const NORMAL = '+5511912340000'
/** The number that stages an unreachable handset. */
const UNREACHABLE = '+5511912340001'
/** The number that stages an unknown handset. */
const UNKNOWN = '+5511912340002'
/** The number whose message never leaves `sent`. */
const STUCK = '+5511912340004'
/** The number whose message the carrier filters. */
const FILTERED = '+5511912340005'
/** Where the webhooks of the tests go. */
const WEBHOOK = 'https://hooks.example.test/sms'

/**
 * A message stored as `queued` and handed to the lifecycle.
 * @param harness The harness the message lives in.
 * @param to The number the message goes to.
 */
function send(harness: Harness, to = NORMAL): Message {
  const message = harness.ctx.store.add({
    direction: 'outbound',
    from: 'AMA4DEVS',
    to,
    body: 'Your code is 1234',
    api: 'native',
    status: 'queued',
    callbackUrl: null,
  })
  harness.ctx.lifecycle.accept(message)
  return message
}

/**
 * The message as the store keeps it now.
 * @param harness The harness the message lives in.
 * @param id The id of the message.
 */
function stored(harness: Harness, id: string): Message | undefined {
  return harness.ctx.store.get(id)
}

/**
 * The statuses the webhooks carried, in the order they were posted.
 * @param harness The harness whose calls are read.
 */
function postedStatuses(harness: Harness): string[] {
  return harness.fetchCalls.map((call) => {
    const body = JSON.parse(String(call.init.body)) as { message: { status: string } }
    return body.message.status
  })
}

/**
 * The store and the webhooks of the harness, the two the manual status needs.
 * @param harness The harness the message lives in.
 */
function manualDeps(harness: Harness): { store: Harness['ctx']['store']; webhooks: Harness['ctx']['webhooks'] } {
  return { store: harness.ctx.store, webhooks: harness.ctx.webhooks }
}

describe('the lifecycle of an outbound message', () => {
  test('a normal number is delivered at once when the delay is zero', () => {
    const harness = makeHarness({ webhookUrl: WEBHOOK })
    const message = send(harness)

    const current = stored(harness, message.id)
    expect(current?.status).toBe('delivered')
    expect(current?.history.map((entry) => entry.status)).toEqual(['queued', 'sent', 'delivered'])
    expect(current?.errorCode).toBeNull()
    expect(current?.errorMessage).toBeNull()
    expect(postedStatuses(harness)).toEqual(['queued', 'sent', 'delivered'])
  })

  test('the steps wait for the timer when the delay is positive', () => {
    const harness = makeHarness({ deliveryDelayMs: 900, webhookUrl: WEBHOOK })
    const message = send(harness)

    expect(harness.scheduled.map((entry) => entry.ms)).toEqual([300, 900])
    expect(stored(harness, message.id)?.status).toBe('queued')

    harness.runScheduled()

    const current = stored(harness, message.id)
    expect(current?.status).toBe('delivered')
    expect(current?.history.map((entry) => entry.status)).toEqual(['queued', 'sent', 'delivered'])
    expect(postedStatuses(harness)).toEqual(['queued', 'sent', 'delivered'])
  })

  test('a number ending in 0001 fails with the unreachable handset code', () => {
    const harness = makeHarness()
    const message = send(harness, UNREACHABLE)

    const current = stored(harness, message.id)
    expect(current?.status).toBe('failed')
    expect(current?.errorCode).toBe(30003)
    expect(current?.errorMessage).toBe('Unreachable destination handset')
  })

  test('a number ending in 0002 is undelivered with the unknown handset code', () => {
    const harness = makeHarness()
    const message = send(harness, UNKNOWN)

    const current = stored(harness, message.id)
    expect(current?.status).toBe('undelivered')
    expect(current?.errorCode).toBe(30005)
    expect(current?.errorMessage).toBe('Unknown destination handset')
  })

  test('a number ending in 0004 stays in sent', () => {
    const harness = makeHarness()
    const message = send(harness, STUCK)

    const current = stored(harness, message.id)
    expect(current?.status).toBe('sent')
    expect(current?.history.map((entry) => entry.status)).toEqual(['queued', 'sent'])
    expect(current?.errorCode).toBeNull()
  })

  test('a number ending in 0005 is filtered by the carrier', () => {
    const harness = makeHarness()
    const message = send(harness, FILTERED)

    const current = stored(harness, message.id)
    expect(current?.status).toBe('failed')
    expect(current?.errorCode).toBe(30007)
    expect(current?.errorMessage).toBe('Message filtered by the carrier')
  })

  test('autoDeliver off keeps the message queued', () => {
    const harness = makeHarness({ autoDeliver: false, webhookUrl: WEBHOOK })
    const message = send(harness)

    expect(stored(harness, message.id)?.status).toBe('queued')
    expect(harness.scheduled.length).toBe(0)
    expect(postedStatuses(harness)).toEqual(['queued'])
  })
})

describe('the manual status', () => {
  test('a manual status moves a queued message', () => {
    const harness = makeHarness({ autoDeliver: false, webhookUrl: WEBHOOK })
    const message = send(harness)

    const updated = applyStatus(manualDeps(harness), message.id, 'delivered')

    expect(updated?.status).toBe('delivered')
    expect(updated?.history.map((entry) => entry.status)).toEqual(['queued', 'delivered'])
    expect(stored(harness, message.id)?.status).toBe('delivered')
    expect(postedStatuses(harness)).toEqual(['queued', 'delivered'])
  })

  test('a manual status of an unknown id changes nothing', () => {
    const harness = makeHarness()

    expect(applyStatus(manualDeps(harness), 'SMunknown', 'delivered')).toBeUndefined()
  })

  test('a named code keeps its own message and any other code is a delivery error', () => {
    const harness = makeHarness({ autoDeliver: false })
    const message = send(harness)

    const filtered = applyStatus(manualDeps(harness), message.id, 'failed', 30007)
    expect(filtered?.errorCode).toBe(30007)
    expect(filtered?.errorMessage).toBe('Message filtered by the carrier')

    const other = applyStatus(manualDeps(harness), message.id, 'failed', 21211)
    expect(other?.errorCode).toBe(21211)
    expect(other?.errorMessage).toBe('Delivery error')
  })

  test('a manual status wins over the timer', () => {
    const harness = makeHarness({ deliveryDelayMs: 900, webhookUrl: WEBHOOK })
    const message = send(harness)

    applyStatus(manualDeps(harness), message.id, 'delivered')
    harness.runScheduled()

    const current = stored(harness, message.id)
    expect(current?.status).toBe('delivered')
    expect(current?.history.map((entry) => entry.status)).toEqual(['queued', 'delivered'])
    expect(postedStatuses(harness)).toEqual(['queued', 'delivered'])
  })

  test('a scheduled step is skipped when the message is gone', () => {
    const harness = makeHarness({ deliveryDelayMs: 900, webhookUrl: WEBHOOK })
    const message = send(harness)

    expect(harness.ctx.store.remove(message.id)).toBe(true)
    harness.runScheduled()

    expect(stored(harness, message.id)).toBeUndefined()
    expect(postedStatuses(harness)).toEqual(['queued'])
  })
})
