#!/usr/bin/env bash
# check-edit-policy.sh — platform-neutral file access policy hook.
#
# Runtime wrappers pass hook JSON on stdin. Claude Code also exposes TOOL_INPUT,
# so use it as a fallback. This script prints human-readable warnings/errors and
# exits non-zero only for hard blocks.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/root-resolve.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-json.sh"

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROOT="$(resolve_hook_root "$SCRIPT_ROOT")"
INPUT="$(hook_read_input)"

command="$(hook_json_field '.tool_input.command // .input.command // .command')"
patch_payload="$(hook_json_field '.tool_input.input // .input.input // .tool_input.patch // .input.patch // .patch')"
tool_name="$(hook_json_field '.tool_name // .tool // .name')"

is_write_path_tool() {
	case "$tool_name" in
		Edit | Write | MultiEdit | apply_patch)
			return 0
			;;
	esac
	return 1
}

run_main_worktree_source_check() {
	local status=0
	local stderr=""

	stderr="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$ROOT" bash "$SCRIPT_ROOT/scripts/hooks/check-main-worktree-source-edit.sh" "$@" 2>&1 >/dev/null)" || status=$?
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
done < <({ hook_paths_from_json; hook_paths_from_patch; } | sort -u)

if [ -n "$command" ]; then
	run_main_worktree_source_check --command "$command"
fi

exit 0
