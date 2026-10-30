# ama4devs video

The ama4devs films, rendered from code with [Remotion](https://www.remotion.dev/).

Each film is a React composition: the shots, the camera and the timing are code,
so a re-render is stable and the words and the facts live in one file.

## The Asaas film (`AsaasTour`)

Two minutes and thirteen seconds over the real screen of the running mock.

The film is a **tour of the product**, not an animation about it: every shot is
a picture taken from the Asaas mock while it ran — the customer record, the
payer invoice, the WhatsApp thread, the webhook log, the request log, the
virtual clock, the refused card. The camera pushes in on the element the
narration is talking about, the film highlights it, and the caption says what
it is.

### The look

The film is set like an editorial: the cards are paper — cream, ink and gold —
and the tour is the dark screen of the product.

- **The cards** open and close the film on cream, set in Instrument Serif, with
  a gold hairline that draws itself in and every element arriving on its own.
- **The captions** are statements, not subtitles: Instrument Serif at the lower
  left, the words arriving one after the other, and the ones the film
  emphasizes — the words between asterisks in `film.json` — coming out in gold
  and in italic.
- **The transitions** trade the two screens the way a cut does: the new picture
  arrives sharp and a little large, the old one leaves sharp and a little
  further away, and a light crosses the frame while the two do.
- **The furniture** — the chapter and the wordmark — sits on the lower right in
  gold, and the progress bar at the bottom counts the screens, one segment per
  shot.

The story it tells, in the order the mock produced it:

1. a customer, a charge and an invoice, paid by card;
2. a test card that tokenizes and refuses on purpose;
3. the channels — the payer's WhatsApp, the application's webhook, a second
   account with its own key and its own customers;
4. the virtual clock — one day, one week, thirty-two days: a charge falls due,
   goes overdue, the balance is credited, the events are delivered;
5. the refusal — a subscription on the refusing card, the request your
   application made, six refusals delivered with HTTP 200, and the charge
   finally overdue.

Nothing in the film is staged: the stills are captures, the values are the
mock's, and the events are the ones the mock really delivered.

## Requirements

- Bun (or Node 18+) and ffmpeg on the PATH
- `uv`, only for the Edge fallback of the generated voice (`uvx --from edge-tts edge-tts`)
- An ElevenLabs key in `.env.sandbox` for the generated voice (`ELEVENLABS_API_KEY=`) — the primary engine
- An OpenRouter key in `.env.sandbox` (`OPENROUTER_API_KEY=`) — the secondary engine, used only when there is no ElevenLabs key
- Playwright, for the capture only (`bun add -d playwright`)
- The first render downloads Remotion's headless Chromium (~150 MB, once)

## Commands

From the repository root:

```bash
make video         # render the film; asks where to save it (default: the Desktop)
make video out=~/Movies/film.mp4   # render without the question
make video-key     # set up the voice key (ElevenLabs first, OpenRouter second)
make video-voice   # regenerate the narration and listen to it
make video-listen  # listen to the narration alone and report what it heard
make video-try text="Um teste." name=meu-teste   # try the voice, saved to the Desktop
make video-shots   # take the stills again, from the running mock
make video-studio  # preview at http://localhost:3000, with the scrubber
```

From `video/`:

```bash
bun install

bun run studio                          # preview
bun run render /path/to/film.mp4        # -> the file you choose
bunx remotion still src/index.ts AsaasTour out/still.png --frame=1120
```

**The film does not live in this repository.** `make video` asks where to write
the MP4 and defaults to `~/Desktop/ama4devs-asaas-mock.mp4`; nothing is left
behind under `video/`, so the repository carries the code of the film and not
its output.

## The shots

`public/shots/` holds the thirty stills of the tour, 1440×900 each, taken from
the mock while it ran. `src/shots.json` is the manifest of the capture: the
file, the page, the caption of the tour and the box the camera must focus on.

They are in the repository because the film cannot be rendered without them.
To take them again, the mock has to be running (and the API console with it):

```bash
# the mock, the WhatsApp mock, Mailpit and the webhook receiver
make up                       # or the local runner of the mocks
node video/scripts/console.mjs &   # the API console the film shows (port 45992)
make video-shots              # writes public/shots/ and src/shots.json
```

`scripts/capture.mjs` drives the panel with Playwright: it creates the
customer, the charge, the subscription and the refusing card, advances the
virtual clock day by day, opens the webhook and request logs and saves a still
at every beat. Every address can be changed with an environment variable
(`ASAAS_BASE`, `WHATSAPP_CONSOLE`, `MAILPIT_URL`, `RECEIVER_URL`,
`API_CONSOLE_URL`).

## The film

| Path | What it is |
|---|---|
| `src/Root.tsx` | The composition: the shots on the timeline, the voice, the progress line |
| `src/film.ts` | The timeline: how long each shot lasts, where the narration starts, where the camera looks |
| `src/film.json` | What the film says over each shot: the caption, the chapter, the narration and the zoom |
| `src/scenes/Tour.tsx` | One shot: the captured screen under the camera, the highlight and the caption |
| `src/scenes/Cards.tsx` | The opening and the closing cards |
| `src/scenes/Furniture.tsx` | The chapter and the wordmark, which live above the shots |
| `src/shots.json` | The manifest of the capture |
| `src/theme.ts` | The ama4devs palette, the typefaces and the camera |
| `src/fonts.ts` | The site's own typefaces, served locally so a render never depends on a font CDN |
| `public/shots/` | The thirty stills of the tour |
| `public/fonts/` | Archivo, Doto, Martian Mono and Instrument Serif (latin subset, served locally) |
| `public/audio/` | The voice and the optional music bed |
| `scripts/capture.mjs` | Takes the stills from the running mock |
| `scripts/console.mjs` | The API console the film shows |
| `scripts/tts.mjs` | The voice engines: ElevenLabs first, OpenRouter second, Edge last |
| `scripts/voice.mjs` | Generates and measures the whole narration |
| `scripts/say.mjs` | Speaks one line on demand — the door an LLM uses |
| `scripts/listen.mjs` | Listens to the narration (MCP connector) and says what it heard |
| `scripts/try-voice.mjs` | Tries one short line with the v4 options, saved to the Desktop |

A caption may emphasize a word: the words between asterisks in `film.json` come
out in gold and in italic.

```json
"caption": "A fatura do pagador — a que chega por e-mail e *WhatsApp*"
```

## The voice

The film narrates itself. The narration is data, not code: `src/voice.json`
holds one segment per line of the script (the id and the text), and
`scripts/voice.mjs` turns each segment into an audio file and measures it.

```
src/voice.json            the script: one id and one text per line
scripts/voice.mjs         generates and measures the audio
public/audio/voice/*.mp3  the generated voice
public/audio/recorded/    your own recording (wins over the generated one)
src/voice.durations.json  the measured lengths the composition reads
src/bed.json              the music bed, or null when there is none
```

The composition places each line on the timeline: a shot lasts as long as its
narration needs, plus a breath, and two narrations never talk over each other.

### Three ways to put a voice on the film

1. **Your own recording (best).** Record the lines — any recorder, any app —
   and export one file per segment as `public/audio/recorded/<id>.m4a`
   (`.mp3`, `.wav` and `.aac` work too). The ids are the ones in
   `src/voice.json`: `intro`, `customer`, `invoice`, `paid`, `card`,
   `whatsapp`, `webhook`, `profiles`, `clock`, `due`, `charge_overdue`, `overdue`,
   `balance`, `received`, `console`, `logs`, `subscription`, `month`, `pending`,
   `refusal`, `refusal_detail`, `charge_overdue_refusal`, `six`, `end`, `closing`. Run
   `make video-voice` and the timeline follows the length of your file.
   Nothing else changes.
2. **The generated voice (default).** The engines are tried in this order, and
   the first one with a key speaks the film:
   1. **ElevenLabs** — the official provider, straight from `api.elevenlabs.io`
      (`ELEVENLABS_API_KEY`), with the Brazilian professional voice **Mayla —
      Engaging, Versatile, Smooth** (`NS7yU4WmAouJsg84X3Mg`), fine-tuned for
      the `eleven_v4` model;
   2. **OpenRouter** — the OpenAI-compatible endpoint
      (`OPENROUTER_API_KEY`);
   3. **Microsoft Edge** — free neural voices, no account, the last resort.

   The endpoint, the models, the voice and the settings live in
   `src/voice.json` (`speech` for ElevenLabs, `speech_fallback` for
   OpenRouter); the key comes from the environment — `.env.sandbox`,
   gitignored, never in the repository. Regenerate with `make video-voice`;
   `node scripts/voice.mjs --force` rewrites the files that already exist.
   The voice of the provider has its own knobs — emotion, tone, the sound
   effects of a scene — and `make video-try` speaks one short line with them,
   saved to the Desktop to listen to.
3. **Another TTS.** Point the script at your engine and keep the same output:
   one file per segment in `public/audio/voice/` and the same
   `src/voice.durations.json` shape. Any server that speaks the OpenAI audio
   API works (`TTS_BASE_URL`, `TTS_MODEL`, `TTS_VOICE`), a local Kokoro
   included.

The key is set up with `make video-key`: the script asks for it with the input
hidden, verifies it against the provider and saves it in `.env.sandbox`. It
never goes through the chat. The full guide for an agent that speaks the film
is in [VOICE.md](VOICE.md).

### How an LLM calls the voice

`scripts/say.mjs` speaks one line and says where it landed. It is the door an
agent uses to put a voice on a line: the text, the pace, and the seconds the
audio has to last.

```bash
cd ama4devs
set -a; . ./.env.sandbox; set +a

# a line that has to last 4.5 seconds
node video/scripts/say.mjs --text "A fatura do pagador." --duration 4.5 --id invoice

# a line that starts at the second 118.5 of the film
node video/scripts/say.mjs --text "E o aviso final." --pace 0.9 --at 118.5 --id refusal

# the same, for a machine to read
node video/scripts/say.mjs --text "E o aviso final." --id refusal --json
```

The JSON answer:

```json
{
  "id": "refusal",
  "file": "public/audio/voice/refusal.mp3",
  "engine": "speech",
  "provider": "elevenlabs",
  "model": "eleven_v4",
  "voice": "NS7yU4WmAouJsg84X3Mg",
  "seconds": 4.4,
  "frames": 132,
  "pace": 0.9,
  "speed": 0.9,
  "targetSeconds": 4.5,
  "drift": -0.1,
  "at": 118.5,
  "atFrame": 3555,
  "timeline": "src/voice.durations.json",
  "cue": "src/voice.cues.json"
}
```

`provider` says which engine spoke: `elevenlabs`, `openrouter` or `edge`.

| Option | What it does |
|---|---|
| `--text <string>` | The line to speak. `--file <path>` reads it from a file. |
| `--id <name>` | The segment id: the name of the file, of the entry in `src/voice.durations.json` and of the cue in `src/voice.cues.json`. Without it, the id comes from the text. |
| `--pace <number>` | The speaking rate: 1 is the voice's own pace, 0.8 is slower, 1.2 is faster. The provider accepts 0.7 to 1.2. |
| `--duration <seconds>` | The length the audio has to have. The pace is corrected until the line fits (up to three tries) and the drift is reported; when the target is out of reach, the answer says so. |
| `--at <seconds>` | The second of the film where the line starts. The cue goes to `src/voice.cues.json`, and the composition reads it. |
| `--voice <id>` | The voice of the endpoint. The default is the one in `src/voice.json`. |
| `--style <a=b,c=d>` | The ElevenLabs settings: `stability`, `similarity` and `style`, from 0 to 1. |
| `--out <path>` | Where to write the audio. The default is `public/audio/voice/<id>.mp3`. |
| `--engine <name>` | `speech` (the endpoint) or `edge` (the free fallback, no key). |
| `--json` | Print the answer as JSON. |

What the script writes, and what the film reads:

- `public/audio/voice/<id>.mp3` — the audio;
- `src/voice.durations.json` — the measured length of every line, which the
  timeline follows;
- `src/voice.cues.json` — the second of every pinned line.

A cue never makes two narrations talk over each other: a line pinned inside the
speech of the previous one waits for it, and the shot grows to fit.

The whole narration at once is `scripts/voice.mjs`: it reads the lines of
`src/voice.json` and writes the same `src/voice.durations.json`.

### The music bed
Drop a track at `public/audio/bed.mp3` (or `.m4a`, `.wav`) and run
`make video-voice`: the film plays it under the narration, from the first frame
to the last, at 22% volume. Without the file the film is voice only.

## Where the facts come from

Everything the film says about the API is real. The stills are captures of the
mock running locally (`mocks/asaas` in this repository) on 2026-10-28, and the
values on the screen are the ones it produced:

- the charge of R$ 349,90 on the refusing card, and the R$ 199,90 subscription;
- the webhook deliveries — `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` and
  `PAYMENT_OVERDUE` for the same payment, both delivered to
  `http://localhost:45991/webhook/asaas` with HTTP 200 on the first attempt;
- the six capture attempts the scheduler made (three on 07/01, three on 08/01)
  and the charge going overdue on the last of them.

The film never states anything the mock did not produce. To refresh the facts,
run the mock, read the same endpoints (`/_admin/request-logs`,
`/_admin/webhooks/deliveries`), take the stills again and rewrite
`src/film.json`.

## Publishing

The film is a build artifact and stays out of the repository. `make video`
writes it where you say; to publish it on the Pages site, render it straight
into the site (`make video out=site/video/asaas-tour.mp4`) and let
`scripts/build-site.sh` ship it with the pages.

## A note on the license

Remotion is free for individuals and companies of up to three people. A bigger
organisation needs a Company License (`remotion.pro/license`): "Creators" for
low-volume manual videos, "Automators" for a pipeline that renders in batch.
Check the terms before publishing: <https://www.remotion.dev/docs/license/pricing>.

## Other cuts

The copy is pt-BR because the panel is. An English cut is a second
`src/voice.json` plus a second `src/film.json`: no shot has to change, because
no shot hardcodes a word.
