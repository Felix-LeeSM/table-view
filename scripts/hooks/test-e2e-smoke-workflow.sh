#!/usr/bin/env bash
# Smoke check for the E2E smoke workflow cache contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/e2e-smoke.yml"

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		exit 1
	fi
}

prepare_block="$(sed -n '/^  e2e-smoke-prepare:/,/^  e2e-smoke:/p' "$WORKFLOW" | sed '$d')"
cache_line="$(awk '/uses: Swatinem\/rust-cache@v2/ { print NR; exit }' <<<"$prepare_block")"
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

assert_contains "$prepare_block" "workspaces: src-tauri -> target" "prepare rust cache"
assert_contains "$prepare_block" "shared-key: e2e-smoke-linux" "prepare rust cache"
assert_contains "$prepare_block" "cache-on-failure: true" "prepare rust cache"
assert_contains "$prepare_block" "save-if: \${{ github.ref == 'refs/heads/main' }}" "prepare rust cache"

echo "PASS: e2e-smoke workflow cache check"
