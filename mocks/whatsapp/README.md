<p align="center"><b>English</b> · <a href="https://instituto-ama.github.io/ama4devs/portuguese/whatsapp/">Português</a> · <a href="https://instituto-ama.github.io/ama4devs/whatsapp/">Documentation site</a></p>

<p align="center"><img src="../../site/assets/ama4devs.jpg" alt="ama4devs in gold pixel letters on a black terminal screen, with a progress bar at 50%." width="720"></p>

# WhatsApp Mock Server

**A local WhatsApp Cloud API**: the Meta Graph API v23.0 of the WhatsApp Business
Platform, simulated operation by operation from Meta's own OpenAPI specification.
Messages, templates, media, voice calls, phone numbers and webhooks, plus a
WhatsApp Web like panel where you are the user on the other side of the chat.

<p align="center">
  <a href="https://github.com/Instituto-AMA/ama4devs/pkgs/container/whatsapp-mock"><img alt="Image" src="https://img.shields.io/badge/ghcr.io-instituto--ama%2Fwhatsapp--mock-00a884"></a>
  <img alt="Graph API" src="https://img.shields.io/badge/Meta%20Graph%20API-v23.0-1877f2">
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-amd64%20%C2%B7%20arm64-00a884">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-00a884"></a>
</p>

<p align="center">
  <img src="docs/img/chat.jpg" alt="The panel: a conversation with a template that has an image header, a formatted body, a footer and quick reply buttons, sent by the application through the Cloud API." width="900">
</p>

```bash
docker run --rm -p 3010:3010 ghcr.io/instituto-ama/whatsapp-mock:latest
```

Open **http://localhost:3010** for the panel, and point your application's Graph
base URL at **http://localhost:3010** instead of `https://graph.facebook.com`.
Nothing else changes: same paths, same bodies, same answers, same error codes.

## Why

Testing a WhatsApp integration against Meta means a real phone number, a
verified business, approved templates, a public URL for the webhook and a bill
per conversation. And you still cannot make the user answer, take a call or
refuse a template on demand.

This mock gives you all of that on `localhost`:

- **Faithful by construction.** Meta's OpenAPI file for v23.0 is vendored in
  [`spec/v23.0`](spec/README.md). Every request is routed and validated against
  it, every answer is held to its response schemas, and a contract test sends
  **every request example in Meta's specification** through the mock. Where
  Meta's specification contradicts Meta's own examples, the correction is
  written down with its reason ([`errata.json`](spec/v23.0/errata.json)).
- **Both sides of the conversation.** Your application sends through the Cloud
  API; the user answers from the panel (or from your tests, with one header),
  and the answer reaches your webhook exactly as Meta delivers it.
- **State that behaves.** Templates go through a review (approved, rejected,
  paused, with the reason and the status webhook), messages move from sent to
  delivered to read, a number has to be registered before it sends, a call
  needs the user's permission.
- **Nothing to configure.** It boots with a business, a WhatsApp Business
  Account and a phone number already registered with calling enabled.

## What it simulates

| Area | Cloud API | What happens |
|---|---|---|
| Messages | `POST /{phone-number-id}/messages` | Text, media, location, contacts, interactive, reactions, replies, templates (header, body, footer, buttons, carousel, limited-time offer, authentication). Receipts `sent → delivered → read`, typing indicator. |
| The user | the same call with `X-Mock-From` | The user writes, replies, sends media and voice notes, gives receipts: the message enters as inbound and goes to your webhook. |
| Templates | `/{waba-id}/message_templates`, `/{template-id}` | Create, edit, delete, list. A review with a verdict and a wait you choose, the `message_template_status_update` webhook, Meta's send errors (`132001`, `132000`, `132012`…). |
| Media | `/{phone-number-id}/media`, `/{media-id}` | Upload (multipart, Meta's types and size limits), describe, download with a token, delete. Files stay on disk. |
| Phone numbers | `/{waba-id}/phone_numbers`, `request_code`, `verify_code`, `register`, `settings` | Business → WABAs → numbers, the onboarding of a new number (the SMS code shows in the panel), two-step PIN, calling settings. An unregistered number cannot send (`133010`). |
| Calls | `POST /{phone-number-id}/calls`, `call_permissions` | The Calling API with **real WebRTC audio**: the user calls the business or the business calls the user, with the permission request and reply, `pre_accept`, `accept`, `reject`, `terminate` and the `calls` webhooks. |
| Webhooks | `POST /{phone-number-id}` (`webhook_configuration`) | Per-number override verified with `hub.challenge`, signed with `x-hub-signature-256`, an optional response delay, and a log of every attempt. |
| Everything else | the rest of the specification | Routed, validated and answered with Meta's own example (Flows, groups, business profile, QR codes…). |

## The panel

<table>
<tr>
<td width="50%"><img src="docs/img/templates.jpg" alt="Template builder: header formats, body with examples, footer, buttons and carousel, next to a phone that draws the template." /><br><sub><b>Template builder.</b> Header (text, image, video, document, location), body with examples, footer, every button type, carousel. The phone on the right draws it as WhatsApp does.</sub></td>
<td width="50%"><img src="docs/img/call.jpg" alt="Call screen with the timer, mute and end buttons." /><br><sub><b>Voice calls.</b> Real WebRTC audio with your microphone. Call the business as the user, call the user as the business, or answer from either side.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/img/numbers.jpg" alt="Accounts and numbers: a new number with the SMS code Meta would send and the steps to verify and register it." /><br><sub><b>Accounts and numbers.</b> Create a number, receive the code Meta would text, verify it, register it with a PIN, turn calling on.</sub></td>
<td width="50%"><img src="docs/img/api.jpg" alt="API reference: every operation of the Cloud API with a ready curl and a table of contents." /><br><sub><b>API reference.</b> Every operation of the Cloud API v23.0 with a curl ready to copy, the test headers and a table of contents that follows the reading.</sub></td>
</tr>
</table>

<p align="center">
  <img src="docs/img/phone-carousel.png" alt="The phone preview with a carousel template." width="280">
  <img src="docs/img/chat-buttons.jpg" alt="A conversation: buttons with their link, phone and code, the user's reply, a location template." width="560">
</p>

The panel speaks **English and Portuguese** (switch in the header) and keeps no
private routes: every action is the Cloud API call your application would make,
or a `/settings` call for what Meta has no endpoint for.

## Use it in your project

```yaml
services:
  whatsapp:
    image: ghcr.io/instituto-ama/whatsapp-mock:latest   # or pin a version: 0.5.0
    ports:
      - '3010:3010'
    environment:
      # Where the mock delivers webhooks (your application).
      WEBHOOK_URL: http://host.docker.internal:4000/webhooks/whatsapp
      # Signs every webhook with x-hub-signature-256, like Meta's app secret.
      WEBHOOK_SECRET: my-app-secret
      # Inside the container localhost is the container: this sends it to your machine.
      WEBHOOK_LOCALHOST_REWRITE: host.docker.internal
    extra_hosts:
      - 'host.docker.internal:host-gateway'   # Linux
    volumes:
      - whatsapp-data:/app/data               # conversations, templates, numbers, media
volumes:
  whatsapp-data:
```

Any `Authorization: Bearer <token>` is accepted, as long as there is one (Meta
refuses a call without it, and so does the mock).

```bash
# Your application sends a template…
curl -X POST http://localhost:3010/v23.0/1234567890/messages \
  -H 'Authorization: Bearer test' -H 'Content-Type: application/json' \
  -d '{"messaging_product":"whatsapp","to":"5511999999999","type":"template",
       "template":{"name":"order_confirmation","language":{"code":"en"},
         "components":[{"type":"body","parameters":[
           {"type":"text","text":"Maria"},{"type":"text","text":"1042"},{"type":"text","text":"29.90"}]}]}}'

# …and the user answers (from a test, or from the panel).
curl -X POST http://localhost:3010/v23.0/1234567890/messages \
  -H 'Authorization: Bearer test' -H 'Content-Type: application/json' \
  -H 'X-Mock-From: 5511999999999' -H 'X-Mock-Contact-Name: Maria Souza' \
  -d '{"messaging_product":"whatsapp","type":"text","text":{"body":"Hi!"}}'
```

## Test headers

What only a test needs travels in optional headers, never in the body, so the
body stays what the Cloud API expects:

| Header | On | What it does |
|---|---|---|
| `X-Mock-From` | `POST /{phone}/messages`, `/calls` | The call comes from the user's phone: a message, a receipt, a call. |
| `X-Mock-Contact-Name` | same | The profile name your webhook sees. |
| `X-Mock-Message-Status` | a read receipt with `X-Mock-From` | `delivered`, `read` or `failed`. |
| `X-Mock-Template-Review` | template create and edit | `APPROVED` (default), `REJECTED`, `PAUSED`, `DISABLED`, `PENDING`. |
| `X-Mock-Template-Review-Reason` | same | The rejection reason. |
| `X-Mock-Template-Review-Delay` | same | How long the review takes, in ms. |
| `X-Mock-Skip-Callback-Verification` | webhook override | Accept the URL without the `hub.challenge` check. |

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | `3010` | HTTP port |
| `WEBHOOK_URL` | *(empty)* | Default webhook; `phone:url` maps a number |
| `WEBHOOK_SECRET` | *(empty)* | Signs webhooks with `x-hub-signature-256` |
| `WEBHOOK_LOCALHOST_REWRITE` | *(empty)* | Host that replaces `localhost` in webhook URLs (`host.docker.internal`) |
| `MOCK_WEBHOOK_RESPONSE_DELAY_MS` | `5000` | Wait before each webhook delivery (also in the panel) |
| `MOCK_DELIVERY_MODE` | `auto` | `manual`: ticks only move when the user's phone gives a receipt |
| `MOCK_TEMPLATE_REVIEW_DELAY_MS` | `2000` | Default duration of a template review |
| `WHAP_CALL_RING_MS` | `60000` | How long a call rings before it ends unanswered |
| `WHAP_DATA_DIR` | `./data` (`/app/data` in the image) | SQLite database and media files |
| `WHAP_DB` | *(file)* | `:memory:` keeps nothing |
| `MOCK_PHONE_NUMBER_ID` · `MOCK_WABA_ID` · `MOCK_BUSINESS_ID` | `1234567890` · `100000000000001` · `100000000000002` | The ids of the default number, WABA and business |
| `MOCK_ALLOWED_HOSTS` | *(empty)* | Extra `Host` names accepted (a compose service name) |

Templates can also be seeded from files: every JSON in `templates/` is imported
at start and when it changes, and `templates/examples/` brings one example of
every component Meta allows ([docs/templates.md](docs/templates.md)).

## Documentation

- [docs/panel.md](docs/panel.md): the panel, calls, voice notes, numbers, the `/settings` routes
- [docs/templates.md](docs/templates.md): templates, seeds and examples
- [spec/README.md](spec/README.md): Meta's specification and its errata

## Development

```bash
bun install
bun run src/index.ts server          # http://localhost:3010
bun --bun vitest run --maxWorkers=2  # tests, including the contract test
bun tsc --noEmit
```

A new Graph version is a new `spec/<version>` folder and an entry in
`src/graph/versions.ts`; the contract test runs every version.

## License

Apache-2.0, see [LICENSE](LICENSE). Meta's OpenAPI specification in `spec/` is
MIT, Copyright (c) Meta Platforms, Inc. and affiliates.

**Not affiliated with Meta or WhatsApp.** This is an independent simulator of
their public API for local development and testing. WhatsApp and Meta are
trademarks of their respective owners.
