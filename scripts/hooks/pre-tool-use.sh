#!/usr/bin/env bash
# PreToolUse / PermissionRequest neutral policy wrapper (Claude Code + codex 공유).
#
# Brain-공통 block 프로토콜 변환 layer. policy check 스크립트
# (check-edit-policy.sh, check-dangerous-bash.sh)는 차단 시 exit 1 을 내는데,
# Claude Code PreToolUse 는 **exit 2 만 block** 으로 인식하고 그 외 non-zero 는
# non-blocking ("Execution continues") 이다. 따라서 exit 1 인 policy 스크립트를
# 매니페스트에서 직접 부르면 차단이 안 된다. 본 wrapper 가 exit 1 을
# JSON `permissionDecision:"deny"` + exit 0 으로 변환해 양 brain 이 동일하게
# 차단한다.
#
# 단일 책임: 본 wrapper 만이 brain 프로토콜을 안다. policy 스크립트 자체는
# brain-agnostic 하게 exit code 만 내도록 유지한다. drift 방지.
#
# 호출: `.claude/settings.json` PreToolUse + `.codex/hooks.json` PreToolUse/PermissionRequest.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT="$(cat || true)"

json_field() {
	local expr="$1"
	if ! command -v jq >/dev/null 2>&1 || [ -z "$INPUT" ]; then
		return 0
	fi
	printf '%s' "$INPUT" | jq -r "$expr // empty" 2>/dev/null || true
}

event_name="$(json_field '.hook_event_name')"
tool_name="$(json_field '.tool_name')"
command="$(json_field '.tool_input.command // .input.command // .command')"

deny() {
	local reason="$1"
	printf '%s\n' "$reason" >&2

	if [ "$event_name" = "PermissionRequest" ]; then
		jq -n --arg reason "$reason" '{
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "deny", message: $reason }
			}
		}'
	else
		jq -n --arg reason "$reason" '{
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: $reason
			}
		}'
	fi
}

is_bash_tool() {
	[ "$tool_name" = "Bash" ] || { [ -z "$tool_name" ] && [ -n "$command" ]; }
}

# Bash tool → destructive/hook-bypass command 정책 (check-dangerous-bash.sh).
if is_bash_tool; then
	stderr=""
	status=0
	stderr="$(bash "$ROOT/scripts/hooks/check-dangerous-bash.sh" "$command" 2>&1 >/dev/null)" || status=$?
	if [ "$status" -ne 0 ]; then
		deny "$stderr"
		exit 0
	fi
	if [ -n "$stderr" ]; then
		printf '%s\n' "$stderr" >&2
	fi
fi

# 모든 tool → file/path edit 정책 (check-edit-policy.sh). stdin JSON 그대로 전달.
policy_stderr=""
policy_status=0
policy_stderr="$(printf '%s' "$INPUT" | bash "$ROOT/scripts/hooks/check-edit-policy.sh" 2>&1 >/dev/null)" || policy_status=$?
if [ "$policy_status" -ne 0 ]; then
	deny "$policy_stderr"
	exit 0
fi
if [ -n "$policy_stderr" ]; then
	printf '%s\n' "$policy_stderr" >&2
fi

exit 0
