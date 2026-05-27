#!/usr/bin/env bash
# check-memory-structure.sh
# 규칙: memory/ 트리 아래에는 **오직 memory.md만** 허용.
#       모든 "방"은 디렉토리이고 내용은 memory.md에, 더 세분화하면 하위 디렉토리에 또 memory.md를 둔다.
# 기본: 경고만 (exit 0). --strict 시 violation 있으면 exit 1.

set -euo pipefail

STRICT=0
for arg in "$@"; do
	case "$arg" in
		--strict) STRICT=1 ;;
	esac
done

if [ ! -d "memory" ]; then
	exit 0
fi

violations=0

while IFS= read -r -d '' file; do
	# Sprint 386 — memory/index/*.md 는 자동 생성 index 라 예외.
	# scripts/regenerate-indexes.sh 가 by-task.md / by-surface.md 두 파일을
	# 만든다. memory/ 트리의 룰 source 는 여전히 memory.md 만.
	case "$file" in
		memory/index/*.md) continue ;;
	esac
	base="$(basename "$file")"
	if [ "$base" != "memory.md" ]; then
		echo "⚠️  memory structure: $file — memory/ 트리는 'memory.md'만 허용합니다."
		echo "    이 파일을 하위 디렉토리로 옮기고 이름을 memory.md로 바꾸세요."
		violations=$((violations + 1))
	fi
done < <(find memory -type f -print0)

if [ "$violations" -gt 0 ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

# Sprint 388 — 자식 디렉토리 있는데 본 dir 에 memory.md 없으면 위반 (index 누락).
# 과거 sub-room 이 parent memory.md 없이 생겨 silent fail 한 결함 재발 방지.
while IFS= read -r dir; do
	case "$dir" in
		memory|memory/index) continue ;;
	esac
	if [ -n "$(find "$dir" -mindepth 1 -maxdepth 1 -type d -print -quit 2>/dev/null)" ] && \
	   [ ! -f "$dir/memory.md" ]; then
		echo "⚠️  memory structure: $dir — 자식 디렉토리는 있는데 index 'memory.md' 없습니다."
		echo "    이 디렉토리에 index memory.md 를 추가하세요 (방 지도 + 진입 규칙)."
		violations=$((violations + 1))
	fi
done < <(find memory -mindepth 1 -type d)

if [ "$violations" -gt 0 ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
