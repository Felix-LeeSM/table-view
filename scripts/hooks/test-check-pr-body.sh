#!/usr/bin/env bash
# Regression tests for the PR body contract checker.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="$ROOT/scripts/hooks/check-pr-body.mjs"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pr-body-check.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

write_valid_body() {
	local path="$1"

	cat >"$path" <<'BODY'
## Summary

Add a CI gate for PR body contracts.

## Changes

- scripts/hooks/check-pr-body.mjs
- scripts/hooks/test-check-pr-body.sh

## Invariants

- Existing CI jobs still run on pull_request and main.

## Test plan

- bash scripts/hooks/test-check-pr-body.sh

## Smoke impact

Smoke-Test-Plan: Not required: metadata-only CI validation.

## Documentation impact

- Required: no
- Trigger: none
- Updated SOT: n/a
- Reason: CI validation only; no product or workflow SOT changes.

## Links

- Closes #809
BODY
}

run_valid_body() {
	local body="$TMP_DIR/valid.md"

	write_valid_body "$body"
	node "$CHECKER" --body-file "$body" >"$TMP_DIR/valid.out" 2>"$TMP_DIR/valid.err" \
		|| fail "valid body should pass"
	grep -Fq "PASS: PR body contract satisfied" "$TMP_DIR/valid.out" \
		|| fail "valid body did not report pass"
}

run_invalid_body() {
	local name="$1"
	local expected="$2"
	shift 2
	local body="$TMP_DIR/${name}.md"

	write_valid_body "$body"
	"$@" "$body"
	if node "$CHECKER" --body-file "$body" >"$TMP_DIR/${name}.out" 2>"$TMP_DIR/${name}.err"; then
		fail "$name should fail"
	fi
	grep -Fq "$expected" "$TMP_DIR/${name}.err" \
		|| fail "$name did not report '$expected'"
}

remove_smoke_plan() {
	local body="$1"
	sed -i.bak '/^Smoke-Test-Plan:/d' "$body"
}

remove_documentation_reason() {
	local body="$1"
	sed -i.bak '/^- Reason:/d' "$body"
}

add_local_path() {
	local body="$1"
	printf '\nLocal evidence: /Users/example/check.log\n' >>"$body"
}

[ -f "$CHECKER" ] || fail "missing checker: $CHECKER"

run_valid_body
run_invalid_body "missing-smoke-plan" "Missing required field: Smoke impact / Smoke-Test-Plan" remove_smoke_plan
run_invalid_body "missing-documentation-reason" "Missing required field: Documentation impact / Reason" remove_documentation_reason
run_invalid_body "local-path" "Local-only path is not allowed" add_local_path

skip_output="$(GITHUB_EVENT_NAME=push node "$CHECKER")"
grep -Fq "SKIP: PR body check only runs on pull_request" <<<"$skip_output" \
	|| fail "push event did not skip gracefully"

echo "PASS: PR body checker regression tests"
