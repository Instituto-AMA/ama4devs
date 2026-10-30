/**
 * The webhook engine — the test that justifies the project.
 *
 * Everything here runs against a REAL HTTP server (the WebhookSink), with fetch from
 * for real: it is the only way to exercise the `asaas-access-token` header, the timeout,
 * and the rule that only HTTP 200 is a success. An in-memory spy would pass the
 * same asserts without testing any of what breaks in real life.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { HOUR_MS, MINUTE_MS } from '../../src/core/clock.ts'
import type { DomainEvent } from '../../src/core/events.ts'
import { webhookDeliveries, webhooks } from '../../src/db/schema/index.ts'
import { BACKOFF_MS } from '../../src/webhooks/backoff.ts'
import { rewriteForContainer, resetRewriteNotice } from '../../src/webhooks/rewrite.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

/** Creates the webhook through the API — it is how the simulator's user does it. */
async function createWebhook(overrides: Record<string, unknown> = {}) {
  const res = await h.api.call('create-new-webhook', {
    body: {
      name: 'Integration',
      url: h.sink.url,
      email: 'dev@localhost',
      sendType: 'NON_SEQUENTIALLY',
      authToken: 'a'.repeat(32),
      events: ['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'],
      ...overrides,
    },
  })
  expect(res.status).toBe(200)
  return res.body
}

/**
 * Emits a domain event directly, the way a charge handler would do it inside its
 * transaction. The payload is FROZEN here.
 */
async function emit(event: string, resource: Record<string, unknown>): Promise<void> {
  const domainEvent: DomainEvent = {
    accountId: h.accountId,
    event,
    resourceType: 'payment',
    resourceId: String(resource.id),
    resource,
  }
  await h.app.ctx.emit(h.app.db, domainEvent)
}

const deliveries = () =>
  h.app.db.select().from(webhookDeliveries).orderBy(webhookDeliveries.sequence)

const webhookRow = (id: string) =>
  h.app.db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, id))
    .limit(1)
    .then((r) => r[0]!)

// ──────────────────────────────────── time travel × delivery queue

describe('turning the clock back unblocks the queue', () => {
  /**
   * THE BUG THIS TEST KEEPS FROM COMING BACK — and it cost an afternoon.
   *
   * Someone clicks `+32` in the panel to watch a card credit. Meanwhile a
   * delivery fails, and the backoff reschedules it for "30 seconds from now" — except that
   * instant is a month ahead of the REAL time. Turning the clock back to the present does not
   * undo the scheduling: the delivery becomes unreachable and, since the `sendType` is
   * SEQUENTIALLY, it freezes the WHOLE queue behind it. No webhook arrives anymore.
   *
   * At the end, the symptom looks like none of that. It looks like "Asaas says the payment
   * was RECEIVED, but my order is still pending" — and you will look for the bug in
   * your status route, which is right.
   */
  it('reset pulls back the deliveries that were scheduled in the future', async () => {
    await createWebhook({ sendType: 'SEQUENTIALLY' })

    // Travels to the future and fails a delivery THERE: the backoff reschedules it for an
    // instant that, seen from the present, has not arrived yet.
    //
    // It has to be the future of the REAL clock, not the harness's — it starts in January
    // 2026, so `advance({days: 30})` would still land in the past and the delivery would not
    // get stuck. It is exactly that asymmetry that makes the bug hard to see.
    const futureDate = new Date(Date.now() + 30 * 86_400_000).toISOString()
    await h.app.app.handle(
      new Request('http://localhost/_admin/clock/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: futureDate }),
      }),
    )

    h.sink.respondWith(500)
    await emit('PAYMENT_CREATED', { id: 'pay_1', status: 'PENDING' })
    await h.tick()

    const [failed] = await deliveries()
    expect(failed!.attempt).toBe(1)
    expect(failed!.nextAttemptAtMs).toBeGreaterThan(Date.now()) // stuck in the future

    // The endpoint comes back up and a new event happens in the PRESENT.
    const res = await h.app.app.handle(
      new Request('http://localhost/_admin/clock/reset', { method: 'POST' }),
    )
    const body = (await res.json()) as { rescheduledDeliveries: number }
    expect(body.rescheduledDeliveries).toBe(1)

    h.sink.respondWith(200)
    await h.tick()

    // Without the pull-back, these expects fail: the queue would be stuck behind the delivery
    // scheduled for 30 days from now, and the sink would never see the redelivery.
    const [drained] = await deliveries()
    expect(drained!.status).toBe('DELIVERED')
    expect(drained!.attempt).toBe(2) // the one that took the 500, and the one that passed
    expect(h.sink.received.length).toBe(2)
  })

  it('the pull-back does not touch an already delivered one nor resurrect an expired one', async () => {
    await createWebhook({ sendType: 'SEQUENTIALLY' })

    h.sink.respondWith(200)
    await emit('PAYMENT_CREATED', { id: 'pay_ok', status: 'PENDING' })
    await h.tick()

    const [done] = await deliveries()
    expect(done!.status).toBe('DELIVERED')
    const before = done!.nextAttemptAtMs

    await h.app.app.handle(new Request('http://localhost/_admin/clock/reset', { method: 'POST' }))

    const [after] = await deliveries()
    expect(after!.status).toBe('DELIVERED')
    expect(after!.nextAttemptAtMs).toBe(before)
  })
})

// ──────────────────────────────────── queue diagnosis (the panel's card)

describe('queueHealth — why the queue is not moving', () => {
  const health = async () => {
    const res = await h.app.app.handle(new Request('http://localhost/_admin/webhooks/queue'))
    const body = (await res.json()) as { webhooks: any[] }
    return body.webhooks[0]!
  }

  /**
   * Each account has ITS OWN webhooks, and its key is the only one that sees them.
   *
   * Without the owner in this response, the panel listed the 8 webhooks of 8 accounts
   * as if they were 8 duplicated records of the same one ("why do I have 8
   * webhooks?"), and the "Reactivate queue" button called the /v3 with the account's key
   * selected one — 404 on all of them, except on its own.
   */
  it("each webhook comes with its OWNING account — another account's key does not see it", async () => {
    await createWebhook({ name: 'do master' })

    const w = await health()
    expect(w.accountId).toBe(h.accountId)
    expect(w.accountName).toBeString()

    // The proof that the owner matters: the key of another account returns 404.
    const other = await h.api.call('create-subaccount', {
      body: {
        name: 'Produtora',
        email: 'produtora@localhost',
        cpfCnpj: '24971563792',
        mobilePhone: '11999999999',
        incomeValue: 5000,
        address: 'Rua X',
        addressNumber: '1',
        province: 'Centro',
        postalCode: '01310100',
      },
    })
    expect(other.status).toBe(200)

    const res = await h.app.app.handle(
      new Request(`http://localhost/v3/webhooks/${w.webhookId}/removeBackoff`, {
        method: 'POST',
        headers: { access_token: other.body.apiKey },
      }),
    )
    expect(res.status).toBe(404)
  })

  it('a queue that is moving does not report a block', async () => {
    await createWebhook({ sendType: 'SEQUENTIALLY' })
    h.sink.respondWith(200)
    await emit('PAYMENT_CREATED', { id: 'pay_1', status: 'PENDING' })
    await h.tick()

    const w = await health()
    expect(w.blocked).toBeNull()
    expect(w.pending).toBe(0)
  })

  /**
   * The case that motivated the card. The endpoint answers 500, the head of the queue freezes, and
   * ALL the deliveries behind it stop. The panel has to say that in so many
   * words — including the HTTP the endpoint returned, because it is the information that
   * sends the developer to the right place.
   */
  it('in SEQUENTIALLY, the failing head freezes the ones behind it — and the card says how many', async () => {
    await createWebhook({ sendType: 'SEQUENTIALLY' })
    h.sink.respondWith(500)

    await emit('PAYMENT_CREATED', { id: 'pay_1', status: 'PENDING' })
    await emit('PAYMENT_CONFIRMED', { id: 'pay_2', status: 'CONFIRMED' })
    await emit('PAYMENT_RECEIVED', { id: 'pay_3', status: 'RECEIVED' })
    await h.tick()

    const w = await health()
    expect(w.pending).toBe(3)
    expect(w.blocked.reason).toBe('HEAD_FAILING')
    expect(w.blocked.event).toBe('PAYMENT_CREATED') // a de MENOR sequence
    expect(w.blocked.lastStatusCode).toBe(500)
    expect(w.blocked.behind).toBe(2) // the other two, stuck behind
  })

  it('NON_SEQUENTIALLY has no head-of-line: one failure does not freeze the others', async () => {
    await createWebhook({ sendType: 'NON_SEQUENTIALLY' })
    h.sink.respondWith(500)
    await emit('PAYMENT_CREATED', { id: 'pay_1', status: 'PENDING' })
    await h.tick()

    const w = await health()
    expect(w.pending).toBe(1) // it failed and will redeliver
    expect(w.blocked).toBeNull() // but it holds nobody
  })

  it('exhausting the backoff becomes INTERRUPTED — and removeBackoff unlocks it', async () => {
    const wh = await createWebhook({ sendType: 'SEQUENTIALLY' })
    h.sink.respondWith(500)
    await emit('PAYMENT_CREATED', { id: 'pay_1', status: 'PENDING' })

    // The 15 attempts, each one at its exact backoff step. End of the line.
    await h.tick()
    for (const offset of BACKOFF_MS.slice(1)) {
      h.clock.advance(offset)
      await h.tick()
    }

    expect((await webhookRow(wh.id)).interrupted).toBe(true)
    expect((await health()).blocked.reason).toBe('INTERRUPTED')

    // The developer fixes the endpoint and presses the button. It is the REAL Asaas operation.
    h.sink.respondWith(200)
    const res = await h.api.call('remove-webhook-backoff', { params: { id: wh.id } })
    expect(res.status).toBe(204)
    await h.tick()

    const w = await health()
    expect(w.blocked).toBeNull()
    expect(w.interrupted).toBe(false)
    expect(w.pending).toBe(0)
  })
})

// ────────────────────────────────────────────────────────── CRUD

describe('webhooks — CRUD', () => {
  it('creates, retrieves, lists and removes — and never returns the authToken', async () => {
    const created = await createWebhook({ name: 'Meu webhook' })

    expect(created.id).toBeString()
    expect(created.name).toBe('Meu webhook')
    expect(created.enabled).toBe(true)
    expect(created.interrupted).toBe(false)
    expect(created.apiVersion).toBe(3)
    // The token only leaves from here, inside the header of a delivery.
    expect(created.hasAuthToken).toBe(true)
    expect(created).not.toHaveProperty('authToken')
    expect(created.events).toEqual([
      'PAYMENT_CREATED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_RECEIVED',
    ])

    const got = await h.api.call('retrieve-a-single-webhook', {
      params: { id: created.id },
    })
    expect(got.body.id).toBe(created.id)

    const list = await h.api.call('list-webhooks')
    expect(list.body.object).toBe('list')
    expect(list.body.totalCount).toBe(1)
    expect(list.body.data[0].id).toBe(created.id)

    const del = await h.api.call('remove-webhook', { params: { id: created.id } })
    expect(del.body).toEqual({ deleted: true, id: created.id })

    const gone = await h.api.call('retrieve-a-single-webhook', {
      params: { id: created.id },
    })
    expect(gone.status).toBe(404)
  })

  it('refuses the 11th webhook of the account', async () => {
    for (let i = 0; i < 10; i++) await createWebhook({ name: `w${i}` })

    const res = await h.api.call('create-new-webhook', {
      body: {
        name: 'the eleventh',
        url: h.sink.url,
        email: 'dev@localhost',
        sendType: 'NON_SEQUENTIALLY',
        events: ['PAYMENT_RECEIVED'],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].description).toContain('limite de 10 webhooks')
  })

  it('refuses an authToken outside 32–255 characters', async () => {
    const res = await h.api.call('create-new-webhook', {
      body: {
        name: 'curto demais',
        url: h.sink.url,
        email: 'dev@localhost',
        sendType: 'NON_SEQUENTIALLY',
        authToken: 'curto',
        events: ['PAYMENT_RECEIVED'],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].code).toBe('invalid_authToken')
  })
})

// ────────────────────────────────────────────────────────── delivery

describe('webhooks — delivery', () => {
  it('delivers the event in Asaas’s envelope, with the asaas-access-token header', async () => {
    const wh = await createWebhook({ authToken: 'tok_'.padEnd(40, 'x') })
    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001', value: 100 })

    const report = await h.tick()

    expect(h.sink.received).toHaveLength(1)
    const [got] = h.sink.received

    expect(got!.headers['asaas-access-token']).toBe('tok_'.padEnd(40, 'x'))
    expect(got!.headers['content-type']).toContain('application/json')

    // O envelope EXATO do Asaas.
    expect(got!.payload.id).toStartWith('evt_')
    expect(got!.payload.event).toBe('PAYMENT_RECEIVED')
    expect(got!.payload.dateCreated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(got!.payload.account).toEqual({ id: h.accountId, ownerId: null })
    expect(got!.payload.payment).toEqual({ id: 'pay_000000000001', value: 100 })

    expect(report.webhooks.delivered).toHaveLength(1)
    expect(report.webhooks.delivered[0]!.statusCode).toBe(200)
    expect(report.webhooks.failed).toEqual([])

    const [d] = await deliveries()
    expect(d!.status).toBe('DELIVERED')
    expect(d!.lastStatusCode).toBe(200)
    expect(d!.attempt).toBe(1)
    expect(d!.lastAttemptAt).toBe(h.app.ctx.clock.timestamp())

    // The webhook does not freeze when everything goes right.
    expect((await webhookRow(wh.id)).interrupted).toBe(false)
  })

  it('does not send the header when the webhook has no authToken', async () => {
    await createWebhook({ authToken: undefined })
    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })
    await h.tick()

    expect(h.sink.received[0]!.headers['asaas-access-token']).toBeUndefined()
  })

  it('HTTP 201 is a FAILURE — only 200 is a success in Asaas', async () => {
    await createWebhook()
    h.sink.respondWith(201)

    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })
    const report = await h.tick()

    expect(h.sink.received).toHaveLength(1) // chegou…
    expect(report.webhooks.delivered).toEqual([]) // …but it does NOT count as delivered.
    expect(report.webhooks.failed).toHaveLength(1)

    const [d] = await deliveries()
    expect(d!.status).toBe('PENDING')
    expect(d!.attempt).toBe(1)
    expect(d!.lastStatusCode).toBe(201)
    expect(d!.lastError).toContain('HTTP 201')
    // Rescheduled to offset 2 of the table: 30s.
    expect(d!.nextAttemptAtMs).toBe(h.clock.nowMs() + 30_000)
  })

  it('204 is a failure too; a 200 on the retry closes the delivery', async () => {
    await createWebhook()
    h.sink.failNext(1, 204) // the first one answers 204, the following ones 200

    await emit('PAYMENT_CONFIRMED', { id: 'pay_000000000001' })
    await h.tick()

    let [d] = await deliveries()
    expect(d!.status).toBe('PENDING')
    expect(d!.lastStatusCode).toBe(204)

    h.clock.advance(30_000)
    await h.tick()

    ;[d] = await deliveries()
    expect(d!.status).toBe('DELIVERED')
    expect(d!.lastStatusCode).toBe(200)
    expect(d!.attempt).toBe(2)
    expect(h.sink.received).toHaveLength(2)
  })

  it('the paused dispatcher delivers nothing', async () => {
    await createWebhook()
    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })

    h.app.scheduler.paused = true
    await h.tick()
    expect(h.sink.received).toHaveLength(0)

    h.app.scheduler.paused = false
    await h.tick()
    expect(h.sink.received).toHaveLength(1)
  })

  it('a disabled webhook receives nothing', async () => {
    const wh = await createWebhook()
    await h.api.call('update-existing-webhook', {
      params: { id: wh.id },
      body: { enabled: false },
    })

    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })
    await h.tick()

    expect(h.sink.received).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────── backoff

describe('webhooks — backoff of 15 attempts', () => {
  it('walks the EXACT offsets of the table, interrupts, and removeBackoff unlocks it', async () => {
    const wh = await createWebhook()
    h.sink.respondWith(500)

    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001', value: 4990 })

    // 1st attempt: immediate (offset 0 of the table).
    await h.tick()
    expect(h.sink.received).toHaveLength(1)

    let [d] = await deliveries()
    expect(d!.attempt).toBe(1)
    expect(d!.lastStatusCode).toBe(500)

    // The 14 following waits. Asaas's table, annotated:
    const expected = [
      30_000,
      MINUTE_MS,
      3 * MINUTE_MS + 30_000,
      5 * MINUTE_MS,
      15 * MINUTE_MS,
      25 * MINUTE_MS,
      HOUR_MS,
      HOUR_MS,
      HOUR_MS,
      HOUR_MS,
      HOUR_MS,
      2 * HOUR_MS,
      2 * HOUR_MS,
      3 * HOUR_MS,
    ]
    expect(BACKOFF_MS.slice(1)).toEqual(expected)

    for (const [i, offset] of expected.entries()) {
      const attemptsBefore = i + 1
      ;[d] = await deliveries()
      expect(d!.nextAttemptAtMs).toBe(h.clock.nowMs() + offset)

      // One instant BEFORE the offset: nothing happens. It is the backoff working.
      h.clock.advance(offset - 1)
      await h.tick()
      expect(h.sink.received).toHaveLength(attemptsBefore)

      // At the exact offset: the attempt goes out.
      h.clock.advance(1)
      await h.tick()
      expect(h.sink.received).toHaveLength(attemptsBefore + 1)
      ;[d] = await deliveries()
      expect(d!.attempt).toBe(attemptsBefore + 1)
    }

    // 15 attempts, all with 500. End of the line.
    expect(h.sink.received).toHaveLength(15)
    ;[d] = await deliveries()
    expect(d!.attempt).toBe(15)
    expect(d!.status).toBe('INTERRUPTED')
    expect(d!.nextAttemptAtMs).toBeNull()

    // And the webhook's WHOLE queue freezes — that is what Asaas does.
    expect((await webhookRow(wh.id)).interrupted).toBe(true)
    const view = await h.api.call('retrieve-a-single-webhook', { params: { id: wh.id } })
    expect(view.body.interrupted).toBe(true)

    // One more tick does not try again: interrupted is interrupted.
    h.clock.advance(24 * HOUR_MS)
    await h.tick()
    expect(h.sink.received).toHaveLength(15)

    // The developer fixes their route…
    h.sink.respondWith(200)

    // …and unfreezes the queue.
    const un = await h.api.call('remove-webhook-backoff', { params: { id: wh.id } })
    expect(un.status).toBe(204)

    expect((await webhookRow(wh.id)).interrupted).toBe(false)
    ;[d] = await deliveries()
    expect(d!.status).toBe('PENDING')
    expect(d!.attempt).toBe(0)

    await h.tick()

    expect(h.sink.received).toHaveLength(16)
    expect(h.sink.received[15]!.payload.event).toBe('PAYMENT_RECEIVED')
    // The redelivered payload is the one from the emit — not a query of the current state.
    expect(h.sink.received[15]!.payload.payment).toEqual({
      id: 'pay_000000000001',
      value: 4990,
    })
    ;[d] = await deliveries()
    expect(d!.status).toBe('DELIVERED')
  })

  it('a PUT with interrupted: false also reactivates the queue', async () => {
    const wh = await createWebhook()

    await h.app.db
      .update(webhooks)
      .set({ interrupted: true })
      .where(eq(webhooks.id, wh.id))

    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })
    await h.tick()
    expect(h.sink.received).toHaveLength(0) // interrupted: it does not deliver

    const res = await h.api.call('update-existing-webhook', {
      params: { id: wh.id },
      body: { interrupted: false },
    })
    expect(res.body.interrupted).toBe(false)

    await h.tick()
    expect(h.sink.received).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────── SEQUENTIALLY

describe('webhooks — SEQUENTIALLY does head-of-line blocking', () => {
  it('the 1st blocked event holds events 2 and 3; when it passes, the 3 arrive in order', async () => {
    await createWebhook({ sendType: 'SEQUENTIALLY' })
    h.sink.respondWith(500)

    await emit('PAYMENT_CREATED', { id: 'pay_000000000001' })
    await emit('PAYMENT_CONFIRMED', { id: 'pay_000000000001' })
    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })

    const rows = await deliveries()
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3])

    await h.tick()

    // ONLY the head of the queue was attempted. The other two are overdue and even
    // so they did NOT go out: it is Asaas's head-of-line blocking.
    expect(h.sink.eventNames).toEqual(['PAYMENT_CREATED'])
    let all = await deliveries()
    expect(all.map((r) => r.attempt)).toEqual([1, 0, 0])
    expect(all.map((r) => r.status)).toEqual(['PENDING', 'PENDING', 'PENDING'])

    // Time passes: the queue stays stuck on the same delivery.
    h.clock.advance(30_000)
    await h.tick()
    expect(h.sink.eventNames).toEqual(['PAYMENT_CREATED', 'PAYMENT_CREATED'])

    all = await deliveries()
    expect(all.map((r) => r.attempt)).toEqual([2, 0, 0])

    // The endpoint comes back. Now the queue drains — in order.
    h.sink.respondWith(200)
    h.clock.advance(MINUTE_MS)
    await h.tick()

    expect(h.sink.eventNames).toEqual([
      'PAYMENT_CREATED',
      'PAYMENT_CREATED',
      'PAYMENT_CREATED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_RECEIVED',
    ])

    all = await deliveries()
    expect(all.map((r) => r.status)).toEqual(['DELIVERED', 'DELIVERED', 'DELIVERED'])
  })

  it('NON_SEQUENTIALLY delivers the due ones even with one failing', async () => {
    await createWebhook({ sendType: 'NON_SEQUENTIALLY' })
    h.sink.failNext(1, 500) // only the FIRST request fails

    await emit('PAYMENT_CREATED', { id: 'pay_000000000001' })
    await emit('PAYMENT_CONFIRMED', { id: 'pay_000000000001' })
    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })

    await h.tick()

    // All three were attempted in the same tick — with no queue blocking.
    expect(h.sink.received).toHaveLength(3)

    const all = await deliveries()
    const statuses = all.map((r) => r.status)
    expect(statuses.filter((s) => s === 'DELIVERED')).toHaveLength(2)
    expect(statuses.filter((s) => s === 'PENDING')).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────── frozen payload

describe('webhooks — the payload is frozen at the emit', () => {
  it('delivers the resource as it was at the emit, not as it is now', async () => {
    await createWebhook({ sendType: 'SEQUENTIALLY' })
    // Nothing is delivered while the dispatcher is paused — it is time travel with
    // the queue stopped.
    h.app.scheduler.paused = true

    const payment = { id: 'pay_000000000001', status: 'PENDING', value: 10_000 }
    await emit('PAYMENT_CREATED', { ...payment })

    // The resource changes after the emit: it is paid, and the amount is corrected.
    payment.status = 'RECEIVED'
    payment.value = 12_345
    await emit('PAYMENT_RECEIVED', { ...payment })

    h.app.scheduler.paused = false
    h.clock.advance(HOUR_MS)
    await h.tick()

    expect(h.sink.received).toHaveLength(2)

    // The 1st delivery carries the fact as it was — PENDING, 10.000 — and not the
    // resource's current state. The event describes an instant, not a query.
    expect(h.sink.received[0]!.payload.event).toBe('PAYMENT_CREATED')
    expect(h.sink.received[0]!.payload.payment).toEqual({
      id: 'pay_000000000001',
      status: 'PENDING',
      value: 10_000,
    })

    expect(h.sink.received[1]!.payload.event).toBe('PAYMENT_RECEIVED')
    expect(h.sink.received[1]!.payload.payment).toEqual({
      id: 'pay_000000000001',
      status: 'RECEIVED',
      value: 12_345,
    })
  })
})

// ────────────────────────────────────────────────────────── retention

describe('webhooks — retention', () => {
  it('a pending delivery beyond the retention window becomes EXPIRED', async () => {
    const wh = await createWebhook()
    h.app.scheduler.paused = true // the queue stops, time does not

    await emit('PAYMENT_RECEIVED', { id: 'pay_000000000001' })

    h.clock.advance(15 * 24 * HOUR_MS) // retention = 14 days
    h.app.scheduler.paused = false
    await h.tick()

    expect(h.sink.received).toHaveLength(0)

    const [d] = await h.app.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, wh.id))

    expect(d!.status).toBe('EXPIRED')
  })
})

// ────────────────────────────────────────────────────────── the Docker trap

describe('webhooks — host rewriting for Docker', () => {
  beforeEach(() => resetRewriteNotice())

  it('rewrites localhost preserving port, path and query', () => {
    expect(
      rewriteForContainer('http://localhost:3000/hook?x=1#f', 'host.docker.internal'),
    ).toBe('http://host.docker.internal:3000/hook?x=1#f')

    expect(rewriteForContainer('http://127.0.0.1:8080/webhook', 'host.docker.internal')).toBe(
      'http://host.docker.internal:8080/webhook',
    )

    expect(rewriteForContainer('http://[::1]:9000/w', 'host.docker.internal')).toBe(
      'http://host.docker.internal:9000/w',
    )
  })

  it('does not touch an external host, and rewrites nothing without the target', () => {
    expect(rewriteForContainer('https://api.exemplo.com/hook', 'host.docker.internal')).toBe(
      'https://api.exemplo.com/hook',
    )
    // Outside Docker (the case of the tests and of `bun run dev`): nothing changes.
    expect(rewriteForContainer('http://localhost:3000/hook', undefined)).toBe(
      'http://localhost:3000/hook',
    )
  })

  it('warns ONCE, at info level — it is the #1 trap of the project', () => {
    const logged: { level: string; msg: string }[] = []
    const log = (level: string, msg: string) => logged.push({ level, msg })

    rewriteForContainer('http://localhost:3000/a', 'host.docker.internal', log as never)
    rewriteForContainer('http://localhost:3000/b', 'host.docker.internal', log as never)

    expect(logged).toHaveLength(1)
    expect(logged[0]!.level).toBe('info')
    expect(logged[0]!.msg).toContain('host.docker.internal')
  })
})

void and // keeps the import used by drizzle's typing
