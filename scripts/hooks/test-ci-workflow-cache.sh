#!/usr/bin/env bash
# Smoke check for the CI workflow cache and coverage contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${CI_WORKFLOW_PATH:-$ROOT/.github/workflows/ci.yml}"
workflow_text="$(cat "$WORKFLOW")"

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq -- "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		exit 1
	fi
}

assert_order() {
	local text="$1"
	local first="$2"
	local second="$3"
	local label="$4"
	local first_line
	local second_line

	first_line="$(grep -Fn -- "$first" <<<"$text" | head -n 1 | cut -d: -f1 || true)"
	second_line="$(grep -Fn -- "$second" <<<"$text" | head -n 1 | cut -d: -f1 || true)"

	if [ -z "$first_line" ] || [ -z "$second_line" ] || [ "$first_line" -ge "$second_line" ]; then
		echo "FAIL: $label: expected '$first' before '$second'" >&2
		exit 1
	fi
}

extract_step_block() {
	local text="$1"
	local step_name="$2"

	awk -v step_name="$step_name" '
		$0 == "      - name: " step_name { in_block = 1; print; next }
		in_block && $0 ~ /^      - name: / { exit }
		in_block { print }
	' <<<"$text"
}

frontend_block="$(sed -n '/^  frontend:/,/^  rust:/p' <<<"$workflow_text" | sed '$d')"
vite_cache_block="$(sed -n '/- name: Cache Vite transform output/,/- name: Install dependencies/p' <<<"$workflow_text" | sed '$d')"
rust_block="$(sed -n '/^  rust:/,/^  integration-tests:/p' <<<"$workflow_text" | sed '$d')"
integration_block="$(sed -n '/^  integration-tests:/,/^  # Runtime E2E smoke/p' <<<"$workflow_text" | sed '$d')"
pr_body_block="$(sed -n '/^  pr-body:/,/^  frontend:/p' <<<"$workflow_text" | sed '$d')"
integration_disk_telemetry_step="$(extract_step_block "$integration_block" "Show disk usage before integration build")"
integration_disk_cleanup_step="$(extract_step_block "$integration_block" "Free disk headroom before integration build")"
integration_run_step="$(extract_step_block "$integration_block" "Run integration tests")"

if [ -z "$pr_body_block" ]; then
	echo "FAIL: PR body job is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$frontend_block" ]; then
	echo "FAIL: frontend job is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$vite_cache_block" ]; then
	echo "FAIL: Vite cache step is missing from $WORKFLOW" >&2
	exit 1
fi

assert_contains "$pr_body_block" "name: PR Body Contract" "PR body job"
assert_contains "$pr_body_block" "node-version: 22.14.0" "PR body job"
assert_contains "$pr_body_block" "run: bash scripts/hooks/test-check-pr-body.sh" "PR body job"
assert_contains "$pr_body_block" "run: node scripts/hooks/check-pr-body.mjs" "PR body job"
assert_order "$pr_body_block" "- name: Test PR body checker" "- name: Validate PR body" "PR body job order"
assert_contains "$frontend_block" "cache: pnpm" "frontend pnpm cache"
assert_contains "$frontend_block" "cache-dependency-path: pnpm-lock.yaml" "frontend pnpm cache"
assert_contains "$vite_cache_block" "path: node_modules/.vite" "vite cache"
assert_contains "$vite_cache_block" "key: vite-\${{ runner.os }}-\${{ hashFiles(" "vite cache key"
assert_contains "$vite_cache_block" "restore-keys: |" "vite cache restore"
assert_contains "$vite_cache_block" "vite-\${{ runner.os }}-" "vite cache restore"
assert_contains "$frontend_block" "run: git fetch --no-tags --prune --depth=1 origin refs/heads/main:refs/remotes/origin/main" "frontend coverage ratchet base fetch"
assert_contains "$frontend_block" "COVERAGE_RATCHET_REQUIRE_MAIN: \"1\"" "frontend coverage ratchet require main"
assert_contains "$frontend_block" "run: pnpm exec tsx scripts/check-coverage-ratchet.ts" "frontend coverage ratchet"
assert_order "$frontend_block" "- name: Fetch coverage ratchet base" "- name: Coverage ratchet" "frontend coverage ratchet base fetch order"
assert_contains "$frontend_block" "run: pnpm test -- --run --coverage --coverage.reporter=text-summary" "frontend coverage gate"
assert_contains "$rust_block" "workspaces: src-tauri -> target" "rust cache"
assert_contains "$rust_block" "cache-bin: false" "rust cache"
assert_contains "$rust_block" "save-if: \${{ github.ref == 'refs/heads/main' }}" "rust cache"
assert_contains "$integration_block" "workspaces: src-tauri -> target" "integration rust cache"
assert_contains "$integration_block" "cache-bin: false" "integration rust cache"
assert_contains "$integration_block" "save-if: \${{ github.ref == 'refs/heads/main' }}" "integration rust cache"
assert_order "$integration_block" "- name: Cache Rust artifacts" "- name: Show disk usage before integration build" "integration disk telemetry after cache"
assert_order "$integration_block" "- name: Show disk usage before integration build" "- name: Free disk headroom before integration build" "integration disk cleanup after telemetry"
assert_order "$integration_block" "- name: Free disk headroom before integration build" "- name: Run integration tests" "integration disk cleanup before cargo tests"
assert_order "$integration_block" "- name: Free disk headroom before integration build" "run: cargo test --manifest-path src-tauri/Cargo.toml" "integration disk cleanup before cargo command"
assert_contains "$integration_disk_telemetry_step" "df -h /" "integration disk telemetry step"
assert_contains "$integration_disk_telemetry_step" "du -sh src-tauri/target" "integration disk telemetry step"
assert_contains "$integration_disk_telemetry_step" "docker system df" "integration disk telemetry step"
assert_contains "$integration_disk_cleanup_step" "sudo apt-get clean" "integration disk cleanup step"
assert_contains "$integration_disk_cleanup_step" "docker system prune -af" "integration disk cleanup step"
assert_contains "$integration_disk_cleanup_step" "/usr/local/lib/android" "integration disk cleanup step"
assert_contains "$integration_disk_cleanup_step" "/usr/share/dotnet" "integration disk cleanup step"
assert_contains "$integration_disk_cleanup_step" "/opt/ghc" "integration disk cleanup step"
assert_contains "$integration_run_step" "run: cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration --test mongo_integration --test fixture_loading --test redis_integration" "integration cargo command"

echo "PASS: CI workflow cache and coverage check"
