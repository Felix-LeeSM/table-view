#!/usr/bin/env bash
# Smoke test for scripts/target-cache.sh command routing. Uses stub Rust tools
# so this verifies cache-warm intent without compiling DuckDB.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="$ROOT/scripts/target-cache.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/target-cache-check.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

CALL_LOG="$TMP_DIR/calls.log"
mkdir -p "$TMP_DIR/bin"

cat >"$TMP_DIR/bin/cargo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'cargo' >>"$TARGET_CACHE_CALL_LOG"
for arg in "$@"; do
  printf ' %s' "$arg" >>"$TARGET_CACHE_CALL_LOG"
done
printf '\n' >>"$TARGET_CACHE_CALL_LOG"

case "${1:-}" in
  check)
    exit 0
    ;;
  nextest)
    exit 0
    ;;
  llvm-cov)
    case "${2:-}" in
      --version)
        exit 0
        ;;
      show-env)
        printf 'export TARGET_CACHE_TEST_SHOW_ENV=1\n'
        exit 0
        ;;
    esac
    ;;
esac

exit 0
EOF

cat >"$TMP_DIR/bin/rustup" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'rustup' >>"$TARGET_CACHE_CALL_LOG"
for arg in "$@"; do
  printf ' %s' "$arg" >>"$TARGET_CACHE_CALL_LOG"
done
printf '\n' >>"$TARGET_CACHE_CALL_LOG"

if [ "${1:-}" = "component" ] && [ "${2:-}" = "list" ]; then
  printf 'llvm-tools-preview\n'
fi
EOF

cat >"$TMP_DIR/bin/cargo-nextest" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$TMP_DIR/bin/cargo" "$TMP_DIR/bin/rustup" "$TMP_DIR/bin/cargo-nextest"

assert_contains() {
  local text="$1"
  local needle="$2"
  local label="$3"

  if ! grep -Fq -- "$needle" <<<"$text"; then
    echo "FAIL: $label: missing '$needle'" >&2
    echo "$text" >&2
    exit 1
  fi
}

assert_not_contains() {
  local text="$1"
  local needle="$2"
  local label="$3"

  if grep -Fq -- "$needle" <<<"$text"; then
    echo "FAIL: $label: unexpected '$needle'" >&2
    echo "$text" >&2
    exit 1
  fi
}

run_helper() {
  : >"$CALL_LOG"
  PATH="$TMP_DIR/bin:$PATH" TARGET_CACHE_CALL_LOG="$CALL_LOG" "$HELPER" "$@" >/dev/null 2>&1
  cat "$CALL_LOG"
}

default_output="$(run_helper "$ROOT")"
assert_contains "$default_output" "cargo check" "default"
assert_contains "$default_output" "cargo nextest list --profile push --target-dir target" "default debug test lane"
assert_contains "$default_output" "--test duckdb_file_analytics" "default duckdb test binary"
assert_contains "$default_output" "cargo llvm-cov show-env --sh" "default coverage env"
assert_contains "$default_output" "cargo nextest list --profile push --target-dir target/llvm-cov-target" "default coverage test lane"

debug_output="$(run_helper --debug-only "$ROOT")"
assert_contains "$debug_output" "cargo check" "debug only"
assert_contains "$debug_output" "cargo nextest list --profile push --target-dir target" "debug only test lane"
assert_contains "$debug_output" "--test duckdb_file_analytics" "debug only duckdb test binary"
assert_not_contains "$debug_output" "target/llvm-cov-target" "debug only"

coverage_output="$(run_helper --coverage-only "$ROOT")"
assert_contains "$coverage_output" "cargo llvm-cov show-env --sh" "coverage only env"
assert_contains "$coverage_output" "cargo nextest list --profile push --target-dir target/llvm-cov-target" "coverage only test lane"
assert_contains "$coverage_output" "--test duckdb_file_analytics" "coverage only duckdb test binary"
assert_not_contains "$coverage_output" "cargo check" "coverage only"

echo "PASS: target-cache smoke check"
