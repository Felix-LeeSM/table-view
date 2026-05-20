#!/usr/bin/env bash
# Wait for the fixture-stack postgres + mysql + mongo containers
# (table_view_postgres, table_view_mysql, table_view_mongo) to become
# healthy. Targets the canonical docker-compose.yml at the repo root.
#
# Sprint 250 — added MySQL branch alongside PG/Mongo for Phase 17 seeding.
set -euo pipefail

TIMEOUT="${WAIT_TIMEOUT:-60}"
PG_USER="${PGUSER:-testuser}"
PG_DB="${PGDATABASE:-table_view_test}"
MYSQL_ROOT_PW="${MYSQL_ROOT_PASSWORD:-testroot}"

if ! command -v docker &>/dev/null; then
    echo "ERROR: docker not in PATH" >&2
    exit 1
fi

start=$(date +%s)

wait_pg() {
    echo "  postgres (table_view_postgres)..."
    until docker exec table_view_postgres pg_isready -U "$PG_USER" -d "$PG_DB" &>/dev/null; do
        if (( $(date +%s) - start >= TIMEOUT )); then
            echo "  TIMEOUT after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  postgres ready."
}

wait_mysql() {
    echo "  mysql (table_view_mysql)..."
    # `mysqladmin ping` returns 0 once the server accepts connections; the
    # root credential is required because the testuser account is scoped to
    # `table_view_test` and rejected before auth completes against the
    # server-level catalog. Stderr is silenced so the "Using a password on
    # the command line is insecure" warning doesn't drown the polling loop.
    until docker exec table_view_mysql \
        mysqladmin ping -h localhost -u root -p"$MYSQL_ROOT_PW" --silent &>/dev/null; do
        if (( $(date +%s) - start >= TIMEOUT )); then
            echo "  TIMEOUT after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  mysql ready."
}

wait_mongo() {
    echo "  mongo (table_view_mongo)..."
    until docker exec table_view_mongo mongosh --quiet --eval "db.adminCommand('ping').ok" &>/dev/null; do
        if (( $(date +%s) - start >= TIMEOUT )); then
            echo "  TIMEOUT after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  mongo ready."
}

echo "Waiting up to ${TIMEOUT}s for fixture databases..."

rc=0
checked=0

if docker ps --format '{{.Names}}' | grep -q '^table_view_postgres$'; then
    wait_pg || rc=1
    checked=$((checked + 1))
else
    echo "  SKIP: table_view_postgres not running"
fi

if docker ps --format '{{.Names}}' | grep -q '^table_view_mysql$'; then
    wait_mysql || rc=1
    checked=$((checked + 1))
else
    echo "  SKIP: table_view_mysql not running"
fi

if docker ps --format '{{.Names}}' | grep -q '^table_view_mongo$'; then
    wait_mongo || rc=1
    checked=$((checked + 1))
else
    echo "  SKIP: table_view_mongo not running"
fi

if [ "$checked" -eq 0 ]; then
    echo "ERROR: no fixture containers running. Start with 'pnpm db:up' or 'docker compose up -d postgres mysql mongo'." >&2
    exit 1
fi

[ "$rc" -eq 0 ] && echo "All fixture databases ready." || echo "ERROR: one or more failed to ready." >&2
exit "$rc"
