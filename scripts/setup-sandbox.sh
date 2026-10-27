#!/usr/bin/env bash
# Sandbox flow: point the target env file at the official Asaas sandbox and Meta's Graph API,
# and register this developer's webhook in the Asaas sandbox. The key never goes through argv or output.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$ROOT_DIR"

PROFILE="${PROFILE:-generic}"
TARGET_ENV="${TARGET_ENV:-}"
export PROFILE

SANDBOX_API="https://api-sandbox.asaas.com/v3"
SANDBOX_ENV="$ROOT_DIR/.env.sandbox"
PROFILE_FILE="$ROOT_DIR/profiles/$PROFILE/sandbox.env"
# Every PAYMENT_* event of the webhook create schema (mocks/asaas/spec/openapi.json).
EVENTS="PAYMENT_AUTHORIZED
PAYMENT_AWAITING_RISK_ANALYSIS
PAYMENT_APPROVED_BY_RISK_ANALYSIS
PAYMENT_REPROVED_BY_RISK_ANALYSIS
PAYMENT_CREATED
PAYMENT_UPDATED
PAYMENT_CONFIRMED
PAYMENT_RECEIVED
PAYMENT_ANTICIPATED
PAYMENT_OVERDUE
PAYMENT_DELETED
PAYMENT_RESTORED
PAYMENT_REFUNDED
PAYMENT_REFUND_IN_PROGRESS
PAYMENT_REFUND_DENIED
PAYMENT_RECEIVED_IN_CASH_UNDONE
PAYMENT_CHARGEBACK_REQUESTED
PAYMENT_CHARGEBACK_DISPUTE
PAYMENT_AWAITING_CHARGEBACK_REVERSAL
PAYMENT_DUNNING_RECEIVED
PAYMENT_DUNNING_REQUESTED
PAYMENT_BANK_SLIP_CANCELLED
PAYMENT_BANK_SLIP_VIEWED
PAYMENT_CHECKOUT_VIEWED
PAYMENT_CREDIT_CARD_CAPTURE_REFUSED
PAYMENT_PARTIALLY_REFUNDED
PAYMENT_SPLIT_CANCELLED
PAYMENT_SPLIT_DIVERGENCE_BLOCK
PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED"

[ -f "$PROFILE_FILE" ] || die "profile file not found: profiles/$PROFILE/sandbox.env"

umask 077
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tuh-sandbox.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

"$ROOT_DIR/scripts/check-tools.sh" sandbox

if [ ! -e "$SANDBOX_ENV" ]; then
  : >"$SANDBOX_ENV"
fi
chmod 600 "$SANDBOX_ENV"

needs_key="$(env_get "$PROFILE_FILE" SANDBOX_NEEDS_KEY)"
webhook_path="$(env_get "$PROFILE_FILE" SANDBOX_WEBHOOK_PATH)"

# api <METHOD> <path> [body-file]: calls the sandbox with the key read from a private curl config file.
# Prints the response body; returns non-zero on a non-2xx status.
api() {
  local method="$1" path="$2" body="${3:-}" out status
  out="$TMP_DIR/response.$$.$RANDOM"
  local args=(--silent --show-error --max-time 30 -K "$TMP_DIR/curl.conf" -X "$method"
    -H 'Content-Type: application/json' -o "$out" -w '%{http_code}')
  [ -z "$body" ] || args+=(--data-binary "@$body")
  status="$(curl "${args[@]}" "$SANDBOX_API$path")" || die "request to the Asaas sandbox failed ($method $path)"
  cat "$out"
  case "$status" in 2??) return 0 ;; *) return 1 ;; esac
}

# ngrok_public_url: the first https public URL of a running ngrok agent. Reads only the loopback API.
ngrok_public_url() {
  local tunnels
  tunnels="$(curl -fsS --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null)" || return 0
  printf '%s' "$tunnels" | jq -r '[.tunnels[]? | select(.public_url | startswith("https://"))][0].public_url // empty' 2>/dev/null || true
}

# --- Asaas sandbox key -------------------------------------------------------------------------
if [ "$needs_key" = 1 ]; then
  key="${ASAAS_SANDBOX_API_KEY:-$(env_get "$SANDBOX_ENV" ASAAS_SANDBOX_API_KEY)}"
  if [ -z "$key" ]; then
    [ -t 0 ] || die "ASAAS_SANDBOX_API_KEY not set and no terminal to ask for it. Put it in .env.sandbox"
    printf 'Asaas sandbox API key (input hidden): '
    read -rs key
    printf '\n'
  fi
  case "$key" in
    '$aact_hmlg_'*) ;;
    *) die "that is not an Asaas sandbox key (it must start with \$aact_hmlg_)" ;;
  esac
  case "$key" in *[$'\n\r"\\']*) die "the key has characters that are not valid in a key" ;; esac

  printf 'header = "access_token: %s"\n' "$key" >"$TMP_DIR/curl.conf"
  chmod 600 "$TMP_DIR/curl.conf"

  if ! api GET /myAccount/status >/dev/null; then
    die "the Asaas sandbox rejected the key (GET /myAccount/status did not return 200)"
  fi
  env_upsert "$SANDBOX_ENV" ASAAS_SANDBOX_API_KEY "$key"
  log "Sandbox key verified and saved to .env.sandbox"
  unset key
fi

# --- Webhook registration ----------------------------------------------------------------------
if [ -n "$webhook_path" ]; then
  [ "$needs_key" = 1 ] || die "profile '$PROFILE' sets SANDBOX_WEBHOOK_PATH without SANDBOX_NEEDS_KEY=1"

  base_url="${SANDBOX_WEBHOOK_URL:-$(env_get "$SANDBOX_ENV" SANDBOX_WEBHOOK_URL)}"
  if [ -z "$base_url" ]; then
    [ -t 0 ] || die "SANDBOX_WEBHOOK_URL not set and no terminal to ask for it"
    default_url="$(ngrok_public_url)"
    if [ -n "$default_url" ]; then
      printf 'Public https base URL of your app (e.g. from cloudflared/ngrok/zrok) [%s]: ' "$default_url"
    else
      printf 'Public https base URL of your app (e.g. from cloudflared/ngrok/zrok): '
    fi
    read -r base_url
    base_url="${base_url:-$default_url}"
  fi
  case "$base_url" in https://*) ;; *) die "the webhook base URL must start with https://" ;; esac
  base_url="${base_url%/}"
  env_upsert "$SANDBOX_ENV" SANDBOX_WEBHOOK_URL "$base_url"

  email="${SANDBOX_WEBHOOK_EMAIL:-$(git config user.email 2>/dev/null || true)}"
  if [ -z "$email" ]; then
    [ -t 0 ] || die "no email for the webhook: set git config user.email or SANDBOX_WEBHOOK_EMAIL"
    printf 'Email for webhook alerts: '
    read -r email
  fi

  name="ama4devs $(whoami)@$(hostname -s)"
  # The repository was called test-utils-hub: webhooks registered under that name are this
  # developer's too.
  legacy_name="test-utils-hub $(whoami)@$(hostname -s)"

  # Remove only this developer's old webhooks (exact name match).
  api GET '/webhooks?limit=100' >"$TMP_DIR/list.json" || die "could not list sandbox webhooks"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    api DELETE "/webhooks/$id" >/dev/null || warn "could not delete old webhook $id"
  done < <(jq -r --arg n "$name" --arg l "$legacy_name" '.data[]? | select(.name == $n or .name == $l) | .id' "$TMP_DIR/list.json")

  auth_token="$(openssl rand -hex 24)"
  events_json="$(printf '%s\n' $EVENTS | jq -R . | jq -sc .)"
  jq -n \
    --arg name "$name" \
    --arg url "$base_url$webhook_path" \
    --arg email "$email" \
    --arg token "$auth_token" \
    --argjson events "$events_json" \
    '{name: $name, url: $url, email: $email, enabled: true, interrupted: false, apiVersion: 3,
      sendType: "SEQUENTIALLY", authToken: $token, events: $events}' >"$TMP_DIR/webhook.json"

  api POST /webhooks "$TMP_DIR/webhook.json" >/dev/null || die "could not register the webhook in the Asaas sandbox"
  env_upsert "$SANDBOX_ENV" ASAAS_SANDBOX_WEBHOOK_TOKEN "$auth_token"
  unset auth_token
  log "Webhook '$name' registered → $base_url$webhook_path"
  log "Its auth token is saved as ASAAS_SANDBOX_WEBHOOK_TOKEN in .env.sandbox"
fi

"$ROOT_DIR/scripts/env-mode.sh" "$PROFILE" sandbox "$TARGET_ENV"
