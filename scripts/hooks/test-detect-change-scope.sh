#!/usr/bin/env bash
# Self-check for scripts/hooks/detect-change-scope.sh docs-only classification.
# Locks the CI docs/memory-only skip contract: a misclassified code change that
# reports docs-only would merge unverified code past the required checks.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/hooks/detect-change-scope.sh"

run_case() {
	local label="$1" expected="$2" files="$3" got
	got="$(CHANGED_FILES_OVERRIDE="$files" bash "$SCRIPT" | sed -n 's/^code_changed=//p' | head -n1)"
	if [ "$got" != "$expected" ]; then
		echo "FAIL: $label: expected code_changed=$expected, got '$got'" >&2
		exit 1
	fi
	echo "PASS: $label (code_changed=$got)"
}

run_case "docs-only" false $'docs/PLAN.md\nmemory/product/memory.md\nREADME.md'
run_case "nested docs/memory subdirs" false $'docs/a/b/c.md\nmemory/x/y/z/memory.md'
run_case "code-only" true $'src/App.tsx\nsrc-tauri/src/lib.rs'
run_case "mixed docs+code" true $'docs/PLAN.md\nsrc/App.tsx'
run_case "workflow change is code" true $'.github/workflows/ci.yml'
run_case "root non-md config is code" true $'package.json'
run_case "fixture json is code" true $'e2e/fixtures/redis/kv/seed.json'

echo "PASS: detect-change-scope classification"
