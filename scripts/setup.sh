#!/usr/bin/env bash
# Mock flow: build and start the mocks, then point the target env file at them. No credential needed.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$ROOT_DIR"

MOCKS="${MOCKS:-asaas whatsapp generator sms}"
PROFILE="${PROFILE:-generic}"
TARGET_ENV="${TARGET_ENV:-}"
export PROFILE

profiles=()
for m in $MOCKS; do profiles+=(--profile "$m"); done
compose=(docker compose --env-file .env -f docker-compose.yml)

"$ROOT_DIR/scripts/check-tools.sh" mock

if [ ! -f .env ]; then
  cp .env.example .env
  log "Created .env from .env.example"
fi

"${compose[@]}" "${profiles[@]}" build
"${compose[@]}" "${profiles[@]}" up -d --wait --wait-timeout 120

"$ROOT_DIR/scripts/env-mode.sh" "$PROFILE" mock "$TARGET_ENV"

asaas_port="$(env_get .env ASAAS_PORT)"
whatsapp_port="$(env_get .env WHATSAPP_PORT)"
generator_port="$(env_get .env GENERATOR_PORT)"
sms_port="$(env_get .env SMS_PORT)"
log ""
log "Mocks are up:"
for m in $MOCKS; do
  case "$m" in
    asaas) log "  asaas     http://localhost:${asaas_port:-45445}" ;;
    whatsapp) log "  whatsapp  http://localhost:${whatsapp_port:-3010}" ;;
    generator) log "  generator http://localhost:${generator_port:-45450}" ;;
    sms) log "  sms       http://localhost:${sms_port:-8899}" ;;
  esac
done
fake_key='$aact_hmlg_local_master'
log "Asaas fake master key: ••••${fake_key: -4}"
