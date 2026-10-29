# AGENTS.md — ama4devs

Rules, layout map, and instructions for agents working in this repository.

## Layout Map

| Path | What it is |
|---|---|
| `Makefile` | Root entrypoint (`help`, `setup`, `setup-sandbox`, `up`, `down`, `status`, `test`, `clean`, ...) |
| `docker-compose.yml` | Compose definitions with profiles for each mock service (`asaas`, `whatsapp`, `generator`; the generator also rides `asaas`) |
| `.env.example` | Contract for root environment variables and port mappings |
| `scripts/` | Shell helpers: `lib.sh`, `check-tools.sh`, `setup.sh`, `setup-sandbox.sh`, `env-mode.sh`, `publish.sh` (multi-platform build and push to GHCR), `changed-mocks.sh` (the mocks a push changed) |
| `site/` | The GitHub Pages documentation site (https://instituto-ama.github.io/ama4devs/): plain HTML, one stylesheet and one script in `site/assets/`; English at the root, Portuguese under `site/pt-br/` with the same section ids. Per mock: overview with use cases (`<mock>/`), `quick-start/`, `api/`, `docs/`. The printer on the home and the overviews replays a real run of the images (calls, events, values): rerun the run before changing a line. Every command a quick start or use case prints must run as written against a fresh container. A change to a mock's behavior rewrites its pages (EN and PT) in the same change; visual decisions live in `DESIGN.md` |
| `site/data/` | Generated, never edited by hand. `node scripts/site-api-data.mjs` (both mocks up, `make up`) writes the specs' operations and their details (parameters, body fields, examples, responses); rerun it when a spec or the engine coverage changes. `node scripts/site-routes-data.mjs <asaas> <whatsapp>` writes the mocks' own routes (`/_admin`, `/_mock`, `/settings`) with answers captured from FRESH instances (its header has the commands); rerun it when one of those routes changes |
| `scripts/build-site.sh` | Assembles `_site/` (gitignored) from `site/`, the mocks' `docs/img/` screenshots (the one copy the READMEs show) and `llms.txt` |
| `.github/workflows/pages.yml` | Builds and deploys the site on every push to master that touches it or the screenshots |
| `.github/workflows/publish-mocks.yml` | Publishes `ghcr.io/instituto-ama/<mock>-mock` on every push to master that changes a mock; only the changed mocks, after their tests |
| `profiles/` | Environment key profiles (`generic/mock.env`, `generic/sandbox.env`) |
| `mocks/asaas/` | Asaas mock server (Elysia, Bun, SQLite, Drizzle, TypeBox) |
| `mocks/whatsapp/` | WhatsApp / Meta Graph API mock server (Hono, Bun, WebSockets) |
| `mocks/generator/` | Fake Brazilian data generator (Bun.serve, no dependency): `src/core/*.js` are browser-native ES modules (JSDoc, no Bun/Node API, seeded `Rng`, never `Math.random()`) shared by the server and the UI in `public/`; `scripts/build-site.sh` publishes `public/` and `src/core/` at `generator/app/` on Pages. Populates the Asaas mock through its API (`POST /_mock/asaas/populate`) |
| `mocks/README.md` | The contract of a mock and checklist for adding a new mock |
| `video/` | The films, rendered from code with Remotion (`bun run render` in `video/`, or `make video` from the root): React compositions under `video/src/` (`scenes/`, `film.ts`, `film.json`, `shots.json`, `voice.json`, `voice.cues.json`, `theme.ts`), the thirty stills of the tour under `video/public/shots/`, the voice and the optional music bed under `video/public/audio/`, the voice engines in `video/scripts/tts.mjs`, the narration generator in `video/scripts/voice.mjs`, the one-line generator in `video/scripts/say.mjs` and the capture of the stills in `video/scripts/capture.mjs`. `make video` asks where to save the rendered MP4 (default: the Desktop) and leaves no film inside the repository |

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
  make video-voice   # regenerate and re-measure the narration
  make video-say text="..." duration=4.5 id=fatura   # speak one line and fit it to the seconds
  make video-shots   # take the stills again, from the running mock
  ```
- **Check the film:**
  ```bash
  ffprobe -v error -show_entries format=duration -show_entries stream=codec_type \
    -of default=noprint_wrappers=1 ~/Desktop/ama4devs-asaas-mock.mp4
  ```
