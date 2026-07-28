#!/usr/bin/env bash
# Self-check for scripts/hooks/analyze/detect-change-scope.sh docs-only classification.
# Locks the CI docs/memory-only skip contract: a misclassified code change that
# reports docs-only would merge unverified code past the required checks.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/hooks/analyze/detect-change-scope.sh"

# Both signals are asserted on every case. `docs_changed` is the one that made
# the classification honest: a docs-only set used to report "code_changed=false"
# and nothing else, which downstream gates read as "nothing changed" and skipped
# the checks that read docs/.
run_case() {
	local label="$1" expect_code="$2" expect_docs="$3" files="$4" out got_code got_docs
	out="$(CHANGED_FILES_OVERRIDE="$files" bash "$SCRIPT")"
	got_code="$(sed -n 's/^code_changed=//p' <<<"$out" | head -n1)"
	got_docs="$(sed -n 's/^docs_changed=//p' <<<"$out" | head -n1)"
	if [ "$got_code" != "$expect_code" ] || [ "$got_docs" != "$expect_docs" ]; then
		echo "FAIL: $label: expected code=$expect_code docs=$expect_docs, got code='$got_code' docs='$got_docs'" >&2
		exit 1
	fi
	echo "PASS: $label (code_changed=$got_code docs_changed=$got_docs)"
}

#         label                          code   docs   files
run_case "docs-only" false true $'docs/PLAN.md\nmemory/product/memory.md\nREADME.md'
run_case "nested docs/memory subdirs" false true $'docs/a/b/c.md\nmemory/x/y/z/memory.md'
run_case "code-only" true false $'src/App.tsx\nsrc-tauri/src/lib.rs'
run_case "mixed docs+code" true true $'docs/PLAN.md\nsrc/App.tsx'
run_case "workflow change is code" true false $'.github/workflows/ci.yml'
run_case "root non-md config is code" true false $'package.json'
run_case "fixture json is code" true false $'e2e/fixtures/redis/kv/seed.json'
# Whitespace-only, because an unset override falls through to git/event detection.
run_case "empty change set" false false $'\n'

# Fail-safe: an unhandled event must set BOTH, not just code_changed. A
# docs-reading job gated on docs_changed would otherwise skip on a
# workflow_dispatch run.
unhandled="$(GITHUB_EVENT_NAME=workflow_dispatch bash "$SCRIPT" 2>/dev/null)"
if ! grep -qx 'code_changed=true' <<<"$unhandled" ||
	! grep -qx 'docs_changed=true' <<<"$unhandled"; then
	echo "FAIL: unhandled event must fail safe to both true, got: $unhandled" >&2
	exit 1
fi
echo "PASS: unhandled event fails safe to both true"

echo "PASS: detect-change-scope classification"
