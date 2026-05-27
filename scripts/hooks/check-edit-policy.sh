#!/usr/bin/env bash
# check-edit-policy.sh — platform-neutral file access policy hook.
#
# Runtime wrappers pass hook JSON on stdin. Claude Code also exposes TOOL_INPUT,
# so use it as a fallback. This script prints human-readable warnings/errors and
# exits non-zero only for hard blocks.

set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$ROOT" ]; then
	if ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
		:
	else
		ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
	fi
fi

INPUT="$(cat || true)"
if [ -z "$INPUT" ] && [ -n "${TOOL_INPUT:-}" ]; then
	INPUT="$TOOL_INPUT"
fi

json_field() {
	local expr="$1"
	if ! command -v jq >/dev/null 2>&1 || [ -z "$INPUT" ]; then
		return 0
	fi
	printf '%s' "$INPUT" | jq -r "$expr // empty" 2>/dev/null || true
}

command="$(json_field '.tool_input.command // .input.command // .command')"
patch_payload="$(json_field '.tool_input.input // .input.input // .tool_input.patch // .input.patch // .patch')"
tool_name="$(json_field '.tool_name // .tool // .name')"

is_write_path_tool() {
	case "$tool_name" in
		Edit | Write | MultiEdit)
			return 0
			;;
	esac
	return 1
}

run_main_worktree_source_check() {
	local status=0
	local stderr=""

	stderr="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$ROOT" bash "$ROOT/scripts/hooks/check-main-worktree-source-edit.sh" "$@" 2>&1 >/dev/null)" || status=$?
	if [ "$status" -ne 0 ]; then
		if [ -n "$stderr" ]; then
			printf '%s\n' "$stderr" >&2
		else
			printf '%s\n' "BLOCKED: source/app edit in primary worktree." >&2
		fi
		exit 1
	fi
	if [ -n "$stderr" ]; then
		printf '%s\n' "$stderr" >&2
	fi
}

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
	local base="${rel##*/}"

	case "$base" in
		.env | .env.local | .env.*.local)
			echo "BLOCKED: Reading or editing local env files is not allowed. Use .env.example for documented defaults." >&2
			exit 1
			;;
	esac

	case "$rel" in
		.claude/settings.local.json)
			echo "BLOCKED: Editing local settings is not allowed." >&2
			exit 1
			;;
		docs/archives/decisions/*/memory.md)
			echo "WARNING: ADR 본문은 작성 순간 동결입니다. 결정을 뒤집으려면 새 ADR을 추가하세요." >&2
			;;
	esac

	if is_write_path_tool; then
		run_main_worktree_source_check "$raw"
	fi
}

while IFS= read -r path; do
	[ -n "$path" ] || continue
	check_path "$path"
done < <({ paths_from_json; paths_from_patch; } | sort -u)

if [ -n "$command" ]; then
	run_main_worktree_source_check --command "$command"
fi

exit 0
