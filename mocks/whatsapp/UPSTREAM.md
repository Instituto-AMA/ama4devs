# Upstream Notes — Whap (WhatsApp Mock Server)

- **Upstream Repository:** [fdarian/whap](https://github.com/fdarian/whap)
- **Upstream Commit:** `0684423`
- **License:** Apache License, Version 2.0 (see `LICENSE`)
- **Date Copied:** 2026-10-26

## Notice of Modification (Apache License 2.0, Section 4.b)

In compliance with Section 4(b) of the Apache License, Version 2.0, notice is hereby given that files in this directory have been modified from their original upstream versions. Modified files carry this prominent notice through this file and the repository's git history.

## Modifications

This copy is maintained internally within `Instituto-AMA/test-utils-hub`. Every change below is relative to the
vendored upstream commit `0684423` — the whole delta is `git diff 2691e7c..HEAD -- mocks/whatsapp`.

### Dependencies

- **`hono` and `@hono/node-server`:** `hono` `^4.7.10` → `^4.13.14` and `@hono/node-server` `^1.14.2` → `^2.1.5`,
  because `bun audit` reported the hono path-confusion and fast-uri host-confusion advisories on the older lines.
- **`effect` and `@effect/platform-bun`:** `4.0.0-beta.59` → `4.0.6`; the stable release moved the CLI out of
  `effect/unstable`, so the imports became `effect/cli` and the flags became `Flag.Int` and `Flag.String`
  (`src/index.ts`, `src/commands/server.ts`, `src/commands/tui.ts`).
- **`vitest` and `@vitest/ui`:** `^3.2.3` → `^4`, because `bun audit` reported the vitest UI arbitrary-file-read
  advisory; the test script now runs `bun --bun vitest run` so the suite always runs on the Bun runtime.
- **`uuid`:** `^10.0.0` → `^14`.
- **Lockfile and remaining finding:** `bun.lock` was refreshed for this mock; the only audit finding left in this tree is
  `esbuild`, reached through the dev-only `vite` tooling that no mock runtime loads.

### Behaviour

- **Panel API (`src/server/panel-message.ts`, `delivery-status.ts`):** `GET /mock/messages` lists both directions as
  `PanelMessage`; `POST /mock/simulate-message` accepts an optional `name`, optional `message.id`/`timestamp`, works
  without a webhook URL (`200 { delivered: false, reason: 'webhook_not_configured' }` instead of 400) and broadcasts
  `NEW_MESSAGE`; outbound `NEW_MESSAGE` carries a `PanelMessage`.
- **Deterministic delivery:** the random template rejection (10%) and delivery failure (5%) are gone; template approval
  is always `APPROVED`. `MOCK_DELIVERY_MODE` (`auto` default | `manual`), `GET/POST /mock/delivery-mode`; `manual` stops
  at `sent`. Each status step updates the store and broadcasts `STATUS_UPDATE`.
- **`POST /mock/messages/:id/status`:** moves an outbound message to `delivered | read | failed` (a `failed` webhook
  carries `errors: [{ code: 131026, title: 'Message undeliverable' }]`).
- **Webhook event log:** `sendWebhook` records every attempt (`kind`, `status`, `httpStatus`, `error`, redacted `url`),
  broadcasts `WEBHOOK_EVENT`; `GET /mock/events` answers `{ events }` newest first, at most 200.
- **`GET /mock/templates`** and `secretSet` on `GET /mock/config`.
- **`parseJsonBody` (`src/server/utils/json-body.ts`):** one shared middleware that rejects a malformed JSON payload
  with the Graph error shape (`validation_error`, code 400) instead of letting the validator crash; the raw body is
  cloned before it is parsed, so the validation middleware still receives the untouched request. It guards
  `POST /:phoneNumberId/messages`, `POST /mock/configure` and `POST /mock/simulate-message`; `POST /webhook/trigger`
  answers with the same `invalidJsonResponse` when its own `c.req.json()` fails.
- **Typing-indicator error:** a failed typing indicator is now answered with 400 `validation_error` instead of 500
  `server_error` — the client sent something the mock cannot process, which is not a server fault.
- **Template watcher (`src/server/store/template-store.ts`):** `initialize()` now awaits `startWatcher()`, the dynamic
  `import('chokidar')` is awaited inside a `try/catch` and a watcher failure is logged with `console.error` instead of
  becoming an unhandled rejection; the templates directory is resolved with `path.resolve`, so a relative path is
  resolved from the working directory and an absolute path is kept as it is.
- **Shared webhook delivery (`src/server/webhook-target.ts`):** the `sendWebhook` helper that was duplicated in
  `messages.ts` and `webhooks.ts` now lives in one module and every delivery goes through it, so the HMAC signature,
  the loopback rewrite and the redacted log are the same on every route.
- **Webhook delivery reaches the host:** `rewriteLoopback` replaces the hostname of a loopback webhook URL
  (`localhost`, `127.0.0.1`, `::1`) with `WEBHOOK_LOCALHOST_REWRITE` (for example `host.docker.internal`), keeping the
  protocol, the port and the path; the URL is returned unchanged when no rewrite host is configured, when it cannot be
  parsed or when it does not point to a loopback address.
- **Graph API version routing (`src/server/server.ts`):** the hardcoded `/v22.0` and `/v23.0` mounts were replaced by
  the pattern `/:version{v[0-9]+\.[0-9]+}`, so every `v<major>.<minor>` release answers (`/v22.0`, `/v23.0`,
  `/v25.0`) and a path without a version (`/latest`) does not.
- **`PORT` environment variable:** `serverPort()` reads `PORT` and returns it when it is a valid port number, else 3010;
  the `server` command's `--port` flag defaults to it, the HTTP listener uses it, and the Docker healthcheck follows it.
- **Web inspection panel:** an inline HTML panel is served at `GET /` (`src/server/routes/panel.ts` and
  `src/server/ui/panel.ts`): the conversation list, the messages of the selected conversation and a
  "Simular mensagem do paciente" form. The page is self-contained — it references no external host.
- **`createApp` is exported** from `src/server/server.ts`, so the full application (guards, CORS and logging included)
  can be built by the tests.

### Security

- **Local guard (`src/server/middleware/local-guard.ts`):** every route the mock serves is behind the guard. The
  `Host` header is checked on every request (the DNS rebinding defence) and the `Origin` header on the state-changing
  methods and on the `/ws` upgrade (the cross-site defence); the opaque `null` origin is refused, a request without an
  `Origin` header passes, and a refusal is a 403 with `forbidden_host` or `forbidden_origin`.
- **`MOCK_ALLOWED_HOSTS`:** a comma-separated list of extra hostnames the guard admits, on top of the loopback
  defaults (`localhost`, `127.0.0.1`, `::1`, `host.docker.internal`). It is what lets a mock reached by its Compose
  service name (`whatsapp`) be answered instead of refused.
- **CORS restricted to allowed origins:** the CORS middleware now echoes the origin only when it is in the allowlist,
  instead of answering any origin.
- **Header redaction in the request log:** the `authorization`, `cookie` and `x-hub-signature-256` headers are logged
  as `[redacted]`, so a token or a signature never reaches the log file.
- **Webhook URL logged without its query string:** `redactUrl` keeps only the origin and the path (a query string can
  carry a token) and is used by the webhook configuration logs, the delivery log and the invalid-format error — which
  no longer echoes the URL either.

### Container

- **Pinned Bun image:** the `BUN_VERSION` build argument went from `1.2` to `1.4.2`, so the image is reproducible.
- **Healthcheck follows `PORT`:** both healthchecks probe `http://localhost:${PORT:-3010}/health` instead of the fixed
  `3010`, and the runtime stage sets `ENV PORT=3010` as the default.
- **The compiled binary builds:** `bun build --compile` failed on ink's optional `react-devtools-core` import, so the
  image never built. `bun run build` now runs `scripts/build.ts`, which compiles with a plugin answering that import
  with an empty module (ink loads devtools only with `DEV=true`).

### Documentation

- **`CLAUDE.md` rewritten in English:** the upstream notes were translated and reorganized, pointing at the root
  `AGENTS.md` and documenting the mock server, the TUI, the CLI router, the web panel, the dynamic Graph version
  pattern, the localhost rewriting of webhook targets, the HMAC signature and the coding conventions.
- **Upstream CI and local tooling configs removed at import time** (in the vendoring commit, before the delta above):
  the upstream repository-specific CI workflows, Cursor rules and development configurations were dropped so the mock
  integrates cleanly into `test-utils-hub`.

### Tests

- **`src/server/middleware/local-guard.test.ts` (new):** an allowed host passes, a foreign `Host` is refused on `/`,
  on a versioned route and on `/mock/simulate-message`, a foreign `Origin` on a write is refused while an allowed
  origin and a request without `Origin` pass, the `null` origin is refused, a foreign origin on the `/ws` upgrade is
  refused, a foreign `Origin` on a plain read is not checked, a bracketed IPv6 host passes, and `MOCK_ALLOWED_HOSTS`
  admits the Compose service name. The same file covers `serverPort` (`4000` → 4000; `abc`, `0`, `70000` and `1.5` →
  3010; unset → 3010).
- **`src/server/webhook-target.test.ts` (new):** `rewriteLoopback` with no rewrite host configured, with `localhost`,
  with `127.0.0.1`, with the IPv6 loopback, with a non-loopback host (unchanged), keeping the port and the path, and
  with an unparseable URL (unchanged); `redactUrl` dropping the query string and refusing to echo an unparseable URL.
- **`src/server/routes/panel.test.ts` (new):** `GET /` answers 200 with an HTML body containing the
  "Simular mensagem do paciente" form, and the page references no external host.
- **`src/server/server.test.ts` (new):** the request log redacts the `authorization`, `cookie` and signature headers,
  and a foreign `Host` is refused with a 403 by the full application.
- **`src/server/routes/messages.test.ts` (fixed):** the templates directory is resolved from the test file, so the
  suite no longer depends on the current working directory; the messages router is mounted at `/v22.0` (the phone
  number id is a router parameter, not part of the mount path); a new test proves that every `v<major>.<minor>`
  answers and that `/latest` gives a 404.
- **`src/server/store/template-store.test.ts` (fixed):** the test templates directory is resolved from the test file
  instead of the working directory, and the mocked `readdir`/`readFile` are reset between tests so no queued value from
  one test can leak into the next.
