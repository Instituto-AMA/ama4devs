# ama4devs: WhatsApp Cloud API mock and Asaas API mock

Local mock servers of two third-party APIs, for development, automated tests and CI,
as Docker images on GHCR:

| Mock | What it simulates | Image |
|---|---|---|
| [WhatsApp mock](mocks/whatsapp/) | **WhatsApp Cloud API** (Meta Graph API v23.0, WhatsApp Business Platform): messages, message templates, media, voice calls (Calling API with WebRTC), phone numbers and WABAs, webhooks, and a WhatsApp Web like panel | `docker pull ghcr.io/instituto-ama/whatsapp-mock:latest` |
| [Asaas mock](mocks/asaas/) | **Asaas API v3** (sandbox simulator of the Brazilian payment gateway): customers, charges with Pix, boleto and credit card, installments, subscriptions, webhooks delivered to `localhost`, payer e-mail and WhatsApp notifications | `docker pull ghcr.io/instituto-ama/asaas-mock:latest` |
| [Generator](mocks/generator/) | **Fake Brazilian data** for tests: people, companies, CPF, CNPJ, CNH, PIS, RG, addresses with real CEP ranges, credit cards, bank accounts, Pix keys and charges, the same for the same seed; populates the Asaas mock with customers and charges in one call. Its UI also runs in the browser at [instituto-ama.github.io/ama4devs/generator/app](https://instituto-ama.github.io/ama4devs/generator/app/) | `docker pull ghcr.io/instituto-ama/generator-mock:latest` |

Em português: **simulador local do WhatsApp (API oficial da Meta) e do Asaas**
(Pix, boleto, cartão, parcelamento, assinatura e webhooks), para desenvolver e
testar integrações sem conta, sem credencial e sem custo.

**Documentation site:** [instituto-ama.github.io/ama4devs](https://instituto-ama.github.io/ama4devs/)
([em português](https://instituto-ama.github.io/ama4devs/pt-br/)).

This repository provides reproducible local mock containers with high behavioral fidelity. Developers and CI pipelines can run end-to-end payment flows and messaging integrations without creating vendor accounts, without managing external credentials, and with full support for delivering webhooks directly to `localhost`.

## Quick Start

Start all mocks and create your local `.env`:

```bash
make setup
```

To configure another application to point to the running mocks, pass `TARGET_ENV`:

```bash
make setup TARGET_ENV=../my-app/.env
```

You can optionally specify a profile (default is `generic`):

```bash
make setup PROFILE=generic TARGET_ENV=../my-app/.env
```

Once running, access the web inspection panels:

- **Asaas Simulator Panel:** [http://localhost:45445](http://localhost:45445)
- **WhatsApp Web Panel:** [http://localhost:3010](http://localhost:3010)
- **Generator:** [http://localhost:45450](http://localhost:45450) (starts with the Asaas mock; its "Popular o mock do Asaas" sheet fills the Asaas mock with customers and charges)

## The Two Flows

The repository supports two development workflows:

### 1. Mock Flow (`make setup` or `make env-mock`)
- **100% local and mocked:** No external accounts, internet access, or credentials needed.
- Builds and starts the containerized mocks with Docker Compose.
- Generates `.env` from `.env.example` if not present.
- Writes mock endpoints (e.g. `http://localhost:45445/v3` and `http://localhost:3010`) and fake master keys (`$aact_hmlg_local_master`) to `TARGET_ENV`.
- **Webhook registration:** The app registers its webhook in the mock exactly as it does against the real Asaas (`POST /v3/webhooks`); the mock delivers each event right after the change that caused it, and `localhost` targets are rewritten to the host.

### 2. Sandbox Flow (`make setup-sandbox` or `make env-sandbox`)
- Points `TARGET_ENV` at the official Asaas sandbox (`https://api-sandbox.asaas.com/v3`) and Meta Graph API (`https://graph.facebook.com`).
- Prompts for your Asaas sandbox API key (hidden input; must start with `$aact_hmlg_`).
- Verifies the key with `GET /myAccount/status` against the official Asaas sandbox API.
- Prompts for your application's public HTTPS base URL (e.g. from `cloudflared`, `ngrok`, or `zrok`) and an alert email.
- Automatically registers this developer's webhook in the Asaas sandbox and cleans up older webhooks previously registered by the same developer.
- Generates a random webhook authorization token and registers the webhook in the sandbox.
- **Credential security:** All sandbox credentials are saved exclusively to `.env.sandbox` (permission `0600`, gitignored, and never committed to the repository). Secrets are masked in console output and never passed via command-line arguments.
- **WhatsApp is not configured by this flow:** `setup-sandbox` only switches `WHATSAPP_GRAPH_URL` to Meta's Graph API; the Meta access token and the WhatsApp webhook belong to the app.

## Makefile Targets

| Target | Description |
|---|---|
| `help` | List the targets |
| `env` | Create `.env` from `.env.example` (never overwrites) |
| `setup` | Start the mocks and point `TARGET_ENV` at them (no credential needed) |
| `setup-sandbox` | Point `TARGET_ENV` at the official Asaas sandbox and Meta Graph API |
| `up` | Start the mocks |
| `down` | Stop the mocks |
| `restart` | Restart the mocks |
| `logs` | Follow logs: `make logs s=<service>` |
| `ps` | List the mock containers |
| `status` | Health of each mock, one line each |
| `build` | Build the mock images |
| `publish` | Build `linux/amd64` + `linux/arm64` and push to GHCR: `make publish MOCKS=asaas` (needs `docker login ghcr.io`) |
| `env-mock` | Write the mock env keys into `TARGET_ENV` (or print them) |
| `env-sandbox` | Write the sandbox env keys into `TARGET_ENV` (or print them) |
| `test` | Run the tests of both mocks, one after the other |
| `clean` | Remove containers and volumes (`FORCE=1` skips the prompt) |

## Published Images

Each mock is published to GHCR for `linux/amd64` and `linux/arm64`, so another project runs it
without cloning this repository:

| Mock | Image |
|---|---|
| Asaas | `ghcr.io/instituto-ama/asaas-mock` |
| WhatsApp | `ghcr.io/instituto-ama/whatsapp-mock` |
| Generator | `ghcr.io/instituto-ama/generator-mock` |

One image per version, with two tags:

- `<version>`: the `version` of the mock's `package.json`. It is pushed once and never moves; pin it.
- `latest`: the newest version, the same image.

The registry keeps nothing else: no image without a version.

How it is published:

- **The `publish-mocks` workflow** (`.github/workflows/publish-mocks.yml`) runs on every push to
  `master` that changes `mocks/**`. `scripts/changed-mocks.sh` picks the mocks whose directory
  changed (a change to the workflow or to `scripts/publish.sh` picks all of them), the mock's
  tests run, then `scripts/publish.sh` builds and pushes. A mock that did not change is not
  rebuilt. It can also be started by hand (Actions → publish-mocks → Run workflow) with the list
  of mocks.
- **By hand:** `docker login ghcr.io` with a token that has `write:packages`, then
  `make publish MOCKS=asaas` (or `MOCKS="asaas whatsapp"`). It refuses a mock directory with
  uncommitted changes, so an image always matches a commit. It builds with its own buildx
  builder (`ama4devs`); the foreign platform runs under emulation and is slow.
- **Releasing a version:** bump `version` in the mock's `package.json` in the change that alters
  it. A push without a bump publishes nothing for that mock, and the workflow warns.

## The Asaas Mock

The Asaas mock provides an in-depth simulation of the Asaas payment platform.

- **API Base Path:** `http://localhost:45445/v3`
- **Dashboard Panel:** `http://localhost:45445` (accounts, balances, API keys, customers, charges, subscriptions, installment plans and ledger entries; create customers and charges of the three kinds, receive in cash).
- **Payer Notifications:** every charge event e-mails the payer (to Mailpit, UI on `http://localhost:8025`, started with the `asaas` profile) and sends a WhatsApp template (to the WhatsApp mock, whose `templates/asaas_*.json` hold them). The charge dialog of the panel lists them and forces one on demand.
- **Invoice Page:** every charge's `invoiceUrl` (`http://localhost:45445/i/<id>`) opens the payer's page, where the charge is paid by Pix, boleto or a test card through the same path as a real payment. `INVOICE_BASE_URL` sets its address when the host port differs.
- **Virtual Clock:** Controlled by `ASAAS_CLOCK_MODE` (`REAL`, `VIRTUAL_FLOWING`, or `VIRTUAL_FROZEN`).
  - Advance time: `POST /_admin/clock/advance` with `{"days": 32}` to trigger D+32 credit card settlements or overdue calculations in milliseconds.
  - Set specific date: `POST /_admin/clock/set` with `{"date": "2026-08-01"}`.
  - Run tick: `POST /_admin/tick`.
- **Seeded Accounts:**
  - The default root account is created with master key `${ASAAS_API_KEY}` (default: `$aact_hmlg_local_master`).
  - Additional root accounts can be seeded on boot using `ASAAS_SEED_EXTRA_ACCOUNTS` (format: `apiKey|name|cpfCnpj` separated by `;`), allowing multiple tenants to run against the same mock instance with stable keys.
- **Local Webhook Delivery:**
  - Inside Docker containers, `localhost` refers to the container itself. The mock uses `WEBHOOK_LOCALHOST_REWRITE=host.docker.internal` and `extra_hosts` to rewrite loopback webhook targets to reach the host machine.
  - Webhooks include the `asaas-access-token` header.
  - Webhook `authToken` values must be between 32 and 255 characters, matching the official Asaas specification.
  - Immediate delivery: mutating operations (`POST`, `PUT`, `PATCH`, `DELETE`) under `/v3`, `/_mock`, and `/_admin` trigger immediate dispatch via `Scheduler.dispatchNow()` in `mocks/asaas/src/scheduler/scheduler.ts` (called from `onAfterResponse` in `mocks/asaas/src/http/app.ts`), delivering webhooks right after successful commits without waiting for the next timer tick. Retries run on every tick with backoff up to 15 attempts.

### Mock Payment Control Routes (`/_mock/payments/...`)

Key-free helper routes mounted under `/_mock` allow deterministic control over payment states in automated tests and local verification:

- **List payments:**
  ```bash
  curl http://localhost:45445/_mock/payments?limit=10
  ```
- **Confirm a payment:**
  ```bash
  curl -X POST http://localhost:45445/_mock/payments/pay_123456789012/confirm
  ```
- **Receive / settle a payment immediately:**
  ```bash
  curl -X POST http://localhost:45445/_mock/payments/pay_123456789012/receive
  ```
- **Mark payment as overdue:**
  ```bash
  curl -X POST http://localhost:45445/_mock/payments/pay_123456789012/overdue
  ```
- **Fail payment (alias for overdue):**
  ```bash
  curl -X POST http://localhost:45445/_mock/payments/pay_123456789012/fail
  ```
- **Refund payment (full or partial):**
  ```bash
  curl -X POST http://localhost:45445/_mock/payments/pay_123456789012/refund \
    -H 'Content-Type: application/json' \
    -d '{"value": 50.00}'
  ```

## The Generator

A tiny service with no dependency (Bun, port 45450) that generates valid fake Brazilian data and
fills the Asaas mock. See [mocks/generator/README.md](mocks/generator/README.md).

- **API:** `GET /v1/<kind>?count=10&seed=demo&formatted=true` for `person`, `company`, `address`,
  `cpf`, `cnpj`, `cnh`, `pis`, `rg`, `credit-card`, `bank-account`, `pix-key`, `charge`;
  `GET /v1/validate/cpf/11144477735`. The same seed (and `now`) returns the same data.
- **Asaas population:** `POST /_mock/asaas/populate` with `{"people": 5, "companies": 2, "chargesPerCustomer": 2, "confirm": 0.5}`
  creates customers and charges through the Asaas API and confirms part of them;
  `GENERATOR_ASAAS_SEED_ON_BOOT=people=10,companies=3,charges=2,confirm=0.5` in `.env` does it once on boot,
  while the Asaas mock has no customer.
- **UI:** `http://localhost:45450`, and the same page on GitHub Pages, generating in the browser.

## The WhatsApp Mock

The WhatsApp mock simulates the Meta WhatsApp Business Cloud API.

- **Graph API:** `/v23.0/...`, every operation of Meta's own OpenAPI specification (`mocks/whatsapp/spec/v23.0`), validated and answered like Meta, with an access token (`Authorization: Bearer …`, any value). What only a test needs travels in optional `X-Mock-*` headers; what Meta has no call for is under `/settings`.
- **Web Panel:** [http://localhost:3010](http://localhost:3010) (conversations with every message type, files, the template builder, the API reference).
- **State:** conversations, webhook calls, settings, webhooks, templates and media survive a restart (SQLite and files in the `whatsapp-data` volume, `/app/data`).
- **The user writes** (the same send call, from the user's phone):
  ```bash
  curl -X POST http://localhost:3010/v23.0/123456789/messages \
    -H 'Authorization: Bearer test' \
    -H 'Content-Type: application/json' \
    -H 'X-Mock-From: 5511999999999' \
    -H 'X-Mock-Contact-Name: Maria Souza' \
    -d '{"messaging_product": "whatsapp", "type": "text", "text": {"body": "Olá, preciso de informações"}}'
  ```
- **Webhook Configuration:**
  - Set via environment variable `WHATSAPP_WEBHOOK_URL` in `.env`.
  - Per number, Meta's call: `POST /v23.0/{phone-number-id}` with `{"webhook_configuration": {"override_callback_uri": "http://localhost:8080/webhooks/whatsapp", "verify_token": "…"}}`; the mock checks the address with `hub.challenge` first (`X-Mock-Skip-Callback-Verification: true` skips it).
  - Loopback targets are rewritten to `host.docker.internal` using `WEBHOOK_LOCALHOST_REWRITE`.
- **HMAC Signatures:**
  - When `WHATSAPP_WEBHOOK_SECRET` is set, outgoing webhook deliveries include the `x-hub-signature-256` header calculated as `sha256=HMAC_SHA256(body, secret)`.

## Integration with Ama-Hub

Ama-Hub integrates these mocks directly into its development lifecycle:

- In Ama-Hub, `make dev` starts these mocks from the published images, at the versions pinned in its `deploy/compose/docker-compose.dev.yml`. With `MOCKS_BUILD=1` it builds them from the sibling checkout instead, to try a change before it is published.
- Running `make sandbox` in Ama-Hub configures it to communicate with the official provider sandboxes.
- See Ama-Hub's local environment documentation at `docs/runbooks/local-environment.md` for details on how Ama-Hub orchestrates development services.

## Security Notes

- **Bound to Loopback:** All host ports are bound exclusively to `127.0.0.1` (`127.0.0.1:45445` and `127.0.0.1:3010`). They must never be exposed on `0.0.0.0` or public networks.
- **Local Route Guard:** Every mock implements a strict local guard. The Asaas mock guards `/`, `/_admin/*` and `/_mock/*`; the generator guards `/` and `/_mock/*`; the WhatsApp mock guards every route it serves, including the `/ws` upgrade. Each rejects requests with untrusted `Host` headers (DNS rebinding) and, on writes, untrusted `Origin` headers (cross-site request attacks); the opaque `null` origin is refused as well. Besides the loopback names (`localhost`, `127.0.0.1`, `::1`) and `host.docker.internal`, the guard admits every hostname in `MOCK_ALLOWED_HOSTS` — the Compose service names (`asaas`, `whatsapp`) are the ones to use, so a mock reached by service name is not rejected.
- **Fake Keys:** All default API keys in `.env.example` and tests are non-functional mock placeholders (e.g. `$aact_hmlg_local_master`). Never commit real credentials to this repository.

## Licenses

- `mocks/asaas`: MIT License (`mocks/asaas/LICENSE`).
- `mocks/whatsapp`: Apache License 2.0 (`mocks/whatsapp/LICENSE`).
- `mocks/generator`: MIT License (`mocks/generator/LICENSE`).
