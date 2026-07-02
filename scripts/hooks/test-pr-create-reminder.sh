#!/usr/bin/env bash
# test-pr-create-reminder.sh — PostToolUse `gh pr create` 리마인더 훅 검증.
#
# 계약: 명령이 `gh pr create` 를 포함하면 additionalContext JSON 을 stdout 으로
# 내고 exit 0, 그 외 명령이면 stdout 비우고 exit 0 (non-blocking, block 안 함).
# brain-agnostic 필드(.tool_input.command / .input.command / .command) 파싱을
# 함께 고정한다.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/pr-create-reminder.sh"

pass=0
fail=0

ok() { printf 'PASS: %s\n' "$1"; pass=$((pass + 1)); }
no() { printf 'FAIL: %s\n  %s\n' "$1" "$2"; fail=$((fail + 1)); }

run_hook() {
	stdout_file="$(mktemp "${TMPDIR:-/tmp}/pcr-stdout.XXXXXX")"
	printf '%s' "$1" | bash "$HOOK" >"$stdout_file" 2>/dev/null
	status=$?
	out="$(cat "$stdout_file")"
	rm -f "$stdout_file"
}

assert_reminder() {
	local label="$1" json="$2"
	run_hook "$json"
	if [ "$status" -eq 0 ] &&
		printf '%s' "$out" |
		jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("pr-reviewer"))' >/dev/null 2>&1; then
		ok "$label"
	else
		no "$label" "status=$status out=$out"
	fi
}

assert_silent() {
	local label="$1" json="$2"
	run_hook "$json"
	if [ "$status" -eq 0 ] && [ -z "$out" ]; then
		ok "$label"
	else
		no "$label" "status=$status out=$out (expected empty stdout + exit 0)"
	fi
}

# case 1: Claude Code shape (.tool_input.command) with gh pr create → reminder.
assert_reminder \
	"gh pr create (.tool_input.command) → additionalContext reminder" \
	'{"tool_name":"Bash","tool_input":{"command":"gh pr create --fill --base main"}}'

# case 2: codex shape (.input.command) with gh pr create → reminder (brain parity).
assert_reminder \
	"gh pr create (.input.command) → additionalContext reminder" \
	'{"tool_name":"Bash","input":{"command":"gh pr create -t x -b y"}}'

# case 3: unrelated command → silent, non-blocking.
assert_silent \
	"non-matching command (ls) → empty stdout, exit 0" \
	'{"tool_name":"Bash","tool_input":{"command":"ls -la"}}'

# case 4: empty / missing command → silent, non-blocking.
assert_silent \
	"missing command field → empty stdout, exit 0" \
	'{"tool_name":"Bash","tool_input":{}}'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
