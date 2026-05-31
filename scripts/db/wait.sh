#!/usr/bin/env bash
# Wait for running fixture-stack containers to become healthy. Targets the
# canonical docker-compose.yml at the repo root.
#
# `pnpm db:up` starts the full compose stack. This script also remains useful
# after partial `docker compose up -d <service>` runs: non-running containers are
# skipped, running containers must pass their compose healthcheck.
set -euo pipefail

TIMEOUT="${WAIT_TIMEOUT:-300}"

if ! command -v docker &>/dev/null; then
    echo "ERROR: docker not in PATH" >&2
    exit 1
fi

start=$(date +%s)

wait_container() {
    local container="$1"
    local label="$2"
    local status

    echo "  ${label} (${container})..."
    until status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null)" && { [ "$status" = "healthy" ] || [ "$status" = "running" ]; }; do
        if (( $(date +%s) - start >= TIMEOUT )); then
            echo "  TIMEOUT after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 2
    done
    echo "  ${label} ready."
}

check_container() {
    local container="$1"
    local label="$2"

    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        wait_container "$container" "$label" || rc=1
        checked=$((checked + 1))
    else
        echo "  SKIP: ${container} not running"
    fi
}

echo "Waiting up to ${TIMEOUT}s for fixture databases..."

rc=0
checked=0

check_container "table_view_postgres" "postgres"
check_container "table_view_mysql" "mysql"
check_container "table_view_mongo" "mongo"
check_container "table_view_mariadb" "mariadb"
check_container "table_view_mssql" "mssql"
check_container "table_view_oracle" "oracle"
check_container "table_view_redis" "redis"

if [ "$checked" -eq 0 ]; then
    echo "ERROR: no fixture containers running. Start with 'pnpm db:up' or 'docker compose up -d'." >&2
    exit 1
fi

[ "$rc" -eq 0 ] && echo "All fixture databases ready." || echo "ERROR: one or more failed to ready." >&2
exit "$rc"
