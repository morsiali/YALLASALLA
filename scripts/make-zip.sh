#!/usr/bin/env bash
# Creates a clean source ZIP of the committed repository (no node_modules, no .env, no data). Usage: bash scripts/make-zip.sh [out.zip]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-yalasala-uae-source.zip}"
git archive --format=zip --prefix=yalasala-uae/ -o "$OUT" HEAD
echo "created $OUT ($(du -h "$OUT" | cut -f1)) from commit $(git rev-parse --short HEAD)"
