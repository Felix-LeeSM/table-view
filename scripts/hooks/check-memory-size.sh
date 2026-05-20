#!/usr/bin/env bash
# check-memory-size.sh
# memory/ 트리의 memory.md 파일 중 200줄을 초과하는 것에 대해 경고.
# 기본: 경고만 출력 (exit 0).
# --strict: 초과 파일이 있으면 exit 1 (CI·pre-push 용).

set -euo pipefail

THRESHOLD="${MEMORY_LINE_THRESHOLD:-200}"
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
	if [ "$lines" -gt "$THRESHOLD" ]; then
		echo "⚠️  memory size: $file (${lines} lines > ${THRESHOLD}). 하위 주제로 분할을 고려하세요 (/split-memory)."
		found_over=1
	fi
done < <(find memory -name "memory.md" -type f -print0)

if [ "$found_over" = "1" ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
