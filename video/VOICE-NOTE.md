# Dev note — the voice of the film

The voice is the **Mayla - Engaging, Versatile, Smooth**
(`NS7yU4WmAouJsg84X3Mg`), a Brazilian professional voice on ElevenLabs,
fine-tuned for the `eleven_v4` model. This note is what a developer (or an
agent) needs to know to change it without wasting credits.

## The shape of the thing

```
video/src/voice.json      the declaration: endpoint, models, voice, settings
video/scripts/tts.mjs     the engines: ElevenLabs, OpenRouter, Edge
video/scripts/voice.mjs   generates and measures the whole narration
video/scripts/say.mjs     speaks one line on demand
video/scripts/try-voice.mjs  tries one short line, saves it to the Desktop
video/scripts/listen.mjs  listens to the narration and says what it heard
```

## The engines, in the order they are tried

| Order | Engine | Key | Shape of the request |
|---|---|---|---|
| 1 | **ElevenLabs** | `ELEVENLABS_API_KEY` | Native: `POST /v1/text-to-speech/{voice_id}`, `xi-api-key` header, `text`/`model_id`/`voice_settings`/`language_code`/`audio_effects`, `output_format` as a query parameter. |
| 2 | **OpenRouter** | `OPENROUTER_API_KEY` | OpenAI-compatible: `input`/`voice`/`response_format`/`speed`. |
| 3 | **Microsoft Edge** | none | `uvx --from edge-tts edge-tts`. |

The order never changes at runtime. `make video-voice` refuses the free
fallback when no provider key is there, so a missing key is an error and not a
silent downgrade in voice.

## The settings of the voice

They live in `src/voice.json`, under `speech.voice_settings`:

| Setting | Range | What it does |
|---|---|---|
| `stability` | 0–1 | How steady the voice is. **Lower is more emotional** (and less repeatable); higher is more monotone. 0.45 is the middle of the road the film uses. |
| `similarity_boost` | 0–1 | How close the voice stays to the original speaker. |
| `style` | 0–1 | How much the style of the original is amplified. |
| `use_speaker_boost` | bool | Boosts the similarity to the original (a little more latency). |
| `speed` | 0.7–1.2 | The pace. `say.mjs` corrects it when a `--duration` is given. |
| `clone_strength` | 0–1 | How close the voice stays to the samples of the clone. Only for a professional voice. |

The emotion and the tone of the voice are these numbers: `stability` down and
`style` up gives an expressive, theatrical voice; `stability` up gives a
neutral, broadcast one.

## The sound effects of a scene

The native endpoint takes `audio_effects`: the color of the voice, the room
it is in and the bed it sits on.

| Kind | Option | Ids |
|---|---|---|
| The color of the voice | `filter_preset_id` | `phone`, `old_radio`, `robot`, `cheap_microphone`, `low_quality_phone`, `bright_phone` |
| The room | `environment_id` | `small_room`, `big_room`, `hall`, `tunnel`, `street`, `valley`, `forest` |
| The bed | `background_noise_id` | `cafe`, `city`, `keyboard`, `call_center` |

A room makes the file **stereo** (the reverb tail is rendered in two
channels); the dry voice is mono.

The catalog is the source of truth for the ids:

```bash
curl -sS -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/audio-effects/catalog
```

## The other options

| Option | What it does |
|---|---|
| `language_code` | The language of the line (ISO 639-1). `pt` for the film. It is ignored by `eleven_multilingual_v2`. |
| `seed` | Makes the prosody of the line reproducible: the same text and the same seed give the same reading (the MP3 bytes are not identical, the delivery is). |
| `previous_text` / `next_text` | The lines around it, so a line that continues another one keeps the same voice and rhythm. |
| `use_pvc_as_ivc` | Uses the IVC version of a professional voice: more expressive, less latency. |

## Trying, with few credits

Every generation costs characters. The rule is short lines and few tries:

```bash
make video-try text="Um teste curto." name=meu-teste
```

The file lands in the **Desktop**, named after the test, so it can be listened
to right away. Every try keeps its own file.

With the options:

```bash
make video-try text="Atendimento, um, dois." name=eco filter=phone
make video-try text="E com a sala em volta." name=sala room=small_room
make video-try text="Mais expressivo." name=emo style="stability=0.2,style=0.8"
make video-try text="Repetível." name=fixo seed=42
```

`node video/scripts/try-voice.mjs --help` is not a thing (the script has no
help flag); the table above is in `VOICE.md`.

## The pronunciation dictionary

Some words the model says the wrong way. The fix is the **pronunciation
dictionary** of ElevenLabs: a set of rules that force how a word is heard.

The dictionary of the film is `ama4devs-pt-br`
(`5T0DghkrQszW236Z4PSC`), declared in `src/voice.json`:

```json
"pronunciation_dictionary_id": "5T0DghkrQszW236Z4PSC",
"pronunciation_dictionary_version_id": "SZ9mTluRA3Ao0zKnXJWc"
```

The rules are **phonemes** (IPA), which force the sound of the word, and not
aliases, which only rewrite the text:

| Word | Phoneme | Why |
|---|---|---|
| `mock` / `mocks` | `mɔk` / `mɔks` | The "o" was not closed |
| `Docker` | `ˈdɔ.kɚ` | The "o" was not closed |
| `payload` | `ˈpeɪ.loʊd` | Read as two words |
| `tokenizado` | `to.ˈke.ni.za.do` | The stress was in the wrong place |
| `webhook` | `ˈwɛb.hʊk` | The stress was in the wrong place |
| `endpoint` | `ˈɛnd.pɔɪnt` | The stress was in the wrong place |
| `código` | `ˈko.di.ɡu` | The accent was not heard |
| `cobrança` | `koˈbɾã.sɐ` | The nasal was not heard |
| `cartão` | `kaɾˈtɐ̃w` | The nasal was not heard |
| `três`, `duzentos`, `mês`, `já` | `tɾɛs`, `duˈzɛ̃.tus`, `mɛs`, `ʒa` | The accent was not heard |

The brand has **no rule**. Every phoneme tried for it failed — `ˈamɐ` → "aMour",
`ˈɐmɐ` → "Herma", `ˈɐ.mɐ` → "Alma", `ˈa.mɐ` → "Amor" — and an alias made it
worse ("AMER 4 devs"). The rule was removed and the script says the brand the
way it must be heard: "ama for deves". A word the model already reads right is
better than a word a wrong phoneme breaks.

The brand is **"ama for deves"**, and the "for" is the English word, not the
number four — it is the pun of the name. The script writes it that way and the
model reads it that way; the "for" only needs the English `fɔɹ`, which the
Brazilian voice already does.

### The phonemes are tried, not guessed

An IPA phoneme is a guess too: `ˈa.mɐ` was heard as "amor". The first `a` of
the Brazilian "ama" is a closed vowel in a closed syllable — `ˈɐmɐ` — and
that is the one that works.

To try a phoneme without spending the whole narration, use `make video-try`
and listen to the file that lands in the Desktop. Then rewrite the rules:

```bash
npx -y @elevenlabs/cli@latest pronunciation-dictionaries rules set \
  --pronunciation-dictionary-id 5T0DghkrQszW236Z4PSC \
  --json '{"rules":[
    {"type":"phoneme","string_to_replace":"ama","phoneme":"ˈɐmɐ","alphabet":"ipa"}
  ]}' --format json
```

`rules set` replaces the whole set; `rules add` adds to it.

**The transcription lies about the brand.** The ASR writes "Llama", "Alma",
"Herma" or "LLM" for it — it guesses the word it does not know. All of them
are the brand, and `listen.mjs` knows that (`BRAND` in the script). Only the
ear decides: the audio is right when the "ama" is said with a closed "a" and a
closed syllable. Trust the file, not the transcription.

The "for" of the brand is the English word — the pun of the name — and the
Brazilian voice already reads it that way. Nothing forces it.

### Changing the rules

The API key of the project cannot write dictionaries (it has no
`pronunciation_dictionaries_write`), so the rules go through the official
CLI, which is authenticated with the OAuth of the browser:

```bash
npx -y @elevenlabs/cli@latest pronunciation-dictionaries rules add \
  --pronunciation-dictionary-id 5T0DghkrQszW236Z4PSC \
  --json '{"rules":[
    {"type":"phoneme","string_to_replace":"ama","phoneme":"ˈa.mɐ","alphabet":"ipa"}
  ]}' --format json
```

The answer carries the new `version_id`: **put it in `src/voice.json`**,
otherwise the new rules are not used. A rule added without the version in the
file changes nothing.

The fields of a rule are `string_to_replace`, `phoneme` and `alphabet` — not
`from` and `to`, which is what the CLI's help shows.

### The accent of the transcription

The transcription of `listen.mjs` does **not** keep the accents: the model
that transcribes writes "cobranca" for "cobrança". So a missing accent in the
transcription is **not** proof that the voice left it out — the dictionary is
what guarantees it.

### The audio is written atomically

Once, the `whatsapp` segment was heard with the words of another request. The
file was complete (the right length, a valid MP3) and the API answered the
right text — but the listen and the generation were running at the same time,
and the listen read the file of the previous round.

Two things came out of it:

- the audio is written through a temporary file and renamed over the target,
  so a reader never sees a half-written file (`writeAudio` in `tts.mjs`);
- the listen always runs **after** the generation, never beside it.

When a line fails, regenerate that one segment — do not regenerate the whole
film:

```bash
rm video/public/audio/voice/whatsapp.mp3
cd video && node scripts/voice.mjs --require-engine
```

## Listening before rendering

The narration is checked against the script: every segment is uploaded and
transcribed, and the transcription is compared with `src/voice.json`. The
words that sound the same (`tique`/`tick`) count as the same word.

```bash
make video-listen
node video/scripts/listen.mjs --id intro
```

This is the check that pays for itself: it caught five mispronounced lines in
the script (`tê-nent`, `tick`, a comma that changed the phrasing, a number
spelled out, and `ama for deves` read as `uma para devs`). A line below 80%
fails the build.

### The numbers are not deterministic

The v4 model reads a number **either way**, and the choice changes between
requests of the same text:

```
"32 dias depois..." -> "Trinta e dois dias depois..."   (once)
"32 dias depois..." -> "32 dias depois..."               (twice)
```

So the script writes the number in digits — `32 dias`, `R$ 349`, `resposta
200` — and the comparison spells both sides out before matching. Without that,
a line that is perfectly fine scores 0% because the transcription wrote the
number in full.

**Do not chase this with the API.** Repeating the same request to see which
way the number comes out costs credits and proves nothing: the answer
changes every time. Change the script or the comparison, never the request.

The numbers that the voice reads in full anyway are the ones the script
already spells out (`Seis recusas`, `Trinta e dois`): those are fine, because
both sides of the comparison agree.

## The key

Never through the chat. `make video-key engine=elevenlabs` opens the browser
through the official CLI, reads the key from `.env.local` without printing it,
verifies it against `GET /v1/models` and saves it in `.env.sandbox` (mode
600). The OpenRouter key is asked with the input hidden and verified against
`/api/v1/auth/key`.
