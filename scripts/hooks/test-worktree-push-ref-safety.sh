#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
failures=0

cargo_deny_block="$(sed -n '/run_cargo_deny()/,/^}/p' "$ROOT/scripts/hooks/pre-push-path-router.sh")"

if ! printf '%s\n' "$cargo_deny_block" | grep -Fq 'git rev-parse --local-env-vars'; then
	echo "ERROR: pre-push cargo-deny must unset Git local env vars before running cargo deny." >&2
	failures=$((failures + 1))
fi

if ! printf '%s\n' "$cargo_deny_block" | grep -Fq 'cargo deny check'; then
	echo "ERROR: pre-push cargo-deny block not found." >&2
	failures=$((failures + 1))
fi

if ! grep -Fq 'branch --unset-upstream "$BRANCH"' "$ROOT/scripts/worktree-spawn.sh"; then
	echo "ERROR: new worktree branches must not track origin/main as their upstream." >&2
	failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
	exit 1
fi

echo "worktree push ref safety checks passed"
