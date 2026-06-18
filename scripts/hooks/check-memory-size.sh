#!/usr/bin/env bash
# check-memory-size.sh
# memory/ 트리의 memory.md 파일의 분량 cap 검사 (복합 게이트).
# 줄 수(기본 200) 또는 chars(기본 12000) 둘 중 하나라도 초과 시 경고.
# 줄 수만으로는 한 줄을 길게 쓴 분량 우회를 못 잡아 chars 보조 cap 을 둔다.
# 기본: 경고만 출력 (exit 0).
# --strict: 초과 파일이 있으면 exit 1 (CI·pre-push 용).
# env: MEMORY_LINE_THRESHOLD(200), MEMORY_CHAR_THRESHOLD(12000).

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/locale-utf8.sh"
ensure_utf8_locale

LINE_THRESHOLD="${MEMORY_LINE_THRESHOLD:-200}"
CHAR_THRESHOLD="${MEMORY_CHAR_THRESHOLD:-12000}"
STRICT=0

for arg in "$@"; do
	case "$arg" in
		--strict) STRICT=1 ;;
	esac
done

if [ ! -d "memory" ]; then
	exit 0
fi

found_over=0
while IFS= read -r -d '' file; do
	lines=$(wc -l < "$file" | tr -d ' ')
	chars=$(wc -m < "$file" | tr -d ' ')
	over_line=0
	over_char=0
	[ "$lines" -gt "$LINE_THRESHOLD" ] && over_line=1
	[ "$chars" -gt "$CHAR_THRESHOLD" ] && over_char=1
	if [ "$over_line" = "1" ] || [ "$over_char" = "1" ]; then
		reason=""
		[ "$over_line" = "1" ] && reason="${lines} lines > ${LINE_THRESHOLD}"
		[ "$over_line" = "1" ] && [ "$over_char" = "1" ] && reason="${reason} / "
		[ "$over_char" = "1" ] && reason="${reason}${chars} chars > ${CHAR_THRESHOLD}"
		echo "⚠️  memory size: $file (${reason}). 하위 주제로 분할을 고려하세요 (split-memory skill)."
		found_over=1
	fi
done < <(find memory -name "memory.md" -type f -print0)

if [ "$found_over" = "1" ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
