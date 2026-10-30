import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { toBusinessDate } from '../../src/core/clock.ts'
import { createHarness, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

/** The /_admin routes live outside /v3 and do not go through the typed ApiClient. */
const get = (app: Harness['app'], path: string) =>
  app.app.handle(new Request(`http://localhost${path}`))

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

describe('authentication', () => {
  const call = (headers: Record<string, string>) =>
    h.app.app.handle(new Request('http://localhost/v3/payments', { headers }))

  it('without access_token → 401 invalid_access_token', async () => {
    const res = await call({})
    expect(res.status).toBe(401)
    expect(((await res.json()) as any).errors[0].code).toBe('invalid_access_token')
  })

  it('malformed token → 401 invalid_access_token_format', async () => {
    // Asaas tells the two cases apart, and that is useful: the client knows whether it
    // pasted the wrong key or the key was revoked.
    const res = await call({ access_token: 'abc123' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as any).errors[0].code).toBe('invalid_access_token_format')
  })

  it('well-formed but unknown token → 401 invalid_access_token', async () => {
    const res = await call({ access_token: '$aact_hmlg_doesnotexist' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as any).errors[0].code).toBe('invalid_access_token')
  })

  it('a valid token passes authentication (it reaches the handler)', async () => {
    const res = await call({ access_token: TEST_API_KEY })
    // What matters is that it is NOT a 401: it authenticated and reached the handler.
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(200)
  })
})

describe('virtual clock', () => {
  it('starts frozen at the configured date', () => {
    expect(h.clock.mode).toBe('VIRTUAL_FROZEN')
    expect(h.app.ctx.clock.today()).toBe('2026-01-05')
  })

  it('frozen means frozen: real time does not leak in', async () => {
    const before = h.app.ctx.clock.timestamp()
    await Bun.sleep(30)
    expect(h.app.ctx.clock.timestamp()).toBe(before)
  })

  it('advance(32 days) runs ONE TICK PER SIMULATED DAY, not a single jump', async () => {
    // If it were a single tick at T+32, a subscription would generate one charge instead of
    // several and the OVERDUE would be stamped with the wrong date.
    const reports = await h.advance({ days: 32 })

    expect(reports.length).toBe(32)
    expect(reports[0]!.tickKey).toBe('2026-01-06')
    expect(reports.at(-1)!.tickKey).toBe('2026-02-06')
    expect(h.app.ctx.clock.today()).toBe('2026-02-06')
  })

  /**
   * THE BUG THESE TWO TESES KEEP FROM COMING BACK.
   *
   * The clock is global to the container. A `+32` clicked in the panel to see a card
   * credit left the simulator 105 days in the future — and the application integrating
   * from the other side started creating charges that were born OVERDUE, because today's
   * due date had already passed for it.
   *
   * The symptom does not look like a clock. Nothing on the screen connected one thing to
   * the other, and there was no way back without restarting the container.
   */
  const clockNow = async () =>
    (await (await get(h.app, '/_admin/clock')).json()) as { driftDays: number; today: string }

  it('/_admin/clock exposes the drift against REAL time', async () => {
    // The sign does not matter (the harness starts at 2026-01-05, which is in the PAST).
    // What matters is that advancing 32 days moves the drift by exactly 32 — that is the
    // number the panel uses to warn "you are in the future".
    const before = await clockNow()
    await h.advance({ days: 32 })
    const after = await clockNow()

    expect(after.driftDays).toBe(before.driftDays + 32)
  })

  it('/_admin/clock/reset returns to the present — the way back from the time travel', async () => {
    await h.advance({ days: 100 })

    const res = await h.app.app.handle(
      new Request('http://localhost/_admin/clock/reset', { method: 'POST' }),
    )
    expect(res.status).toBe(200)

    const clock = await clockNow()
    expect(clock.driftDays).toBe(0)
    // And it is REAL time, not the harness's starting date.
    // The clock's day is the business day in America/Sao_Paulo: comparing with
    // the UTC date failed every evening between 21:00 and midnight (UTC-3).
    expect(clock.today).toBe(toBusinessDate(new Date()))
  })

  it('daily jobs are idempotent: ten ticks on the same day = one run', async () => {
    const { jobRuns } = await import('../../src/db/schema/index.ts')

    for (let i = 0; i < 10; i++) await h.tick()

    const runs = await h.app.db.select().from(jobRuns)
    const today = h.app.ctx.clock.today()
    const todayRuns = runs.filter((r) => r.tickKey === today)

    // No (job, day) pair repeats — that is what the composite PK guarantees.
    const keys = todayRuns.map((r) => `${r.jobName}:${r.tickKey}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('pagination and error format', () => {
  it('the error always comes as an array, even with a single error', async () => {
    const res = await h.app.app.handle(
      new Request('http://localhost/v3/customers', {
        method: 'POST',
        headers: { access_token: TEST_API_KEY, 'content-type': 'application/json' },
        body: '{}',
      }),
    )

    expect(res.status).toBe(400) // 400, not Elysia's standard 422
    const body = (await res.json()) as any
    expect(Array.isArray(body.errors)).toBe(true)

    // Asaas's real pattern is `invalid_<field>`, in camelCase like the request.
    const codes = body.errors.map((e: any) => e.code)
    expect(codes).toContain('invalid_name')
    expect(codes).toContain('invalid_cpfCnpj')
  })
})
