#!/usr/bin/env bash
# check-doc-size.sh
# docs/ 지속 참조 문서의 chars 분량 cap 검사.
# 일회성 산출물은 제외한다 — agent 가 다시 읽을 일이 거의 없기 때문:
#   docs/sprints      — sprint 산출물(contract/findings/handoff), 일회성
#   docs/archives     — 과거 기록·결정 로그
#   docs/table_plus   — vendored 외부 mirror (README 가 docs.tableplus.com/llms.txt 명시)
#   docs/explorations — historical artifacts (README 가 "현재 SOT 아님" 선언)
# 남은 살아있는 참조 문서(product, contributor-guide, ROADMAP, quality, phases, docs root)만 잰다.
# memory 와 달리 줄 수 cap 은 두지 않는다 — docs 는 한 줄이 긴 것이 흔하고 분량(chars)이
# 읽기 부하의 더 나은 척도다.
# 기본: 경고만 출력 (exit 0). --strict: 초과 파일이 있으면 exit 1.
# env: DOCS_CHAR_THRESHOLD(120000).

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/locale-utf8.sh"
ensure_utf8_locale

CHAR_THRESHOLD="${DOCS_CHAR_THRESHOLD:-120000}"
STRICT=0

for arg in "$@"; do
	case "$arg" in
		--strict) STRICT=1 ;;
	esac
done

if [ ! -d "docs" ]; then
	exit 0
fi

found_over=0
while IFS= read -r -d '' file; do
	chars=$(wc -m < "$file" | tr -d ' ')
	if [ "$chars" -gt "$CHAR_THRESHOLD" ]; then
		echo "⚠️  doc size: $file (${chars} chars > ${CHAR_THRESHOLD}). 분할 또는 요약을 고려하세요."
		found_over=1
	fi
done < <(find docs \
	\( -path docs/sprints -o -path docs/archives -o -path docs/table_plus -o -path docs/explorations \) -prune \
	-o -name '*.md' -type f -print0)

if [ "$found_over" = "1" ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
