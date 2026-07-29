#!/usr/bin/env bash
# PostToolUse reminder (Claude Code + codex 공유). `gh pr create` 실행 직후
# 리뷰 단계를 잊지 않도록 non-blocking 넛지를 additionalContext 로 주입한다.
#
# 왜: 리뷰(pr-reviewer read-only)는 기본/자동/무-게이트 단계인데, 실사용에서
# 간헐적으로 누락되고 merge-확인 단계와 혼동됐다. 머지만 확인 대상이다.
# 사용자 결정(soft-first): hook 으로 강제(block)하지 않고 리마인더만 준다.
# block 이 아니라 additionalContext 만 내므로 턴을 막지 않는다.
#
# parity: 양 brain 이 동일 스크립트를 호출한다.
# 호출: `.claude/settings.json` PostToolUse(Bash) + `.codex/hooks.json` PostToolUse(Bash).

set -euo pipefail

INPUT="$(cat || true)"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/hook-json.sh"

command="$(hook_json_field '.tool_input.command // .input.command // .command')"

case "$command" in
	*"gh pr create"*)
		command -v jq >/dev/null 2>&1 || exit 0
		jq -n '{
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "gh pr create 실행 감지 — 리뷰 단계: 이 PR 에는 독립 pr-reviewer(read-only) coordinator 리뷰가 붙어야 한다. 붙이는 주체는 orchestrator 다 — 저자는 자기 PR 의 리뷰어를 부르지 않는다(self-review 편향). 리뷰는 기본/자동/무-게이트 단계이고, 머지만 확인 대상이다. 리뷰 없이 이 PR 을 끝난 것으로 두지 마라."
      }
    }'
		;;
esac

exit 0
