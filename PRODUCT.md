# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: static HTML, CSS and plain JavaScript under `site/`, no build step and no
framework, assembled by `scripts/build-site.sh` and served by GitHub Pages
(`.github/workflows/pages.yml`). Screenshots come from `mocks/<mock>/docs/img`.

## Users

Developers who integrate an application with the WhatsApp Cloud API or the Asaas API
v3 and need a faithful local API to point at, during development, in automated tests and
in CI. Most come from Brazil (Asaas is a Brazilian payment gateway: Pix, boleto, card);
the WhatsApp mock also serves developers anywhere. They arrive from a search ("asaas
sandbox localhost", "whatsapp cloud api mock"), from GHCR or from GitHub, often after the
real sandbox failed them (no webhooks to localhost, real waiting times, no way to make the
user answer).

## Purpose

ama4devs is a repository of two mock servers, each one Docker image:

- **WhatsApp mock** (`ghcr.io/instituto-ama/whatsapp-mock`, port 3010): the Meta Graph
  API v23.0 Cloud API, routed and validated against Meta's own OpenAPI file, plus a
  WhatsApp Web like panel where the developer is the user on the other side. Messages,
  templates with a review, media, voice notes, voice calls with real WebRTC, business,
  WABAs and phone numbers, signed webhooks.
- **Asaas mock** (`ghcr.io/instituto-ama/asaas-mock`, port 45445): the Asaas API v3 with
  behavioral fidelity captured from the real sandbox: customers, Pix, boleto, card
  (tokenization, test cards), installments, subscriptions, splits, webhooks to localhost
  with the real retry rules, payer notifications by e-mail and WhatsApp.

The repository grows into a pool of provider mocks. Planned, not built: more payment
providers and banks (Stripe, Rede/Itaú, Pagar.me, C6 Bank, Banco Inter, other bank
connections). The site shows them as planned and never as available.

Success: a developer runs both together (`git clone` + `make setup`: WhatsApp, Asaas and
Mailpit configured with no step by hand), switches the base URL, and debugs the whole flow
end to end instead of guessing.

## Positioning

The Asaas mock's distinguishing mechanism is the **virtual clock**: time moves when the
developer says so (`POST /_admin/clock/advance`, `+1 / +7 / +32 days` in the panel), and
every simulated day runs the real jobs: subscriptions charge, unpaid charges go overdue,
cards credit at D+32, webhooks fire. The developer watches their own state machine react
to months of billing in seconds. Both mocks: same paths, same bodies, same webhooks as the
real API; no account, no credential, no bill.

## Brand commitments

- Name on the site: **ama4devs**, with an authorship line "maintained by Instituto AMA".
- Every page carries the disclaimer: independent simulators, not affiliated with Meta,
  WhatsApp or Asaas; no payment is real.
- Licenses: WhatsApp mock Apache-2.0, Asaas mock MIT.

## Language

English is the default at the site root; Portuguese (pt-BR) lives under `/pt-br/`, one
click away, with the same content. Both languages are kept in step.

## Constraints

- Only capabilities the mocks have today are stated. A feature not built yet is not on
  the site.
- Screenshots are current captures of the live panels, never reused old images.
- SEO and LLM discoverability matter: titles, descriptions, keywords, JSON-LD,
  `sitemap.xml`, `llms.txt`, hreflang alternates.
- Works at phone width with no horizontal scroll; respects reduced motion.

## Evidence

No testimonials, user counts, download numbers or benchmarks exist. Proof is the
mechanism itself: the parity suite against the real sandbox, the contract test over
every example of Meta's specification, the screenshots and runnable commands.
