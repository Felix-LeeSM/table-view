#!/usr/bin/env bash
# Smoke check for generated/cache/tmp/worktree ignore fences.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

expect_ignored() {
	local path="$1"

	git -C "$ROOT" check-ignore --no-index -q -- "$path" ||
		fail "expected ignored generated/cache path: $path"
}

expect_not_ignored() {
	local path="$1"
	local details

	if git -C "$ROOT" check-ignore --no-index -q -- "$path"; then
		details="$(git -C "$ROOT" check-ignore --no-index -v -- "$path" || true)"
		fail "unexpected ignored source-like path: $path${details:+ ($details)}"
	fi
}

expect_ignored "node_modules/.cache/package.js"
expect_ignored "dist/assets/app.js"
expect_ignored ".vite/deps/chunk.js"
expect_ignored "cargo-target/debug/build-output"
expect_ignored "target/debug/build-output"
expect_ignored "src-tauri/target/debug/build-output"
expect_ignored "src-tauri/sql-parser-core/target/debug/build-output"
expect_ignored "src-tauri/mongosh-parser-core/target/debug/build-output"
expect_ignored "coverage/lcov.info"
expect_ignored "test-results/results.json"
expect_ignored "wdio-report/index.html"
expect_ignored "e2e/wdio-report/run/index.html"
expect_ignored "tmp/scratch/App.tsx"
expect_ignored "worktrees/agent/src/App.tsx"
expect_ignored ".claude/worktrees/agent/src-tauri/src/lib.rs"
expect_ignored ".env.local"
expect_ignored "src-tauri/icons/Compiled/partial-info.plist"

expect_not_ignored "src/target/source.ts"
expect_not_ignored "src/dist/source.ts"
expect_not_ignored "src/coverage/source.ts"
expect_not_ignored "src/tmp/source.ts"
expect_not_ignored "src/test-results/source.ts"
expect_not_ignored "src/node_modules/source.ts"
expect_not_ignored "src/lib/sql/wasm/generated-cache-fence-check.js"
expect_not_ignored "src/lib/mongo/wasm/generated-cache-fence-check.d.ts"
expect_not_ignored "src-tauri/gen/schemas/generated-cache-fence-check.json"
expect_not_ignored "src-tauri/icons/generated-cache-fence-check.png"
expect_not_ignored "e2e/wdio-report/.gitkeep"
expect_not_ignored ".env.example"

echo "PASS: generated/cache/tmp/worktree fences"
