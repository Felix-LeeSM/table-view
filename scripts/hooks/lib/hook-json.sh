#!/usr/bin/env bash
# lib/hook-json.sh — sourced module (순수 함수 정의, top-level 부작용 없음).
# runtime wrapper 가 stdin 으로 주는 hook JSON 에서 필드/경로를 추출.
# 소비: scripts/hooks/post-tool-use.sh, scripts/hooks/check-edit-policy.sh.
# 호환성(동작 불변): 함수는 caller 의 전역 \$INPUT / \$command / \$patch_payload
# 를 참조. 인자화 정리는 Phase 2.

# stdin 으로 hook JSON 을 읽어 INPUT 후보를 반환. 빈 경우 TOOL_INPUT 폴백.
hook_read_input() {
	local input
	input="$(cat || true)"
	if [ -z "$input" ] && [ -n "${TOOL_INPUT:-}" ]; then
		input="$TOOL_INPUT"
	fi
	printf '%s' "$input"
}

hook_json_field() {
	local expr="$1"
	if ! command -v jq >/dev/null 2>&1 || [ -z "$INPUT" ]; then
		return 0
	fi
	printf '%s' "$INPUT" | jq -r "$expr // empty" 2>/dev/null || true
}

hook_paths_from_json() {
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

hook_paths_from_patch() {
	{ [ -n "$command" ] || [ -n "$patch_payload" ]; } || return 0
	printf '%s\n%s\n' "$command" "$patch_payload" | sed -nE \
		-e 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p' \
		-e 's/^\*\*\* Move to: (.*)$/\1/p'
}
