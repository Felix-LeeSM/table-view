#!/usr/bin/env bash
# Smoke check for the auto-tag-release workflow contract (issue #1405, option B).
#
# Guards the two invariants that make option B safe:
#  1. It only fires on a version bump to tauri.conf.json on main, and pushes the
#     tag with a PAT so release.yml actually triggers.
#  2. It NEVER publishes — the draft gate stays a manual human step, because
#     #1400 auto-update installs any published release to every user.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/auto-tag-release.yml"

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

assert_contains() {
	local text="$1" needle="$2" label="$3"
	if ! grep -Fq -- "$needle" <<<"$text"; then
		fail "$label: missing '$needle'"
	fi
}

assert_not_contains() {
	local text="$1" needle="$2" label="$3"
	if grep -Fq -- "$needle" <<<"$text"; then
		fail "$label: must not contain '$needle'"
	fi
}

[ -f "$WORKFLOW" ] || fail "auto-tag-release workflow is missing"
workflow_text="$(cat "$WORKFLOW")"

assert_contains "$workflow_text" "name: Auto Tag Release" "workflow identity"

# Trigger: only a version bump on main.
assert_contains "$workflow_text" "branches: [main]" "main branch trigger"
assert_contains "$workflow_text" 'paths: ["src-tauri/tauri.conf.json"]' "tauri.conf.json path trigger"

# Tag push must use a PAT — GITHUB_TOKEN-pushed tags do not trigger release.yml.
assert_contains "$workflow_text" "secrets.RELEASE_PAT" "PAT for downstream trigger"

# semver + Cargo.toml agreement guard (blocks a malformed/half-done bump).
assert_contains "$workflow_text" 'jq -r .version src-tauri/tauri.conf.json' "version parse"
assert_contains "$workflow_text" "Cargo.toml" "Cargo.toml version cross-check"

# Idempotency: existing tag is a no-op.
assert_contains "$workflow_text" "git ls-remote --tags origin" "idempotent tag existence check"

# SAFETY: this workflow must never publish a release. Publishing stays manual so
# a bad release cannot auto-install via #1400. Reject any publish escape hatch.
assert_not_contains "$workflow_text" "gh release edit" "no publish automation"
assert_not_contains "$workflow_text" "draft=false" "no draft flip"
assert_not_contains "$workflow_text" "releaseDraft: false" "no draft flip"
assert_not_contains "$workflow_text" "--publish" "no publish flag"

echo "PASS: Auto-tag-release workflow check"
