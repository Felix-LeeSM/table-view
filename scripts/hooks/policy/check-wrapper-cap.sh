#!/usr/bin/env bash
# check-wrapper-cap.sh
#
# ## cap 정의 — 한 문장
#
# **cap 은 `wc -l` 이 세는 파일 전체 줄수다. frontmatter 를 포함하고 README.md
# 는 제외한다.**
#
#   .claude/agents    ≤ 15
#   .codex/agents     ≤ 15
#   .claude/rules     ≤ 30
#   .claude/commands  ≤ 15
#
# 정의가 두 벌이었다 (#1975): `.claude/agents/README.md` 는 "**본문** 9-15줄",
# 이 스크립트는 파일 전체 ≤ 15 였다. README 상한대로 본문이 15줄이면 파일은
# 21줄이라 스크립트 위반이다. 위 한 문장으로 통일했고 두 README 가 그 문장을
# 인용한다. `.codex/agents/README.md` 에는 cap 조항이 아예 없었는데 이 스크립트는
# 그 디렉토리도 계측한다 — 그것도 맞췄다.
#
# ## `.claude/rules` 가 20 이 아니라 30 인 이유
#
# 20 은 sprint-387 이 "wrapper 는 포인터" 라는 전제로 정한 값이다. 그 전제가
# 무너졌다 — `.claude/rules/*.md` 는 spawn 된 subagent 에 **자동으로 배달되는 세
# 채널 중 하나**이고 마크다운 링크는 따라가지 않는다 (#1978 프로브,
# claude 2.1.220 / haiku, 6칸, `tool_uses: 0`). 그래서 포인터로 두면 룰이 안
# 닿는다. 이제 cap 의 역할은 "포인터임을 강제" 가 아니라 **채널 예산**이다 —
# 여기 있는 줄은 전부 모든 subagent 의 시스템 프롬프트에 실린다.
#
# 30 의 근거: `git-policy.md` 가 파생 차단 목록을 싣고 25줄이다. 그리고 가장 작은
# workflow 룰 방이 49줄이라 (`wc -l memory/workflow/bug-fix/memory.md`) 방을
# 통째로 복제하면 30 에서 여전히 걸린다.
#
# ## 모드
#
# 기본은 경고만 (exit 0) — PostToolUse advisory 용. `--strict` 는 violation 시
# exit 1 이고 pre-push 의 agent/hook 경로가 그 모드로 부른다. 기본 모드만
# 배선돼 있던 동안 `.claude/agents/pr-reviewer.md` 16줄 위반이 main 에 live
# 였다 (#1975).

set -euo pipefail

STRICT=0
for arg in "$@"; do
	case "$arg" in
		--strict) STRICT=1 ;;
	esac
done

violations=0

check_dir() {
	local dir="$1"
	local cap="$2"

	[ -d "$dir" ] || return 0

	for f in "$dir"/*.md; do
		[ -f "$f" ] || continue
		local base
		base="$(basename "$f")"
		[ "$base" = "README.md" ] && continue

		local lines
		lines=$(wc -l < "$f" | tr -d ' ')

		if [ "$lines" -gt "$cap" ]; then
			echo "⚠️  wrapper cap: $f — $lines 줄 (cap $cap, 파일 전체 wc -l)."
			echo "    줄어들 곳: agent 는 memory/ 방이나 skills: 주입, rules 는 파생 목록만."
			violations=$((violations + 1))
		fi
	done
}

check_dir ".claude/agents" 15
check_dir ".codex/agents" 15
check_dir ".claude/rules" 30
check_dir ".claude/commands" 15

if [ "$violations" -gt 0 ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
