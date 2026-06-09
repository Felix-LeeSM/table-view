#!/usr/bin/env bash
# Smoke check for the E2E smoke workflow cache contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/e2e-smoke.yml"
SMOKE_SCRIPT="$ROOT/scripts/e2e-smoke-ci.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/e2e-smoke-workflow-check.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		exit 1
	fi
}

assert_not_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: unexpected '$needle'" >&2
		exit 1
	fi
}

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

write_workflow_matrix() {
	awk '
		/^[[:space:]]*- spec_key:/ { key = $3 }
		/^[[:space:]]*spec: e2e\/smoke\/.*\.spec\.ts/ && key != "" {
			print key " " $2
			key = ""
		}
	' "$WORKFLOW" >"$TMP_DIR/workflow-matrix.txt"
}

write_script_matrix() {
	awk '
		/run_wdio "\$BASE_DATA_DIR\/[^"]+" "e2e\/smoke\/.*\.spec\.ts"/ {
			key = $0
			sub(/^.*run_wdio "\$BASE_DATA_DIR\//, "", key)
			sub(/".*$/, "", key)

			spec = $0
			sub(/^.*"e2e/, "e2e", spec)
			sub(/".*$/, "", spec)

			print key " " spec
		}
	' "$SMOKE_SCRIPT" >"$TMP_DIR/script-matrix.txt"
}

assert_matrix_contract() {
	write_workflow_matrix
	write_script_matrix

	if [ ! -s "$TMP_DIR/workflow-matrix.txt" ]; then
		fail "workflow smoke matrix is empty"
	fi
	if [ ! -s "$TMP_DIR/script-matrix.txt" ]; then
		fail "script default smoke matrix is empty"
	fi

	local matrix_count
	matrix_count="$(wc -l <"$TMP_DIR/workflow-matrix.txt" | tr -d '[:space:]')"
	if [ "$matrix_count" -lt 16 ]; then
		fail "workflow smoke matrix unexpectedly shrank below 16 specs"
	fi

	if ! diff -u "$TMP_DIR/workflow-matrix.txt" "$TMP_DIR/script-matrix.txt"; then
		fail "workflow matrix and scripts/e2e-smoke-ci.sh default run_wdio matrix diverged"
	fi

	while read -r key spec; do
		[ -n "$key" ] || continue
		if [ "$spec" != "e2e/smoke/$key.spec.ts" ]; then
			fail "matrix key/path mismatch: $key -> $spec"
		fi
		if [ ! -f "$ROOT/$spec" ]; then
			fail "matrix spec does not exist: $spec"
		fi
	done <"$TMP_DIR/workflow-matrix.txt"
}

prepare_block="$(sed -n '/^  e2e-smoke-prepare:/,/^  e2e-smoke:/p' "$WORKFLOW" | sed '$d')"
smoke_block="$(sed -n '/^  e2e-smoke:/,/^  e2e-smoke-required:/p' "$WORKFLOW" | sed '$d')"
smoke_script="$(cat "$SMOKE_SCRIPT")"
sqlite_spec="$(cat "$ROOT/e2e/smoke/sqlite.spec.ts")"
duckdb_spec="$(cat "$ROOT/e2e/smoke/duckdb.spec.ts")"
cache_line="$(awk '/uses: Swatinem\/rust-cache@v2/ { print NR; exit }' <<<"$prepare_block")"
telemetry_line="$(awk '/- name: Show disk usage before E2E build/ { print NR; exit }' <<<"$prepare_block")"
cleanup_line="$(awk '/- name: Free disk headroom before E2E build/ { print NR; exit }' <<<"$prepare_block")"
build_line="$(awk '/- name: Build E2E smoke binary/ { print NR; exit }' <<<"$prepare_block")"

if [ -z "$prepare_block" ]; then
	echo "FAIL: e2e-smoke-prepare job is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$cache_line" ]; then
	echo "FAIL: e2e-smoke-prepare must restore Rust target cache before building the Tauri smoke binary" >&2
	exit 1
fi
if [ -z "$build_line" ]; then
	echo "FAIL: e2e-smoke-prepare build step is missing from $WORKFLOW" >&2
	exit 1
fi
if [ "$cache_line" -ge "$build_line" ]; then
	echo "FAIL: Rust target cache restore must run before Build E2E smoke binary" >&2
	exit 1
fi
if [ -z "$telemetry_line" ]; then
	echo "FAIL: e2e-smoke-prepare must print disk usage before building the Tauri smoke binary" >&2
	exit 1
fi
if [ -z "$cleanup_line" ]; then
	echo "FAIL: e2e-smoke-prepare must free disk headroom before building the Tauri smoke binary" >&2
	exit 1
fi
if [ "$telemetry_line" -le "$cache_line" ] || [ "$telemetry_line" -ge "$build_line" ]; then
	echo "FAIL: disk usage telemetry must run after Rust cache restore and before Build E2E smoke binary" >&2
	exit 1
fi
if [ "$cleanup_line" -le "$telemetry_line" ] || [ "$cleanup_line" -ge "$build_line" ]; then
	echo "FAIL: disk headroom cleanup must run after disk telemetry and before Build E2E smoke binary" >&2
	exit 1
fi

assert_contains "$prepare_block" "workspaces: src-tauri -> target" "prepare rust cache"
assert_contains "$prepare_block" "shared-key: e2e-smoke-linux" "prepare rust cache"
assert_contains "$prepare_block" "cache-on-failure: true" "prepare rust cache"
assert_contains "$prepare_block" "save-if: \${{ github.ref == 'refs/heads/main' }}" "prepare rust cache"
assert_contains "$prepare_block" "df -h /" "prepare disk telemetry"
assert_contains "$prepare_block" "du -sh src-tauri/target" "prepare disk telemetry"
assert_contains "$prepare_block" "sudo apt-get clean" "prepare disk cleanup"
assert_contains "$prepare_block" "docker system prune -af" "prepare disk cleanup"
assert_contains "$prepare_block" "/usr/local/lib/android" "prepare disk cleanup"
assert_contains "$prepare_block" "/usr/share/dotnet" "prepare disk cleanup"
assert_contains "$prepare_block" "/opt/ghc" "prepare disk cleanup"
assert_contains "$smoke_block" "key: tauri-driver-\${{ runner.os }}-v\${{ env.TAURI_DRIVER_VERSION }}" "tauri-driver cache"
assert_contains "$smoke_block" "~/.cargo/bin/tauri-driver.version" "tauri-driver cache"
assert_contains "$smoke_block" "Ensure tauri-driver cache contract" "tauri-driver cache"
assert_contains "$smoke_block" "cargo install tauri-driver --version \"\${TAURI_DRIVER_VERSION}\" --locked --force" "tauri-driver cache"
assert_contains "$smoke_block" "printf '%s\\n' \"\${TAURI_DRIVER_VERSION}\" > \"\$marker\"" "tauri-driver cache"
assert_contains "$smoke_block" "tauri-driver --help >/dev/null" "tauri-driver cache"
assert_not_contains "$smoke_block" "tauri-driver --version)" "tauri-driver cache"
assert_contains "$smoke_block" "TAURI_DRIVER_VERSION" "tauri-driver cache"
assert_matrix_contract
assert_contains "$smoke_block" "spec_key: sqlite" "sqlite smoke promotion"
assert_contains "$smoke_block" "e2e/smoke/sqlite.spec.ts" "sqlite smoke promotion"
assert_contains "$smoke_block" "spec_key: duckdb" "duckdb smoke promotion"
assert_contains "$smoke_block" "e2e/smoke/duckdb.spec.ts" "duckdb smoke promotion"
assert_contains "$smoke_script" 'run_wdio "$BASE_DATA_DIR/sqlite" "e2e/smoke/sqlite.spec.ts"' "sqlite script wiring"
assert_contains "$smoke_script" 'run_wdio "$BASE_DATA_DIR/duckdb" "e2e/smoke/duckdb.spec.ts"' "duckdb script wiring"
assert_contains "$sqlite_spec" "SQLite DML batch result was not visible through a follow-up SELECT" "sqlite visible smoke assertions"
assert_contains "$sqlite_spec" "SQLite read-only write rejection did not render" "sqlite visible smoke assertions"
assert_contains "$duckdb_spec" "DuckDB DML readback did not appear in result grid" "duckdb visible smoke assertions"
assert_contains "$duckdb_spec" "DuckDB read-only write rejection did not render" "duckdb visible smoke assertions"
assert_contains "$smoke_script" "set -euo pipefail" "smoke script failure handling"
assert_contains "$smoke_script" "pnpm tsx e2e/fixtures/seed-smoke.ts" "smoke script fixture setup"
if grep -Eq 'run_wdio .* \|\| true|seed-smoke\.ts.*\|\| true' "$SMOKE_SCRIPT"; then
	fail "smoke script must not convert setup or spec failures into passes"
fi
assert_contains "$smoke_block" "spec_key: oracle" "oracle smoke promotion"
assert_contains "$smoke_block" "e2e/smoke/oracle.spec.ts" "oracle smoke promotion"
assert_contains "$smoke_block" "Start Oracle service" "oracle smoke promotion"
assert_contains "$smoke_block" "timeout-minutes: 12" "oracle smoke timeout"
assert_contains "$smoke_script" "e2e/smoke/oracle.spec.ts" "oracle smoke promotion"

echo "PASS: e2e-smoke workflow cache check"
