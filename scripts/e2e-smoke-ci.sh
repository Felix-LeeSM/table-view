#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export E2E_PG_HOST="${E2E_PG_HOST:-${PGHOST:-localhost}}"
export E2E_PG_PORT="${E2E_PG_PORT:-${PGPORT:-15432}}"
export PGUSER="${PGUSER:-testuser}"
export PGPASSWORD="${PGPASSWORD:-testpass}"
export PGDATABASE="${PGDATABASE:-table_view_test}"

export E2E_MONGO_HOST="${E2E_MONGO_HOST:-${MONGO_HOST:-localhost}}"
export E2E_MONGO_PORT="${E2E_MONGO_PORT:-${MONGO_PORT:-37017}}"
export MONGO_USER="${MONGO_USER:-testuser}"
export MONGO_PASSWORD="${MONGO_PASSWORD:-testpass}"
export E2E_MONGO_DB="${E2E_MONGO_DB:-table_view_test}"
export E2E_MONGO_AUTH_DB="${E2E_MONGO_AUTH_DB:-admin}"

export E2E_MYSQL_HOST="${E2E_MYSQL_HOST:-${MYSQL_HOST:-localhost}}"
export E2E_MYSQL_PORT="${E2E_MYSQL_PORT:-${MYSQL_PORT:-13306}}"
export MYSQL_USER="${MYSQL_USER:-testuser}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-testpass}"
export MYSQL_DATABASE="${MYSQL_DATABASE:-table_view_test}"

export E2E_MARIADB_HOST="${E2E_MARIADB_HOST:-${MARIADB_HOST:-localhost}}"
export E2E_MARIADB_PORT="${E2E_MARIADB_PORT:-${MARIADB_PORT:-23306}}"
export MARIADB_USER="${MARIADB_USER:-testuser}"
export MARIADB_PASSWORD="${MARIADB_PASSWORD:-testpass}"
export MARIADB_DATABASE="${MARIADB_DATABASE:-table_view_test}"

export E2E_REDIS_HOST="${E2E_REDIS_HOST:-${REDIS_HOST:-localhost}}"
export E2E_REDIS_PORT="${E2E_REDIS_PORT:-${REDIS_PORT:-6379}}"
export E2E_REDIS_DB="${E2E_REDIS_DB:-2}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-}"

REPORT_DIR="$ROOT_DIR/e2e/wdio-report"
mkdir -p "$REPORT_DIR"
find "$REPORT_DIR" -type f ! -name .gitkeep -delete

pnpm tsx scripts/e2e-pre-smoke-release-gate.ts
pnpm tsx e2e/fixtures/seed-smoke.ts
pnpm tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json

BASE_DATA_DIR="${TABLE_VIEW_TEST_DATA_DIR:-${RUNNER_TEMP:-/tmp}/table-view-smoke}"
rm -rf "$BASE_DATA_DIR"
mkdir -p "$BASE_DATA_DIR"

run_wdio() {
  local data_dir="$1"
  local spec="$2"

  if command -v xvfb-run >/dev/null 2>&1; then
    TABLE_VIEW_TEST_DATA_DIR="$data_dir" xvfb-run -a pnpm exec wdio run wdio.smoke.conf.ts --spec "$spec"
  else
    TABLE_VIEW_TEST_DATA_DIR="$data_dir" pnpm exec wdio run wdio.smoke.conf.ts --spec "$spec"
  fi
}

run_wdio "$BASE_DATA_DIR/postgres" "e2e/smoke/postgres.spec.ts"
run_wdio "$BASE_DATA_DIR/postgres-safe-mode" "e2e/smoke/postgres-safe-mode.spec.ts"
run_wdio "$BASE_DATA_DIR/postgres-explain" "e2e/smoke/postgres-explain.spec.ts"
run_wdio "$BASE_DATA_DIR/postgres-extension-completion" "e2e/smoke/postgres-extension-completion.spec.ts"
run_wdio "$BASE_DATA_DIR/postgres-cancellation" "e2e/smoke/postgres-cancellation.spec.ts"
run_wdio "$BASE_DATA_DIR/mysql" "e2e/smoke/mysql.spec.ts"
run_wdio "$BASE_DATA_DIR/mariadb" "e2e/smoke/mariadb.spec.ts"
run_wdio "$BASE_DATA_DIR/sqlite" "e2e/smoke/sqlite.spec.ts"
run_wdio "$BASE_DATA_DIR/duckdb" "e2e/smoke/duckdb.spec.ts"
run_wdio "$BASE_DATA_DIR/mongodb" "e2e/smoke/mongodb.spec.ts"
run_wdio "$BASE_DATA_DIR/redis" "e2e/smoke/redis.spec.ts"
