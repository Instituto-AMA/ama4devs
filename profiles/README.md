# Profiles

A profile says which env keys an app needs to talk to the mocks (`mock.env`) or to the official
sandboxes (`sandbox.env`). `scripts/env-mode.sh <profile> mock|sandbox <target-env-file>` writes those
keys into the app's env file. Pick one with `make setup PROFILE=<name> TARGET_ENV=<file>`.

Each file is `KEY=VALUE` lines and `#` comments. Values may reference `${ASAAS_PORT}`, `${GENERATOR_PORT}`, `${SMS_PORT}`,
`${WHATSAPP_PORT}` and `${ASAAS_API_KEY}` (from `.env`) and, in `sandbox.env`,
`${ASAAS_SANDBOX_API_KEY}` (from `.env.sandbox`). Nothing else is expanded.

## Control keys (`sandbox.env` only, never written to the target)

- `SANDBOX_NEEDS_KEY=1`: the app keeps the Asaas key in env, so `setup-sandbox` asks for the sandbox
  key, verifies it and exposes it as `${ASAAS_SANDBOX_API_KEY}`.
- `SANDBOX_WEBHOOK_PATH=/path`: `setup-sandbox` registers `<public url>/path` as this developer's
  webhook in the Asaas sandbox.

## Add a profile for an app

1. Create `profiles/<app>/mock.env` and `profiles/<app>/sandbox.env`, copying `generic` as a start.
2. Rename the keys to the ones the app reads.
3. Drop the control keys the app does not need (an app that stores its key elsewhere omits
   `SANDBOX_NEEDS_KEY`).

Ama-Hub is not a profile: it runs these mocks from its own `make up-all` and switches with its own
`make setup` / `make setup-sandbox`.
