#!/usr/bin/env bash
# lib/root-resolve.sh — sourced module (순수 함수 정의, top-level 부작용 없음).
# repository root 를 stdout 에 출력. 폴백 순서:
#   1. CLAUDE_PROJECT_DIR
#   2. git rev-parse --show-toplevel
#   3. caller $0 기준 dirname/../.. (또는 arg1 로 전달된 fallback)
# 소비: scripts/hooks/post-tool-use.sh, scripts/hooks/check-edit-policy.sh.
# 주의: source 된 함수라도 \$0 는 caller 스크립트명을 가리킨다.

resolve_hook_root() {
	local fallback="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
	local root="${CLAUDE_PROJECT_DIR:-}"
	[ -n "$root" ] && { printf '%s' "$root"; return 0; }
	if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
		printf '%s' "$root"; return 0
	fi
	printf '%s' "$fallback"
}
