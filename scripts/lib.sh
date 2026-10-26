#!/usr/bin/env bash
# Shared helpers. Source it; do not run it.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '%s\n' "$*"; }
warn() { printf 'warn: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# require_cmd <name> <hint>
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' not found. $2"
}

# env_get <file> <key>: prints the value of the last KEY=VALUE line, nothing if absent. One pair of
# surrounding quotes is dropped, as compose reads them (a single-quoted value keeps its `$`).
env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  awk -v k="$key" '
    index($0, k "=") == 1 { v = substr($0, length(k) + 2) }
    END {
      if (v ~ /^\x27.*\x27$/ || v ~ /^".*"$/) v = substr(v, 2, length(v) - 2)
      if (v != "") print v
    }
  ' "$file"
}

# env_upsert <file> <key> <value>
# Replaces the first `KEY=...` line (or a commented `# KEY=`) or appends one. Atomic (temp file in the
# same dir + mv), keeps every other line and the file mode. A file it creates gets mode 600; an
# existing file keeps its mode. The value travels in the environment of awk, never in argv, and is
# never echoed.
env_upsert() {
  local file="$1" key="$2" value="$3" tmp mode
  [[ "$key" =~ ^[A-Z0-9_]+$ ]] || die "refusing env key '$key': must match [A-Z0-9_]+"
  [ -e "$file" ] || (umask 077; : >"$file")
  tmp="$(mktemp "$(dirname "$file")/.env-upsert.XXXXXX")" || die "cannot create a temp file next to $file"
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null || echo 600)"
  if ! ENV_UPSERT_VALUE="$value" awk -v k="$key" '
    BEGIN { v = ENVIRON["ENV_UPSERT_VALUE"]; done = 0 }
    {
      line = $0
      probe = line
      sub(/^#[ \t]*/, "", probe)
      if (!done && index(probe, k "=") == 1) {
        print k "=" v
        done = 1
      } else {
        print line
      }
    }
    END { if (!done) print k "=" v }
  ' "$file" >"$tmp"; then
    rm -f "$tmp"
    die "failed to update $file"
  fi
  chmod "$mode" "$tmp"
  mv "$tmp" "$file"
}

# is_secret_key <key>: true for names that must never be printed.
is_secret_key() {
  case "$1" in
    *_KEY | *_TOKEN | *_SECRET) return 0 ;;
    *) return 1 ;;
  esac
}
