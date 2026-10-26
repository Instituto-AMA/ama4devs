# Upstream Notes — Asaas Mock Server

- **Upstream Repository:** [theoxys/asaas-mock-server](https://github.com/theoxys/asaas-mock-server)
- **Upstream Commit:** `14fa00e`
- **License:** MIT (see `LICENSE`)
- **Date Copied:** 2026-10-26

## Modifications

This copy is maintained internally within `Instituto-AMA/test-utils-hub`. Every change below is relative to the
vendored upstream commit `14fa00e` — the whole delta is `git diff 2691e7c..HEAD -- mocks/asaas`.

### Dependencies

- **`drizzle-orm` security bump:** `^0.44.2` → `^0.45.2` (with `bun.lock` refreshed), because `bun audit` reported an
  identifier-injection advisory on the older line. The only finding left is `esbuild`, reached through the dev-only
  `drizzle-kit`/`vite` tooling that no mock runtime loads.

### Behaviour

- **`Scheduler.dispatchNow()`:** sends the webhook deliveries that are already due outside the virtual tick, sharing
  the tick's mutex so it never interleaves with a tick or a clock advance; calls that arrive while a pass is running
  coalesce into one more pass instead of one pass each.
- **`Scheduler.idle()`:** resolves when no dispatch pass is running or queued, so a test can wait for the deliveries
  without a timer.
- **Immediate dispatch after a write:** a global `onAfterResponse` hook (`src/http/app.ts`) calls
  `scheduler.dispatchNow()` right after a mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) that ended in 2xx
  under `/v3`, `/_mock` or `/_admin`; a request that ended in 4xx dispatches nothing, and a dispatch failure is
  logged instead of breaking the response.
- **Mock payment control routes (`/_mock/*`, `src/mock/routes.ts`):** `GET /_mock/payments` (optional `status` filter,
  `limit` capped at 100, `offset`, `totalCount` and `hasMore`) and
  `POST /_mock/payments/:id/{confirm,receive,overdue,fail,refund}`. These routes need no `access_token`, find the
  payment in any account, and always answer the same shape — `payment`, `from`, `to` and the queued `events` — with a
  404 in the Asaas error format when the id matches no payment. `fail` is an alias of `overdue` (the settlement
  failure the app sees is `PAYMENT_OVERDUE`), `refund` accepts an optional `value`, and `receive` pays and then
  settles when the payment stopped at `CONFIRMED`.
- **`refund-bank-slip`:** implemented `POST /v3/payments/{id}/bankSlip/refund`, the refund of a paid boleto. It refuses
  any billing type other than `BOLETO` (400 `invalid_action`), moves the payment through `applyTransition` (so the
  webhook is emitted and the ledger is reversed when the money had already credited) and answers the spec's
  `{ requestUrl }` shape — the "solicitar estorno" link, not the payment.
- **`SEED_EXTRA_ACCOUNTS`:** extra ROOT accounts can now be seeded on every boot, one item per tenant in the format
  `apiKey|name|cpfCnpj` separated by `;` (empty or unset means none). The parsing and validation live in
  `src/core/config.ts`: the key must start with `$aact_`, cannot be the master key and cannot repeat, and a malformed
  item is a boot error that names the item index — never the key, which is a secret.
- **Shared seed implementation (`src/admin/seed.ts`):** `seedMasterAccount` and the new `seedExtraAccounts` share one
  `insertRootAccount` helper and take a single `deps` object; an extra account is born as a ROOT account with its own
  wallet, an approved KYC, a login email derived from its name (`Clinica A` → `clinica-a@localhost`) and a zero
  balance. Both seeds are idempotent: a second boot with the same keys creates nothing.
- **Admin panel outcome buttons:** the payments page of the panel gained the **Receber**, **Vencer** and **Estornar**
  buttons (marked with a `Simulador` badge), which drive the `/_mock` routes instead of the Asaas API; a new `mock()`
  client in `panel/src/api.ts` makes that second channel explicit. The buttons appear only for the statuses the
  transition accepts — receive on `PENDING`/`OVERDUE`, overdue on `PENDING`, refund on `RECEIVED`/`CONFIRMED`.

### Security

- **Local route guard (`src/http/local-guard.ts`):** the key-free local routes (`/`, `/_admin/*`, `/_mock/*`) are
  restricted to an explicit hostname allowlist. The `Host` header is checked on every guarded request (the DNS
  rebinding defence), the `Origin` header only on state-changing methods, and the opaque `null` origin (a sandboxed
  iframe, a `data:` or `file:` page) is refused as foreign. A refusal is a 403 in the Asaas error format
  (`forbidden_host` / `forbidden_origin`); the API routes and `/health` stay outside the guard.
- **`MOCK_ALLOWED_HOSTS`:** a comma-separated list of extra hostnames the guard admits, on top of the loopback
  defaults (`localhost`, `127.0.0.1`, `::1`, `host.docker.internal`). It is what lets a mock reached by its Compose
  service name (`asaas`) be answered instead of refused.
- **Guard cleanups:** the host name parsing lives in one `hostnameOf` helper (the URL and the Origin share it, and
  the Origin variant keeps only `http:`/`https:`), the refusal texts live in one message map, and the
  state-changing method set is exported so the immediate-dispatch hook and the guard agree on what a write is.

### Container

- **Pinned and leaner image:** the base image is pinned to `oven/bun:1.4.2-alpine` in every stage, the installs run
  with `--ignore-scripts`, and a new `prod-deps` stage installs only the production dependencies — the runtime stage
  copies that `node_modules` instead of the full development one.
- **OCI vendor label:** `org.opencontainers.image.vendor` records that the image is maintained by
  `Instituto-AMA/test-utils-hub` on top of `theoxys/asaas-mock-server`.
- **`.dockerignore` rewrite:** `.env.example` is excluded too (the image receives its environment from Compose),
  `data/`, `tests/`, `tools/*` (except `tools/codegen`, needed by the build stage) and `*.md` are kept out of the build
  context, so no local database, no test fixtures and no documents can leak into the image.

### Documentation

- **`AGENTS.md` rewritten in English:** the upstream notes (in Portuguese) were translated and reorganized, keeping the
  rules that matter — `src/domain/` is pure, no ambient time or randomness, the vendored spec is the source of truth
  and is never edited by hand, and the parity suite is the authority over any comment.
- **`.env.example`:** documents `SEED_EXTRA_ACCOUNTS` and its `apiKey|name|cpfCnpj` format with a fake-key example.

### Tests

- **`tests/integration/local-guard.test.ts` (new):** allowed hosts on the panel and admin routes, an unknown `Host`
  refused on `/`, `/_admin/*` and `/_mock/*`, port stripping and bracketed IPv6 hosts, a foreign `Origin` refused on a
  write while a local origin and a request without `Origin` pass, the opaque `null` origin refused, `Origin` ignored
  on reads, a host admitted through `MOCK_ALLOWED_HOSTS`, and the API and health routes left outside the guard.
- **`tests/integration/mock-controls.test.ts` (new):** the `/_mock` routes — each outcome transition, the listing
  across accounts with a status filter, the 404 in the Asaas error format, and the 404 of every mock route when
  `adminEnabled` is false.
- **`tests/integration/webhook-immediate.test.ts` (new):** the delivery happens right after the write without a tick,
  nothing is dispatched after a 4xx, a paused dispatcher holds the delivery until it is resumed, two quick changes are
  delivered in order in at most two passes, and concurrent `dispatchNow()` calls coalesce into one promise.
- **`tests/integration/bank-slip-refund.test.ts` (new):** the refund of a paid boleto reaches `REFUNDED` with
  `PAYMENT_REFUNDED` queued through the same state machine, the 200 body is the spec's `{ requestUrl }` and not the
  payment, and a non-boleto payment is refused instead of being refunded by the wrong gateway path.
- **`tests/integration/seed-extra-accounts.test.ts` (new):** every extra key authenticates, each extra account is a
  ROOT account with its own wallet, the tenants do not see each other's customers, and a second boot creates nothing.
- **`tests/unit/config.test.ts` (new):** the `SEED_EXTRA_ACCOUNTS` parsing — empty value, whitespace trimming, a stray
  `;`, a missing field, a key that does not start with `$aact_`, a duplicate key and the master key — each failing with
  the index of the offending item.
