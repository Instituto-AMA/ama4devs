# AGENTS.md — test-utils-hub

Rules, layout map, and instructions for agents working in this repository.

## Layout Map

| Path | What it is |
|---|---|
| `Makefile` | Root entrypoint (`help`, `setup`, `setup-sandbox`, `up`, `down`, `status`, `test`, `clean`, ...) |
| `docker-compose.yml` | Compose definitions with profiles for each mock service (`asaas`, `whatsapp`) |
| `.env.example` | Contract for root environment variables and port mappings |
| `scripts/` | Shell helpers: `lib.sh`, `check-tools.sh`, `setup.sh`, `setup-sandbox.sh`, `env-mode.sh` |
| `profiles/` | Environment key profiles (`generic/mock.env`, `generic/sandbox.env`) |
| `mocks/asaas/` | Asaas mock server (Elysia, Bun, SQLite, Drizzle, TypeBox) |
| `mocks/whatsapp/` | WhatsApp / Meta Graph API mock server (Hono, Bun, WebSockets) |
| `mocks/README.md` | The contract of a mock and checklist for adding a new mock |

## The Rules

1. **English Only:** All identifiers, code, comments, documentation, commit messages, and PR descriptions must be written in English. The only exception is text a person reads on a screen (panel labels, buttons, error messages displayed to users in pt-BR).
2. **Self-Contained Mocks:** Each mock lives in `mocks/<name>` as an independent service with its own `Dockerfile`, `GET /health` endpoint, dedicated port, and automated test suite.
3. **No Editing Generated Files:** Never edit generated files by hand:
   - `mocks/asaas/src/generated/*` (run `bun run codegen` in `mocks/asaas`)
   - `mocks/asaas/src/admin/ui.html` (run `bun run panel:build` in `mocks/asaas`)
4. **No Secrets in the Repository:**
   - Keys in tests, compose files, and examples must remain fake placeholders (e.g. `$aact_hmlg_local_master`).
   - Sandbox secrets belong strictly in `.env.sandbox` (gitignored, mode 0600) and must never be committed.
5. **Deterministic Tests:** Tests run via `make test` or within each mock directory (`bun test`). Tests must never use sleep timers to wait for state changes; await the operation or event completion.

## How to Verify a Change

- **Run tests:**
  ```bash
  make test
  ```
  Or run within a specific mock:
  ```bash
  cd mocks/asaas && bun test
  cd mocks/whatsapp && bun run test
  ```
- **Check builds:**
  ```bash
  make build
  ```
- **Check service health:**
  ```bash
  make up
  make status
  ```
