# Whap: WhatsApp Mock Server Development Notes

> **General Rules & Repository Guidelines:** See the root [AGENTS.md](../../AGENTS.md).

This mock is maintained as part of `Instituto-AMA/test-utils-hub` (originating from `fdarian/whap`). It simulates the WhatsApp Business Cloud API (Meta Graph API) for local development and testing.

---

## Whap-Specific Architecture & Details

### 1. Components
- **Mock Server:** Hono-based server (`src/server/server.ts`) listening on port 3010 (override via `PORT` or `--port`).
- **Interactive TUI:** React + Ink terminal interface (`src/tui/index.tsx`).
- **CLI Router:** Brocli-based command router (`src/index.ts`).
- **Web Inspection Panel:** Inline HTML panel served at `GET /`.

### 2. Routing & Graph API Compatibility
- Graph API routes match any API version dynamically using the pattern `/:version{v[0-9]+\.[0-9]+}/...` (e.g. `/v22.0`, `/v23.0`).
- Health endpoint: `GET /health` returns status and template count.
- Inbound message simulation: `POST /mock/simulate-message` or `POST /webhook/simulate-message`.
- Webhook configuration endpoints: `POST /mock/configure` and `GET /mock/config`.

### 3. Webhooks & Signatures
- **Localhost Rewriting:** Containerized calls to `localhost` or `127.0.0.1` are automatically rewritten to target `host.docker.internal` (controlled by `WEBHOOK_LOCALHOST_REWRITE`).
- **HMAC Signatures:** When `WEBHOOK_SECRET` is configured, outgoing webhooks include the `x-hub-signature-256` signature header, exactly matching Meta's Cloud API specification.
- **Priority:** CLI arguments (`--webhook-url`) > Environment variables (`WEBHOOK_URL`) > Configuration file (`whap.json`).

### 4. Custom Template Resolution
- Configurable in `whap.json` via `templates.cmd`.
- When set, whap delegates template resolution to an external command instead of reading static files from `templates/`.

### 5. Coding Conventions
- **Bun Execution:** Use Bun for all tasks (`bun test`, `bun run build`, `bun tsc --noEmit`).
- **Imports:** Always use explicit `.ts` / `.tsx` extensions in import statements.
- **No Barrel Files:** Keep imports direct and explicit; do not create re-exporting index files.
- **No Centralized `types.ts`:** Declare types beside their respective domain functions and stores.
