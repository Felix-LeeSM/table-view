#!/usr/bin/env bash
# Smoke check for the Homebrew cask sync workflow contract.
#
# The cask generator (scripts/release/update-homebrew-cask.mjs) writes the
# cask directly into the tap checkout working tree. The Open PR step must:
#   1. clear that working-tree copy before switching branches, otherwise the
#      generated file carries over and `git diff` reports no change (the bug
#      that left the tap with no Casks/table-view.rb at all); and
#   2. stage the cask (`git add`) before the change check, so a first-time
#      (untracked) cask is detected via `git diff --cached` instead of being
#      missed by `git diff --quiet` (which ignores untracked files).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/homebrew-cask.yml"

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
	fail "homebrew cask workflow is missing"
fi

workflow_text="$(cat "$WORKFLOW")"

assert_contains "$workflow_text" "name: Homebrew Cask Sync" "workflow identity"
assert_contains "$workflow_text" "types: [published]" "release published trigger"
assert_contains "$workflow_text" "workflow_dispatch:" "manual rerun trigger"
assert_contains "$workflow_text" "release_tag:" "manual release tag input"
assert_contains "$workflow_text" 'inputs.release_tag' "release tag fallback for manual runs"
assert_contains "$workflow_text" "update-homebrew-cask.mjs" "cask generator"

# Regression: working-tree cask must be cleared before the branch switch so the
# generator's direct write does not carry over and mask the diff.
assert_contains "$workflow_text" 'rm -f "${tap_file}"' "clear working-tree cask before branch switch"

# Regression: stage the cask before the change check so a first-time (untracked)
# cask is detected instead of silently skipped.
assert_contains "$workflow_text" 'git add "${tap_file}"' "stage cask before change detection"
assert_contains "$workflow_text" "git diff --cached --quiet" "staged change detection"

echo "PASS: Homebrew cask sync workflow check"
