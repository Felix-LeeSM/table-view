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

	if ! grep -Fq -- "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		exit 1
	fi
}

assert_not_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if grep -Fq -- "$needle" <<<"$text"; then
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
	' "$WORKFLOW" | sort >"$TMP_DIR/workflow-matrix.txt"
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
		' "$SMOKE_SCRIPT" | sort >"$TMP_DIR/script-matrix.txt"
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

changes_block="$(sed -n '/^  changes:/,/^  e2e-smoke-prepare:/p' "$WORKFLOW" | sed '$d')"
prepare_block="$(sed -n '/^  e2e-smoke-prepare:/,/^  e2e-smoke:/p' "$WORKFLOW" | sed '$d')"
smoke_block="$(sed -n '/^  e2e-smoke:/,/^  e2e-smoke-file-backed:/p' "$WORKFLOW" | sed '$d')"
file_backed_block="$(sed -n '/^  e2e-smoke-file-backed:/,/^  e2e-smoke-enterprise-rdbms:/p' "$WORKFLOW" | sed '$d')"
enterprise_block="$(sed -n '/^  e2e-smoke-enterprise-rdbms:/,/^  e2e-smoke-required:/p' "$WORKFLOW" | sed '$d')"
required_block="$(sed -n '/^  e2e-smoke-required:/,$p' "$WORKFLOW")"
smoke_script="$(cat "$SMOKE_SCRIPT")"
search_smoke="$(cat "$ROOT/e2e/smoke/search-runtime-smoke.ts")"
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
if [ -z "$file_backed_block" ]; then
	echo "FAIL: e2e-smoke-file-backed job is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$enterprise_block" ]; then
	echo "FAIL: e2e-smoke-enterprise-rdbms job is missing from $WORKFLOW" >&2
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
if [ "$telemetry_line" -ge "$cleanup_line" ]; then
	echo "FAIL: disk usage telemetry must run before disk headroom cleanup" >&2
	exit 1
fi
if [ "$cleanup_line" -ge "$cache_line" ]; then
	echo "FAIL: disk headroom cleanup must run before Rust cache restore" >&2
	exit 1
fi
if [ "$cache_line" -ge "$build_line" ]; then
	echo "FAIL: Rust target cache restore must run before Build E2E smoke binary" >&2
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
assert_contains "$smoke_script" "pnpm tsx scripts/e2e-smoke-routing-decisions.ts" "fixture smoke routing decisions"
assert_contains "$smoke_block" "key: tauri-driver-\${{ runner.os }}-v\${{ env.TAURI_DRIVER_VERSION }}" "tauri-driver cache"
assert_contains "$smoke_block" "~/.cargo/bin/tauri-driver.version" "tauri-driver cache"
assert_contains "$smoke_block" "Ensure tauri-driver cache contract" "tauri-driver cache"
assert_contains "$smoke_block" "cargo install tauri-driver --version \"\${TAURI_DRIVER_VERSION}\" --locked --force" "tauri-driver cache"
assert_contains "$smoke_block" "printf '%s\\n' \"\${TAURI_DRIVER_VERSION}\" > \"\$marker\"" "tauri-driver cache"
assert_contains "$smoke_block" "tauri-driver --help >/dev/null" "tauri-driver cache"
assert_not_contains "$smoke_block" "tauri-driver --version)" "tauri-driver cache"
assert_contains "$smoke_block" "TAURI_DRIVER_VERSION" "tauri-driver cache"
assert_contains "$smoke_block" "ELASTIC_PASSWORD: TableViewSearch1!" "Search smoke auth"
assert_contains "$smoke_block" "ELASTICSEARCH_USER: elastic" "Search smoke auth"
assert_contains "$smoke_block" "ELASTICSEARCH_PASSWORD: TableViewSearch1!" "Search smoke auth"
assert_contains "$smoke_block" "curl -fsS -u elastic:TableViewSearch1!" "Search smoke auth"
assert_contains "$smoke_block" "OPENSEARCH_INITIAL_ADMIN_PASSWORD=TableViewSearch1!" "Search smoke auth"
assert_contains "$smoke_block" "OPENSEARCH_USER: admin" "Search smoke auth"
assert_contains "$smoke_block" "OPENSEARCH_PASSWORD: TableViewSearch1!" "Search smoke auth"
assert_contains "$smoke_block" "curl -fsS -u admin:TableViewSearch1!" "Search smoke auth"
assert_not_contains "$smoke_block" "xpack.security.enabled: false" "Search smoke auth"
assert_not_contains "$smoke_block" "DISABLE_SECURITY_PLUGIN=true" "Search smoke auth"
assert_contains "$smoke_script" 'export ELASTICSEARCH_USER="${ELASTICSEARCH_USER:-elastic}"' "Search smoke auth"
assert_contains "$smoke_script" 'export ELASTICSEARCH_PASSWORD="${ELASTICSEARCH_PASSWORD:-TableViewSearch1!}"' "Search smoke auth"
assert_contains "$smoke_script" 'export OPENSEARCH_USER="${OPENSEARCH_USER:-admin}"' "Search smoke auth"
assert_contains "$smoke_script" 'export OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-TableViewSearch1!}"' "Search smoke auth"
assert_contains "$search_smoke" "wrongSearchProbePassword(dbType)" "Search smoke auth"
assert_contains "$search_smoke" "Search authentication error" "Search smoke auth"
assert_matrix_contract
assert_contains "$file_backed_block" "spec_key: sqlite" "sqlite file-backed smoke"
assert_contains "$file_backed_block" "e2e/smoke/sqlite.spec.ts" "sqlite file-backed smoke"
assert_contains "$file_backed_block" "spec_key: duckdb-file-analytics" "duckdb file analytics smoke"
assert_contains "$file_backed_block" "e2e/smoke/duckdb-file-analytics.spec.ts" "duckdb file analytics smoke"
assert_contains "$file_backed_block" "E2E_SPEC: \${{ matrix.spec }}" "sqlite file-backed smoke"
assert_contains "$file_backed_block" "E2E_SPEC_KEY: \${{ matrix.spec_key }}" "sqlite file-backed smoke"
assert_not_contains "$file_backed_block" "services:" "sqlite file-backed smoke"
assert_contains "$required_block" "e2e-smoke-file-backed" "sqlite file-backed smoke required gate"
assert_contains "$required_block" "needs.e2e-smoke-file-backed.result" "sqlite file-backed smoke required gate"
assert_contains "$required_block" "e2e-smoke-enterprise-rdbms" "enterprise RDBMS smoke required gate"
assert_contains "$required_block" "needs.e2e-smoke-enterprise-rdbms.result" "enterprise RDBMS smoke required gate"
assert_not_contains "$smoke_block" "spec_key: sqlite" "sqlite service-backed smoke"
assert_not_contains "$smoke_block" "e2e/smoke/sqlite.spec.ts" "sqlite service-backed smoke"
assert_not_contains "$smoke_block" "spec_key: duckdb-file-analytics" "duckdb file analytics service-backed smoke"
assert_not_contains "$smoke_block" "e2e/smoke/duckdb-file-analytics.spec.ts" "duckdb file analytics service-backed smoke"
assert_contains "$smoke_block" "spec_key: duckdb" "duckdb smoke promotion"
assert_contains "$smoke_block" "e2e/smoke/duckdb.spec.ts" "duckdb smoke promotion"
assert_contains "$smoke_script" 'run_wdio "$BASE_DATA_DIR/sqlite" "e2e/smoke/sqlite.spec.ts"' "sqlite script wiring"
assert_contains "$smoke_script" 'run_wdio "$BASE_DATA_DIR/duckdb" "e2e/smoke/duckdb.spec.ts"' "duckdb script wiring"
assert_contains "$smoke_script" 'run_wdio "$BASE_DATA_DIR/duckdb-file-analytics" "e2e/smoke/duckdb-file-analytics.spec.ts"' "duckdb file analytics script wiring"
assert_contains "$sqlite_spec" "SQLite DML batch result was not visible through a follow-up SELECT" "sqlite visible smoke assertions"
assert_contains "$sqlite_spec" "SQLite read-only write rejection did not render" "sqlite visible smoke assertions"
assert_contains "$duckdb_spec" "DuckDB DML readback did not appear in result grid" "duckdb visible smoke assertions"
assert_contains "$duckdb_spec" "DuckDB read-only write rejection did not render" "duckdb visible smoke assertions"
assert_contains "$smoke_script" "set -euo pipefail" "smoke script failure handling"
assert_contains "$smoke_script" 'seed_smoke_spec "$spec_key" "$spec"' "per-spec fixture setup"
assert_contains "$smoke_script" 'E2E_SPEC_KEY="$spec_key" E2E_SPEC="$spec" pnpm tsx e2e/fixtures/seed-smoke.ts' "per-spec fixture setup"
assert_contains "$smoke_script" 'spec_key="$(basename "$data_dir")"' "per-spec fixture setup"
assert_not_contains "$smoke_script" 'if [[ "${E2E_BUILD_ONLY:-0}" != "1" ]]; then' "per-spec fixture setup"
if grep -Eq 'run_wdio .* \|\| true|seed-smoke\.ts.*\|\| true' "$SMOKE_SCRIPT"; then
	fail "smoke script must not convert setup or spec failures into passes"
fi
assert_contains "$smoke_script" 'run_wdio "$BASE_DATA_DIR/mssql" "e2e/smoke/mssql.spec.ts"' "enterprise RDBMS smoke promotion"
assert_contains "$smoke_script" 'run_wdio "$BASE_DATA_DIR/oracle" "e2e/smoke/oracle.spec.ts"' "enterprise RDBMS smoke promotion"
assert_contains "$enterprise_block" "spec_key: mssql" "enterprise RDBMS smoke promotion"
assert_contains "$enterprise_block" "spec_key: oracle" "enterprise RDBMS smoke promotion"
assert_contains "$enterprise_block" "Start MSSQL service" "enterprise RDBMS smoke promotion"
assert_contains "$enterprise_block" "Start Oracle service" "enterprise RDBMS smoke promotion"
assert_contains "$enterprise_block" "mcr.microsoft.com/mssql/server:2022-latest" "enterprise RDBMS smoke promotion"
assert_contains "$enterprise_block" "gvenzl/oracle-xe:21-slim-faststart" "enterprise RDBMS smoke promotion"
assert_contains "$enterprise_block" "max-parallel: 1" "enterprise RDBMS smoke promotion"
assert_contains "$required_block" "Enterprise RDBMS runtime result" "enterprise RDBMS smoke promotion"
assert_contains "$required_block" "Runtime matrix passed." "enterprise RDBMS smoke promotion"

# docs/memory-only skip gate (audit 2026-07-03 #5). The runtime matrix (~30m)
# skips on docs PRs. The required `Runtime Happy Path` aggregation must skip too
# (not fail) so the required context stays satisfied via skipped-job semantics.
if [ -z "$changes_block" ]; then
	echo "FAIL: change-detection 'changes' job is missing from $WORKFLOW" >&2
	exit 1
fi
assert_contains "$changes_block" "name: Detect Change Scope" "changes job"
assert_contains "$changes_block" "fetch-depth: 0" "changes job needs full history for diff base"
assert_contains "$changes_block" "run: bash scripts/hooks/detect-change-scope.sh" "changes job detection script"
assert_contains "$prepare_block" "needs: changes" "prepare needs changes"
assert_contains "$prepare_block" "if: needs.changes.outputs.code_changed == 'true'" "prepare docs-only skip gate"
# always() keeps failure detection; the code_changed guard skips the whole
# aggregation on docs-only so the required context is satisfied by skip.
assert_contains "$required_block" "if: always() && needs.changes.outputs.code_changed == 'true'" "required aggregation docs-only skip gate"
assert_contains "$required_block" "- changes" "required aggregation needs changes"
# Guard the forbidden shortcut: a workflow-level paths-ignore key (not a comment
# mentioning it) would leave the required Runtime Happy Path context
# expected/missing forever.
if grep -Eq "^[[:space:]]+paths-ignore:" "$WORKFLOW"; then
	fail "workflow-level paths-ignore orphans the required Runtime Happy Path check"
fi

echo "PASS: e2e-smoke workflow cache check"
