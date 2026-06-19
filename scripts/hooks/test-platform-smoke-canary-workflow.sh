#!/usr/bin/env bash
# Smoke check for the opt-in macOS/Windows platform canary workflow contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/platform-smoke-canary.yml"

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq -- "$needle" <<<"$text"; then
		fail "$label: missing '$needle'"
	fi
}

assert_not_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if grep -Fq -- "$needle" <<<"$text"; then
		fail "$label: unexpected '$needle'"
	fi
}

if [ ! -f "$WORKFLOW" ]; then
	fail "platform canary workflow is missing"
fi

workflow_text="$(cat "$WORKFLOW")"
matrix_block="$(sed -n '/^[[:space:]]*matrix:/,/^[[:space:]]*steps:/p' "$WORKFLOW" | sed '$d')"

assert_contains "$workflow_text" "name: Platform Smoke Canary" "workflow identity"
assert_contains "$workflow_text" "workflow_dispatch:" "manual trigger"
assert_not_contains "$workflow_text" "pull_request:" "manual trigger"
assert_not_contains "$workflow_text" "push:" "manual trigger"
assert_contains "$workflow_text" "contents: read" "permissions"
assert_contains "$workflow_text" "fail-fast: false" "matrix isolation"
assert_contains "$workflow_text" "name: Platform Smoke Canary (\${{ matrix.label }})" "separate platform jobs"
assert_contains "$matrix_block" "label: macOS arm64" "macOS canary"
assert_contains "$matrix_block" "platform: macos-14" "macOS canary"
assert_contains "$matrix_block" "target: aarch64-apple-darwin" "macOS canary"
assert_contains "$matrix_block" "tauri_args: --target aarch64-apple-darwin" "macOS canary"
assert_contains "$matrix_block" 'cxxflags: ""' "macOS canary"
assert_contains "$matrix_block" "label: Windows x86_64" "Windows canary"
assert_contains "$matrix_block" "platform: windows-latest" "Windows canary"
assert_contains "$matrix_block" "target: x86_64-pc-windows-msvc" "Windows canary"
assert_contains "$matrix_block" 'cxxflags: "/std:c++17"' "Windows canary"
assert_contains "$workflow_text" "node-version: 22.14.0" "toolchain"
assert_contains "$workflow_text" "version: 10.20.0" "toolchain"
assert_contains "$workflow_text" "toolchain: 1.91.0" "toolchain"
assert_contains "$workflow_text" "pnpm install --frozen-lockfile" "dependency install"
assert_contains "$workflow_text" 'CXXFLAGS: ${{ matrix.cxxflags }}' "Windows MSVC C++17 override"
assert_contains "$workflow_text" "pnpm tauri build --debug --no-bundle --ci" "tauri no-bundle smoke"
assert_contains "$workflow_text" "GITHUB_STEP_SUMMARY" "separate platform summary"
assert_contains "$workflow_text" "Required gate: no" "non-blocking canary"
assert_contains "$workflow_text" "Runtime support claim: none" "no support claim"
assert_not_contains "$workflow_text" "continue-on-error: true" "canary failure visibility"

echo "PASS: Platform smoke canary workflow check"
