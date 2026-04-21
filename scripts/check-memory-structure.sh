#!/usr/bin/env bash
# check-memory-structure.sh
# 규칙: memory/ 트리 아래에는 **오직 memory.md만** 허용.
#       모든 "방"은 디렉토리이고 내용은 memory.md에, 더 세분화하면 하위 디렉토리에 또 memory.md를 둔다.
#       ADR/lesson도 서브디렉토리 + memory.md 형태여야 함.
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

exit 0
