#!/usr/bin/env bash
# check-memory-size.sh
# memory/ 트리의 memory.md 파일의 분량 cap 검사 (복합 게이트).
# 줄 수(기본 200) 또는 chars(기본 12000) 둘 중 하나라도 초과 시 경고.
# 줄 수만으로는 한 줄을 길게 쓴 분량 우회를 못 잡아 chars 보조 cap 을 둔다.
# 기본: 경고만 출력 (exit 0).
# --strict: 초과 파일이 있으면 exit 1 (CI·pre-push 용).
# env: MEMORY_LINE_THRESHOLD(200), MEMORY_CHAR_THRESHOLD(12000).

set -euo pipefail

# UTF-8 locale 보장: wc -m 이 한국어를 문자 수로 세도록 (wc -l 은 locale 무관).
# macOS BSD wc 는 LC_ALL=C 일 때 멀티바이트를 바이트 수로 세 CI 와 불일치.
# LC_ALL 이 이미 UTF-8 계열이면 존중, 그 외(C 등)이거나 비어있으면 override 한다.
case "${LC_ALL:-}" in
	*UTF-8*|*utf8*) ;;
	*)
		for _l in en_US.UTF-8 en_US.utf8 C.UTF-8 C.utf8; do
			if locale -a 2>/dev/null | grep -qix "$_l"; then LC_ALL="$_l"; export LC_ALL; break; fi
		done
		;;
esac

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
