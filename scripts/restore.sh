#!/usr/bin/env bash
# Restore a backup into an EMPTY database (creates roles' grants via the dump). Usage: bash scripts/restore.sh backups/x.dump postgres://owner@host/dbname
# Roles yalasala_app / yalasala_service must exist first: run `npm run db:migrate` against the new database once, or create them (see docs/03-OPERATIONS.md).
set -euo pipefail
DUMP="${1:?backup file}"; URL="${2:?target database url}"
pg_restore --no-owner --exit-on-error --dbname="$URL" "$DUMP"
echo "restored $DUMP into target"
