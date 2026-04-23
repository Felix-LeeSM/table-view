#!/usr/bin/env bash
# Wait for all test database services defined in docker-compose.test.yml
# to become healthy before exiting.
#
# Usage:
#   ./scripts/wait-for-test-db.sh
#
# Exits 0 when all services are accepting connections.
# Exits 1 if a service does not become ready within the timeout.

set -euo pipefail

TIMEOUT="${WAIT_TIMEOUT:-60}"
COMPOSE_FILE="docker-compose.test.yml"

if ! command -v docker &>/dev/null; then
    echo "ERROR: docker is not installed or not in PATH" >&2
    exit 1
fi

# Verify the compose file exists
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: $COMPOSE_FILE not found in current directory" >&2
    exit 1
fi

echo "Waiting up to ${TIMEOUT}s for test databases to become healthy..."

start_time=$(date +%s)

wait_for_postgres() {
    local host="${PGHOST:-localhost}"
    local port="${PGPORT:-5432}"
    local user="${PGUSER:-testuser}"
    local db="${PGDATABASE:-table_view_test}"
    echo "  Checking PostgreSQL at ${host}:${port} ..."
    until docker exec table_view_test_postgres pg_isready -U "$user" -d "$db" &>/dev/null; do
        local now
        now=$(date +%s)
        if (( now - start_time >= TIMEOUT )); then
            echo "  TIMEOUT: PostgreSQL not ready after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  PostgreSQL is ready."
}

wait_for_mysql() {
    local host="${MYSQL_HOST:-localhost}"
    local port="${MYSQL_TCP_PORT:-3306}"
    echo "  Checking MySQL at ${host}:${port} ..."
    until docker exec table_view_test_mysql mysqladmin ping -h localhost --silent &>/dev/null; do
        local now
        now=$(date +%s)
        if (( now - start_time >= TIMEOUT )); then
            echo "  TIMEOUT: MySQL not ready after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  MySQL is ready."
}

wait_for_mongodb() {
    local host="${MONGO_HOST:-localhost}"
    local port="${MONGO_PORT:-27017}"
    echo "  Checking MongoDB at ${host}:${port} ..."
    until docker exec table_view_test_mongodb mongosh --quiet --eval "db.adminCommand('ping').ok" &>/dev/null; do
        local now
        now=$(date +%s)
        if (( now - start_time >= TIMEOUT )); then
            echo "  TIMEOUT: MongoDB not ready after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  MongoDB is ready."
}

wait_for_elasticsearch() {
    local host="${ES_HOST:-localhost}"
    local port="${ES_PORT:-9200}"
    echo "  Checking Elasticsearch at ${host}:${port} ..."
    until docker exec table_view_test_elasticsearch curl -sf http://localhost:9200/_cluster/health &>/dev/null; do
        local now
        now=$(date +%s)
        if (( now - start_time >= TIMEOUT )); then
            echo "  TIMEOUT: Elasticsearch not ready after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  Elasticsearch is ready."
}

wait_for_redis() {
    local host="${REDIS_HOST:-localhost}"
    local port="${REDIS_PORT:-6379}"
    echo "  Checking Redis at ${host}:${port} ..."
    until docker exec table_view_test_redis redis-cli ping &>/dev/null; do
        local now
        now=$(date +%s)
        if (( now - start_time >= TIMEOUT )); then
            echo "  TIMEOUT: Redis not ready after ${TIMEOUT}s" >&2
            return 1
        fi
        sleep 1
    done
    echo "  Redis is ready."
}

# Track overall success
overall_rc=0
checked_count=0

# Wait for PostgreSQL
if docker ps --format '{{.Names}}' | grep -q '^table_view_test_postgres$'; then
    if ! wait_for_postgres; then
        overall_rc=1
    fi
    checked_count=$((checked_count + 1))
else
    echo "  SKIP: table_view_test_postgres container not running"
fi

# Wait for MySQL
if docker ps --format '{{.Names}}' | grep -q '^table_view_test_mysql$'; then
    if ! wait_for_mysql; then
        overall_rc=1
    fi
    checked_count=$((checked_count + 1))
else
    echo "  SKIP: table_view_test_mysql container not running"
fi

# Wait for MongoDB
if docker ps --format '{{.Names}}' | grep -q '^table_view_test_mongodb$'; then
    if ! wait_for_mongodb; then
        overall_rc=1
    fi
    checked_count=$((checked_count + 1))
else
    echo "  SKIP: table_view_test_mongodb container not running"
fi

# Wait for Elasticsearch
if docker ps --format '{{.Names}}' | grep -q '^table_view_test_elasticsearch$'; then
    if ! wait_for_elasticsearch; then
        overall_rc=1
    fi
    checked_count=$((checked_count + 1))
else
    echo "  SKIP: table_view_test_elasticsearch container not running"
fi

# Wait for Redis
if docker ps --format '{{.Names}}' | grep -q '^table_view_test_redis$'; then
    if ! wait_for_redis; then
        overall_rc=1
    fi
    checked_count=$((checked_count + 1))
else
    echo "  SKIP: table_view_test_redis container not running"
fi

if [ "$checked_count" -eq 0 ]; then
    echo "ERROR: No test database containers are running." >&2
    echo "  Start with: docker compose -f docker-compose.test.yml up -d" >&2
    exit 1
fi

if [ "$overall_rc" -eq 0 ]; then
    echo "All test databases are ready."
else
    echo "ERROR: One or more test databases failed to become ready." >&2
fi

exit "$overall_rc"
