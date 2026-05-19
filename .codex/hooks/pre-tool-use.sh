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
patch_payload="$(json_field '.tool_input.input // .input.input // .tool_input.patch // .input.patch // .patch')"

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

run_main_worktree_source_check() {
  local stderr status
  status=0
  stderr="$(bash "$ROOT/scripts/hooks/check-main-worktree-source-edit.sh" "$@" 2>&1 >/dev/null)" || status=$?
  if [ "$status" -ne 0 ]; then
    if [ -z "$stderr" ]; then
      stderr="BLOCKED: source/app edit in main worktree."
    fi
    deny "$stderr"
    exit 0
  fi
  if [ -n "$stderr" ]; then
    printf '%s\n' "$stderr" >&2
  fi
}

is_bash_tool() {
  [ "$tool_name" = "Bash" ] || { [ -z "$tool_name" ] && [ -n "$command" ]; }
}

if is_bash_tool; then
  stderr=""
  status=0
  stderr="$("$ROOT/scripts/hooks/check-dangerous-bash.sh" "$command" 2>&1 >/dev/null)" || status=$?
  if [ "$status" -ne 0 ]; then
    deny "$stderr"
    exit 0
  fi
  if [ -n "$stderr" ]; then
    printf '%s\n' "$stderr" >&2
  fi
  run_main_worktree_source_check --command "$command"
fi

paths_from_json() {
  if ! command -v jq >/dev/null 2>&1 || [ -z "$INPUT" ]; then
    return 0
  fi
  printf '%s' "$INPUT" | jq -r '
    [
      .tool_input.file_path?, .input.file_path?, .file_path?,
      .tool_input.path?, .input.path?, .path?,
      (.tool_input.files?[]? | .file_path? // .path?),
      (.input.files?[]? | .file_path? // .path?)
    ] | .[]? | select(type == "string" and length > 0)
  ' 2>/dev/null || true
}

paths_from_patch() {
  { [ -n "$command" ] || [ -n "$patch_payload" ]; } || return 0
  printf '%s\n%s\n' "$command" "$patch_payload" | sed -nE \
    -e 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p' \
    -e 's/^\*\*\* Move to: (.*)$/\1/p'
}

check_path() {
  local raw="$1"
  local rel="${raw#$ROOT/}"

  case "$rel" in
    *.env | *.env.* | .env | .env.*)
      deny "BLOCKED: Editing .env files is not allowed. Use .env.local for local overrides."
      exit 0
      ;;
    .claude/settings.local.json)
      deny "BLOCKED: Editing local settings is not allowed."
      exit 0
      ;;
    .claude/skills/*)
      deny "BLOCKED: .claude/skills/ 는 skill plugin 영역. 본 repo 가 수정하면 plugin update 시 충돌. 룰 추가는 memory/ 아래에 신설하세요. (sprint-388 lock)"
      exit 0
      ;;
    memory/decisions/*/memory.md)
      printf '%s\n' "WARNING: ADR 본문은 작성 순간 동결입니다. 결정을 뒤집으려면 새 ADR을 추가하세요." >&2
      ;;
  esac

  run_main_worktree_source_check "$raw"
}

while IFS= read -r path; do
  [ -n "$path" ] || continue
  check_path "$path"
done < <({ paths_from_json; paths_from_patch; } | sort -u)

exit 0
