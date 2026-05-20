#!/usr/bin/env bash
# Codex PreToolUse / PermissionRequest policy wrapper.
# Mirrors `.claude/settings.json` constraints and delegates Bash command policy
# to `scripts/hooks/check-dangerous-bash.sh`.

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

json_string() {
  jq -n --arg value "$1" '$value'
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
