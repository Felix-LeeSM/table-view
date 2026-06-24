#!/usr/bin/env bash
# Smoke check for the release workflow contract.
#
# The Windows MSVC build of libduckdb-sys requires /std:c++17: DuckDB's vendored
# fmt uses inline variables, and MSVC's C++14 default fails with error C7525.
# platform-smoke-canary.yml sets this via a matrix cxxflags + step env CXXFLAGS.
# release.yml must do the same on its Windows leg, or every release's Windows
# bundle fails to build.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/release.yml"

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

if [ ! -f "$WORKFLOW" ]; then
	fail "release workflow is missing"
fi

workflow_text="$(cat "$WORKFLOW")"
matrix_block="$(sed -n '/^[[:space:]]*matrix:/,/^[[:space:]]*steps:/p' "$WORKFLOW" | sed '$d')"

assert_contains "$workflow_text" "name: Release" "workflow identity"
assert_contains "$workflow_text" 'tags: ["v*.*.*"]' "version tag push trigger"

# Regression: Windows MSVC needs /std:c++17 to build DuckDB's vendored fmt.
assert_contains "$matrix_block" 'cxxflags: "/std:c++17"' "Windows C++17 override"
assert_contains "$matrix_block" 'cxxflags: ""' "non-Windows empty cxxflags"

# Regression: windows-latest now ships VS18 / MSVC 14.51, where DuckDB's vendored
# fmt references stdext::checked_array_iterator and fails with C2653 even under
# /std:c++17. Pin the Windows leg to windows-2022 (VS17) to match
# platform-smoke-canary.yml, whose Windows smoke passes on exactly that image.
assert_contains "$matrix_block" 'platform: windows-2022' "Windows platform pinned to VS17 (MSVC 14.4x)"

# Regression: the cxxflags matrix value must reach the build step env so cc-rs
# passes /std:c++17 to cl.exe.
assert_contains "$workflow_text" 'CXXFLAGS: ${{ matrix.cxxflags }}' "build step CXXFLAGS env"

echo "PASS: Release workflow check"
