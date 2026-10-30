<p align="center"><b>English</b> · <a href="https://instituto-ama.github.io/ama4devs/sms/">Documentation site</a></p>

<p align="center"><img src="../../site/assets/ama4devs.jpg" alt="ama4devs in gold pixel letters on a black terminal screen, with a progress bar at 50%." width="720"></p>

# SMS Mock Server

**A local SMS gateway simulator for development and automated testing.** Provides native REST, Twilio-compatible, and simple send APIs, realistic message delivery lifecycles, status and inbound webhooks with HMAC signatures, deterministic magic numbers for delivery failure simulation, GSM-7 and UCS-2 segment counting, OTP code extraction, long-poll testing support, and a live handset inbox panel updated in real time via WebSockets.

<p align="center">
  <img src="docs/img/chat-asaas.jpg" alt="The panel: the SMS the Asaas mock sent to a payer, delivered, with the sender id, the segment badge and the delivery status." width="900">
</p>

<p align="center">
  <a href="https://github.com/Instituto-AMA/ama4devs/pkgs/container/sms-mock"><img alt="Image" src="https://img.shields.io/badge/ghcr.io-instituto--ama%2Fsms--mock-4f46e5"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-amd64%20%C2%B7%20arm64-4f46e5">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-4f46e5"></a>
</p>

## Quick Start

Run the container:

```bash
docker run --rm -p 127.0.0.1:8899:8899 ghcr.io/instituto-ama/sms-mock:latest
```

Or start it with Make in the repository root:

```bash
make up MOCKS=sms
```

Open the live handset panel at [http://localhost:8899](http://localhost:8899). The container listens on `8899`; in the repository, `SMS_PORT` in the `.env` file moves the host port.

Send an SMS using the native API:

```bash
curl -s -X POST http://localhost:8899/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{"to": "+5511912340010", "body": "Your verification code is 482913"}'
```

Read it back immediately, or long-poll waiting for it to arrive:

```bash
curl -s 'http://localhost:8899/v1/messages?to=%2B5511912340010&wait=3000'
```

## Starts with the Asaas mock

In this repository the root `make up` (the `asaas` compose profile) brings the SMS mock up together with the Asaas mock, the generator and Mailpit. Set `SMS_ENABLED=0` in the `.env` file to keep it down, or run `make up MOCKS=sms` to start only the SMS mock.

The Asaas mock (version `0.11.2`) finds the SMS mock by itself: first by the compose service name `sms`, then by this machine, then by the Docker host, on port `8899`. It sends the payer SMS notifications to it (`POST /v1/messages`, sender `ASAAS`) for the same charge events as its e-mails and WhatsApp messages, and only for customers with a mobile phone. There is nothing to configure.

A verified run: a charge for "Maria Souza" produced the SMS

```text
ASAAS → +5511987654321
Maria Souza: Conta Principal gerou uma cobrança de R$ 120,50 (Consulta), com vencimento em 10/11/2026. Ver fatura e pagar: …
```

and it ended `delivered` in the SMS panel.

## The Panel

The web panel at `http://localhost:8899` models a real phone handset inbox:

- **One Conversation per Phone Number:** The sidebar groups the messages by destination number, with a sender selector, a search field and the filters **All**, **No reply** and **Failed**.
- **The Messages Your App Sent:** They arrive as bubbles on the left, with the sender id, the delivery status (**Queued**, **Sent**, **Delivered**, **Undelivered**, **Failed**) and a segment badge (`1 SMS · GSM-7`).
- **OTP Code Chips:** The parser scans message bodies for 4–8 digit verification codes and split groups (e.g., `482913`, `123-456`), rendering one-click copyable chip buttons below the message text.
- **Manual Status Controls:** On hover, each message offers **Deliver**, **Fail**, **Undelivered** and **Delete**.
- **Handset Replies:** Type in the composer at the bottom of a thread to reply as the handset user. The reply shows on the right, records an inbound message (`direction: 'inbound'`, `status: 'received'`) and fires your configured inbound webhook.
- **Live Segment Counter:** While typing in the composer, a counter displays the encoding (`GSM-7` or `UCS-2`), the length against the segment capacity and the total billed SMS parts (`length/capacity · encoding · N SMS`).
- **Details Drawer:** The info icon in the header (or a click on a bubble) opens the drawer with the fields of the message, its JSON and the status history.
- **New Test Message:** The icon in the header opens a dialog that sends a message through the API, the way your application would.
- **Two Languages:** The header switches the panel between Brazilian Portuguese and English.
- **Empty State:** With no messages yet, the panel offers **New test message**, **Load samples** and **Open the control panel**.
- **WebSocket Updates:** Real-time bi-directional synchronization over `ws://localhost:8899/ws` updates threads, delivery badges, and webhook logs without refreshing.

<table>
<tr>
<td width="50%"><img src="docs/img/chat.jpg" alt="The chat of the panel: an SMS with a copyable OTP code chip, the segment badge, the delivery status and the reply of the handset." /><br><sub><b>The conversation.</b> An OTP message with a copyable code chip, the segment badge, the delivery status and the reply of the handset on the right.</sub></td>
<td width="50%"><img src="docs/img/chat-new.jpg" alt="The new test message dialog: the destination number, the sender and the body of the message." /><br><sub><b>New test message.</b> A dialog that sends the message through the API, the way your application would.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/img/tools-delivery.jpg" alt="The delivery tab of the control panel: automatic or manual delivery and the delay in milliseconds." /><br><sub><b>Delivery.</b> Automatic or manual delivery, and the delay in milliseconds until the message arrives.</sub></td>
<td width="50%"><img src="docs/img/tools-webhooks.jpg" alt="The webhook tab of the control panel: the webhook URL, the secret and the default sender." /><br><sub><b>Webhook.</b> The URL, the secret and the default sender, with the payload shapes and the signature header.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/img/tools-events.jpg" alt="The events tab of the control panel: a list of webhook attempts with the body and the status code." /><br><sub><b>Events.</b> Every webhook attempt, with its body and the status code it answered.</sub></td>
<td width="50%"><img src="docs/img/tools-magic.jpg" alt="The magic numbers tab of the control panel: the table of deterministic outcomes by phone number suffix." /><br><sub><b>Magic numbers.</b> The last four digits of the destination decide the outcome of the message.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/img/tools-api.jpg" alt="The API tab of the control panel: an operation of the catalog expanded, with a curl and the answer of the test." /><br><sub><b>API.</b> An operation of the catalog expanded, with its parameters, its curl and the answer of a real call.</sub></td>
<td width="50%"></td>
</tr>
</table>

## The Control Panel

The icon in the header opens the control panel, a full-screen view with the tabs on the side:

- **Delivery:** Automatic or manual delivery, the delay in milliseconds and **Start from zero**, which removes every conversation and every webhook event of the mock.
- **Webhook:** The webhook URL, the secret, the default sender, the payload shapes, the `x-sms-signature` header and a Node.js snippet to verify the signature.
- **Events:** Every webhook attempt, with its body and the status code it answered.
- **Magic Numbers:** The whole table of deterministic outcomes, the GSM-7 and UCS-2 capacities and the OTP rules.
- **API:** The 20 operations of the catalog, expandable, with the parameters, the body fields, a `curl`, every documented answer and a **Test** button that sends the request for real and shows the answer.

The [API page of the documentation site](https://instituto-ama.github.io/ama4devs/sms/api/) has the same catalog, for reading.

## Send APIs

The mock exposes three send interfaces sharing the same message store and lifecycle engine:

### 1. Native API

A JSON-first REST interface under `/v1/messages`.

```bash
curl -X POST http://localhost:8899/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "+5511912340010",
    "body": "Your order #1042 has shipped.",
    "from": "AMA4DEVS",
    "callbackUrl": "http://127.0.0.1:4000/webhooks/sms"
  }'
```

Returns `201 Created` with the stored message:

```json
{
  "id": "SM01928374a5b6c7d8e9f0123456789abc",
  "direction": "outbound",
  "from": "AMA4DEVS",
  "to": "+5511912340010",
  "body": "Your order #1042 has shipped.",
  "status": "queued",
  "api": "native",
  "encoding": "GSM-7",
  "segments": 1,
  "codes": [],
  "errorCode": null,
  "errorMessage": null,
  "callbackUrl": "http://127.0.0.1:4000/webhooks/sms",
  "createdAt": "2026-10-29T17:00:00.000Z",
  "updatedAt": "2026-10-29T17:00:00.000Z",
  "sentAt": null,
  "deliveredAt": null,
  "history": [{ "status": "queued", "at": "2026-10-29T17:00:00.000Z" }]
}
```

Available native endpoints:
- `POST /v1/messages`: Create and queue an outbound message.
- `GET /v1/messages`: Query messages with filters (`to`, `from`, `number`, `status`, `direction`, `q`, `limit`, `after`, `wait`).
- `GET /v1/messages/:id`: Fetch a single message by ID.
- `DELETE /v1/messages/:id`: Delete a message (`204 No Content`).

### 2. Twilio-Compatible API

Accepts standard Twilio REST requests under `/2010-04-01/Accounts/{AccountSid}/Messages.json`. Form-encoded data (`To`, `From`, `Body`, `StatusCallback`, or `MessagingServiceSid`) is parsed and returns standard Twilio resource representations.

```bash
curl -X POST http://localhost:8899/2010-04-01/Accounts/ACmock00000000000000000000000000/Messages.json \
  -u ACmock00000000000000000000000000:mock-auth-token \
  -d "To=+5511912340010" \
  -d "From=AMA4DEVS" \
  -d "Body=Your code is 482913"
```

To point the official Twilio Node.js SDK at the mock, configure the client's base URL:

```javascript
import twilio from 'twilio';

const accountSid = 'ACmock00000000000000000000000000';
const authToken = 'mock-auth-token';

const client = twilio(accountSid, authToken);

// Swap the Twilio base API URL to point to the local mock
client.api.baseUrl = 'http://localhost:8899';
// Leave TWILIO_REGION and TWILIO_EDGE unset: with either set the SDK rewrites the hostname.

const message = await client.messages.create({
  to: '+5511912340010',
  from: 'AMA4DEVS',
  body: 'Your verification code is 482913',
});

console.log(message.sid, message.status);
```

Available Twilio-compatible endpoints:
- `POST /2010-04-01/Accounts/{AccountSid}/Messages.json`
- `GET /2010-04-01/Accounts/{AccountSid}/Messages.json`
- `GET /2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json`
- `DELETE /2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json`

### 3. Simple API

A lightweight single-endpoint interface supporting `GET` and `POST` at `/sms/send`:

```bash
# Via GET query parameters:
curl "http://localhost:8899/sms/send?to=%2B5511912340010&message=Quick+alert&sender=AMA4DEVS"

# Or via POST JSON / form:
curl -X POST http://localhost:8899/sms/send \
  -H 'Content-Type: application/json' \
  -d '{"to": "+5511912340010", "message": "Quick alert", "sender": "AMA4DEVS"}'
```

Returns `200 OK`:

```json
{
  "status": "ok",
  "id": "SM01928374a5b6c7d8e9f0123456789abc",
  "to": "+5511912340010",
  "segments": 1
}
```

Field aliases accepted: `message`, `text`, or `body`; `sender` or `from`.

## Lifecycle and Magic Numbers

Outbound messages follow an asynchronous delivery lifecycle: `queued` → `sent` → `delivered` (or a terminal failure status).
- By default, transitions occur across `SMS_DELIVERY_DELAY_MS` (default `1500` ms). The message reaches `sent` at 1/3 of the delay (`500` ms) and finishes delivery at the full duration (`1500` ms).
- Setting `SMS_DELIVERY_DELAY_MS=0` processes transitions synchronously on creation.
- Disabling auto-delivery (`SMS_AUTO_DELIVER=0`) holds messages in `queued` until manually advanced via the control API or web panel.

### Magic Numbers Table

You can test failure edge-cases deterministically by setting the destination phone number's last 4 digits:

| Suffix | Outcome | Terminal Status | Error Code | HTTP Status | Description |
|---|---|---|---|---|---|
| `...0001` | `failed` | `failed` | `30003` | 201 | Message reaches `sent`, then fails with carrier code 30003 (*Unreachable destination handset*). |
| `...0002` | `undelivered` | `undelivered` | `30005` | 201 | Message reaches `sent`, then marks undelivered with code 30005 (*Unknown destination handset*). |
| `...0003` | `rejected` | — | `21211` | 400 | Immediately rejected upon submission with HTTP 400 (`rejected_number` / 21211 *Invalid 'To' Phone Number*). |
| `...0004` | `stuck` | `sent` | — | 201 | Progresses to `sent` and stays stuck indefinitely (simulates lost network receipts). |
| `...0005` | `filtered` | `failed` | `30007` | 201 | Message reaches `sent`, then fails with carrier code 30007 (*Message filtered by the carrier*). |
| *any other* | `normal` | `delivered` | — | 201 | Progresses normally through `queued` → `sent` → `delivered`. |

### Segment Counting

The message engine analyzes text encoding and calculates billable SMS parts:
- **GSM-7:** Basic 128-character alphabet plus 9 extension characters (`^`, `{`, `}`, `\`, `[`, `]`, `~`, `|`, `€`, each counting as 2 septets). Single message capacity is **160** characters; messages exceeding 160 characters split into segments of **153** characters.
- **UCS-2:** Triggered automatically whenever text contains any character outside the GSM-7 set (such as emojis or accented characters not present in GSM 03.38). Single message capacity is **70** UTF-16 code units; multi-segment messages split into parts of **67** units.

### OTP Code Extraction

Message bodies are automatically inspected for verification codes:
- Runs of 4 to 8 standalone digits (e.g. `482913`).
- Grouped digits with separators (e.g. `123-456`, `123 456`).
- Extracted codes populate the `codes` array and render as copyable action chips in the panel.

## Webhooks

The mock posts HTTP callbacks for status changes and inbound handset replies.
- Webhook destination is resolved from the message's `callbackUrl` (per-message callback), falling back to `SMS_WEBHOOK_URL` (global default).
- Inbound replies from the handset always post to `SMS_WEBHOOK_URL`.

### Payload Formats

- **Native and Simple APIs:** Dispatches a JSON body:
  ```json
  {
    "event": "message.status",
    "message": {
      "id": "SM01928374a5b6c7d8e9f0123456789abc",
      "direction": "outbound",
      "from": "AMA4DEVS",
      "to": "+5511912340010",
      "body": "Your verification code is 482913",
      "status": "delivered",
      "api": "native",
      "encoding": "GSM-7",
      "segments": 1,
      "codes": ["482913"],
      "errorCode": null,
      "errorMessage": null,
      "callbackUrl": null,
      "createdAt": "2026-10-29T17:00:00.000Z",
      "updatedAt": "2026-10-29T17:00:01.500Z",
      "sentAt": "2026-10-29T17:00:00.500Z",
      "deliveredAt": "2026-10-29T17:00:01.500Z",
      "history": [
        { "status": "queued", "at": "2026-10-29T17:00:00.000Z" },
        { "status": "sent", "at": "2026-10-29T17:00:00.500Z" },
        { "status": "delivered", "at": "2026-10-29T17:00:01.500Z" }
      ]
    }
  }
  ```
- **Twilio-Compatible API:** Dispatches standard `application/x-www-form-urlencoded` fields (`MessageSid`, `SmsSid`, `AccountSid`, `MessageStatus`, `SmsStatus`, `From`, `To`, `NumSegments`, `ErrorCode`, `ErrorMessage`, and `Body` on inbound).

### Signature Verification

When `SMS_WEBHOOK_SECRET` is configured, outgoing webhooks include the header:
```http
x-sms-signature: sha256=<hex-hmac>
```

Verify it in Node.js:

```javascript
import crypto from 'node:crypto';

export function verifySmsWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedHash = signatureHeader.slice('sha256='.length);
  const expectedHash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const providedBuf = Buffer.from(providedHash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
```

## Testing with the Long-Poll

Automated tests can avoid brittle `sleep` timers by querying the listing endpoint with `wait=<milliseconds>`:

```bash
curl -s 'http://localhost:8899/v1/messages?to=%2B5511912340010&wait=5000'
```

- If matching messages already exist in the store, the endpoint responds immediately with HTTP 200.
- If no matches exist yet, the connection stays open until a message matching your criteria (`to`, `from`, `number`, `status`, `direction`, `q`, `after`) is created or changes into a match (e.g. `status=delivered`), or until `wait` milliseconds elapse (clamped to a maximum of 30,000 ms).
- If the wait times out without a match, it returns an empty list (`{"messages": [], "count": 0}`).

## Control Routes

Management endpoints live under `/_mock/sms/` and are guarded against untrusted origins:

| Method & Route | Description |
|---|---|
| `GET /_mock/sms/settings` | Read runtime settings (`deliveryDelayMs`, `autoDeliver`, `webhookUrl`, `webhookSecret`, `defaultFrom`). |
| `PUT /_mock/sms/settings` | Update settings at runtime; broadcasts `settings.updated` to connected panels. |
| `POST /_mock/sms/inbound` | Simulate a reply sent by the handset (`{"from": "+5511912340010", "body": "Confirmed"}`). Fires inbound webhook. |
| `POST /_mock/sms/messages/:id/status` | Manually advance an outbound message status (`{"status": "delivered", "errorCode": null}`). |
| `POST /_mock/sms/reset` | Clear all messages and webhook delivery logs from memory (`204 No Content`). |
| `GET /_mock/sms/webhooks/deliveries` | List recent webhook delivery attempts (up to 200, newest first). |
| `DELETE /_mock/sms/webhooks/deliveries` | Clear webhook delivery history (`204 No Content`). |
| `POST /_mock/sms/demo` | Seed sample inbox fixtures (OTP verification, shipping alert, UCS-2 promotion, carrier error, handset reply). |

## Configuration

Configure the mock using environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8899` | HTTP port the mock server listens on. |
| `MOCK_ALLOWED_HOSTS` | `""` | Comma-separated list of additional `Host` headers allowed by the local guard. |
| `SMS_WEBHOOK_URL` | `""` | Default target URL for status and inbound webhook callbacks. |
| `SMS_WEBHOOK_SECRET` | `""` | HMAC-SHA256 secret for signing outgoing `x-sms-signature` headers. |
| `SMS_DELIVERY_DELAY_MS` | `1500` | Duration in ms to transition from `queued` to `delivered` (0 for synchronous). |
| `SMS_AUTO_DELIVER` | `1` | Automatically advance message lifecycle (`1` = enabled, `0` = pause in `queued`). |
| `SMS_DEFAULT_COUNTRY_CODE` | `55` | Default country calling code prepended to numbers lacking an international prefix. |
| `SMS_DEFAULT_FROM` | `AMA4DEVS` | Default sender ID used when requests omit a `from` field. |
| `SMS_MAX_MESSAGES` | `5000` | Maximum messages retained in memory before oldest entries are evicted. |
| `WEBHOOK_LOCALHOST_REWRITE` | `""` | Rewrites loopback webhook hosts (`localhost`, `127.0.0.1`) to another host (e.g. `host.docker.internal`). |

## The Local Guard

To ensure safety during local development and testing, all routes except `/health` validate the `Host` header. State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`), the `/ws` handshake and `GET /sms/send` also refuse a foreign `Origin`, or a cross-site browser request (`Sec-Fetch-Site: cross-site`):
- Default allowed hosts: `localhost`, `127.0.0.1`, `::1`, `host.docker.internal`, `sms`, and `sms-mock`.
- Extra hosts (e.g. custom Docker compose service aliases) can be supplied via `MOCK_ALLOWED_HOSTS`.
- CORS preflights (`OPTIONS`) and cross-origin requests reflect allowed origins and expose standard headers.

## Limits

- **In-Memory Store:** All messages, conversation states, and webhook delivery records reside purely in RAM. Restarting the server or container resets the store completely.
- **No Real Delivery:** The mock is entirely self-contained; no telecom operators or carrier networks are ever contacted.
- **No API Key Check:** Any `Authorization` header, Bearer token, or Twilio Basic auth credential is accepted without credential validation.

## Development

Run tests:

```bash
bun test
```

Start the development server with file watching:

```bash
bun src/server.ts
# or
bun dev
```

Run TypeScript typechecks:

```bash
bun run typecheck
```
