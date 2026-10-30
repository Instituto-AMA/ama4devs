<p align="center"><b>English</b> · <a href="https://instituto-ama.github.io/ama4devs/generator/">Documentation site</a></p>

<p align="center"><img src="../../site/assets/ama4devs.jpg" alt="ama4devs in gold pixel letters on a black terminal screen, with a progress bar at 50%." width="720"></p>

# Brazilian Fake Data Generator & Asaas Populator

**Valid fake Brazilian data for tests, seeded fixtures, and instant Asaas mock population.**

Generates valid documents (CPF, CNPJ, CNH, PIS, RG), realistic individuals and companies with addresses matching Brazilian CEP ranges and DDDs, credit cards, bank accounts, Pix keys, and billing charges. The core runs with zero dependencies in Node, Bun, or directly inside the browser. It also populates the [Asaas mock](https://instituto-ama.github.io/ama4devs/asaas/) with customers and charges in a single call.

<p align="center">
  <a href="https://github.com/Instituto-AMA/ama4devs/pkgs/container/generator-mock"><img alt="Image" src="https://img.shields.io/badge/ghcr.io-instituto--ama%2Fgenerator--mock-7a3a2a"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-amd64%20%C2%B7%20arm64-7a3a2a">
  <a href="../../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-7a3a2a"></a>
</p>

## Quick Start

### Docker

```bash
docker run --rm -p 45450:45450 ghcr.io/instituto-ama/generator-mock:latest
```

Open [http://localhost:45450](http://localhost:45450) in your browser to use the interactive generator UI, or call the API:

```bash
curl 'http://localhost:45450/v1/person?count=2&seed=demo'
```

### Docker Compose

In another project's compose, add a `generator` service next to `asaas`. Both find each other automatically by service name:

```yaml
  generator:
    image: ghcr.io/instituto-ama/generator-mock:0.2.0
    ports:
      - '45450:45450'
    depends_on:
      - asaas
```

When `ASAAS_URL` is unset, the generator discovers the Asaas mock on boot and every 10 s (`asaas`, `asaas-mock`, `localhost`, `host.docker.internal` on port 45445). So `docker run` of both, or both in any compose, needs no variable.

In this repository, running `make up` boots the generator along with the Asaas mock (port 45450). Setting `GENERATOR_ENABLED=0` in `.env` keeps it down (`deploy.replicas`).

## API Endpoints

The HTTP service listens on port `45450` by default. All `/v1/*` endpoints allow CORS (`Access-Control-Allow-Origin: *`).

| Method & Route | Description |
|---|---|
| `GET /health` | Healthcheck: `{ status: 'ok', service: 'generator', version }` |
| `GET /` | Built-in web UI (static assets served from `public/`) |
| `GET /core/<name>.js` | Raw browser-native ES module files (`src/core/<name>.js`) |
| `GET /v1/kinds` | List available kinds: `{ kinds: [{ id, label }] }` |
| `GET /v1/validate/:type/:value` | Validate a document: `{ type, value, valid }` for `cpf`, `cnpj`, `cnh`, `pis` |
| `GET /v1/:kind` | Generate items for any kind. Accepts query parameters: `count` (1–1000), `seed`, `formatted`, `state`, `gender`, `outcome`, `billingType`, `now` |
| `GET /_mock/asaas/status` | Asaas connection check: `{ asaasUrl, panelUrl, reachable, customers }` |
| `POST /_mock/asaas/populate` | Populate the Asaas mock with realistic customers and charges |

### Supported Kinds

1. `person` — Realistic individual with name, CPF, RG, CNH, PIS, birth date, mother's name, email, phone, and complete address.
2. `company` — Company with CNPJ, corporate name, trade name, state/municipal registration, opening date, CNAE activity, address, and partners.
3. `address` — Address matching Brazilian state, city, real postal code (CEP) range, and IBGE code.
4. `cpf` — Brazilian Individual Taxpayer Registry number with valid check digits.
5. `cnpj` — Brazilian National Registry of Legal Entities number with valid check digits.
6. `cnh` — Brazilian National Driver's License number with valid DENATRAN check digits.
7. `pis` — Brazilian Social Integration Program number with valid mod-11 check digits.
8. `rg` — General Registry identity document with check digit.
9. `credit-card` — Test credit card details (approved, declined, or random Luhn-valid).
10. `bank-account` — Bank account with real Brazilian bank code, agency, account number, and type.
11. `pix-key` — Pix keys of type `CPF`, `CNPJ`, `EMAIL`, `PHONE`, or `EVP` (random UUIDv4).
12. `charge` — Financial charge with billing type (`PIX`, `BOLETO`, `CREDIT_CARD`), value in BRL, due date, and description.

## Determinism

Every generator function relies on a deterministic pseudo-random number generator (mulberry32). Supplying the same `seed`, kind, options, and reference date (`now`) guarantees the exact same output across runs:

```bash
# Returns identical data every time:
curl 'http://localhost:45450/v1/person?seed=fixture-1&now=2026-10-29'
```

This ensures predictable, flake-free test fixtures for automated testing suites.

## Safe Data Guarantees

All synthetic data generated adheres to safety standards:
- **Email addresses:** Constrained to RFC 2606 reserved testing domains (`example.com`, `example.org`, `example.net`).
- **Website addresses:** Formatted as `https://www.slug.example.com`.
- **Phone numbers:** Mobile phones use valid regional DDDs with subscriber digits compliant with telecommunication rules (no repeated digits).
- **Test Cards:** Default `APPROVE` outcome uses `4444444444444444`; `DECLINE` uses `5184019740373151`.

## Asaas Mock Population

Populate the Asaas mock in a single HTTP call, or directly from the Asaas panel.

When both services run together, the Asaas mock discovers the generator automatically (probing `generator`, `generator-mock`, `localhost`, and the Docker host on port 45450 every 10 s). While connected, the Asaas panel (<http://localhost:45445>) displays an **Integrations › Generator** tab showing status, an "Open generator" action, and a "Populate this account" button that seeds the account selected in the topbar via `POST /_admin/generator/populate`. If the generator is unreachable or turned off, the tab does not exist.

You can also call the generator endpoint directly:

```bash
curl -X POST http://localhost:45450/_mock/asaas/populate \
  -H 'Content-Type: application/json' \
  -d '{
    "people": 5,
    "companies": 2,
    "chargesPerCustomer": 2,
    "billingTypes": ["PIX", "BOLETO", "CREDIT_CARD"],
    "confirm": 0.5,
    "seed": "demo",
    "apiKey": "$aact_hmlg_..."
  }'
```

### How it works
1. **Target Account:** Uses the `apiKey` from the request body if specified, otherwise falling back to `ASAAS_API_KEY`.
2. **Creates Customers:** Calls `POST /v3/customers` on the Asaas mock for each person and company generated.
3. **Creates Payments:** Calls `POST /v3/payments` for each customer according to `chargesPerCustomer` and `billingTypes`.
4. **Simulates Confirmations:** For a proportion of charges determined by `confirm` (0.0 to 1.0), calls `POST /v3/sandbox/payment/{id}/confirm` to simulate completed payments.
5. **Returns Summary:** Provides IDs, direct links to the Asaas simulator panel, and any errors encountered during execution.

### Automatic Seed on Boot

Set `ASAAS_SEED_ON_BOOT` (or `GENERATOR_ASAAS_SEED_ON_BOOT` in the root `.env`) to automatically populate Asaas when the container starts (stays off unless set):

```bash
ASAAS_SEED_ON_BOOT="people=10,companies=3,charges=2,confirm=0.5"
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `45450` | Port the server listens on |
| `GENERATOR_ENABLED` | `1` | In Compose, controls service replicas (`deploy.replicas`). Set `0` to keep down |
| `ASAAS_URL` | *(unset: found by itself)* | Base URL of the Asaas mock API. When unset, discovered automatically |
| `ASAAS_API_KEY` | `$aact_hmlg_local_master` | Default API key for customer and charge creation (overridable via `apiKey` in populate body) |
| `ASAAS_PANEL_URL` | `http://localhost:45445` | Browser-accessible URL for Asaas panel links |
| `ASAAS_SEED_ON_BOOT` | `""` | Comma-separated boot seed configuration (stays off unless set) |
| `MOCK_ALLOWED_HOSTS` | `""` | Comma-separated list of additional host headers allowed by the local guard |

## Local Guard

To ensure safe local development, the root endpoint (`/`) and internal management routes (`/_mock/*`) enforce a Host and Origin guard. Requests from standard local origins (`localhost`, `127.0.0.1`, `::1`, `host.docker.internal`) are accepted. Additional allowed hosts can be configured via `MOCK_ALLOWED_HOSTS`.

## Testing

Run unit and integration tests with Bun:

```bash
bun test
```

From the repository root:

```bash
make test
```

## Documentation

Full documentation, usage examples, and browser-based generator are available at:
[https://instituto-ama.github.io/ama4devs/generator/](https://instituto-ama.github.io/ama4devs/generator/)
