#!/usr/bin/env bash
# Prints the mocks (space separated) whose directory changed between two commits, so a push
# publishes only the images it touched.
#
#   scripts/changed-mocks.sh <before> <after>
#
# Every mock is printed when <before> is unknown (first push of a branch, a force push that
# dropped it) or when the publish machinery itself changed (the workflow, the publish script),
# because then every image would be built differently.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

before="${1:-}"
after="${2:-HEAD}"

all_mocks() {
  local dockerfile names=()
  for dockerfile in "${ROOT_DIR}"/mocks/*/Dockerfile; do
    names+=("$(basename "$(dirname "$dockerfile")")")
  done
  printf '%s\n' "${names[*]}"
}

if [[ -z "$before" || "$before" =~ ^0+$ ]] || ! git -C "$ROOT_DIR" cat-file -e "${before}^{commit}" 2>/dev/null; then
  all_mocks
  exit 0
fi

changed="$(git -C "$ROOT_DIR" diff --name-only "$before" "$after")"

if grep -qE '^(\.github/workflows/publish-mocks\.yml|scripts/publish\.sh)$' <<<"$changed"; then
  all_mocks
  exit 0
fi

picked=()
for mock in $(all_mocks); do
  if grep -q "^mocks/${mock}/" <<<"$changed"; then
    picked+=("$mock")
  fi
done
printf '%s\n' "${picked[*]:-}"
