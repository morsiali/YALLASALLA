#!/usr/bin/env bash
# PostgreSQL backup (custom format, compressed). Usage: DATABASE_URL=postgres://... bash scripts/backup.sh [out.dump]
set -euo pipefail
URL="${DATABASE_URL:-postgres://yalasala_owner:owner_dev_pw@localhost:54329/yalasala}"
OUT="${1:-backups/yalasala-$(date +%Y%m%d-%H%M%S).dump}"
mkdir -p "$(dirname "$OUT")"
pg_dump --format=custom --no-owner --dbname="$URL" --file="$OUT"
echo "backup written to $OUT ($(du -h "$OUT" | cut -f1))"
