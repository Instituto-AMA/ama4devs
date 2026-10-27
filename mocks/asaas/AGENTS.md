# AGENTS.md — Asaas Mock Server

This mock is maintained internally as part of `Instituto-AMA/ama4devs`. It runs locally in Docker alongside other provider mocks for development and testing.

## What it is

A **local Asaas**: a server that exposes the Asaas v3 API and runs in Docker on the developer's machine, eliminating external dependencies and vendor credentials.

## Why it exists

**The official Asaas sandbox does not deliver webhooks to `localhost`.** This mock delivers webhooks to localhost by rewriting loopback targets to `host.docker.internal`. Furthermore, because it includes a **virtual clock**, you can advance 32 days in milliseconds and observe the `PAYMENT_RECEIVED` webhook arrive for credit cards—something no test suite running against the real Asaas sandbox can do.

## What it is NOT

**It is not a mock of static responses.** A credit card payment created here enters `CONFIRMED`, credits at D+32, debits the fee (R$ 0.49 + 2.99%), executes split transfers across accounts, and posts entries to both ledger statements. Never return static hardcoded JSON where business logic applies.

A subtly incorrect mock is **worse than no mock**, because it creates false confidence. When a real business rule is unknown, mark it with `TODO(rule)`, make it configurable via environment variables, and record it in `progress.md`.

---

## Stack

Bun · Elysia · Drizzle · SQLite (`bun:sqlite`) · TypeBox · Docker

## Source of Truth

`spec/openapi.json` is the official Asaas OpenAPI 3.0.1 specification, vendored byte-for-byte. **Never edit this file directly.** Corrections belong in `spec/overlays/*.json` as JSON Patch with a `_why` explaining the necessity (e.g. the spec omits the `AUTHORIZED` status from all status enums).

Running `bun run codegen` turns the specification into `src/generated/` — TypeBox schemas, 74 canonical enums, and a **manifest** of all 213 operations.

### The specification proves form; only the real API proves content.

`bun run test:parity` compares simulator responses against responses **captured from the real Asaas sandbox** (`tests/golden/*.json`). This parity suite is the ultimate authority for this mock.

Any divergence reported by the parity suite is **our bug**: Asaas is the truth; do not modify golden responses to mask discrepancies.

---

## Non-Negotiable Invariants

### 1. `src/domain/` is PURE

It never imports `db`, `http`, `core/clock`, or `AppContext`. Every domain function receives `now: Date` and required values as **arguments**.

This ensures calculations can be tested in isolation without booting servers or databases.

### 2. No Ambient Time or Randomness

`Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`, and `CURRENT_TIMESTAMP` are **forbidden** outside `src/core/clock.ts` and `src/core/rng.ts`. Use `ctx.clock` and `ctx.rng`.

A single leak causes time travel to record real wall-clock dates, silently destroying determinism. `tests/unit/no-ambient-time.test.ts` statically checks source files and fails the build on violations.

### 3. Money is Represented as Integer Cents

Always suffix monetary fields with `Cents` (e.g. `R$ 1.99` → `199`).

Floating-point numbers (`REAL`) in SQLite introduce IEEE-754 rounding drift. Asaas rules depend on exact remainder arithmetic (e.g. "installment rounding remainder goes into the final installment"). Convert to BRL only at serialization boundaries. Split percentages use `1e4` scaling (`E4`), and fee percentages use basis points (`Bp`).

### 4. Payment Status Changes Only in ONE Place

All transitions pass through `applyTransition()`. Sandbox actions, scheduler ticks, credit card captures, `receiveInCash`, and refunds must all invoke it.

Webhook queueing and ledger entries are direct side-effects of `applyTransition()`. Never write `UPDATE payments SET status = ...` outside this function.

### 5. Account Balances Change Only via `postEntries()`

Ledger entries and `accounts.balanceCents` updates are committed together within the **same database transaction**. The invariant `balance === SUM(ledger)` is validated in tests.

### 6. State Mutations Use Compare-and-Swap

Mutations must use `UPDATE ... WHERE id = ? AND status = <expected>`. Idempotent retries will safely update zero rows without producing duplicate side-effects.

---

## Implementing Operations

Route registration is manifest-driven: every `operationId` without a handler automatically returns `501 Not Implemented` in Asaas error format.

To implement an operation:
1. Write the handler in `src/modules/<area>/handlers.ts`.
2. Add it to the handler map spread in `src/modules/index.ts`.

Routing, authentication derivation, request validation, and error shaping are wired automatically.

## API Quirks and Contract Nuances

- Creation returns HTTP **200**, never 201.
- Errors always follow `{"errors":[{"code":"invalid_<field>","description":"..."}]}` (array format, even for single errors; `description` in pt-BR).
- List endpoints: `{object:"list", hasMore, totalCount, limit, offset, data:[]}` with `limit` capped at 100.
- Webhooks: **Only HTTP 200 is considered success**; 201 and 204 are treated as failures, reproducing official Asaas behavior.
- Identifiers: `pay_<12digits>`, `cus_<12digits>`, `sub_<alphanumeric>`, while installment, transfer, split, webhook, and walletId use standard UUIDs.

## Tests

- `tests/unit/`: Pure domain tests, table-driven. Covers edge cases like interest calculations, rounding remainders, and fee splits.
- `tests/integration/`: Uses `createHarness()` with in-memory SQLite, frozen clock, seeded RNG, and a real HTTP webhook sink. Contract conformance is validated automatically against the OpenAPI schema for every response. Call `h.assertLedgerBalances()` at the end of financial test cases.
- Time travel in tests: `h.advance({days: 32})` drains webhooks for each simulated day. Use `POST /_admin/webhooks/pause` when advancing time without triggering backoff exhaustion on pending webhooks.

## Local Webhook Forwarding

Inside Docker containers, `localhost` points at the container itself. `WEBHOOK_LOCALHOST_REWRITE` (default: `host.docker.internal`) rewrites the host in webhook URLs so events reach services running on the host machine.

## Business Rules

Rules fall into two categories:
1. **Proven Against Real Sandbox:** Verified by `bun run test:parity` (e.g. fixed R$ 1.99 Pix fee, remainder placed in last installment, staggered D+32 credit for card installments, immediate first payment on subscription creation).
2. **Researched from Documentation:** Documented hypotheses. When resolving discrepancies with real Asaas behavior, update the simulator (Asaas is the source of truth), add a golden test, and update comments.
