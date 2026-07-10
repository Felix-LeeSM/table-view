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

# Regression: the macOS app bundle must carry a proper ad-hoc signature (Sealed
# Resources), or Gatekeeper rejects it as "damaged" and trashes it. Without
# bundle.macOS.signingIdentity the bundle is only linker-signed (flags 0x20002),
# which spctl rejects with "code has no resources but signature indicates they
# must be present". tauri.conf.json pins ad-hoc signing so Tauri signs the whole
# bundle (flags 0x2, Sealed Resources version=2).
TAURI_CONF="$ROOT/src-tauri/tauri.conf.json"
[ -f "$TAURI_CONF" ] || fail "tauri.conf.json is missing"
assert_contains "$(cat "$TAURI_CONF")" '"signingIdentity": "-"' "macOS ad-hoc bundle signing in tauri.conf.json"

# Regression: release.yml must verify the macOS leg actually produced a Sealed
# Resources signature, so a Tauri signing regression fails the release build
# instead of shipping a "damaged" bundle to users.
assert_contains "$workflow_text" "Verify macOS bundle signature" "macOS bundle signature verification step"

# Regression (#1430): release.yml must verify every updater .sig against the
# pubkey committed in tauri.conf.json, so a private-key/pubkey drift fails the
# release run instead of silently breaking auto-update for every client.
assert_contains "$workflow_text" "Verify updater signatures against committed pubkey" "updater signature gate step"
assert_contains "$workflow_text" "scripts/release/verify-updater-sigs.mjs" "updater signature gate script"
assert_contains "$workflow_text" 'ARTIFACT_PATHS: ${{ steps.tauri.outputs.artifactPaths }}' "updater signature gate artifact input"

# Regression (#1429): the build matrix runs with fail-fast: false, and
# tauri-action merges each leg's updater entry into the draft's latest.json
# via read-merge-write. A failed leg (v0.3.1: Windows) or a lost concurrent
# merge drops that platform's key; publishing it makes that OS's clients
# silently report "up to date" forever. release.yml must verify the merged
# manifest's platform completeness after all legs, even when one failed.
assert_contains "$workflow_text" "verify-latest-json:" "latest.json completeness gate job"
assert_contains "$workflow_text" "needs: build" "latest.json gate ordered after all build legs"
assert_contains "$workflow_text" "if: always()" "latest.json gate runs even when a build leg failed"
assert_contains "$workflow_text" "scripts/release/verify-latest-json.mjs" "latest.json completeness gate script"
assert_contains "$workflow_text" "gh release download" "latest.json fetched from the draft release"

echo "PASS: Release workflow check"
