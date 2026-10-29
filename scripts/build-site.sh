#!/usr/bin/env bash
# Assembles the GitHub Pages site into _site/: the pages in site/, the screenshots each
# mock keeps in mocks/<mock>/docs/img (one copy, the one the READMEs show), the generator's
# app (it runs fully in the browser) and llms.txt.
# usage: scripts/build-site.sh [out-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/_site}"

rm -rf "$OUT"
mkdir -p "$OUT/img"
cp -R "$ROOT/site/." "$OUT/"
for mock in whatsapp asaas; do
  mkdir -p "$OUT/img/$mock"
  cp -R "$ROOT/mocks/$mock/docs/img/." "$OUT/img/$mock/"
done
# The generator's UI runs fully in the browser: publish it with its core modules at generator/app/.
mkdir -p "$OUT/generator/app/core"
cp -R "$ROOT/mocks/generator/public/." "$OUT/generator/app/"
cp "$ROOT"/mocks/generator/src/core/*.js "$OUT/generator/app/core/"
cp "$ROOT/mocks/asaas/docs/icon.svg" "$OUT/img/asaas/icon.svg"
cp "$ROOT/llms.txt" "$OUT/llms.txt"
# Served as is: no Jekyll pass over the files.
touch "$OUT/.nojekyll"

echo "site built in $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
