# Asaas Mock Server — a faithful local simulator of the Asaas sandbox

## Context

Asaas's sandbox **does not deliver webhooks to `localhost`**, which makes it impossible to test a
payment flow end to end on the developer's machine: you create the charge, it gets paid, and the event never
arrives. Today that forces workarounds (ngrok, a staging deploy just to test, a manual mock of the
payload) that do not reproduce the real behavior — credit deadlines, interest, split, webhook retry.

We are going to build a **local Asaas in Docker**: a server that exposes Asaas's v3 API with contract
fidelity and **really simulates** the platform's state machines, financial calculations and schedules —
and delivers webhooks to `localhost`. It is not a mock of static responses: a card charge created in it
stays `CONFIRMED`, credits at D+32, debits the fee, moves the split between
accounts and produces a statement entry — all observable.

The difference from the real sandbox: a **controllable virtual clock**. You advance 32 days in
milliseconds and watch the `PAYMENT_RECEIVED` arrive. No test suite against the real Asaas can
do that.

**Source of truth:** the official OpenAPI 3.0.1 spec (`https://www.asaas.com/openApi/document?version=3&languageCode=en-US`
returns the raw JSON) — 159 paths, **213 operations**, 486 schemas, auth via the `access_token` header.
Already downloaded and analyzed. The business rules (fees, interest, deadlines, 111 webhook events, backoff)
were researched in the official docs and are consolidated below.

## Decisions (confirmed with the user)

| | |
|---|---|
| **Stack** | Bun + Elysia + Drizzle + SQLite (`bun:sqlite`) + Docker |
| **Coverage** | Full surface (213 routes registered, with auth/validation/Asaas errors) + core with a real business engine |
| **Time** | Controllable virtual clock via `/_admin/clock` + per-tick scheduler; the default mode follows the real clock |
| **Multi-account** | Each API key = one account with its own `walletId` and balance; a split really moves money between accounts |

---

## Architecture

### 1. OpenAPI → code pipeline

**Our own codegen emitting TypeBox** (not Kubb — it is a *client* generator; not Zod — Elysia is
TypeBox-native and validates both request **and response**). `openapi-typescript` enters only as a type
oracle in the tests, to detect drift.

The central point: the codegen emits a **manifest** of the 213 operations. The routes are registered by
iterating the manifest, and every `operationId` without a handler automatically receives a `notImplemented`.
That way, *"the 213 routes exist"* becomes a **build invariant**, not a checklist.

```
spec/openapi.json          # vendored, byte-for-byte from upstream, never hand-edited
spec/overlays/*.json       # JSON Patch for the spec's defects (e.g. the AUTHORIZED status is missing from the enum)
src/generated/operations.ts # the manifest: {operationId, tag, method, path, params, query, body, responses}
src/generated/schemas/*.ts  # TypeBox, one file per tag (486 schemas in one file kills tsc)
```

Two known spec defects, already handled:
- **Denormalized enums** — 173 enum schemas, 9 variations of "PaymentStatus" that collapse into 2
  value sets. The codegen deduplicates by the hash of the value set.
- **Missing values** — `AUTHORIZED` (pre-authorization) appears in no status enum. An overlay
  adds it. `src/domain/enums.ts` is written by hand and is **authoritative**; a test guarantees
  `spec_enum ⊆ domain_enum`, so the CI breaks when Asaas adds a new status.

The build is **hermetic and offline** (the spec endpoint answers 429 if you hit it repeatedly). `bun run spec:diff`
runs in a separate weekly job and opens an issue when Asaas changes the API.

### 2. Structure

```
src/
├── domain/      # PURE. It imports no db, http or clock. Every fn receives `now: Date`.
│                # money, fees, interest, discount, installments, split, settlement,
│                # cpf-cnpj, calendar (BR business days), payment-machine
├── db/schema/   # Drizzle, one file per area
├── core/        # clock, rng (seeded), context, ledger, events, errors, pagination
├── http/        # app, register (manifest→routes), auth, error-mapper
├── modules/     # one folder per tag, handlers indexed by operationId
├── scheduler/   # tick() + jobs
├── webhooks/    # queue, dispatcher, backoff, payload, localhost rewrite
└── admin/       # OUTSIDE /v3: clock, reset, state, deliveries, fees, coverage
```

The rule that holds everything together: **`src/domain/` imports nothing from the infrastructure.** It is what
allows parallelizing agents without conflict and what makes the virtual clock a non-problem for the calculations.

### 3. Money: integers in cents

SQLite `REAL` is IEEE-754 — the running balance accumulates error over thousands of entries. Worse:
Asaas's rules are **exact remainder rules** ("the remainder goes to the last installment"), which only
express themselves in integer arithmetic. `value_cents: integer`. Split percentages have 4 decimal
places → 1e4 scale. Fees in basis points.

Dates in **TEXT** in Asaas's wire format (`YYYY-MM-DD` / `YYYY-MM-DD HH:mm:ss`) —
lexicographically sortable, no timezone surprises. Timezone `America/Sao_Paulo`.
**No `CURRENT_TIMESTAMP` as a column default** — every timestamp comes from `clock.now()`, otherwise the
virtual clock leaks.

The balance is materialized in `accounts.balance_cents` **in the same transaction** as the ledger entry, and an
invariant runs in the tests' `afterEach`: `balance_cents === SUM(financial_transactions.value_cents)`.

### 4. The payment state machine

A declarative transition table + effect descriptors. `plan()` is a **pure function** that returns
*data*; `apply()` executes it in a transaction.

```ts
// src/domain/payment-machine.ts — PURE
plan(payment, trigger, now, fees) → { to: Status, patch, effects: Effect[] } | AsaasError

type Effect =
  | { t:'LEDGER';  entries }   // PAYMENT_RECEIVED + PAYMENT_FEE
  | { t:'WEBHOOK'; event }
  | { t:'SPLIT';   to }
  | { t:'SET_CREDIT_DATE'; date }
```

`applyTransition()` is the **only place** where a charge's status changes — sandbox action,
scheduler, capture, `receiveInCash`, refund, they all go through it. The webhook and the financial entry
are *effects of the transition*, not something the handler has to remember to do. They cannot diverge.
`UPDATE ... WHERE id=? AND status=?` (compare-and-swap) makes the machine safe against a double tick.

The divergence per payment method lives in a single place (`settlementDate()`):

| billingType | Flow | Credit |
|---|---|---|
| `PIX` | → `RECEIVED` **directly** (skips CONFIRMED) | immediate |
| `BOLETO` | → `CONFIRMED` → `RECEIVED` | D+1 business day |
| `CREDIT_CARD` | → `CONFIRMED` → `RECEIVED` | **D+32** |
| `DEBIT_CARD` | → `CONFIRMED` → `RECEIVED` | D+3 |

Once overdue, it enters `OVERDUE` first, in any of them.

### 5. Virtual clock + scheduler

`Clock` injected through `AppContext`. Three modes: `REAL` (default), `VIRTUAL_FLOWING`, `VIRTUAL_FROZEN`
(CI). **`Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()` are forbidden** outside of
`core/clock.ts` and `core/rng.ts` — an ESLint rule + a test that greps the source.

`advance({days: 40})` is **not a single tick at T+40** — that would generate one subscription charge instead
of several and would stamp `OVERDUE` with the wrong date. It is a full `tick()` **per simulated day**.

The fixed order of the jobs per tick (the order is part of the semantics):
`subscription-generation` → `overdue` → `credit-settlement` → `split-release` →
`split-divergence-expiry` → `anticipation-settlement` → `webhook-dispatch` → `retention-purge`

Idempotency in 3 layers: an in-process mutex (one Bun process + SQLite = trivially serial), a
`job_runs(jobName, tickKey)` UNIQUE table, and CAS on every mutation — the last one is what actually saves you.

`POST /_admin/clock/advance` returns a `TickReport` with the transitions, which makes the tests read like a
specification:
```ts
const [r] = await h.advance({ days: 32 })
expect(r.transitions).toContainEqual({ paymentId, from:'CONFIRMED', to:'RECEIVED', job:'credit-settlement' })
```

### 6. Webhook engine

One `webhook_events` per domain event → N `webhook_deliveries` (one per subscribed config).
**The payload is frozen at the moment of the emit** — a retry 3h later cannot send the resource's
current state; the event describes an instant.

Fidelity to the real Asaas:
- The `asaas-access-token` header = the webhook's `authToken`. **Only HTTP 200 is a success** (201/204 = failure —
  it is the real rule and it is where people get burned). A 10s timeout.
- A 15-attempt backoff: `0, 30s, 1min, 3.5min, 5min, 15min, 25min, 1h×5, 2h×2, 3h` → then
  `interrupted = true`. `POST /v3/webhooks/{id}/removeBackoff` resets it.
- `SEQUENTIALLY` does real head-of-line blocking (it is Asaas's contract, and it is exactly what the
  user needs to be able to test). `NON_SEQUENTIALLY` runs with limited concurrency.
- At-least-once delivery; the `evt_` id is stable across retries (it lives in the *event*, not in the *delivery*).
- 14-day retention (simulated).

The backoff is compared against `clock.nowMs()` — so `advance({hours:1})` triggers the retry at the
right hour. You can exercise the 15 attempts and reach `interrupted` in ~20ms.

### 7. Business rules (researched in the official docs)

**Fees** (configurable by env / `PUT /_admin/fees`): settled bank slip R$ 1.99 · Pix received R$ 1.99
fixed · single-payment card R$ 0.49 + 2.99% · 2-6x +3.49% · 7-12x +3.99% · 13-21x +4.29% · debit
card R$ 0.35 + 1.89% · TED R$ 5.00.

**`netValue = value − fee`.** The split applies to the **`netValue`**, not to the gross amount.

**Interest/fine:** the fine is applied **once**, on the 1st day of lateness (FIXED|PERCENTAGE). Pro-rata
die interest over a 30-day commercial month: `interest = value × (interest.value/100) / 30 × daysLate`.
`interest` only has `value` (a monthly percentage) — it has **no `type`**. `interestValue = fine + interest`.

**Installment plan:** the N charges are born immediately, monthly. The rounding remainder goes to the
**last** installment — `R$ 350 / 12 → 11 × R$ 29.16 + R$ 29.24` (line 1 of the golden test).

**Subscription:** the first charge is generated **at creation**. Each following charge is generated
**40 days before** its `nextDueDate` (configurable to 14 or 7).

**Split:** `PENDING → AWAITING_CREDIT → DONE`. Sum > `netValue` → `BLOCKED_BY_VALUE_DIVERGENCE` with
2 business days to adjust.

**Errors:** `{"errors":[{"code":"invalid_<field>","description":"..."}]}`. Creation returns **200**, never 201.
**Pagination:** `{object:"list", hasMore, totalCount, limit, offset, data:[]}`, max limit 100.
**IDs:** `pay_<12 digits>`, `cus_<12 digits>`, `sub_<alphanumeric>`, `evt_<hex32>&<n>`; installment/transfer/split/
webhook/walletId = **plain UUID**. Sandbox API key: `$aact_hmlg_…`.
**Test cards:** `4444444444444444` approves; `5184019740373151` and `4916561358240741` decline.

### 8. Docker — the #1 trap

The product's promise is *a webhook on localhost*, and Docker breaks it: inside the container,
`http://localhost:3000` is the container itself.

```yaml
environment:
  WEBHOOK_LOCALHOST_REWRITE: host.docker.internal   # rewrites the webhook URL
extra_hosts:
  - "host.docker.internal:host-gateway"            # makes it work on Linux too
```
The rewrite is on by default, and it is logged out loud the first time. **This goes in the first 20 lines of the
README.**

---

## Requested documents

- **`AGENTS.md`** — what the project is, why it exists, the stack, the non-negotiable invariants (pure
  domain, the ban on `Date.now()`, money in cents, every transition through `applyTransition`), and
  how an agent should work here.
- **`MASTER_PLAN.md`** — this plan, versioned in the repo.
- **`progress.md`** — a tracks/agents/status table + the **machine-generated line**
  (`bun run coverage:ops` reads the manifest ∩ handler map and prints `implemented: 41/213`). Never keep
  a count by hand that an agent knows how to compute.

---

## Phases

### Phase 0 — Trunk (blocking, one agent, not parallelizable)
Skeleton, vendored spec + overlays, **codegen**, `src/generated/*`, **the complete Drizzle schema**
(all the tables at once — it is the only real merge-conflict surface), `src/core/*`,
`src/http/*`, **the 213 routes assembled as stubs**, test harness + webhook sink, Docker,
`AGENTS.md` / `MASTER_PLAN.md` / `progress.md`.

*Deliverable:* the container boots, `bun test` is green, the 213 ops answer (501 in Asaas's format),
contract validation on, `GET /_admin/coverage` → `0/213`.

### Fan-out (parallel tracks — each one has its own folder in `modules/` and its own file in `db/schema/`)

| Track | Scope | Depends on |
|---|---|---|
| **C — Money** | fees, interest, fine, discount, installments, split math, cpfCnpj, business days + golden tests | Phase 0 (only `money.ts`) — **starts first, 100% pure** |
| **B — Webhooks** | queue, dispatcher, backoff, SEQ/NON_SEQ, retention, admin log | Phase 0 |
| **G — Long tail** | ~150 CRUD/stub ops (invoices, bills, dunning, pix, checkout, recharge…) | Phase 0 |
| **A — Payments core** | customers, payments, state machine, sandbox actions | C |
| **D — Finance** | ledger, balance, financialTransactions, transfers | A |
| **H — Card** | tokenization, test cards, pre-authorization/capture | A |
| **E — Recurrence** | installments, subscriptions, D-40 generation | A, C |
| **F — Multi-account split** | split engine, subaccounts, movement between accounts | A, D |

Sequence: `0` → `{C, B, G}` → `A` → `{D, H}` → `{E, F}`

---

## Verification

**Unit** (`src/domain/`, pure, table-driven + golden files): fees, interest, discount, installment
division, split, cpfCnpj, business days, the complete `status × trigger` matrix (15×10) in a snapshot.

**Integration** (in-memory SQLite + frozen `VirtualClock` + seeded RNG + a real webhook sink via
`Bun.serve`). The scenarios that are the acceptance criterion:
1. Bank slip → `OVERDUE` at D+1 → interest accrues day by day → `receiveInCash` → ledger + webhooks in order.
2. Pix → `RECEIVED` right away, **without a `PAYMENT_CONFIRMED` webhook**, `netValue = value − 199`, a ledger with
   `PAYMENT_RECEIVED` + `PAYMENT_FEE`.
3. A 12× R$ 350 card with 2 splits → 12 immediate payments with the values `[29.16 ×11 , 29.24]`, each one
   crediting at **D+32**, the split moving money to both accounts, **both statements balancing**.
4. A MONTHLY subscription → the charge generated **exactly 40 days before** the `nextDueDate`, and **not** on the 41st.
5. The sink returns 500 → exactly 15 attempts at the exact backoff offsets → `interrupted=true` →
   `removeBackoff` → delivery.

**Contract tests for free:** a hook in the harness's `ApiClient` validates **every response the whole
suite produces** against the TypeBox schema generated from the spec. Contract coverage becomes a by-product of
writing a feature test. Plus a surface test that walks the 213 operationIds and guarantees that
the route resolves.

**Determinism:** run the suite twice with the same `SEED` and diff a canonical dump of the database.
Byte-identical or the build breaks.

**Parity with the real Asaas** (the mitigation of the biggest risk): `tools/capture.ts` runs a script against
the **real sandbox** with the user's key, captures HTTP responses and webhook payloads, writes them to
`tests/golden/`. A parity suite replicates the script against the mock and diffs field by field. It is what
turns fidelity from hope into a test.

**Manual, at the end:** `docker compose up`, create a Pix charge via curl, confirm it via
`/v3/sandbox/payment/{id}/confirm`, watch the `PAYMENT_RECEIVED` arrive at a local listener.

---

## Risks

1. **Unverifiable fidelity.** Every rule here is *researched*, not *proven* — exact
   rounding, the composition of the `netValue`, the roll to the next business day, the exact set of payload fields. A subtly
   wrong mock is worse than no mock, because it produces false confidence.
   → **`tools/capture.ts` + the parity suite is the #1 priority after the trunk.** Secondary: every
   fee/rule behind a config, so that a divergence is a config change, not a code change.

2. **Virtual clock leakage.** A single `Date.now()` outside of `core/` destroys determinism in
   silence, and the bug shows up as a flaky test three months later.
   → Lint + a grep test on the source + zero time defaults in the schema + a determinism suite.

3. **Time travel × the webhook queue.** `advance({days:40})` to test a subscription will, without you
   asking, fast-forward the 15 backoff attempts, mark `interrupted` and — in `SEQUENTIALLY` —
   freeze the queue. The following tests see zero webhooks.
   → `TickReport` exposes webhook state changes; the harness's `advance()` **drains the queue before**
   each day step; `POST /_admin/webhooks/pause` for pure time travel; `webhook-dispatch` runs
   **last** in the tick.
