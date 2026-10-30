# Whap: WhatsApp Mock Server Development Notes

> **General Rules & Repository Guidelines:** See the root [AGENTS.md](../../AGENTS.md).

This mock is maintained as part of `Instituto-AMA/ama4devs`. It simulates the WhatsApp Business Cloud API (Meta Graph API) for local development and testing.

---

## Whap-Specific Architecture & Details

### 1. Components
- **Mock Server:** Hono-based server (`src/server/server.ts`) listening on port 3010 (override via `PORT` or `--port`).
- **Interactive TUI:** React + Ink terminal interface (`src/tui/index.tsx`).
- **CLI Router:** Brocli-based command router (`src/index.ts`).
- **Web Inspection Panel:** Inline HTML panel served at `GET /`.

### 2. The Cloud API, from Meta's own specification (`src/graph/`)
- Every call that replicates Meta is the real Meta resource: no `/mock/...` route exists. `spec/<version>/business-messaging-api.yaml` is Meta's OpenAPI file (github.com/facebook/openapi, MIT); `spec/<version>/errata.json` lists where Meta's spec contradicts its own examples, each correction with its reason. Only `v23.0` is served; another version answers `(#2500)`.
- `graph/engine.ts` checks the version, the access token (missing → `2500`, malformed → `190`), matches the operation (ids resolved by kind through `NodeRegistry`), checks required query parameters and validates the body against the spec. The stateful operations (`graph/versions.ts`: messages, templates, media, phone number) run in the simulation routers; every other operation answers Meta's example, or a body shaped by the response schema.
- A new Graph version is a new `spec/<version>` folder and an entry in `graph/versions.ts`. `graph/contract.test.ts` sends every request example of every version through the mock and checks the answers against the response schemas.
- What only a test needs travels in optional `X-Mock-*` headers (`src/server/mock-headers.ts`): `X-Mock-From` / `X-Mock-Contact-Name` (the user's phone writes, through the same send call), `X-Mock-Message-Status` (the user's receipt), `X-Mock-Template-Review`, `-Reason`, `-Delay` (the review verdict and wait), `X-Mock-Skip-Callback-Verification` (a webhook override without the `hub.challenge` check).
- What Meta has no call for lives under `/settings` (`routes/settings.ts`): delivery mode, webhook delay, webhooks, events, conversations, `/settings/media/{id}` for the panel, and the example templates (`/settings/examples`). Health: `GET /health`.
- Media: `POST /{phone}/media` (multipart, Meta's types and limits), `GET`/`DELETE /{media-id}`, and the download URL `/whatsapp_business/attachments/?mid=…` (wants a token, like Meta's).
- Accounts (`routes/accounts.ts`, `store/account-store.ts`): Business → WABAs → numbers. `GET /{business}/owned_whatsapp_business_accounts`, `GET`/`POST /{waba}`, `GET`/`POST /{waba}/phone_numbers`, `request_code` (the code Meta would text is shown in the panel and the log), `verify_code` (`136025`), `register` (two-step PIN, `133005` on mismatch), `deregister`, `GET`/`POST /{phone}/settings` (calling, in the spec's lowercase). A number that is not registered cannot send (`133010`). Boot seeds the default business, WABA and number `1234567890` (`MOCK_PHONE_NUMBER_ID`), registered with calling enabled, plus the configured numbers; an id the mock never saw joins the default WABA registered, calling disabled. `/settings/accounts` is the tree for the panel; `POST /settings/accounts/wabas` makes a WABA (Meta makes them in the embedded signup).
- Calls (`calls.ts`, `routes/calls.ts`): Meta's Calling API with real WebRTC SDP. `POST /{phone}/calls` with `connect`, `pre_accept`, `accept`, `reject`, `terminate`; with `X-Mock-From` it is the user's phone (connect = the user calls; accept/reject a business call; terminate). Webhooks on the `calls` field: `connect` (offer, or the user's answer), `terminate` (COMPLETED/FAILED, times and duration when answered), `statuses` with `type: call` (RINGING, ACCEPTED, REJECTED). Rules: registered number with calling on (`133010`, `138000`), the user's permission for business calls (`138006`), one active call per user (`138003`), 100 business calls a day (`138012`), the SDP of accept matching pre_accept, ring time `WHAP_CALL_RING_MS` (60 s). Permissions: `GET /{phone}/call_permissions`, the `call_permission_request` interactive message (1 per 24 h, 2 per 7 days: `138009`; `138017` over a permanent one), the user's `call_permission_reply` (temporary 7 days or permanent), automatic when the user calls and callback permission is on, revoked after 4 unanswered business calls. `/settings/calls` lists the calls for the panel.

### 3. What the mock remembers (`src/server/store/`)
- One SQLite file (`bun:sqlite`), `WHAP_DATA_DIR/whap.db` (default `./data`, `/app/data` in the image, a volume): conversations, webhook calls, settings, webhook overrides, businesses, WABAs, numbers, calls, call permissions and the template library. A call that was going on when the mock stopped is closed at start. Media bytes are files in `WHAP_DATA_DIR/media/`, their metadata in the database.
- `templates/*.json` seed the library: imported at start and on change, by content hash, so a template deleted or edited through the API stays as the API left it until its file changes.
- `templates/examples/*.json` are seeds too: one template per thing Meta lets a template carry (image, video, document and location headers, footer, every button type, more than three buttons, carousel, limited-time offer, named parameters, authentication, formatting). Their sample media are `templates/examples/media/`, served at `/settings/examples/media/{file}`; `/settings/examples` lists them so the panel folds them apart (`routes/examples.ts`).
- `WHAP_DB=:memory:` (and every vitest run) keeps everything in memory, each store on its own database.

### 4. The Web Panel
- Served at `GET /` as one self-contained page (`src/server/ui/panel.ts`): the chat, the console (delivery, webhook, events, templates, API) and the API reference. The server inlines the Cloud API reference of the latest version (`graph/reference.ts`) into the page.
- Every action of the panel is the Cloud API call an application would make (Bearer token, version path) or a `/settings` call; the panel never has a private route.
- The chat draws every message type: text, media (image, video, audio, document, sticker), location, and templates with their header (text, media, location), footer, buttons (quick reply, link, phone, copy code) and carousel cards. Files are attached in the composer and in the new conversation dialog: uploaded to the number's media, sent by id.
- The template builder: header, body with examples (positional or named), footer, buttons, carousel; components it has no editor for (a limited-time offer, the authentication fields) are kept on save. Beside it a phone (its own light and dark) draws the template as WhatsApp does: business header, Meta's notice, WhatsApp formatting, at most three buttons (more open "see all options"), carousel, offer; a tapped quick reply comes back quoting the template.
- Calls in the chat: the phone button of the chat header calls the clinic as the user, or (in **Owner** mode) the user as the clinic, asking for the call permission first when there is none. The call screen runs real WebRTC (`RTCPeerConnection`, ICE gathered before the SDP leaves); the panel answers as the user or as the clinic, both ends in one browser when no application answers. Calls appear in the conversation as call log bubbles; the permission request is a card with the user's three choices.
- Voice notes: the composer's microphone records Ogg Opus mono (WebCodecs `AudioEncoder` and an Ogg muxer in the page, since Chrome records no Ogg), uploads it and sends `audio` with `voice: true`; without WebCodecs it falls back to the browser's recorder. Audio bubbles draw WhatsApp's player (bars from the decoded file, progress, seek).
- The **Numbers** tab: businesses, WABAs and numbers, with the onboarding steps (request code, verify, register with PIN) and the calling switches.
- Two languages, pt-BR and English, chosen in the header and kept in `localStorage`; Meta's own text in the reference stays English.
- The reference of the panel and of the API: `docs/panel.md`.

### 5. Webhooks & Signatures
- **Localhost Rewriting:** Containerized calls to `localhost` or `127.0.0.1` are automatically rewritten to target `host.docker.internal` (controlled by `WEBHOOK_LOCALHOST_REWRITE`).
- **HMAC Signatures:** When `WEBHOOK_SECRET` is configured, outgoing webhooks include the `x-hub-signature-256` signature header, exactly matching Meta's Cloud API specification.
- **Priority:** CLI arguments (`--webhook-url`) > Environment variables (`WEBHOOK_URL`) > Configuration file (`whap.json`).

### 6. Custom Template Resolution
- Configurable in `whap.json` via `templates.cmd`.
- When set, whap delegates template resolution to an external command instead of the library.

### 7. Coding Conventions
- **Bun Execution:** Use Bun for all tasks (`bun test`, `bun run build`, `bun tsc --noEmit`).
- **Imports:** Always use explicit `.ts` / `.tsx` extensions in import statements.
- **No Barrel Files:** Keep imports direct and explicit; do not create re-exporting index files.
- **No Centralized `types.ts`:** Declare types beside their respective domain functions and stores.
