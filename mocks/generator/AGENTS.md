# AGENTS.md — Generator Mock

This mock is maintained internally as part of `Instituto-AMA/ama4devs`. It runs locally in Docker alongside other provider mocks for development and testing.

## What it is

A **fake Brazilian data generator**: a server with no runtime dependency that produces valid documents (CPF, CNPJ, CNH, PIS, RG), realistic people and companies, addresses that match Brazilian CEP ranges, cards, bank accounts, Pix keys and charges — all of it seeded, so the same seed always returns the same data.

It also does two jobs of a mock:

- **Populates the Asaas mock** through the Asaas API, in one call (`POST /_mock/asaas/populate`).
- **Simulates the Direct Data credit check** (the API v3 credit routes of the provider) at the provider's own paths, with a table of test CPFs that force one outcome each.

## Layout

| Path | What it is |
|---|---|
| `src/core/*.js` | The core: browser-native ES modules (`// @ts-check`, JSDoc, no Bun or Node API) shared by the server and the browser |
| `src/core/index.js` | Re-exports every module of the core |
| `src/app.ts` | The application: the routes, the local guard, the static files |
| `src/server.ts` | The HTTP server (`Bun.serve`) |
| `src/directd.ts` | The Direct Data server: the credit routes, the webhook routes, the account routes, the async queries, the log, the counters and the control routes |
| `src/core/credit.js` | The Direct Data credit core: the test CPFs, the outcomes, the profiles and the documented envelope |
| `src/asaas.ts`, `src/discovery.ts` | The Asaas population and the discovery of the Asaas mock |
| `src/config.ts` | The configuration, read from the environment |
| `public/` | The UI: plain HTML, CSS and JavaScript, no build step |
| `spec/directd/` | The provider contract of the Direct Data simulation |
| `tests/` | The tests of the core, of the server and of the Asaas population |

## The core rules

- `src/core/*.js` runs in the browser as it is: no Bun API, no Node API, no import map, no build step. The Pages site serves the very same files the server runs.
- Every value is deterministic: the caller passes the clock and the seed, and the rng is seeded with `createRng(seed)`.
- **`Math.random()` never appears.** The only randomness is `createRng` in `src/core/rng.js`; the tests of the core guard it.
- The UI in `public/` is plain HTML/CSS/JS and no build step: what is in the repository is what the browser runs.
- The tests never sleep: the clock, the ids and the wait are injected through `Deps` in `src/app.ts`.

## Direct Data

The Direct Data simulation answers the provider's credit routes (`/api/Score`, `/api/BoaVistaAcertaMaisPositivoPF`, `/api/Historico/ObterRetornoConsultaAsync`), its webhook routes (`/api/Webhook/CreateUrlCallBack`, `/api/Webhook/ConfirmUrlCallBack`), its account routes (`/api/Marketplace/GetBalance`, `/api/Billing/GetConsumptionApiV3`) and the Hub's credit check points at it.

### The source of truth is the provider's documentation

`spec/directd/` holds the provider's own documentation: the catalog examples, the details of the public MCP and the integration guide. **Refresh it from the catalog pages and the public MCP before changing a field** — never from memory, never from a guess.

### A subtly incorrect simulator is worse than none

A wrong field gives the Hub false confidence, and the Hub ships it. So:

- **Never invent a field.** A field that is not in the documentation does not go into the answer.
- **Keep the documented key order.** The order of `metaDados` and of every `retorno` is part of the contract.
- **A choice the provider does not document is listed in `spec/directd/README.md`**, under "What is not documented", with the reason. Nothing else may be the simulator's own invention.

### It never leaves the machine

- **No `fetch` to the outside, and no provider URL in `credit.js` or `directd.ts`.** A test guards it. The simulation never proxies, forwards or calls any host.
- **The only post the mock makes is to a local receiver.** A registered callback URL is posted to only when its host is a loopback (`127.0.0.1`, `::1`, `localhost`) or a single-label compose host; any other URL is refused with `400` and nothing is posted, and a redirect from the receiver is not followed. The `fetch` that carries the post lives in the wiring of `src/app.ts`, never in `credit.js`.
- **The only token is the public one**, `00000000-0000-4000-8000-00000000d1d1`. No real token lives in this repository, and the log keeps the state of the token (`valid`, `invalid`, `missing`), never its value.
- `Callback=habilitar` records the flag and the mock posts the callback of a settled consultation to the confirmed URL on its own schedule, and to nowhere else. Only `ConfirmUrlCallBack` confirms a registration: the code the receiver got comes back through it. `GERARCOMPROVANTE=Habilitar` only records the flag: no PDF is produced.

### The tests inject the outside world

The clock, the ids, the sleep, the schedule and the post come from `Deps` (`src/app.ts`): the server passes them, the tests replace them with fakes. **The tests never sleep**, and neither does the core.

### Changing a behavior changes the docs

A change of behavior rewrites, in the same change:

- the `## Direct Data Credit Check` section of [`README.md`](README.md),
- the pages of the site, in English (`site/generator/`) and in Portuguese (`site/portuguese/generator/`), with the same section ids.

The panels and the quick starts print commands that must run as written against a fresh container.
