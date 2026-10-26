#!/usr/bin/env bash
# Usage: check-tools.sh mock|sandbox
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mode="${1:-}"
case "$mode" in mock | sandbox) ;; *) die "usage: check-tools.sh mock|sandbox" ;; esac

missing=()

check() { # check <label> <ok: 0|1> <hint>
  if [ "$2" -eq 0 ]; then
    log "  ✓ $1"
  else
    log "  ✗ $1"
    missing+=("$1: $3")
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

log "Checking tools ($mode)"

if have docker; then
  check "docker CLI" 0 ""
  if docker compose version 2>/dev/null | grep -Eq 'v?2\.|v?[3-9]\.'; then
    check "docker compose v2" 0 ""
  else
    check "docker compose v2" 1 "install the compose plugin (brew install docker-compose)"
  fi
  if docker info >/dev/null 2>&1; then
    check "docker daemon reachable" 0 ""
  else
    check "docker daemon reachable" 1 "start Docker Desktop or run 'colima start'"
  fi
else
  check "docker CLI" 1 "brew install --cask docker (or brew install docker colima)"
  check "docker compose v2" 1 "comes with Docker Desktop (or brew install docker-compose)"
  check "docker daemon reachable" 1 "start Docker Desktop or run 'colima start'"
fi

if have curl; then check "curl" 0 ""; else check "curl" 1 "brew install curl"; fi

if [ "$mode" = sandbox ]; then
  if have jq; then check "jq" 0 ""; else check "jq" 1 "brew install jq"; fi
  if have openssl; then check "openssl" 0 ""; else check "openssl" 1 "brew install openssl"; fi

  profile="${PROFILE:-generic}"
  profile_file="$ROOT_DIR/profiles/$profile/sandbox.env"
  if [ -f "$profile_file" ] && [ -n "$(env_get "$profile_file" SANDBOX_WEBHOOK_PATH)" ]; then
    if [ -n "${SANDBOX_WEBHOOK_URL:-}" ] || [ -n "$(env_get "$ROOT_DIR/.env.sandbox" SANDBOX_WEBHOOK_URL)" ]; then
      check "public tunnel (SANDBOX_WEBHOOK_URL set)" 0 ""
    elif have cloudflared || have ngrok || have zrok; then
      check "public tunnel (cloudflared/ngrok/zrok)" 0 ""
    else
      check "public tunnel (cloudflared/ngrok/zrok)" 1 "brew install cloudflared (or set SANDBOX_WEBHOOK_URL to a public https URL)"
    fi
  fi
fi

if [ "${#missing[@]}" -gt 0 ]; then
  {
    printf '\nMissing:\n'
    printf '  - %s\n' "${missing[@]}"
  } >&2
  exit 1
fi
