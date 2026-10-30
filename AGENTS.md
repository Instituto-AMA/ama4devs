# AGENTS.md — ama4devs

Rules, layout map, and instructions for agents working in this repository.

## Layout Map

| Path | What it is |
|---|---|
| `Makefile` | Root entrypoint (`help`, `setup`, `setup-sandbox`, `up`, `down`, `status`, `test`, `clean`, ...) |
| `docker-compose.yml` | Compose definitions with profiles for each mock service (`asaas`, `whatsapp`, `generator`, `sms`; the generator and the SMS mock also ride `asaas`) |
| `.env.example` | Contract for root environment variables and port mappings |
| `scripts/` | Shell helpers: `lib.sh`, `check-tools.sh`, `setup.sh`, `setup-sandbox.sh`, `env-mode.sh`, `publish.sh` (multi-platform build and push to GHCR), `changed-mocks.sh` (the mocks a push changed), `voice-key.sh` (the speech key, asked with the input hidden) |
| `site/` | The GitHub Pages documentation site (https://instituto-ama.github.io/ama4devs/): plain HTML, one stylesheet and one script in `site/assets/`; English at the root, Portuguese under `site/pt-br/` with the same section ids. Per mock: overview with use cases (`<mock>/`), `quick-start/`, `api/`, `docs/`. The printer on the home and the overviews replays a real run of the images (calls, events, values): rerun the run before changing a line. Every command a quick start or use case prints must run as written against a fresh container. A change to a mock's behavior rewrites its pages (EN and PT) in the same change; visual decisions live in `DESIGN.md` |
| `site/data/` | Generated, never edited by hand. `node scripts/site-api-data.mjs` (both mocks up, `make up`) writes the specs' operations and their details (parameters, body fields, examples, responses); rerun it when a spec or the engine coverage changes. `node scripts/site-routes-data.mjs <asaas> <whatsapp>` writes the mocks' own routes (`/_admin`, `/_mock`, `/settings`) with answers captured from FRESH instances (its header has the commands); rerun it when one of those routes changes |
| `scripts/build-site.sh` | Assembles `_site/` (gitignored) from `site/`, the mocks' `docs/img/` screenshots (the one copy the READMEs show) and `llms.txt` |
| `.github/workflows/pages.yml` | Builds and deploys the site on every push to master that touches it or the screenshots |
| `.github/workflows/publish-mocks.yml` | Publishes `ghcr.io/instituto-ama/<mock>-mock` on every push to master that changes a mock; only the changed mocks, after their tests |
| `profiles/` | Environment key profiles (`generic/mock.env`, `generic/sandbox.env`) |
| `mocks/asaas/` | Asaas mock server (Elysia, Bun, SQLite, Drizzle, TypeBox) |
| `mocks/whatsapp/` | WhatsApp / Meta Graph API mock server (Hono, Bun, WebSockets) |
| `mocks/generator/` | Fake Brazilian data generator (Bun.serve, no dependency): `src/core/*.js` are browser-native ES modules (JSDoc, no Bun/Node API, seeded `Rng`, never `Math.random()`) shared by the server and the UI in `public/`; `scripts/build-site.sh` publishes `public/` and `src/core/` at `generator/app/` on Pages. Populates the Asaas mock through its API (`POST /_mock/asaas/populate`) |
| `mocks/sms/` | SMS gateway mock server (Bun.serve, no dependency; `src/core/*.js` browser-native shared with the panel in `public/`; panel is a phone inbox; control routes `/_mock/sms/*`; in-memory) |
| `mocks/README.md` | The contract of a mock and checklist for adding a new mock |
| `video/` | The films, rendered from code with Remotion (`bun run render` in `video/`, or `make video` from the root): React compositions under `video/src/` (`scenes/`, `film.ts`, `film.json`, `shots.json`, `voice.json`, `voice.cues.json`, `theme.ts`), the thirty stills of the tour under `video/public/shots/`, the voice and the optional music bed under `video/public/audio/`, the voice engines in `video/scripts/tts.mjs` (ElevenLabs first, OpenRouter second, Edge last), the narration generator in `video/scripts/voice.mjs`, the one-line generator in `video/scripts/say.mjs`, the try of a short line in `video/scripts/try-voice.mjs`, the listener that checks the narration in `video/scripts/listen.mjs`, the capture of the stills in `video/scripts/capture.mjs` and the guide for an agent that speaks the film in `video/VOICE.md`. `make video` asks where to save the rendered MP4 (default: the Desktop) and leaves no film inside the repository |

## The Rules

1. **English Only:** All identifiers, code, comments, documentation, commit messages, and PR descriptions must be written in English. The only exception is text a person reads on a screen (panel labels, buttons, error messages displayed to users in pt-BR).
2. **Self-Contained Mocks:** Each mock lives in `mocks/<name>` as an independent service with its own `Dockerfile`, `GET /health` endpoint, dedicated port, and automated test suite.
3. **No Editing Generated Files:** Never edit generated files by hand:
   - `mocks/asaas/src/generated/*` (run `bun run codegen` in `mocks/asaas`)
   - `mocks/asaas/src/admin/ui.html` (run `bun run panel:build` in `mocks/asaas`)
4. **No Secrets in the Repository:**
   - Keys in tests, compose files, and examples must remain fake placeholders (e.g. `$aact_hmlg_local_master`).
   - Sandbox secrets belong strictly in `.env.sandbox` (gitignored, mode 0600) and must never be committed.
5. **Published Images:** A change to a mock that projects should receive bumps `version` in that mock's `package.json`; the published `<version>` tag never moves, and consumers (Ama-Hub's `deploy/compose/docker-compose.dev.yml`) pin it. Never build images on the owner's machine to publish unless asked: the workflow publishes.
6. **Deterministic Tests:** Tests run via `make test` or within each mock directory (`bun test`). Tests must never use sleep timers to wait for state changes; await the operation or event completion.
7. **The Films State What the Mock Did:** A film is a claim about the product. Every picture in `video/public/shots/` is a capture of the running mock, and every value, event, payload and status on the screen comes from a real run of it (`/_admin/request-logs`, `/_admin/webhooks/deliveries`); when the mock's behavior changes, the stills are taken again (`make video-shots`) and the film's facts change in the same change. Never invent a payload, a status or a date to make a shot look better, and never stage a screen that the mock cannot produce.
8. **The Voice Is Data:** The narration lives in `video/src/voice.json` and its audio in `video/public/audio/`. A human recording (`video/public/audio/recorded/<id>.m4a`) always wins over the generated voice, and `node video/scripts/voice.mjs` re-measures the timeline from the files that are actually there. Never commit a recording of a person without asking.
9. **One Line At A Time:** `node video/scripts/say.mjs --text "..." --duration 4.5 --id fatura` speaks a single line, corrects the pace until the line fits the seconds it was given, writes the file, and updates `src/voice.durations.json` (the measured length the timeline follows) and `src/voice.cues.json` (the second the line starts at, when `--at` is given). The key comes from the environment (`.env.sandbox`), never from the repository.
10. **The Voice Engines, In Order:** The generated voice speaks with the first engine that has a key: **ElevenLabs** (`ELEVENLABS_API_KEY`, the official provider at `api.elevenlabs.io`), then **OpenRouter** (`OPENROUTER_API_KEY`, the OpenAI-compatible endpoint), then **Microsoft Edge** (`uvx --from edge-tts edge-tts`, free, no key). The endpoints, the models, the voice and the settings live in `video/src/voice.json` (`speech` for ElevenLabs, `speech_fallback` for OpenRouter). The default voice is **Mayla — Engaging, Versatile, Smooth** (`NS7yU4WmAouJsg84X3Mg`), a Brazilian professional voice fine-tuned for `eleven_v4`. `video/VOICE.md` is the guide for an agent that speaks the film.
11. **The Speech Key Never Goes Through the Chat:** Never ask for an ElevenLabs or OpenRouter key in the chat and never accept one pasted there — a key in the chat is a key in the history. Use `make video-key` (the script `scripts/voice-key.sh`): it asks with the input hidden, verifies the key against the provider and saves it in `.env.sandbox` (mode 0600, gitignored). The official ElevenLabs CLI (`npx -y @elevenlabs/cli@latest onboard connect --env-path .env.local`) does the browser approval and writes `.env.local` (gitignored); never print or `cat` either file.
12. **The Voice Is Tried, Not Guessed:** `make video-try text="..." name=...` speaks one short line with the options of the provider (emotion and tone through `--style`, the sound effects of a scene through `--filter`, `--room` and `--noise`, the reproducible prosody through `--seed`) and writes it to the Desktop for the developer to listen to. Every try costs credits: keep the lines short, do not repeat a line that already exists, and never regenerate the whole narration to test one setting.
13. **Credits Are Scarce:** never repeat a request to see if the answer changes. The v4 model reads a number either way ("32 dias" or "trinta e dois") and the choice changes between identical requests, so repeating the request proves nothing and costs characters. Fix the script or the comparison instead — `listen.mjs` spells both sides out before matching, and the numbers of the script are written in digits (`32 dias`, `R$ 349`, `resposta 200`).
14. **The Pronunciation Is Forced, Not Hoped For:** a word the model says wrong is fixed in the pronunciation dictionary of the film (`ama4devs-pt-br`, `5T0DghkrQszW236Z4PSC`), declared in `video/src/voice.json` with its version id. The rules are phonemes (IPA), not aliases: `mock` → `mɔk`, `código` → `ˈko.di.ɡu`, `cobrança` → `koˈbɾã.sɐ`, `cartão` → `kaɾˈtɐ̃w`. The brand has no rule: every phoneme tried for it failed (`ˈamɐ` → "aMour", `ˈɐmɐ` → "Herma", `ˈɐ.mɐ` → "Alma", `ˈa.mɐ` → "Amor"), so the rule was removed and the script says the brand the way it must be heard — "ama for deves". To add one, use the official CLI (the API key of the project has no `pronunciation_dictionaries_write`) and **put the new version id in `src/voice.json`**, or the rule changes nothing: `npx -y @elevenlabs/cli@latest pronunciation-dictionaries rules set --pronunciation-dictionary-id 5T0DghkrQszW236Z4PSC --json '{"rules":[{"type":"phoneme","string_to_replace":"mock","phoneme":"mɔk","alphabet":"ipa"}]}'`. The brand is "ama **for** deves" — the English word *for*, the pun of the name, not the number four. The transcription of `listen.mjs` does not keep the accents and guesses the words it does not know ("Llama", "Alma", "LLM" for "ama"), so only the ear decides: trust the file, not the transcription.
15. **The Audio Is Checked, Not Trusted:** the provider can answer with the audio of another request — a file with the right length and the wrong words. `make video-listen` catches it (the match falls), and only that segment is generated again (`rm video/public/audio/voice/<id>.mp3`), never the whole film. The audio is written atomically (`writeAudio` in `tts.mjs`: a temporary file, then a rename), and the listen runs **after** the generation, never beside it. The transcriber can answer about another audio too: a segment whose match is near zero is heard again — the hearing is free, the speech of the provider is never repeated — and only a file that is wrong on both hearings is regenerated.

## How to Verify a Change

- **Run tests:**
  ```bash
  make test
  ```
  Or run within a specific mock:
  ```bash
  cd mocks/asaas && bun test
  cd mocks/whatsapp && bun run test
  ```
- **Check builds:**
  ```bash
  make build
  ```
- **Check service health:**
  ```bash
  make up
  make status
  ```
- **Render the film:**
  ```bash
  make video         # asks where to save it; defaults to ~/Desktop/ama4devs-asaas-mock.mp4
  make video-voice   # regenerate and re-measure the narration, then listen to it
  make video-listen  # listen to the narration alone and report what it heard
  make video-say text="..." duration=4.5 id=fatura   # speak one line and fit it to the seconds
  make video-shots   # take the stills again, from the running mock
  ```
- **Set up the voice key (never through the chat):**
  ```bash
  make video-key engine=elevenlabs   # the official CLI opens the browser; the key lands in .env.sandbox
  make video-key engine=openrouter   # the key is asked with the input hidden
  npx -y @elevenlabs/cli@latest onboard check --env-path .env.local   # verify, without printing the key
  ```
- **Try the voice (costs credits — short lines only):**
  ```bash
  make video-try text="Um teste curto." name=meu-teste
  make video-try text="..." name=eco style="stability=0.2,style=0.8" filter=phone
  ```
  The file lands in the Desktop, ready to listen to.
- **Check the film:**
  ```bash
  ffprobe -v error -show_entries format=duration -show_entries stream=codec_type \
    -of default=noprint_wrappers=1 ~/Desktop/ama4devs-asaas-mock.mp4
  ```
