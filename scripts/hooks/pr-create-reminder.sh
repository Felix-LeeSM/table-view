#!/usr/bin/env bash
# PostToolUse reminder (Claude Code + codex 공유). `gh pr create` 실행 직후
# 델리버리 T4 리뷰를 잊지 않도록 non-blocking 넛지를 additionalContext 로 주입한다.
#
# 왜: review(T4, pr-reviewer read-only)는 기본/자동/무-게이트 단계인데, 실사용에서
# 간헐적으로 누락되고 merge-확인 단계와 혼동됐다. merge(T6)만 확인 대상이다.
# 사용자 결정(soft-first): hook 으로 강제(block)하지 않고 리마인더만 준다.
# block 이 아니라 additionalContext 만 내므로 턴을 막지 않는다.
#
# parity: 양 brain 이 동일 스크립트를 호출한다.
# 호출: `.claude/settings.json` PostToolUse(Bash) + `.codex/hooks.json` PostToolUse(Bash).

set -euo pipefail

INPUT="$(cat || true)"
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-json.sh"

command="$(hook_json_field '.tool_input.command // .input.command // .command')"

case "$command" in
	*"gh pr create"*)
		command -v jq >/dev/null 2>&1 || exit 0
		jq -n '{
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "gh pr create 실행 감지 — 델리버리 T4: PR 이 생성됐다면 지금 pr-reviewer(read-only) coordinator 를 spawn 해 리뷰해라. 리뷰는 기본/자동/무-게이트 단계이고, merge(T6)만 확인 대상이다. 리뷰를 건너뛰고 이 턴을 끝내지 마라."
      }
    }'
		;;
esac

exit 0
