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

export E2E_MSSQL_HOST="${E2E_MSSQL_HOST:-${MSSQL_HOST:-localhost}}"
export E2E_MSSQL_PORT="${E2E_MSSQL_PORT:-${MSSQL_PORT:-14333}}"
export MSSQL_USER="${MSSQL_USER:-sa}"
export MSSQL_PASSWORD="${MSSQL_PASSWORD:-Testpass123!}"
export MSSQL_DATABASE="${MSSQL_DATABASE:-table_view_test}"

export E2E_ORACLE_HOST="${E2E_ORACLE_HOST:-${ORACLE_HOST:-localhost}}"
export E2E_ORACLE_PORT="${E2E_ORACLE_PORT:-${ORACLE_PORT:-1521}}"
export ORACLE_USER="${ORACLE_USER:-testuser}"
export ORACLE_PASSWORD="${ORACLE_PASSWORD:-testpass}"
export E2E_ORACLE_SERVICE="${E2E_ORACLE_SERVICE:-${ORACLE_SERVICE:-XEPDB1}}"

export E2E_REDIS_HOST="${E2E_REDIS_HOST:-${REDIS_HOST:-localhost}}"
export E2E_REDIS_PORT="${E2E_REDIS_PORT:-${REDIS_PORT:-6379}}"
export E2E_REDIS_DB="${E2E_REDIS_DB:-2}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-}"

export E2E_VALKEY_HOST="${E2E_VALKEY_HOST:-${VALKEY_HOST:-localhost}}"
export E2E_VALKEY_PORT="${E2E_VALKEY_PORT:-${VALKEY_PORT:-16379}}"
export E2E_VALKEY_DB="${E2E_VALKEY_DB:-2}"
export VALKEY_PASSWORD="${VALKEY_PASSWORD:-}"

export E2E_ELASTICSEARCH_HOST="${E2E_ELASTICSEARCH_HOST:-${ELASTICSEARCH_HOST:-localhost}}"
export E2E_ELASTICSEARCH_PORT="${E2E_ELASTICSEARCH_PORT:-${ELASTICSEARCH_PORT:-19200}}"
export ELASTICSEARCH_USER="${ELASTICSEARCH_USER:-}"
export ELASTICSEARCH_PASSWORD="${ELASTICSEARCH_PASSWORD:-}"

export E2E_OPENSEARCH_HOST="${E2E_OPENSEARCH_HOST:-${OPENSEARCH_HOST:-localhost}}"
export E2E_OPENSEARCH_PORT="${E2E_OPENSEARCH_PORT:-${OPENSEARCH_PORT:-29200}}"
export OPENSEARCH_USER="${OPENSEARCH_USER:-}"
export OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-}"

REPORT_DIR="$ROOT_DIR/e2e/wdio-report"
SPEC_TO_RUN="${E2E_SPEC:-}"
if [[ -n "$SPEC_TO_RUN" ]]; then
  REPORT_DIR="${E2E_REPORT_DIR:-$ROOT_DIR/e2e/wdio-report/${E2E_SPEC_KEY:-single-spec}}"
else
  REPORT_DIR="${E2E_REPORT_DIR:-$ROOT_DIR/e2e/wdio-report}"
fi
mkdir -p "$REPORT_DIR"
find "$REPORT_DIR" -type f ! -name .gitkeep -delete

pnpm tsx scripts/e2e-smoke-routing-decisions.ts
pnpm tsx scripts/e2e-pre-smoke-release-gate.ts
if [[ "${E2E_BUILD_ONLY:-0}" != "1" ]]; then
  pnpm tsx e2e/fixtures/seed-smoke.ts
fi
if [[ "${E2E_SKIP_BUILD:-0}" != "1" ]]; then
  pnpm tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json
fi
if [[ "${E2E_BUILD_ONLY:-0}" = "1" ]]; then
  exit 0
fi

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

if [[ -n "$SPEC_TO_RUN" ]]; then
  SAFE_SPEC_NAME="${E2E_SPEC_KEY:-$(basename "$SPEC_TO_RUN" .spec.ts)}"
  SAFE_SPEC_NAME="$(printf '%s' "$SAFE_SPEC_NAME" | tr '/ ' '-' )"
  run_wdio "$BASE_DATA_DIR/$SAFE_SPEC_NAME" "$SPEC_TO_RUN"
else
  run_wdio "$BASE_DATA_DIR/postgres" "e2e/smoke/postgres.spec.ts"
  run_wdio "$BASE_DATA_DIR/postgres-safe-mode" "e2e/smoke/postgres-safe-mode.spec.ts"
  run_wdio "$BASE_DATA_DIR/postgres-explain" "e2e/smoke/postgres-explain.spec.ts"
  run_wdio "$BASE_DATA_DIR/postgres-extension-completion" "e2e/smoke/postgres-extension-completion.spec.ts"
  run_wdio "$BASE_DATA_DIR/postgres-cancellation" "e2e/smoke/postgres-cancellation.spec.ts"
  run_wdio "$BASE_DATA_DIR/postgres-structure-ddl" "e2e/smoke/postgres-structure-ddl.spec.ts"
  run_wdio "$BASE_DATA_DIR/mysql" "e2e/smoke/mysql.spec.ts"
  run_wdio "$BASE_DATA_DIR/mariadb" "e2e/smoke/mariadb.spec.ts"
  run_wdio "$BASE_DATA_DIR/mssql" "e2e/smoke/mssql.spec.ts"
  run_wdio "$BASE_DATA_DIR/oracle" "e2e/smoke/oracle.spec.ts"
  run_wdio "$BASE_DATA_DIR/sqlite" "e2e/smoke/sqlite.spec.ts"
  run_wdio "$BASE_DATA_DIR/duckdb" "e2e/smoke/duckdb.spec.ts"
  run_wdio "$BASE_DATA_DIR/duckdb-file-analytics" "e2e/smoke/duckdb-file-analytics.spec.ts"
  run_wdio "$BASE_DATA_DIR/mongodb" "e2e/smoke/mongodb.spec.ts"
  run_wdio "$BASE_DATA_DIR/redis" "e2e/smoke/redis.spec.ts"
  run_wdio "$BASE_DATA_DIR/valkey" "e2e/smoke/valkey.spec.ts"
  run_wdio "$BASE_DATA_DIR/elasticsearch" "e2e/smoke/elasticsearch.spec.ts"
  run_wdio "$BASE_DATA_DIR/opensearch" "e2e/smoke/opensearch.spec.ts"
fi
