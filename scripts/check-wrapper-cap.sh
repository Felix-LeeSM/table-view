#!/usr/bin/env bash
# check-wrapper-cap.sh
# Lazy wrapper 줄수 cap 점검. sprint-387 lock:
#   .claude/agents    ≤ 15 줄
#   .claude/rules     ≤ 20 줄
#   .claude/commands  ≤ 15 줄
# README.md 는 skip (디렉토리 정책 문서).
# 기본 동작: violation 있어도 경고만 (exit 0). --strict 시 violation 있으면 exit 1.
# PostToolUse hook 으로 등록 시 stderr 경고만 → agent 가 즉시 보고 fix.

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
			echo "⚠️  wrapper cap: $f — $lines 줄 (cap $cap)."
			echo "    본문은 memory/ 의 source room 으로 옮기고 wrapper 는 redirect 만."
			violations=$((violations + 1))
		fi
	done
}

check_dir ".claude/agents" 15
check_dir ".claude/rules" 20
check_dir ".claude/commands" 15

if [ "$violations" -gt 0 ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
