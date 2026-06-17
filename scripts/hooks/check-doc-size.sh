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

# UTF-8 locale 보장: wc -m 이 한국어를 문자 수로 세도록 (wc -l 은 locale 무관).
# macOS BSD wc 는 LC_ALL=C 일 때 멀티바이트를 바이트 수로 세 CI 와 불일치.
# LC_ALL 이 이미 UTF-8 계열이면 존중, 그 외(C 등)이거나 비어있으면 override 한다.
# (UTF-8 locale 이 전혀 없는 POSIX-only minimal 환경에서는 폴백이 no-op →
#  한국어 false-positive 가능. macOS / GH Actions ubuntu 는 기본 C.UTF-8 보유.)
case "${LC_ALL:-}" in
	*UTF-8*|*utf8*) ;;
	*)
		for _l in en_US.UTF-8 en_US.utf8 C.UTF-8 C.utf8; do
			# producer(locale -a)가 grep -q 의 early-close 로 SIGPIPE(141)를 받는 것을
			# 삼킨다. pipefail 하에서 producer 의 non-zero exit 이 파이프 전체를 실패로
			# 만들어, 매칭에 성공해도 폴백이永不 진입하는(LC_ALL=C 가 유지되어 wc -m 이
			# 한국어를 바이트 수로 세는) 회귀를 방지한다.
			if { locale -a 2>/dev/null || true; } | grep -qix "$_l"; then LC_ALL="$_l"; export LC_ALL; break; fi
		done
		;;
esac

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
