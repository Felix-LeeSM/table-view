#!/usr/bin/env bash
# Smoke check for the CI workflow cache and coverage contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ci.yml"

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

	first_line="$(grep -Fn -- "$first" <<<"$text" | head -n 1 | cut -d: -f1)"
	second_line="$(grep -Fn -- "$second" <<<"$text" | head -n 1 | cut -d: -f1)"

	if [ -z "$first_line" ] || [ -z "$second_line" ] || [ "$first_line" -ge "$second_line" ]; then
		echo "FAIL: $label: expected '$first' before '$second'" >&2
		exit 1
	fi
}

frontend_block="$(sed -n '/^  frontend:/,/^  rust:/p' "$WORKFLOW" | sed '$d')"
vite_cache_block="$(sed -n '/- name: Cache Vite transform output/,/- name: Install dependencies/p' "$WORKFLOW" | sed '$d')"
rust_block="$(sed -n '/^  rust:/,/^  integration-tests:/p' "$WORKFLOW" | sed '$d')"
integration_block="$(sed -n '/^  integration-tests:/,/^  # Runtime E2E smoke/p' "$WORKFLOW" | sed '$d')"

if [ -z "$frontend_block" ]; then
	echo "FAIL: frontend job is missing from $WORKFLOW" >&2
	exit 1
fi
if [ -z "$vite_cache_block" ]; then
	echo "FAIL: Vite cache step is missing from $WORKFLOW" >&2
	exit 1
fi

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

echo "PASS: CI workflow cache and coverage check"
