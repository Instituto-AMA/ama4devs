# The voice of the film, for an agent

This is the door an LLM uses to put a voice on a line of the film. Read it
before touching the audio: it says which engine speaks, where the key lives
and what the commands are.

The developer note — the settings of the voice, the sound effects and the
rules of the credits — is in [VOICE-NOTE.md](VOICE-NOTE.md).

## The voice

The film speaks with **Mayla - Engaging, Versatile, Smooth**
(`NS7yU4WmAouJsg84X3Mg`), a Brazilian professional voice fine-tuned for the
`eleven_v4` model. The endpoint, the models and the settings live in
`src/voice.json`:

```json
"speech": {
  "base_url": "https://api.elevenlabs.io/v1/text-to-speech/{voice}",
  "models": ["eleven_v4", "eleven_multilingual_v2"],
  "voice": "NS7yU4WmAouJsg84X3Mg",
  "voice_name": "Mayla - Engaging, Versatile, Smooth",
  "response_format": "mp3_44100_128",
  "language_code": "pt",
  "pronunciation_dictionary_id": "5T0DghkrQszW236Z4PSC",
  "pronunciation_dictionary_version_id": "SZ9mTluRA3Ao0zKnXJWc",
  "voice_settings": {
    "stability": 0.45,
    "similarity_boost": 0.8,
    "style": 0.35,
    "use_speaker_boost": true
  }
}
```

The two `pronunciation_dictionary_*` fields are the rules that force how a word
is heard — without them the model reads "cobrança" without the nasal. They
have to carry the **version id** of the rules: a rule that is not in that
version changes nothing.

| Setting | What it does |
|---|---|
| `stability` | How steady the voice is. Lower is more emotional (and less repeatable), higher is more monotone. |
| `similarity_boost` | How close the voice stays to the original speaker. |
| `style` | How much the style of the original is amplified. |
| `use_speaker_boost` | Boosts the similarity to the original (a little more latency). |
| `speed` | The pace, from 0.7 to 1.2. |
| `clone_strength` | How close the voice stays to the samples of the clone (a professional voice). |

## Trying the voice

`scripts/try-voice.mjs` speaks one short line with the options of the
provider and writes it to the **Desktop**, so the developer can listen to it.
Every test keeps its own file.

```bash
make video-try text="Um teste curto." name=meu-teste
```

The options:

| Option | What it does |
|---|---|
| `--text <string>` | The line to speak. |
| `--name <text>` | The name of the file (the default comes from the text). |
| `--model <id>` | `eleven_v4` (the default), `eleven_multilingual_v2`, ... |
| `--voice <id>` | The voice of the provider. The default is the one in `src/voice.json`. |
| `--style <a=b,c=d>` | The voice settings: `stability`, `similarity_boost`, `style`, `use_speaker_boost`, `speed`, `clone_strength`. |
| `--language <code>` | The language of the line (ISO 639-1). The default is `pt`. |
| `--filter <id>` | The color of the voice: `phone`, `old_radio`, `robot`, `cheap_microphone`, `low_quality_phone`, `bright_phone`. |
| `--room <id>` | The room of the voice: `small_room`, `big_room`, `hall`, `tunnel`, `street`, `valley`, `forest`. It makes the file stereo. |
| `--noise <id>` | The bed of the voice: `cafe`, `city`, `keyboard`, `call_center`. |
| `--effect <id>` | A shortcut that takes the id of any effect of the catalog. |
| `--seed <number>` | The seed that makes the prosody of the line reproducible. |
| `--pace <number>` | The speed of the voice, from 0.7 to 1.2. |
| `--out <path>` | Where to write the file. The default is the Desktop. |
| `--json` | Print the answer as JSON. |

The ids of the effects come from `GET /v1/audio-effects/catalog`:

```bash
curl -sS -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/audio-effects/catalog
```

**Credits:** every test costs characters. Keep the lines short and the number
of tries small; the same line with the same seed gives the same prosody, so
there is no need to try it twice.

## The engines, in the order they are tried

| Order | Engine | Key | Notes |
|---|---|---|---|
| 1 | **ElevenLabs** (the primary one) | `ELEVENLABS_API_KEY` | The official provider, straight from `api.elevenlabs.io`. |
| 2 | **OpenRouter** (the secondary one) | `OPENROUTER_API_KEY` | The OpenAI-compatible endpoint, used when there is no ElevenLabs key. |
| 3 | **Microsoft Edge** | none | Free neural voices, no account. The last resort, good enough for a draft. |

The order never changes at runtime: the first engine with a key in the
environment speaks the film. `src/voice.json` declares the endpoint, the
models and the voice of each one (`speech` for ElevenLabs, `speech_fallback`
for OpenRouter).

## Where the key lives

The key is read from the environment and is **never written to the repository**.
It lives in `.env.sandbox` (gitignored, mode 600) and reaches the scripts
through the shell:

```bash
set -a; . ./.env.sandbox; set +a
```

**Never ask for a key in the chat, and never accept one pasted there.** A key
in the chat is a key in the history. Use the setup script below: it reads the
key with the input hidden and saves it in the right place by itself.

## Setting the key up

### ElevenLabs (the official CLI)

The official CLI of ElevenLabs does the whole flow — the browser approval, the
storage of the key and the check of it. The CLI is not installed by default;
`npx` runs it without touching the project:

```bash
# what the project needs, and what is left to do
npx -y @elevenlabs/cli@latest onboard init

# the approval: it opens the browser, and the key lands in .env.local
npx -y @elevenlabs/cli@latest onboard connect --env-path .env.local

# the check: it verifies the key and the integration
npx -y @elevenlabs/cli@latest onboard check --env-path .env.local

# a short text-to-speech request (ask the developer first)
npx -y @elevenlabs/cli@latest onboard test --env-path .env.local
```

The CLI writes the key in `.env.local`. The film reads `.env.sandbox`, so the
script below copies it over and verifies it against the provider:

```bash
make video-key engine=elevenlabs
```

What the script does, in order:

1. runs the CLI approval (`onboard connect`), which prints the link of the
   approval page — open it in the browser and click Authorize;
2. reads the key from `.env.local` **without printing it**;
3. verifies it against `GET https://api.elevenlabs.io/v1/models` (the key
   travels in a curl config file, never in the command line, where `ps` would
   show it);
4. writes it in `.env.sandbox` as `ELEVENLABS_API_KEY`, mode 600;
5. prints which engines the film will now use.

The CLI keeps `.env.local` — that is where it stores its own copy. The file is
gitignored: add it to `.gitignore` if it is not there yet. Never print it and
never `cat` it.

### OpenRouter (the secondary one)

The OpenRouter key is pasted in the terminal with the input hidden and
verified against the provider:

```bash
make video-key engine=openrouter
```

The key must start with `sk-or-`. It is saved in `.env.sandbox` as
`OPENROUTER_API_KEY`, mode 600, and never printed.

### The Edge fallback

Nothing to set up: `uvx --from edge-tts edge-tts` speaks the line. It is
free, has no account and needs `uv` on the PATH.

## Is the CLI installed?

The CLI of ElevenLabs is a Python package, and this project runs it through
`npx` (the `@elevenlabs/cli` package). Check before using it:

```bash
npx -y @elevenlabs/cli@latest --version   # runs it, nothing to install
```

A project that wants it as a real dependency instead:

```bash
npm install --save-dev @elevenlabs/cli     # then: npx elevenlabs onboard init
```

If the CLI is not available at all, the fallback is Edge — no key, no install.

## Speaking one line

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

## The whole narration

`scripts/voice.mjs` reads the lines of `src/voice.json` and writes the same
`src/voice.durations.json`, one file per segment in `public/audio/voice/`:

```bash
make video-voice                # only the missing files
node video/scripts/voice.mjs --force   # everything again
```

A recording of a human voice always wins: drop a file at
`public/audio/recorded/<id>.m4a` (`.mp3`, `.wav` and `.aac` work too) and the
timeline follows the length of that file.

`make video-voice` refuses to narrate with Edge when no provider key is
available: it fails with a message that says how to set the key up, instead of
generating a draft in a different voice. To allow the free fallback on
purpose, run the script without `--require-engine`:

```bash
node video/scripts/voice.mjs
```

## Listening to the narration

The audio is checked against the script: every segment is uploaded and
transcribed by the MCP connector, and the transcription is compared with the
text of `src/voice.json`. A mispronounced word, a wrong language or a
truncated line shows up here instead of in the render.

```bash
make video-listen              # every segment
node video/scripts/listen.mjs --id intro --id end
node video/scripts/listen.mjs --json
```

```
  intro: listening... "um mock local da API do ASAS." -> 100%
  end: listening... "De volta ao presente" -> 100%

25/25 segments heard, 96% on average
```

The match ignores the accents and the punctuation: the words of the script
that the transcription says, in order, over the words of the script. The
command fails when a segment cannot be listened to or when one of them is
below 80%.

The transcriber sometimes answers about another audio: a segment whose match
is near zero is heard again, and the better of the two hearings is the one
that counts. The hearing is free — the speech of the provider is never
repeated, it costs credits. A file that is wrong on both hearings is a file
to generate again:

```bash
rm video/public/audio/voice/<id>.mp3
node video/scripts/voice.mjs          # speaks only the missing line
```

It needs the `mcode-tools` CLI on the PATH (the MCP connector of this
environment). Without it the command fails: the check is part of the build,
and a narration nobody listened to is not a narration that was verified.

## The rules

1. **The key never goes through the chat.** Ask for it with
   `make video-key`, or let the CLI open the browser.
2. **Never print the env file.** `cat .env.sandbox` is forbidden; run
   `onboard check` to verify a key.
3. **Never put the key in the code.** The scripts read the environment.
4. **Never commit a key.** `.env.sandbox` and `.env.local` are gitignored.
5. **The film states what the mock did.** If the voice changes, the audio
   changes with it: regenerate the narration and the timeline follows.
