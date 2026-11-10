# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The product is a repository of four containerized mocks, a documentation site and a
film pipeline, each part with its own stack:

- **Asaas mock**: Elysia on Bun, SQLite with Drizzle, TypeBox schemas.
- **WhatsApp mock**: Hono on Bun, WebSockets, SQLite and files for the state.
- **Generator**: `Bun.serve`, no dependency. `src/core/*.js` are browser-native ES
  modules (seeded RNG, never `Math.random()`), shared by the server and the UI.
- **SMS mock**: `Bun.serve`, no dependency, `src/core/*.js` browser-native and shared
  with the phone-inbox panel.
- **Site**: delegated: static HTML, CSS and plain JavaScript under `site/`, no build
  step and no framework, assembled by `scripts/build-site.sh` and served by GitHub Pages
  (`.github/workflows/pages.yml`). Screenshots come from `mocks/<mock>/docs/img`.
- **Films**: Remotion compositions under `video/src/`, rendered from code.

Each mock ships as one image on GHCR, for `linux/amd64` and `linux/arm64`.

## Users

Developers integrating an application with a provider API who need a faithful local API
to point at, during development, in automated tests and in CI. Most are Brazilian: Asaas
is a Brazilian payment gateway (Pix, boleto, card), and the data, the credit check and
the SMS numbers are Brazilian. The WhatsApp mock also serves developers anywhere.

They arrive from a search ("asaas sandbox localhost", "whatsapp cloud api mock"), from
GHCR or GitHub, from the generator hosted on Pages, and often after the real sandbox
failed them: no webhooks to localhost, real waiting times, no way to make the user
answer, credentials to manage, a bill to pay.

Three jobs, in order of frequency: see the whole flow end to end on the machine; write a
test that asserts on a webhook or a status; get valid data (a CPF, a CNPJ, an address
with a real CEP range, a card, a Pix key) without touching a real person's data.

## Purpose

ama4devs is a repository of local mock servers, each one a Docker image: three mocks of a
real provider API and one tool that feeds them.

- **WhatsApp mock** (`ghcr.io/instituto-ama/whatsapp-mock`, port 3010): the Meta Graph
  API v23.0 Cloud API, routed and validated against Meta's own OpenAPI file, plus a
  WhatsApp Web like panel where the developer is the user on the other side. Messages of
  every type, templates with a review, media, voice notes, voice calls with real WebRTC,
  business, WABAs and numbers with SMS code onboarding, webhooks signed with
  `x-hub-signature-256`. The state survives a restart.
- **Asaas mock** (`ghcr.io/instituto-ama/asaas-mock`, port 45445): the Asaas API v3 with
  behavioral fidelity captured from the real sandbox: customers, Pix, boleto, card
  (tokenization, test cards), installments, subscriptions, splits, hosted checkout,
  webhooks to localhost with the real retry rules, payer notifications by e-mail,
  WhatsApp and SMS, and the payer's own invoice page.
- **SMS mock** (`ghcr.io/instituto-ama/sms-mock`, port 8899): an SMS gateway, in memory
  and with no dependency: a native API, a Twilio-compatible API and a simple one; the
  `queued → sent → delivered` lifecycle, deterministic magic numbers, GSM-7 and UCS-2
  segment counting, OTP extraction, status and inbound webhooks signed with HMAC, and a
  live phone-inbox panel over WebSocket.
- **Generator** (`ghcr.io/instituto-ama/generator-mock`, port 45450): valid fake Brazilian
  data, the same for the same seed: people, companies, CPF, CNPJ, CNH, PIS, RG, addresses
  with real CEP ranges, credit cards, bank accounts, Pix keys and charges. It populates
  the Asaas mock through the Asaas API itself and simulates the Direct Data credit check
  at the provider's own paths, with a public token and seventeen test CPFs.

The generator's UI runs in the browser with no container: on Pages it is a first-class
hosted tool, with a playground that runs every route and the Direct Data answers for
each test CPF.

The repository grows into a pool of provider mocks. Planned, not built: more payment
providers and banks (Stripe, Rede/Itaú, Pagar.me, C6 Bank, Banco Inter, other bank
connections). The site shows them as planned and never as available.

Success: a developer runs the set together (`git clone` + `make setup`: WhatsApp, Asaas,
SMS, generator and Mailpit configured with no step by hand), switches the base URL, and
debugs the whole flow end to end instead of guessing.

## Positioning

The Asaas mock's distinguishing mechanism is the **virtual clock**: time moves when the
developer says so (`POST /_admin/clock/advance`, `+1 / +7 / +32 days` in the panel), and
every simulated day runs the real jobs: subscriptions charge, unpaid charges go overdue,
cards credit at D+32, webhooks fire. The developer watches their own state machine react
to months of billing in seconds.

Every mock answers with the real API's paths, bodies and webhooks, so the integration
code under test does not change: no account, no credential, no bill. The generator and
the Direct Data simulation extend the same promise to the data side, and the SMS mock
answers at the provider's own paths in its three API shapes.

The mock is published, not installed: one image per mock on GHCR, one tag per version
that never moves plus `latest`, so another project runs the same mock without cloning
this repository.

## Operating Context

- **Two flows.** `make setup` (or `make env-mock`) points the application at the local
  mocks and writes fake keys (`$aact_hmlg_local_master`) into the target `.env`.
  `make setup-sandbox` points it at the official Asaas sandbox and the Meta Graph API,
  registers the webhook there with a random token and keeps every secret in
  `.env.sandbox` (mode `0600`, gitignored).
- **The mocks find each other.** The Asaas mock finds Mailpit, the WhatsApp mock and the
  SMS mock by itself, by compose service name, by `localhost` or by the Docker host, the
  closest one first, and the generator joins it the same way. `MAILPIT_URL`,
  `WHATSAPP_MOCK_URL` and `SMS_MOCK_URL` pin a place; an empty value turns the channel
  off. The WhatsApp mock runs alone.
- **Panels are the window.** Each mock has a panel that shows what the real API never
  shows: conversations, charges, the ledger, request logs, webhook deliveries, the phone
  inbox. Mailpit is the mailbox of the payer e-mails.
- **Part of the site is generated.** `site/data/*.json` (the operations of each mock's
  API with their details, and the mocks' own routes captured from fresh instances) is
  written by `scripts/site-api-data.mjs` and `scripts/site-routes-data.mjs` and never
  edited by hand.
- **The films are captured, not drawn.** A film is rendered from code with Remotion and
  every still is a capture of the running mock; `make video-shots` takes them again when
  the mock's behavior changes. The demos are published as release media and linked from
  the site.
- **Ama-Hub consumes the images.** It starts them from GHCR at the versions pinned in
  its own compose, or builds from a sibling checkout with `MOCKS_BUILD=1`.

## Brand commitments

- Name on the site: **ama4devs**, with an authorship line "maintained by Instituto AMA".
- Every page carries the disclaimer: independent simulators, not affiliated with Meta,
  WhatsApp or Asaas; no payment is real.
- Licenses: the WhatsApp mock is Apache-2.0; the Asaas, generator and SMS mocks are MIT.

## Language

The site is English at the root by default; Portuguese (pt-BR) lives under
`/portuguese/`, one click away, with the same content. Both languages are kept in step.

The repository itself is written in English. Portuguese appears only as on-screen
presentation: text a person reads in a panel, a payer-facing message, a localized page,
or narration and captions in a film.

## Constraints

- Only capabilities the mocks have today are stated. A feature not built yet is not on
  the site.
- Screenshots are current captures of the live panels, never reused old images.
- SEO and LLM discoverability matter: titles, descriptions, keywords, JSON-LD,
  `sitemap.xml`, `llms.txt`, hreflang alternates.
- Works at phone width with no horizontal scroll; respects reduced motion.
- Every mock is self-contained: its own Dockerfile, `GET /health`, a dedicated port and
  an automated test suite.
- Bound to loopback: the host ports listen on `127.0.0.1` only and must never be exposed
  on a public network. Each mock guards its own routes against a DNS rebinding `Host`
  and, on writes, a cross-site `Origin`; `MOCK_ALLOWED_HOSTS` admits the compose service
  names.
- No secret is committed: the keys in the examples and in the tests are fake
  placeholders, and the sandbox secrets live only in `.env.sandbox`.
- The registry holds nothing but the mocks: one image per version, `<version>` pinned and
  never moved, plus `latest` for the newest.

## Evidence

No testimonials, user counts, download numbers or benchmarks exist. Proof is the
mechanism itself: the parity suite against the real sandbox, the contract test over every
example of Meta's own specification, the test suite of each mock, the screenshots, the
generated API data and the runnable commands.

The films are evidence too: every value, event and status on screen comes from a real
run of the mock.

Absences future work must not fabricate: customers, logos, testimonials, usage numbers,
benchmarks and comparisons the mocks cannot show.

## Product Principles

1. **Fidelity over convenience.** The mock answers like the real API — same paths, same
   bodies, same webhooks — so the developer's code does not change to be tested.
2. **Nothing to configure by hand.** One image, one command, no credential, no account;
   a mock finds the ones it needs by itself.
3. **Truth over polish.** Only what is built is stated. A planned provider is a blank
   slot, never an available one; a screenshot is a capture of today, not of last month.
4. **The clock is the hero.** Time moves when the developer says so, so a month of
   billing runs in a second and the state machine reacts in front of them.
5. **The run is the proof.** Every line printed on the site and every still in a film
   comes from a real run of the images.
