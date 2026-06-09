#!/usr/bin/env bash
# Smoke check for the E2E smoke workflow cache contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/e2e-smoke.yml"
SMOKE_SCRIPT="$ROOT/scripts/e2e-smoke-ci.sh"

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

prepare_block="$(sed -n '/^  e2e-smoke-prepare:/,/^  e2e-smoke:/p' "$WORKFLOW" | sed '$d')"
smoke_block="$(sed -n '/^  e2e-smoke:/,/^  e2e-smoke-required:/p' "$WORKFLOW" | sed '$d')"
smoke_script="$(cat "$SMOKE_SCRIPT")"
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
assert_contains "$smoke_block" "key: tauri-driver-\${{ runner.os }}-v\${{ env.TAURI_DRIVER_VERSION }}" "tauri-driver cache"
assert_contains "$smoke_block" "~/.cargo/bin/tauri-driver.version" "tauri-driver cache"
assert_contains "$smoke_block" "Ensure tauri-driver cache contract" "tauri-driver cache"
assert_contains "$smoke_block" "cargo install tauri-driver --version \"\${TAURI_DRIVER_VERSION}\" --locked --force" "tauri-driver cache"
assert_contains "$smoke_block" "printf '%s\\n' \"\${TAURI_DRIVER_VERSION}\" > \"\$marker\"" "tauri-driver cache"
assert_contains "$smoke_block" "tauri-driver --help >/dev/null" "tauri-driver cache"
assert_not_contains "$smoke_block" "tauri-driver --version)" "tauri-driver cache"
assert_contains "$smoke_block" "TAURI_DRIVER_VERSION" "tauri-driver cache"
assert_contains "$smoke_block" "spec_key: oracle" "oracle smoke promotion"
assert_contains "$smoke_block" "e2e/smoke/oracle.spec.ts" "oracle smoke promotion"
assert_contains "$smoke_block" "Start Oracle service" "oracle smoke promotion"
assert_contains "$smoke_block" "timeout-minutes: 12" "oracle smoke timeout"
assert_contains "$smoke_script" "e2e/smoke/oracle.spec.ts" "oracle smoke promotion"

echo "PASS: e2e-smoke workflow cache check"
