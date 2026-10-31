<p align="center"><b>English</b> · <a href="https://instituto-ama.github.io/ama4devs/portuguese/">Português</a> · <a href="https://instituto-ama.github.io/ama4devs/">Documentation site</a></p>

<p align="center"><img src="site/assets/ama4devs.jpg" alt="ama4devs in gold pixel letters on a black terminal screen, with a progress bar at 50%." width="900"></p>

# ama4devs: local mocks of the APIs your application depends on

Local mock servers of Asaas, the WhatsApp Cloud API and an SMS gateway, plus a generator of
fake Brazilian data, for development, automated tests and CI, as Docker images on GHCR:

| Mock | What it simulates | Image |
|---|---|---|
| [WhatsApp mock](mocks/whatsapp/) | **WhatsApp Cloud API** (Meta Graph API v23.0, WhatsApp Business Platform): messages, message templates, media, voice calls (Calling API with WebRTC), phone numbers and WABAs, webhooks, and a WhatsApp Web like panel | `docker pull ghcr.io/instituto-ama/whatsapp-mock:latest` |
| [Asaas mock](mocks/asaas/) | **Asaas API v3** (sandbox simulator of the Brazilian payment gateway): customers, charges with Pix, boleto and credit card, installments, subscriptions, webhooks delivered to `localhost`, payer e-mail, WhatsApp and SMS notifications | `docker pull ghcr.io/instituto-ama/asaas-mock:latest` |
| [Generator](mocks/generator/) | **Fake Brazilian data** for tests: people, companies, CPF, CNPJ, CNH, PIS, RG, addresses with real CEP ranges, credit cards, bank accounts, Pix keys and charges, the same for the same seed; populates the Asaas mock with customers and charges in one call. Its UI also runs in the browser at [instituto-ama.github.io/ama4devs/generator/app](https://instituto-ama.github.io/ama4devs/generator/app/) | `docker pull ghcr.io/instituto-ama/generator-mock:latest` |
| [SMS mock](mocks/sms/) | **SMS gateway** (native API, Twilio-compatible, simple GET/POST): messages, status and inbound webhooks, deterministic magic numbers, segment counting, OTP extraction, and a phone inbox panel | `docker pull ghcr.io/instituto-ama/sms-mock:latest` |

**Documentation site:** [instituto-ama.github.io/ama4devs](https://instituto-ama.github.io/ama4devs/)
(English; [Português](https://instituto-ama.github.io/ama4devs/portuguese/)). Each mock has an
overview with use cases, a quick start, its API and its docs, in both languages.

This repository provides reproducible local mock containers with high behavioral fidelity. Developers and CI pipelines can run end-to-end payment flows and messaging integrations without creating vendor accounts, without managing external credentials, and with full support for delivering webhooks directly to `localhost`.

## Quick Start

Start all mocks and create your local `.env`:

```bash
make setup
```

`MOCKS` picks which ones (default `asaas whatsapp generator sms`), e.g. `make up MOCKS=sms`.
The `asaas` profile also brings Mailpit, the generator and the SMS mock.

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
- **Mailpit:** [http://localhost:8025](http://localhost:8025) (the mailbox of the payer e-mails the Asaas mock sends)
- **Generator:** [http://localhost:45450](http://localhost:45450) (starts with the Asaas mock; `GENERATOR_ENABLED=0` in `.env` keeps it down). The Asaas mock finds it by itself and shows **Integrations › Generator**, which fills the selected account with customers and charges
- **SMS Panel:** [http://localhost:8899](http://localhost:8899) (live phone inbox to inspect incoming messages, extract OTP codes, reply as the handset, and simulate delivery outcomes; starts with the Asaas mock, which sends the payer SMS to it — `SMS_ENABLED=0` in `.env` keeps it down)

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
| `test` | Run the tests of the mocks, one after the other |
| `clean` | Remove containers and volumes (`FORCE=1` skips the prompt) |
| `video` | Render the film and ask where to save it (default: the Desktop) |
| `video-voice` | Regenerate the narration and listen to it |
| `video-listen` | Listen to the generated narration and report what it heard |
| `video-key` | Set up the voice key (ElevenLabs first, OpenRouter second): `make video-key engine=elevenlabs` |
| `video-say` | Speak one line: `make video-say text="..." duration=4.5 id=invoice` |
| `video-try` | Try the voice with the v4 options, saved to the Desktop: `make video-try text="..." name=my-test` |
| `video-shots` | Capture the screens of the running mock for the film (needs the mocks up) |
| `video-studio` | Preview the film with the scrubber at http://localhost:3000 |

The films are rendered from code with Remotion; see [video/README.md](video/README.md).

## Published Images

Each mock is published to GHCR for `linux/amd64` and `linux/arm64`, so another project runs it
without cloning this repository:

| Mock | Image |
|---|---|
| Asaas | `ghcr.io/instituto-ama/asaas-mock` |
| WhatsApp | `ghcr.io/instituto-ama/whatsapp-mock` |
| Generator | `ghcr.io/instituto-ama/generator-mock` |
| SMS | `ghcr.io/instituto-ama/sms-mock` |

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
- **Dashboard Panel:** `http://localhost:45445` (accounts, balances, API keys, customers, charges, subscriptions, installment plans and ledger entries; create customers and charges of the three kinds, receive in cash). The **New customer** and **New charge** forms each have a button that fills every field with test data (and a customer, when the charge has none), for a one-click start.
- **Payer Notifications:** every charge event e-mails the payer (to Mailpit, UI on `http://localhost:8025`, started with the `asaas` profile), sends a WhatsApp template (to the WhatsApp mock, whose `templates/asaas_*.json` hold them) and sends an SMS (to the SMS mock, UI on `http://localhost:8899`, also started with the `asaas` profile; the Asaas mock finds it by itself and sends with the sender `ASAAS`). The SMS follows the customer's `smsEnabledForCustomer` flag and needs a mobile phone. The charge dialog of the panel lists the e-mail and the WhatsApp template and forces one on demand.
- **Invoice Page:** every charge's `invoiceUrl` (`http://localhost:45445/i/<id>`) opens the payer's page, where the charge is paid by Pix, bank slip or a test card through the same path as a real payment. `INVOICE_BASE_URL` sets its address when the host port differs.
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
- **Joins the Asaas mock by itself:** each finds the other on boot and every 10 s (compose service name, this
  machine, the Docker host), like Mailpit and the WhatsApp mock. The Asaas panel then has **Integrations › Generator**
  to populate the selected account. `GENERATOR_URL=` (empty) on the Asaas mock turns it off and hides the tab.
- **UI:** `http://localhost:45450`, and the same page on GitHub Pages, generating in the browser.

## The SMS Mock

A lightweight SMS gateway simulator with no dependencies (Bun, port 8899) for local development,
automated tests and CI. See [mocks/sms/README.md](mocks/sms/README.md).

- **APIs:** Native `POST /v1/messages` (`to`, `body`, `from`, `callbackUrl`) and `GET /v1/messages` (with `wait` long-polling for tests); Twilio-compatible `POST /2010-04-01/Accounts/{sid}/Messages.json`; and simple `GET|POST /sms/send`.
- **Message Lifecycle & Magic Numbers:** Follows `queued` → `sent` → `delivered` (after `SMS_DELIVERY_DELAY_MS`, default 1500 ms). Magic numbers by last four digits simulate deterministic outcomes: `0001` fails (30003), `0002` is undelivered (30005), `0003` rejected at API call (HTTP 400), `0004` remains stuck in `sent`, and `0005` filtered (failed, 30007).
- **Segments & OTP:** Counts GSM-7 (160/153) and UCS-2 (70/67) segments, and automatically extracts OTP verification codes.
- **Webhooks:** Dispatches status and inbound webhooks (JSON or Twilio-style form encoding) signed with `x-sms-signature: sha256=<hmac>` when `SMS_WEBHOOK_SECRET` is set, with loopback rewriting support.
- **Control Routes:** Mounted under `/_mock/sms/` (`settings`, `inbound`, `messages/:id/status`, `reset`, `webhooks/deliveries`, `demo`).
- **UI:** [http://localhost:8899](http://localhost:8899) — a real-time phone inbox panel over WebSocket (`/ws`) allowing you to inspect messages, view OTP chips, reply as the handset, and manually change message statuses.

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
    -d '{"messaging_product": "whatsapp", "type": "text", "text": {"body": "Hello, I need information"}}'
  ```
- **Webhook Configuration:**
  - Set via environment variable `WHATSAPP_WEBHOOK_URL` in `.env`.
  - Per number, Meta's call: `POST /v23.0/{phone-number-id}` with `{"webhook_configuration": {"override_callback_uri": "http://localhost:8080/webhooks/whatsapp", "verify_token": "…"}}`; the mock checks the address with `hub.challenge` first (`X-Mock-Skip-Callback-Verification: true` skips it).
  - Loopback targets are rewritten to `host.docker.internal` using `WEBHOOK_LOCALHOST_REWRITE`.
- **HMAC Signatures:**
  - When `WHATSAPP_WEBHOOK_SECRET` is set, outgoing webhook deliveries include the `x-hub-signature-256` header calculated as `sha256=HMAC_SHA256(body, secret)`.

## Repository Layout

| Path | What it is |
|---|---|
| `mocks/` | The four mocks (`asaas`, `whatsapp`, `generator`, `sms`), each with its own `Dockerfile`, `GET /health`, port, tests and README; the contract is in [mocks/README.md](mocks/README.md) |
| `site/` | The documentation site (GitHub Pages), plain HTML: English at the root, Portuguese under `site/portuguese/` |
| `video/` | The films, rendered from code with Remotion ([video/README.md](video/README.md)) |
| `profiles/` | Env key profiles for `make setup PROFILE=...` ([profiles/README.md](profiles/README.md)) |
| `scripts/` | Shell helpers behind the Makefile, the publish workflow and the site build |
| `AGENTS.md` | The rules for agents working in this repository |

## Integration with Ama-Hub

Ama-Hub integrates these mocks directly into its development lifecycle:

- In Ama-Hub, `make dev` starts these mocks from the published images, at the versions pinned in its `deploy/compose/docker-compose.dev.yml`. With `MOCKS_BUILD=1` it builds them from the sibling checkout instead, to try a change before it is published.
- Running `make sandbox` in Ama-Hub configures it to communicate with the official provider sandboxes.
- See Ama-Hub's local environment documentation at `docs/runbooks/local-environment.md` for details on how Ama-Hub orchestrates development services.

## Security Notes

- **Bound to Loopback:** All host ports are bound exclusively to `127.0.0.1` (`127.0.0.1:45445`, `127.0.0.1:3010`, `127.0.0.1:45450`, `127.0.0.1:8899` and Mailpit's `127.0.0.1:8025`). They must never be exposed on `0.0.0.0` or public networks.
- **Local Route Guard:** Every mock implements a strict local guard. The Asaas mock guards `/`, `/_admin/*` and `/_mock/*`; the generator guards `/` and `/_mock/*`; the WhatsApp mock guards every route it serves, including the `/ws` upgrade; the SMS mock guards every route but `/health`. Each rejects requests with untrusted `Host` headers (DNS rebinding) and, on writes, untrusted `Origin` headers (cross-site request attacks); the opaque `null` origin is refused as well. Besides the loopback names (`localhost`, `127.0.0.1`, `::1`) and `host.docker.internal`, the guard admits every hostname in `MOCK_ALLOWED_HOSTS` — the Compose service names (`asaas`, `whatsapp`) are the ones to use, so a mock reached by service name is not rejected.
- **Fake Keys:** All default API keys in `.env.example` and tests are non-functional mock placeholders (e.g. `$aact_hmlg_local_master`). Never commit real credentials to this repository.

## Licenses

- `mocks/asaas`: MIT License (`mocks/asaas/LICENSE`).
- `mocks/whatsapp`: Apache License 2.0 (`mocks/whatsapp/LICENSE`).
- `mocks/generator`: MIT License (`mocks/generator/LICENSE`).
- `mocks/sms`: MIT License (`mocks/sms/LICENSE`).
