#!/usr/bin/env bash
# Asks for a speech key with the input hidden and saves it in .env.sandbox.
#
# The key never goes through argv, never through the chat and never through
# the shell history: it is read with `read -s` and written straight to the
# file. The file is gitignored and keeps its mode 600.
#
# The engines of the film, in the order they are tried:
#
#   1. ElevenLabs (the primary one)  -> ELEVENLABS_API_KEY
#   2. OpenRouter (the secondary one) -> OPENROUTER_API_KEY
#   3. Microsoft Edge, no key needed
#
# Usage:
#   scripts/voice-key.sh                # asks which engine to set up
#   scripts/voice-key.sh elevenlabs     # sets up the ElevenLabs key
#   scripts/voice-key.sh openrouter     # sets up the OpenRouter key
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$ROOT_DIR"

TARGET_ENV="$ROOT_DIR/.env.sandbox"

usage() {
  cat <<'EOF'
usage: scripts/voice-key.sh [elevenlabs|openrouter]

  elevenlabs   the primary engine: the official ElevenLabs API key
  openrouter   the secondary engine: the OpenRouter key
  (no argument) asks which one to set up

The key is asked with the input hidden and saved in .env.sandbox (gitignored).
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

umask 077
[ -e "$TARGET_ENV" ] || : >"$TARGET_ENV"
chmod 600 "$TARGET_ENV"

# ask_key <label> <hint>: reads a key with the input hidden and puts it in the
# variable REPLY. The key is never echoed, never in argv and never in history.
ask_key() {
  local label="$1" hint="$2"
  printf '%s\n' "$hint"
  printf '%s (input hidden): ' "$label"
  read -rs REPLY
  printf '\n'
  [ -n "$REPLY" ] || die "the key is empty"
}

# verify_key <url> <header>: asks the provider if the key is good.
#
# The key travels in a curl config file (mode 600) and never in the command
# line: an argument is visible in `ps` to every process of the machine.
verify_key() {
  local url="$1" header="$2" conf
  require_cmd curl "Install curl to verify the key."
  conf="$(mktemp "${TMPDIR:-/tmp}/ama4devs-curl.XXXXXX")" || die "cannot create a temp file"
  chmod 600 "$conf"
  printf 'header = "%s"\n' "$header" >"$conf"
  if ! curl -fsS --max-time 30 -K "$conf" "$url" >/dev/null; then
    rm -f "$conf"
    return 1
  fi
  rm -f "$conf"
  return 0
}

# setup_elevenlabs: the browser flow of the official CLI. The CLI asks for the
# approval in the browser and writes the key itself, in the env file.
setup_elevenlabs() {
  require_cmd npx "Install Node.js, or run 'npx -y @elevenlabs/cli@latest onboard connect' by hand."

  local cli_env="$ROOT_DIR/.env.local"
  if [ -n "$(env_get "$cli_env" ELEVENLABS_API_KEY)" ]; then
    log "ElevenLabs key already in .env.local"
  else
    log "The CLI prints the approval link: open it in the browser and click Authorize."
    log "The CLI stores the key in .env.local (gitignored); it is never printed."
    if ! npx -y @elevenlabs/cli@latest onboard connect --env-path "$cli_env" --no-browser; then
      die "the ElevenLabs approval did not finish"
    fi
  fi

  # The CLI wrote the key in .env.local; the film reads .env.sandbox.
  local key
  key="$(env_get "$cli_env" ELEVENLABS_API_KEY)"
  [ -n "$key" ] || die "the ElevenLabs CLI did not store a key in .env.local"

  # The key is verified against the provider before it is saved.
  if ! verify_key "https://api.elevenlabs.io/v1/models" "xi-api-key: $key"; then
    die "ElevenLabs rejected the key (GET /v1/models did not return 200)"
  fi

  env_upsert "$TARGET_ENV" ELEVENLABS_API_KEY "$key"
  chmod 600 "$TARGET_ENV"
  unset key
  log "ElevenLabs key verified and saved to .env.sandbox"
}

# setup_openrouter: the key is pasted in the terminal, hidden, and verified.
setup_openrouter() {
  local key
  key="${OPENROUTER_API_KEY:-}"
  if [ -z "$key" ]; then
    ask_key "OpenRouter API key" \
      "Create one at https://openrouter.ai/keys (it starts with sk-or-)."
    key="$REPLY"
  fi
  case "$key" in sk-or-*) ;; *) die "that is not an OpenRouter key (it must start with sk-or-)" ;; esac
  case "$key" in *[$'\n\r"\\']*) die "the key has characters that are not valid in a key" ;; esac

  if ! verify_key "https://openrouter.ai/api/v1/auth/key" "Authorization: Bearer $key"; then
    die "OpenRouter rejected the key (GET /api/v1/auth/key did not return 200)"
  fi

  env_upsert "$TARGET_ENV" OPENROUTER_API_KEY "$key"
  chmod 600 "$TARGET_ENV"
  unset key
  log "OpenRouter key verified and saved to .env.sandbox"
}

engine="${1:-}"
if [ -z "$engine" ]; then
  cat <<'EOF'
Which engine do you want to set up?

  1. ElevenLabs (the primary one, the official provider)
  2. OpenRouter (the secondary one)
EOF
  printf 'Choice [1]: '
  read -r choice
  case "$choice" in
    1 | elevenlabs) engine="elevenlabs" ;;
    2 | openrouter) engine="openrouter" ;;
    *) die "unknown choice" ;;
  esac
fi

case "$engine" in
  elevenlabs) setup_elevenlabs ;;
  openrouter) setup_openrouter ;;
  *)
    usage >&2
    die "unknown engine '$engine'"
    ;;
esac

log ""
log "The voice of the film now reads .env.sandbox:"
if [ -n "$(env_get "$TARGET_ENV" ELEVENLABS_API_KEY)" ]; then
  log "  1. ElevenLabs (ELEVENLABS_API_KEY)"
fi
if [ -n "$(env_get "$TARGET_ENV" OPENROUTER_API_KEY)" ]; then
  log "  2. OpenRouter (OPENROUTER_API_KEY)"
fi
log "  3. Microsoft Edge (no key)"
log ""
log "Now run: make video-voice"
