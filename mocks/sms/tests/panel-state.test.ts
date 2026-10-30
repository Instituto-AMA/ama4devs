import { describe, expect, test } from 'bun:test'
import type { Delivery, Message, Settings } from '../src/types.ts'
import {
  counterparty,
  conversations,
  createState,
  replyTo,
  senders,
  thread,
} from '../public/state.js'

/** The settings the mock starts with. */
const settings: Settings = {
  deliveryDelayMs: 1500,
  autoDeliver: true,
  webhookUrl: '',
  webhookSecret: '',
  defaultFrom: 'AMA4DEVS',
}

/**
 * A message with the fields the panel reads.
 * @param {Partial<Message>} overrides The fields to change.
 * @returns {Message}
 */
function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? 'SM00000000000000000000000000000001',
    direction: overrides.direction ?? 'outbound',
    from: overrides.from ?? 'AMA4DEVS',
    to: overrides.to ?? '+5511912340000',
    body: overrides.body ?? 'ola',
    status: overrides.status ?? 'queued',
    api: overrides.api ?? 'native',
    encoding: overrides.encoding ?? 'GSM-7',
    segments: overrides.segments ?? 1,
    codes: overrides.codes ?? [],
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    callbackUrl: overrides.callbackUrl ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T10:00:00.000Z',
    sentAt: overrides.sentAt ?? null,
    deliveredAt: overrides.deliveredAt ?? null,
    history: overrides.history ?? [],
  }
}

/**
 * A webhook delivery.
 * @param {Partial<Delivery>} overrides The fields to change.
 * @returns {Delivery}
 */
function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: overrides.id ?? 'DL00000000000000000000000000000001',
    messageId: overrides.messageId ?? 'SM00000000000000000000000000000001',
    event: overrides.event ?? 'status',
    url: overrides.url ?? 'http://localhost:8899/hook',
    ok: overrides.ok ?? true,
    statusCode: overrides.statusCode ?? 200,
    error: overrides.error ?? null,
    requestBody: overrides.requestBody ?? '{"event":"message.status"}',
    contentType: overrides.contentType ?? 'application/json',
    signed: overrides.signed ?? false,
    at: overrides.at ?? '2026-01-01T10:00:01.000Z',
  }
}

describe('the panel state', () => {
  test('starts empty', () => {
    const state = createState()

    expect(state.get()).toEqual({
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
    })
  })

  test('is replaced and never changed in place', () => {
    const state = createState()
    const before = state.get()

    state.set({ search: 'a' })

    expect(state.get()).not.toBe(before)
    expect(before.search).toBe('')
    expect(state.get().search).toBe('a')
  })

  test('takes the snapshot of the mock', () => {
    const state = createState()
    const message = makeMessage({ id: 'SM1' })
    const delivery = makeDelivery()

    state.apply({
      type: 'snapshot',
      messages: [message],
      settings,
      deliveries: [delivery],
      version: '0.1.0',
    })

    expect(state.get().messages).toEqual([message])
    expect(state.get().settings).toEqual(settings)
    expect(state.get().deliveries).toEqual([delivery])
    expect(state.get().version).toBe('0.1.0')
  })

  test('appends a created message and selects its conversation', () => {
    const state = createState()
    const message = makeMessage({ id: 'SM1', to: '+5511912340000' })

    state.apply({ type: 'message.created', message })

    expect(state.get().messages).toEqual([message])
    expect(state.get().selected).toBe('+5511912340000')
  })

  test('ignores a created message that is already there', () => {
    const state = createState()
    const message = makeMessage({ id: 'SM1' })
    state.apply({ type: 'message.created', message })

    let notified = 0
    state.subscribe(() => {
      notified += 1
    })

    state.apply({ type: 'message.created', message })

    expect(state.get().messages).toHaveLength(1)
    expect(notified).toBe(0)
  })

  test('replaces an updated message', () => {
    const state = createState()
    state.apply({ type: 'message.created', message: makeMessage({ id: 'SM1', status: 'queued' }) })

    state.apply({ type: 'message.updated', message: makeMessage({ id: 'SM1', status: 'delivered' }) })

    expect(state.get().messages).toHaveLength(1)
    expect(state.get().messages[0]?.status).toBe('delivered')
  })

  test('appends an updated message that is unknown', () => {
    const state = createState()
    const message = makeMessage({ id: 'SM2' })

    state.apply({ type: 'message.updated', message })

    expect(state.get().messages).toEqual([message])
  })

  test('removes a deleted message and closes it in the inspector', () => {
    const state = createState()
    state.apply({ type: 'message.created', message: makeMessage({ id: 'SM1' }) })
    state.set({ selectedMessageId: 'SM1' })

    state.apply({ type: 'message.deleted', id: 'SM1' })

    expect(state.get().messages).toEqual([])
    expect(state.get().selectedMessageId).toBeNull()
  })

  test('empties the messages and the deliveries on a reset', () => {
    const state = createState()
    state.apply({ type: 'message.created', message: makeMessage({ id: 'SM1' }) })
    state.apply({ type: 'delivery', delivery: makeDelivery() })
    state.set({ selected: '+5511912340000', selectedMessageId: 'SM1' })

    state.apply({ type: 'reset' })

    expect(state.get().messages).toEqual([])
    expect(state.get().deliveries).toEqual([])
    expect(state.get().selected).toBeNull()
    expect(state.get().selectedMessageId).toBeNull()
  })

  test('keeps the search and the filters of the sidebar on a reset', () => {
    const state = createState()
    state.apply({ type: 'message.created', message: makeMessage({ id: 'SM1' }) })
    state.set({ search: 'ola', filter: 'noreply', sender: 'AMA4DEVS' })

    state.apply({ type: 'reset' })

    expect(state.get().messages).toEqual([])
    expect(state.get().search).toBe('ola')
    expect(state.get().filter).toBe('noreply')
    expect(state.get().sender).toBe('AMA4DEVS')
  })

  test('keeps the deliveries newest first and never more than two hundred', () => {
    const state = createState()
    state.apply({ type: 'delivery', delivery: makeDelivery({ id: 'DL2' }) })
    state.apply({ type: 'delivery', delivery: makeDelivery({ id: 'DL1' }) })

    expect(state.get().deliveries.map((one) => one.id)).toEqual(['DL1', 'DL2'])

    for (let at = 0; at < 250; at++) {
      state.apply({ type: 'delivery', delivery: makeDelivery({ id: `DL${at}` }) })
    }

    expect(state.get().deliveries).toHaveLength(200)
  })

  test('empties the deliveries when the mock clears them', () => {
    const state = createState()
    state.apply({ type: 'delivery', delivery: makeDelivery() })

    state.apply({ type: 'deliveries.cleared' })

    expect(state.get().deliveries).toEqual([])
  })

  test('takes the settings of the mock', () => {
    const state = createState()

    state.apply({ type: 'settings.updated', settings: { ...settings, deliveryDelayMs: 0 } })

    expect(state.get().settings?.deliveryDelayMs).toBe(0)
  })

  test('tells the listeners once per change and lets them leave', () => {
    const state = createState()
    let notified = 0
    const leave = state.subscribe(() => {
      notified += 1
    })

    state.set({ search: 'a' })
    expect(notified).toBe(1)

    state.apply({ type: 'message.created', message: makeMessage({ id: 'SM1' }) })
    expect(notified).toBe(2)

    leave()
    state.set({ search: 'b' })
    expect(notified).toBe(2)
  })
})

describe('the selectors of the panel', () => {
  test('the counterparty is the number on the other side', () => {
    expect(counterparty(makeMessage({ direction: 'outbound', from: 'AMA4DEVS', to: '+5511912340000' }))).toBe(
      '+5511912340000',
    )
    expect(
      counterparty(makeMessage({ direction: 'inbound', from: '+5511912340000', to: '+5500000000000' })),
    ).toBe('+5511912340000')
  })

  test('the conversations group by counterparty and the newest comes first', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM1', to: '+5511912340000', createdAt: '2026-01-01T10:00:00.000Z' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM2', to: '+5511888888888', createdAt: '2026-01-01T12:00:00.000Z' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM3', to: '+5511912340000', createdAt: '2026-01-01T11:00:00.000Z' }),
    })

    const list = conversations(state.get())

    expect(list.map((one) => one.number)).toEqual(['+5511888888888', '+5511912340000'])
    expect(list[1]?.count).toBe(2)
    expect(list[1]?.last.id).toBe('SM3')
  })

  test('the search narrows the conversations by body, number and code', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM1', to: '+5511912340000', body: 'Seu codigo e 482913', codes: ['482913'] }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM2', to: '+5511888888888', body: 'oferta do dia' }),
    })

    state.set({ search: '482913' })
    expect(conversations(state.get()).map((one) => one.number)).toEqual(['+5511912340000'])

    state.set({ search: '88888' })
    expect(conversations(state.get()).map((one) => one.number)).toEqual(['+5511888888888'])

    state.set({ search: 'OFERTA' })
    expect(conversations(state.get()).map((one) => one.number)).toEqual(['+5511888888888'])

    state.set({ search: '' })
    expect(conversations(state.get())).toHaveLength(2)
  })

  test('the unread count is the outbound messages that wait for a reply', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM1', direction: 'outbound', to: '+5511912340000' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM2', direction: 'inbound', from: '+5511912340000', to: '+5500000000000' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM3', direction: 'outbound', to: '+5511912340000' }),
    })

    const list = conversations(state.get())

    expect(list[0]?.count).toBe(3)
    expect(list[0]?.unread).toBe(1)
  })

  test('a conversation without an answer counts every outbound message', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM1', direction: 'outbound', to: '+5511912340000' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM2', direction: 'outbound', to: '+5511912340000' }),
    })

    expect(conversations(state.get())[0]?.unread).toBe(2)
  })

  test('the thread of a conversation is the oldest first', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM2', to: '+5511912340000', createdAt: '2026-01-01T12:00:00.000Z' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM1', to: '+5511912340000', createdAt: '2026-01-01T10:00:00.000Z' }),
    })
    state.apply({ type: 'message.created', message: makeMessage({ id: 'SM3', to: '+5511888888888' }) })

    expect(thread(state.get(), '+5511912340000').map((one) => one.id)).toEqual(['SM1', 'SM2'])
    expect(thread(state.get(), '+5511888888888').map((one) => one.id)).toEqual(['SM3'])
  })
})

describe('the filters of the sidebar', () => {
  /**
   * Four conversations: one the handset never answered, one it answered, one
   * with an undelivered message it answered and one with a failed message it
   * never answered.
   * @returns {ReturnType<typeof createState>}
   */
  function stateOfFour(): ReturnType<typeof createState> {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM1',
        direction: 'outbound',
        from: 'ALFA',
        to: '+5511912340000',
        status: 'delivered',
        createdAt: '2026-01-01T10:00:00.000Z',
      }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM2',
        direction: 'outbound',
        from: 'ALFA',
        to: '+5511888888888',
        status: 'delivered',
        createdAt: '2026-01-01T10:00:00.000Z',
      }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM3',
        direction: 'inbound',
        from: '+5511888888888',
        to: 'ALFA',
        status: 'received',
        createdAt: '2026-01-01T11:00:00.000Z',
      }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM4',
        direction: 'outbound',
        from: 'ALFA',
        to: '+5511777777777',
        status: 'undelivered',
        createdAt: '2026-01-01T10:00:00.000Z',
      }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM5',
        direction: 'inbound',
        from: '+5511777777777',
        to: 'ALFA',
        status: 'received',
        createdAt: '2026-01-01T11:00:00.000Z',
      }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM6',
        direction: 'outbound',
        from: 'ALFA',
        to: '+5511666666666',
        status: 'failed',
        createdAt: '2026-01-01T10:00:00.000Z',
      }),
    })
    return state
  }

  test('the senders are the distinct senders of the outbound messages, sorted', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM1', direction: 'outbound', from: 'ZULU' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM2', direction: 'outbound', from: 'ALFA', to: '+5511888888888' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM3', direction: 'outbound', from: 'ALFA', to: '+5511777777777' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM4',
        direction: 'inbound',
        from: '+5511666666666',
        to: 'ALFA',
        status: 'received',
      }),
    })

    expect(senders(state.get())).toEqual(['ALFA', 'ZULU'])
  })

  test('the chip all keeps every conversation', () => {
    const state = stateOfFour()

    state.set({ filter: 'all' })

    expect(conversations(state.get()).map((one) => one.number).sort()).toEqual([
      '+5511666666666',
      '+5511777777777',
      '+5511888888888',
      '+5511912340000',
    ])
  })

  test('the chip noreply keeps the conversations the handset never answered', () => {
    const state = stateOfFour()

    state.set({ filter: 'noreply' })

    expect(conversations(state.get()).map((one) => one.number).sort()).toEqual([
      '+5511666666666',
      '+5511912340000',
    ])
  })

  test('the chip failed keeps the conversations with a message that did not reach', () => {
    const state = stateOfFour()

    state.set({ filter: 'failed' })

    expect(conversations(state.get()).map((one) => one.number).sort()).toEqual([
      '+5511666666666',
      '+5511777777777',
    ])
  })

  test('the sender keeps the conversations it wrote to', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM1', direction: 'outbound', from: 'ALFA', to: '+5511912340000' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({ id: 'SM2', direction: 'outbound', from: 'BRAVO', to: '+5511888888888' }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM3',
        direction: 'inbound',
        from: '+5511777777777',
        to: 'ALFA',
        status: 'received',
      }),
    })

    state.set({ sender: 'ALFA' })
    expect(conversations(state.get()).map((one) => one.number)).toEqual(['+5511912340000'])

    state.set({ sender: 'BRAVO' })
    expect(conversations(state.get()).map((one) => one.number)).toEqual(['+5511888888888'])

    state.set({ sender: '+5511777777777' })
    expect(conversations(state.get())).toEqual([])

    state.set({ sender: null })
    expect(conversations(state.get())).toHaveLength(3)
  })

  test('the chip, the sender and the search narrow the conversations together', () => {
    const state = createState()
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM1',
        direction: 'outbound',
        from: 'ALFA',
        to: '+5511912340000',
        body: 'oferta do dia',
      }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM2',
        direction: 'outbound',
        from: 'BRAVO',
        to: '+5511888888888',
        body: 'oferta do dia',
      }),
    })
    state.apply({
      type: 'message.created',
      message: makeMessage({
        id: 'SM3',
        direction: 'outbound',
        from: 'ALFA',
        to: '+5511777777777',
        body: 'outro assunto',
      }),
    })

    state.set({ filter: 'noreply', sender: 'ALFA' })
    expect(conversations(state.get()).map((one) => one.number).sort()).toEqual([
      '+5511777777777',
      '+5511912340000',
    ])

    state.set({ search: 'oferta' })
    expect(conversations(state.get()).map((one) => one.number)).toEqual(['+5511912340000'])
  })
})

describe('replyTo', () => {
  test('answers the sender of the newest outbound message', () => {
    const state = createState()
    state.apply({
      type: 'snapshot',
      messages: [makeMessage({ id: 'SM1', from: '+5511988887777', to: '+5511912345678' })],
      settings,
      deliveries: [],
      version: '0.1.0',
    })

    expect(replyTo(state.get(), '+5511912345678')).toBe('+5511988887777')
    expect(replyTo(state.get(), '+5511900000000')).toBeNull()
  })
})

describe('senders', () => {
  test('the chosen sender stays offered after the store loses it', () => {
    const state = createState()
    state.set({ sender: 'ASAAS' })
    expect(senders(state.get())).toEqual(['ASAAS'])
  })
})
