#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SQL_WASM="$ROOT/src/lib/sql/wasm/sql_parser_core_bg.wasm"
MONGO_WASM="$ROOT/src/lib/mongo/wasm/mongosh_parser_core_bg.wasm"

# Budgets are gzip-compressed bytes. They are expressed as KiB to avoid
# platform-specific ambiguity in human "KB" output.
SQL_WASM_GZIP_BUDGET_BYTES="${SQL_WASM_GZIP_BUDGET_BYTES:-81920}"     # 80 KiB
MONGO_WASM_GZIP_BUDGET_BYTES="${MONGO_WASM_GZIP_BUDGET_BYTES:-54272}" # 53 KiB

size_bytes() {
  wc -c <"$1" | tr -d '[:space:]'
}

gzip_size_bytes() {
  gzip -c "$1" | wc -c | tr -d '[:space:]'
}

check_wasm() {
  local label="$1"
  local path="$2"
  local budget="$3"

  if [ ! -f "$path" ]; then
    echo "ERROR: $label WASM artifact is missing: ${path#$ROOT/}" >&2
    return 1
  fi

  local raw_size
  local gzip_size
  raw_size="$(size_bytes "$path")"
  gzip_size="$(gzip_size_bytes "$path")"

  printf '%s wasm: raw=%s bytes gzip=%s bytes budget=%s bytes\n' \
    "$label" "$raw_size" "$gzip_size" "$budget"

  if [ "$gzip_size" -gt "$budget" ]; then
    echo "ERROR: $label WASM gzip size exceeds budget (${gzip_size} > ${budget})" >&2
    return 1
  fi
}

check_wasm "SQL" "$SQL_WASM" "$SQL_WASM_GZIP_BUDGET_BYTES"
check_wasm "Mongo" "$MONGO_WASM" "$MONGO_WASM_GZIP_BUDGET_BYTES"
