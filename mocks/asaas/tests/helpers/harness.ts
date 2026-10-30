/**
 * The test harness. It is the file that decides whether this project is testable.
 *
 * Three things it does, and they are the point:
 *
 * 1. It boots the REAL SERVER (through the bootstrap), not a parallel assembly that
 *    diverges over time. In-memory SQLite, frozen clock, seeded RNG.
 *
 * 2. It validates the CONTRACT on every response the whole suite produces, against the
 *    TypeBox schema generated from Asaas's spec. Contract coverage becomes a
 *    by-product of writing a feature test — nobody has to remember to do it.
 *
 * 3. `advance()` DRAINS THE WEBHOOK QUEUE before each day step. Without this,
 *    advancing 40 days to test a subscription would exhaust, as a bonus, the 15
 *    backoff attempts of any pending delivery and would mark the webhook as
 *    `interrupted` — and the following tests would see zero webhooks, with no explanation.
 */
import { Value } from '@sinclair/typebox/value'
import { eq, sql } from 'drizzle-orm'
import { bootstrap, type App, type ConfigOverrides } from '../../src/bootstrap.ts'
import { VirtualClock } from '../../src/core/clock.ts'

import { accounts, financialTransactions } from '../../src/db/schema/index.ts'
import { getOperation, type OperationId } from '../../src/generated/operations.ts'
import type { HandlerMap } from '../../src/http/register.ts'
import { HANDLERS } from '../../src/modules/index.ts'
import { JOBS } from '../../src/scheduler/jobs/index.ts'
import type { Job, TickReport } from '../../src/scheduler/scheduler.ts'
import { WebhookSink } from './webhook-sink.ts'

export const TEST_API_KEY = '$aact_hmlg_test0000000000000000000000000'
/** Monday, so that "business day" does not become a hidden variable. */
export const TEST_CLOCK_START = '2026-01-05T09:00:00-03:00'

export class ContractViolation extends Error {
  constructor(operationId: string, status: number, errors: string[], body: unknown) {
    super(
      `The response of "${operationId}" (HTTP ${status}) does not match the schema of the ` +
        `spec of Asaas:\n  ${errors.join('\n  ')}\n\nBody received:\n` +
        JSON.stringify(body, null, 2),
    )
    this.name = 'ContractViolation'
  }
}

export interface ApiResponse<T = any> {
  status: number
  body: T
}

export class ApiClient {
  constructor(
    private readonly app: App['app'],
    private readonly apiKey: string,
  ) {}

  async call<T = any>(
    operationId: OperationId,
    opts: {
      params?: Record<string, string>
      query?: Record<string, string | number | undefined>
      body?: unknown
    } = {},
  ): Promise<ApiResponse<T>> {
    const op = getOperation(operationId)
    if (!op) throw new Error(`unknown operationId: ${operationId}`)

    let path: string = op.specPath
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      path = path.replace(`{${k}}`, encodeURIComponent(v))
    }
    const remaining = path.match(/\{([^}]+)\}/)
    if (remaining) {
      throw new Error(`Parameter "${remaining[1]}" not given for ${operationId}`)
    }

    const url = new URL(`http://localhost${path}`)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }

    const res = await this.app.handle(
      new Request(url.toString(), {
        method: op.method.toUpperCase(),
        headers: {
          access_token: this.apiKey,
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      }),
    )

    const text = await res.text()
    const body = text ? JSON.parse(text) : null

    this.#assertContract(operationId, res.status, body)
    return { status: res.status, body }
  }

  /**
   * Validates the response against the schema generated from the spec. Runs on EVERY
   * call of the suite, for free.
   */
  #assertContract(operationId: OperationId, status: number, body: unknown): void {
    // Errors (4xx/5xx) have no success schema; we only check the envelope.
    if (status >= 400) {
      const errs = (body as any)?.errors
      if (!Array.isArray(errs) || !errs.every((e) => e?.code && e?.description)) {
        throw new ContractViolation(
          operationId,
          status,
          ['error outside the { errors: [{ code, description }] } format'],
          body,
        )
      }
      return
    }

    const schema = (getOperation(operationId).responses as Record<number, any>)[status]
    if (!schema) return

    if (!Value.Check(schema, body)) {
      const errors = [...Value.Errors(schema, body)]
        .slice(0, 8)
        .map((e) => `${e.path || '/'}: ${e.message}`)
      throw new ContractViolation(operationId, status, errors, body)
    }
  }
}

export interface Harness {
  app: App
  api: ApiClient
  /** Client of another account — to test the split between accounts. */
  as(apiKey: string): ApiClient
  sink: WebhookSink
  clock: VirtualClock
  accountId: string
  walletId: string

  tick(): Promise<TickReport>
  advance(d: {
    days?: number
    hours?: number
    minutes?: number
  }): Promise<TickReport[]>

  /** balanceCents === SUM(ledger). Call it at the end of every financial scenario. */
  assertLedgerBalances(): Promise<void>

  /** Registers a webhook pointing at the sink. Returns the id. */
  subscribeWebhook(events: string[]): Promise<string>

  close(): void
}

/**
 * Boots the real server. Without injecting handlers or jobs: the test
 * exercises the `HANDLERS` and the `JOBS` that `bun start` uses.
 *
 * (There was an `extraHandlers`/`extraJobs` parameter while the tracks were running in
 * parallel, so that each agent could test its own before the stitching. It was removed
 * from parallel: a test that registers its own handlers passes even if the stitching
 * never happened — it serves itself, and the suite stops proving that the
 * real server answers that route.)
 */
export async function createHarness(overrides: ConfigOverrides = {}): Promise<Harness> {
  const sink = await WebhookSink.start()

  const app = await bootstrap({
    config: {
      databasePath: ':memory:',
      seed: 1, // seeded RNG → deterministic ids
      logLevel: 'silent',
      adminEnabled: true,
      clock: {
        mode: 'VIRTUAL_FROZEN',
        start: TEST_CLOCK_START,
        tickIntervalMs: 0, // no timer: the test controls time
      },
      seedAccount: {
        apiKey: TEST_API_KEY,
        name: 'Conta de Teste',
        cpfCnpj: '47960950000121',
        email: 'teste@localhost',
        balanceCents: 0 as never,
      },
      webhook: {
        localhostRewrite: undefined, // outside Docker: it does not rewrite
        timeoutMs: 1000, // 10s would make the timeout test too slow
        maxAttempts: 15,
        retentionDays: 14,
        maxPerAccount: 10,
      },
      ...overrides,
    },
  })

  const clock = app.ctx.clock as VirtualClock

  const harness: Harness = {
    app,
    api: new ApiClient(app.app, TEST_API_KEY),
    as: (key) => new ApiClient(app.app, key),
    sink,
    clock,
    accountId: app.seed.accountId,
    walletId: app.seed.walletId,

    tick: () => app.scheduler.tick(),

    async advance({ days = 0, hours = 0, minutes = 0 }) {
      const reports: TickReport[] = []
      for (let i = 0; i < days; i++) {
        // Drains the queue BEFORE advancing: see the comment at the top of the file.
        await app.scheduler.tick()
        clock.advance(86_400_000)
        reports.push(await app.scheduler.tick())
      }
      const subDayMs = hours * 3_600_000 + minutes * 60_000
      if (subDayMs > 0) {
        clock.advance(subDayMs)
        reports.push(await app.scheduler.tick())
      }
      return reports
    },

    async assertLedgerBalances() {
      // Grouped in JS on purpose: a correlated subquery here is easy to
      // write wrong and start returning 0 in silence — which would make the
      // assertion always pass, the worst possible defect in an invariant.
      const accountRows = await app.db
        .select({ id: accounts.id, balance: accounts.balanceCents })
        .from(accounts)

      const entries = await app.db
        .select({
          accountId: financialTransactions.accountId,
          value: financialTransactions.valueCents,
        })
        .from(financialTransactions)

      const sums = new Map<string, number>()
      for (const e of entries) {
        sums.set(e.accountId, (sums.get(e.accountId) ?? 0) + e.value)
      }

      for (const row of accountRows) {
        const ledger = sums.get(row.id) ?? 0
        if (row.balance !== ledger) {
          throw new Error(
            `The balance of account ${row.id} does not match the statement: ` +
              `accounts.balance_cents=${row.balance}, SUM(ledger)=${ledger}. ` +
              `Someone touched a balance without going through postEntries().`,
          )
        }
      }
    },

    /**
     * Registers a webhook pointing at the sink. Without this, no event is
     * delivered — the fan-out only creates deliveries for subscribed webhooks.
     */
    async subscribeWebhook(events: string[]) {
      const { webhooks } = await import('../../src/db/schema/index.ts')
      const ids = await import('../../src/domain/ids.ts')
      const id = ids.webhookConfigId(app.ctx.rng)

      await app.db.insert(webhooks).values({
        id,
        accountId: app.seed.accountId,
        name: 'sink',
        url: sink.url,
        email: 'sink@localhost',
        enabled: true,
        interrupted: false,
        authToken: 'a'.repeat(32),
        apiVersion: 3,
        sendType: 'SEQUENTIALLY',
        events,
        dateCreated: app.ctx.clock.timestamp(),
      })
      return id
    },

    close() {
      sink.stop()
      app.close()
    },
  }

  return harness
}

/** Creates a second account (with its own API key) for the split tests. */
export async function createSecondAccount(
  h: Harness,
  name = 'Secondary Account',
): Promise<{ accountId: string; walletId: string; apiKey: string }> {
  const { accounts: accountsTable, apiKeys } = await import('../../src/db/schema/index.ts')
  const ids = await import('../../src/domain/ids.ts')
  const rng = h.app.ctx.rng

  const accountId = ids.accountId(rng)
  const walletId = ids.walletId(rng)
  const apiKey = ids.apiKey(rng)

  await h.app.db.insert(accountsTable).values({
    id: accountId,
    walletId,
    parentAccountId: h.accountId,
    name,
    email: `${name.toLowerCase().replace(/\s/g, '-')}@localhost`,
    cpfCnpj: '24971563792',
    personType: 'FISICA',
    country: 'Brasil',
    status: 'APPROVED',
    balanceCents: 0,
    dateCreated: h.app.ctx.clock.timestamp(),
  })

  await h.app.db.insert(apiKeys).values({
    id: ids.genericId(rng),
    accountId,
    key: apiKey,
    name: 'Key',
    active: true,
    dateCreated: h.app.ctx.clock.timestamp(),
  })

  void eq // keeps the import used by drizzle's typing
  return { accountId, walletId, apiKey }
}
