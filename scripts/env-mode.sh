#!/usr/bin/env bash
# Usage: env-mode.sh <profile> mock|sandbox [target-env-file]
# Writes the profile's keys into the target file, or prints `export` lines when no target is given.
# A secret without a target is printed as a comment, never as a value.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

profile="${1:-}"
mode="${2:-}"
target="${3:-}"
[ -n "$profile" ] && [ -n "$mode" ] || die "usage: env-mode.sh <profile> mock|sandbox [target-env-file]"
case "$mode" in mock | sandbox) ;; *) die "mode must be mock or sandbox, got '$mode'" ;; esac

profile_file="$ROOT_DIR/profiles/$profile/$mode.env"
[ -f "$profile_file" ] || die "profile file not found: profiles/$profile/$mode.env"

if [ -n "$target" ]; then
  [ -d "$(dirname "$target")" ] || die "directory of target env file does not exist: $(dirname "$target")"
fi

# Only these placeholders are expanded, from .env (with defaults) and .env.sandbox.
asaas_port="$(env_get "$ROOT_DIR/.env" ASAAS_PORT)"
whatsapp_port="$(env_get "$ROOT_DIR/.env" WHATSAPP_PORT)"
generator_port="$(env_get "$ROOT_DIR/.env" GENERATOR_PORT)"
sms_port="$(env_get "$ROOT_DIR/.env" SMS_PORT)"
asaas_api_key="$(env_get "$ROOT_DIR/.env" ASAAS_API_KEY)"
asaas_port="${asaas_port:-45445}"
whatsapp_port="${whatsapp_port:-3010}"
generator_port="${generator_port:-45450}"
sms_port="${sms_port:-3020}"
asaas_api_key="${asaas_api_key:-\$aact_hmlg_local_master}"
sandbox_key="${ASAAS_SANDBOX_API_KEY:-$(env_get "$ROOT_DIR/.env.sandbox" ASAAS_SANDBOX_API_KEY)}"

expand() {
  local v="$1"
  v="${v//'${ASAAS_PORT}'/$asaas_port}"
  v="${v//'${WHATSAPP_PORT}'/$whatsapp_port}"
  v="${v//'${GENERATOR_PORT}'/$generator_port}"
  v="${v//'${SMS_PORT}'/$sms_port}"
  v="${v//'${ASAAS_API_KEY}'/$asaas_api_key}"
  v="${v//'${ASAAS_SANDBOX_API_KEY}'/$sandbox_key}"
  printf '%s' "$v"
}

# First pass: resolve and validate every key, so a missing value never leaves the target half switched.
keys=()
values=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in '' | '#'*) continue ;; esac
  key="${line%%=*}"
  [ "$key" != "$line" ] || die "invalid line in $profile_file (no '='): $key"
  # Control keys steer the setup scripts and never reach the target.
  case "$key" in SANDBOX_NEEDS_KEY | SANDBOX_WEBHOOK_PATH) continue ;; esac
  value="$(expand "${line#*=}")"
  if [ "$value" = "" ] && [ "${line#*=}" = '${ASAAS_SANDBOX_API_KEY}' ]; then
    die "$key needs the sandbox key; run setup-sandbox first (nothing was written)"
  fi
  keys+=("$key")
  values+=("$value")
done <"$profile_file"

# Second pass: write or print. Mock values are fake, so only the sandbox mode masks secrets.
for i in "${!keys[@]}"; do
  key="${keys[$i]}"
  value="${values[$i]}"
  masked=0
  if [ "$mode" = sandbox ] && is_secret_key "$key"; then masked=1; fi
  if [ -n "$target" ]; then
    env_upsert "$target" "$key" "$value"
    if [ "$masked" = 1 ]; then log "$key → ••••"; else log "$key → $value"; fi
    continue
  fi
  if [ "$masked" = 1 ]; then
    printf '# %s is set from .env.sandbox (hidden; pass a target file to write it)\n' "$key"
    continue
  fi
  printf 'export %s=%q\n' "$key" "$value"
done
