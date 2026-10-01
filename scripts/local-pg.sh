#!/usr/bin/env bash
# Starts/stops a throwaway PostgreSQL 16 cluster WITHOUT Docker (uses locally installed binaries).
# Usage: bash scripts/local-pg.sh start|stop|status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="${PGDATA_DIR:-$ROOT/.pgdata}"
PORT="${PGPORT_LOCAL:-54329}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -z "$BIN" ] && BIN="$(dirname "$(command -v pg_ctl)")"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "run as non-root or create a postgres user"; exit 1; }
  RUN_AS="su postgres -c"
  mkdir -p "$PGDATA"; chown postgres "$PGDATA"
fi
run() { if [ -n "$RUN_AS" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      run "$BIN/initdb -D '$PGDATA' -U postgres --auth=trust -E UTF8 >/dev/null"
    fi
    run "$BIN/pg_ctl -D '$PGDATA' -o '-p $PORT -k /tmp' -l '$PGDATA/server.log' -w start" || true
    run "psql -h /tmp -p $PORT -U postgres -tc \"select 1 from pg_roles where rolname='yalasala_owner'\" | grep -q 1 || psql -h /tmp -p $PORT -U postgres -c \"create role yalasala_owner login superuser password 'owner_dev_pw'\""
    run "psql -h /tmp -p $PORT -U postgres -tc \"select 1 from pg_database where datname='yalasala'\" | grep -q 1 || psql -h /tmp -p $PORT -U postgres -c 'create database yalasala owner yalasala_owner'"
    echo "Postgres ready on localhost:$PORT (db yalasala)";;
  stop) run "$BIN/pg_ctl -D '$PGDATA' -m fast stop";;
  status) run "$BIN/pg_ctl -D '$PGDATA' status";;
esac
