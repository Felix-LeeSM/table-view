#!/usr/bin/env bash
# test-pre-tool-use-wrapper.sh — neutral PreToolUse wrapper 변환 로직 검증.
#
# 핵심 bug 회귀: policy 스크립트(check-edit-policy / check-dangerous-bash) 가 내는
# exit 1 을 wrapper 가 JSON permissionDecision:"deny" + exit 0 으로 변환하는지.
# Claude Code 는 exit 2 만 block 하므로, 이 변환이 없으면 매니페스트 직접 호출 시
# 차단이 무시된다.
#
# .env 기반 케이스는 check-edit-policy 의 `.env` case 가 primary/linked 무관 항상
# 차단하므로 worktree 안에서도 재현 가능하다.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER="$SCRIPT_DIR/pre-tool-use.sh"

pass=0
fail=0

ok() { printf 'PASS: %s\n' "$1"; pass=$((pass + 1)); }
no() { printf 'FAIL: %s\n  %s\n' "$1" "$2"; fail=$((fail + 1)); }

# wrapper 를 stdin JSON 으로 실행. stdout(JSON) 과 exit code 를 변수로 받는다.
run_wrapper() {
	stdout_file="$(mktemp "${TMPDIR:-/tmp}/ptu-stdout.XXXXXX")"
	printf '%s' "$1" | bash "$WRAPPER" >"$stdout_file" 2>/dev/null
	status=$?
	out="$(cat "$stdout_file")"
	rm -f "$stdout_file"
}

assert_deny() {
	local label="$1" json="$2" jq_expect="$3"
	run_wrapper "$json"
	if [ "$status" -eq 0 ] && printf '%s' "$out" | jq -e "$jq_expect" >/dev/null 2>&1; then
		ok "$label"
	else
		no "$label" "status=$status out=$out"
	fi
}

assert_pass() {
	local label="$1" json="$2"
	run_wrapper "$json"
	if [ "$status" -eq 0 ] && [ -z "$out" ]; then
		ok "$label"
	else
		no "$label" "status=$status out=$out (expected empty stdout + exit 0)"
	fi
}

# case 1: edit-policy 차단 (.env) → PreToolUse deny 변환.
assert_deny \
	"edit-policy block (.env Read) → permissionDecision deny + exit 0" \
	"{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$ROOT/.env\"}}" \
	'.hookSpecificOutput.permissionDecision == "deny"'

# case 2: dangerous-bash 차단 (--no-verify) → PreToolUse deny 변환.
assert_deny \
	"dangerous-bash block (git commit --no-verify) → permissionDecision deny + exit 0" \
	"{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit --no-verify -m x\"}}" \
	'.hookSpecificOutput.permissionDecision == "deny"'

# case 3: 정상 Write (memory orchestration) → 통과, JSON 없음.
assert_pass \
	"normal Write memory/* → exit 0, no JSON" \
	"{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$ROOT/memory/workflow/x.md\"}}"

# case 4: PermissionRequest event → decision.behavior deny (codex PermissionRequest path).
assert_deny \
	"PermissionRequest (.env) → decision.behavior deny" \
	"{\"hook_event_name\":\"PermissionRequest\",\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$ROOT/.env\"}}" \
	'.hookSpecificOutput.decision.behavior == "deny"'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
