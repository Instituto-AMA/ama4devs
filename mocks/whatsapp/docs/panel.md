# The Web Panel and the Mock API

The mock serves a web panel at `GET /`: a WhatsApp-Web-like view of every
conversation, with the controls a developer needs to test an integration. The
same panel is the reference of the API: the **API** tab documents every
operation of Meta's Cloud API specification, with a call ready to copy.

Every action of the panel is a call an application could make: the Cloud API
call Meta documents (a version path and an access token), or a `/settings`
call for what Meta has no call for. The panel has no private route.

---

## The panel

| Part | What it is for |
|---|---|
| Chat list | Every conversation between the clinic numbers and the users, with the unread filter and the search. |
| Conversation | The messages of both sides, with the delivery and read ticks. The composer speaks as the user or as the clinic owner, and attaches files. |
| Control panel | The console: delivery mode, webhook destination, webhook calls, templates and the API reference. |
| Language | The switch in the header: `PT` and `EN`, kept in `localStorage`. Meta's own text in the reference stays English. |

### What the chat draws

| Message | Drawn as |
|---|---|
| `text` | the text |
| `image`, `video`, `audio`, `sticker` | the media, played or shown inside the bubble, with its caption |
| `document` | a file card that opens the file |
| `location` | a place card |
| `template` | the header (text, image, video, document or location), a limited-time offer with its end, the body with its variables filled, the footer, the buttons (quick reply, link with its suffix, phone, copy code with the code) and, for a carousel, the cards side by side under the bubble |

Text is drawn with WhatsApp's formatting: `*bold*`, `_italic_`, `~strike~`,
three backticks for monospace, and links.

A media sent by id is shown from the mock's copy (`/settings/media/{id}`); a
media sent by link is shown from the link.

### Attachments

The clip in the composer and the attachment action in the new conversation dialog
take an image, video, audio, document or sticker. The panel uploads it to the
number's media (`POST /{phone-number-id}/media`) and sends it by id, with the
text as its caption. From the user's side the message goes to the webhook with
the `mime_type`, `sha256` and `filename` Meta adds.

### Voice notes

With nothing typed, the send button is a microphone, as on the phone. It
records a voice note: Ogg Opus, mono, 48 kHz, made in the page with WebCodecs
(`AudioEncoder`) and an Ogg muxer, since Chrome records no Ogg. The note is
uploaded to the number's media and sent as `audio` with `voice: true`; from the
user's side the webhook carries `mime_type: audio/ogg; codecs=opus`. A browser
without WebCodecs uses its own recorder (Ogg when it has it, MP4 audio
otherwise, sent as a plain audio). Every audio bubble is WhatsApp's player:
the sender's face (a microphone on a voice note), play, the bars of the file,
the time, a click on the bars seeks.

### Calls

The phone button of the chat header calls with real WebRTC audio (the
browser's microphone and speaker):

| Mode | The button | What happens |
|---|---|---|
| **User** | calls the clinic | `POST /{phone}/calls` with `X-Mock-From` and the offer; the application hears `calls` / `connect`, answers `pre_accept` / `accept` with its SDP, and the panel connects to it |
| **Owner** | calls the user | without the user's permission, it sends the `call_permission_request` first; with it, `POST /{phone}/calls` `connect` with the offer, and the user's phone (this panel) rings |

The call screen answers from either side: as the user's phone, as the clinic
without an application answering, or as the user when the clinic called from
this panel. With both ends in one browser, you hear your own microphone back.
Calls stay in the conversation as call log bubbles (answered with the duration,
missed, declined). A permission request is a card with the user's choices to
allow always, allow for seven days, or deny; the answer goes to the webhook as
`call_permission_reply`.

---

## Numbers

The **Numbers** tab shows the accounts as Meta arranges them: the business,
its WhatsApp Business Accounts (WABAs) and their numbers.

| On a number | The Cloud API call |
|---|---|
| **Add number** | `POST /{waba-id}/phone_numbers` (`cc`, `phone_number`, `verified_name`): not verified, not registered |
| **By SMS**, **By call** | `POST /{phone-number-id}/request_code`; the code Meta would send shows on the number and in a toast |
| **Verify** | `POST /{phone-number-id}/verify_code`; a wrong code is `(#136025)` |
| **Register** | `POST /{phone-number-id}/register` with the six-digit PIN; the first one is kept, another is `(#133005)` |
| **Calls**, callback permission | `POST /{phone-number-id}/settings` with `calling`; turning calling on needs the number registered and a webhook (`(#138018)`) |
| **Remove from the Cloud API** | `POST /{phone-number-id}/deregister` |

A number off the Cloud API cannot send (`(#133010)`) nor call. The mock boots
with the default number `1234567890` registered with calling on.

---

## Templates

The **Templates** tab is the account's library (`GET /{waba-id}/message_templates`).
The builder edits:

| Part | What Meta takes |
|---|---|
| Header | none, text (one `{{1}}`, its example), image, video, document (a sample file for the review) or location |
| Body | the text and an example per variable: `{{1}}` in `example.body_text`, `{{name}}` in `example.body_text_named_params` (`parameter_format: NAMED`) |
| Footer | up to 60 characters |
| Buttons | up to 10: quick replies, up to 2 links (`{{1}}` suffix with an example), 1 phone, 1 copy code |
| Carousel | 2 to 10 cards, each an image or video, a text and up to 2 buttons; a carousel is a marketing template |

A component the builder has no editor for (a `LIMITED_TIME_OFFER`, the
`add_security_recommendation` and `code_expiration_minutes` of an
authentication template, an `OTP` button) is kept as it came on save.

The phone beside the form draws the template the way the patient's WhatsApp
does, with its own light/dark switch: the status bar, the business
name with its badge, Meta's notice, the header, the offer, the formatted body,
the footer with the time, and the buttons. With more than three buttons the
phone shows two and an action that opens the list. A tap on a
quick reply sends it back quoting the template; a link, a phone number or a
code shows what the tap does.

The application's templates come first. The examples of `templates/examples/`
are folded under **Examples**, apart from them.

Saving
creates (`POST /{waba-id}/message_templates`) or edits (`POST /{template-id}`)
the template: it is born `PENDING` and the review gives its verdict after the
wait set in **Review simulation** (`X-Mock-Template-Review*`). A media
header's sample is uploaded to the mock and its address is the
`example.header_handle`.

A send of a media-header template must carry the media in the header's
parameter, or the mock refuses it with Meta's `(#132012)`.

---

## What the mock remembers

Conversations, webhook calls, settings, webhook overrides, businesses, WABAs,
numbers, calls, call permissions and the template library are kept in one
SQLite file, `WHAP_DATA_DIR/whap.db`
(`/app/data` in the image, a volume). Uploaded media are files in
`WHAP_DATA_DIR/media`. A restart forgets nothing.

`templates/*.json` seed the library: a file is imported at start and when it
changes. A template deleted or edited through the API stays as the API left it
until its file changes.

`templates/examples/` holds one example per thing a template can carry, with
the sample files of their media headers in `templates/examples/media/`:

| Example | Shows |
|---|---|
| `example_appointment_reminder` | image header, footer, two quick replies and a phone button |
| `example_quote_pdf` | document header, a link with a `{{1}}` suffix |
| `example_directions` | location header, a static link, a phone button |
| `example_care_video` | video header |
| `example_coupon_discount` | text header with a variable, copy code, link, opt-out quick reply |
| `example_satisfaction_survey` | five quick replies: "see all options" |
| `example_treatments_showcase` | carousel of three image cards |
| `example_flash_offer` | limited-time offer with an image, copy code and link |
| `example_named_parameters` | named parameters |
| `example_access_code` | authentication: code, security line, expiry footer, `OTP` copy button |
| `example_formatted_text` | body only, with WhatsApp formatting and a link |

---

## The response timer

An application behind a webhook often needs a moment: a queue, a lock, a slow
handler. **Response delay** (the **Events** tab) sets how long the mock
waits before it delivers an event to the webhook. The default is **5 seconds**;
`MOCK_WEBHOOK_RESPONSE_DELAY_MS` changes it at start.

```bash
curl http://localhost:3010/settings/webhook-delay
curl -X PUT http://localhost:3010/settings/webhook-delay \
  -H 'Content-Type: application/json' -d '{"delayMs": 0}'
```

---

## The mock headers

Optional, never sent to Meta: they say how the mock behaves in a test.

| Header | On | What it does |
|---|---|---|
| `X-Mock-From` | `POST /{phone}/messages` | The user's phone writes: the message enters as received and goes to the webhook. |
| `X-Mock-From` | `POST /{phone}/calls` | The user's phone calls (`connect`), takes or declines a business call (`accept`, `reject`), hangs up (`terminate`). |
| `X-Mock-Contact-Name` | same | The profile name the webhook shows. |
| `X-Mock-Message-Status` | the read body with `X-Mock-From` | The user's receipt: `delivered`, `read` (default) or `failed`. |
| `X-Mock-Template-Review` | template create and edit | The verdict: `APPROVED` (default), `REJECTED`, `PAUSED`, `DISABLED`, `PENDING`. |
| `X-Mock-Template-Review-Reason` | same | The `reason` of the webhook and the `rejected_reason` of the read. |
| `X-Mock-Template-Review-Delay` | same | How long the review takes, in ms (default 2000, max 600000). |
| `X-Mock-Skip-Callback-Verification` | `POST /{phone}` with `webhook_configuration` | Accepts the address without the `hub.challenge` check. |

```bash
# The user writes, through the same call the clinic uses.
curl -X POST http://localhost:3010/v23.0/1234567890/messages \
  -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' \
  -H 'X-Mock-From: 5511999999999' -H 'X-Mock-Contact-Name: Maria Souza' \
  -d '{"messaging_product": "whatsapp", "type": "text", "text": {"body": "Oi"}}'
```

---

## The settings (`/settings`)

What Meta has no call for. No token.

| Method | Path | What it does |
|---|---|---|
| `GET`, `PUT` | `/settings/delivery-mode` | `auto` (ticks advance alone) or `manual` (the user's phone gives each receipt). |
| `GET`, `PUT` | `/settings/webhook-delay` | The response timer, in ms. |
| `GET` | `/settings/webhooks` | The default address, each number's override, whether a signing secret is set. |
| `GET`, `DELETE` | `/settings/events` | The webhook calls, newest first. |
| `GET`, `DELETE` | `/settings/conversations` | Every message of every number. |
| `GET` | `/settings/media/{id}` | The bytes of an uploaded media, for the panel. |
| `GET` | `/settings/examples` | The example templates (`templates/examples/`) still in the library. |
| `GET` | `/settings/accounts` | Businesses, WABAs and numbers, with the code a number waits for and its webhook. |
| `POST` | `/settings/accounts/wabas` | A new WABA on a business (`business_id`, `name`). |
| `GET` | `/settings/calls` | Every call, newest first. |
| `GET` | `/settings/examples/media/{file}` | A sample file of an example's media header. |
| `GET` | `/health` | Whether the mock is up. |

Pointing a number's webhook is Meta's call, `POST /{phone-number-id}` with
`webhook_configuration.override_callback_uri`; the mock checks the address with
`hub.challenge` first.
