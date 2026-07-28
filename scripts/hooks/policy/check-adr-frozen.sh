#!/usr/bin/env bash
# check-adr-frozen.sh
# ADR 본문 동결 정책. docs/archives/decisions/*/memory.md 의 frontmatter (--- 사이) 외
# hunk 가 staged 된 경우 차단. 새 ADR (untracked → 새로 add) 은 OK.
#
# 결정 뒤집기는: 새 ADR + frontmatter `supersedes: NNNN` + 원본 ADR 의 frontmatter
# 만 `status: Superseded`, `superseded_by: NNNN` 메타로 갱신.

set -euo pipefail

# staged ADR memory.md 파일
staged_adrs="$(git diff --cached --name-only --diff-filter=AM 2>/dev/null | grep -E "^docs/archives/decisions/[^/]+/memory\.md$" || true)"

if [ -z "$staged_adrs" ]; then
	exit 0
fi

# git ls-tree 결과 미리 캐시 — pipefail + SIGPIPE 충돌 회피
# (grep -q 가 매치 직후 stdin close → git ls-tree write 시 SIGPIPE → exit 141
#  → pipefail 켜진 상태에서 if 조건 실패로 평가됨).
tree_list="$(git ls-tree -r HEAD --name-only 2>/dev/null || true)"

violations=0
while IFS= read -r f; do
	[ -z "$f" ] && continue

	# 새 ADR (이전 commit 에 없던 파일) 은 OK. herestring 으로 pipe 회피.
	in_tree=0
	if grep -qFx "$f" <<< "$tree_list"; then
		in_tree=1
	fi
	[ "$in_tree" = "0" ] && continue

	# staged diff 추출 + frontmatter 영역 vs 본문 영역 분리.
	# frontmatter = 첫 --- 부터 두 번째 --- 까지.
	body_hunk="$(git diff --cached -- "$f" | awk '
		/^---$/ { dash_count++; next }
		/^@@/ { in_hunk = 1; next }
		!in_hunk { next }
		# diff context lines 의 frontmatter 영역 인식:
		# 본문 영역 시작 = 두 번째 --- 이후 의 +/- 줄
		# 그러나 awk 가 diff 안의 --- 카운트해야 함.
		# 단순화: diff 의 + / - 라인 중 frontmatter 영역 (파일의 처음 두 --- 사이) 인지
		# 정확히 판단하기 어렵다. fallback: + / - 라인의 *content* 가 yaml field
		# (^key: value 패턴) 이고 frontmatter 키워드 (status / superseded_by / updated)
		# 면 OK 로 간주. 그 외 본문 변경.
		/^[+-][^+-]/ {
			line = substr($0, 2)
			# frontmatter 메타 필드 허용 목록:
			if (line ~ /^(status|superseded_by|updated|review-profile|date):/) next
			# yaml frontmatter delimiter
			if (line == "---") next
			# 비어있는 줄 (편집기 noise) 허용
			if (line ~ /^[[:space:]]*$/) next
			# 그 외 = 본문 변경
			print
		}
	' 2>/dev/null)"

	if [ -n "$body_hunk" ]; then
		echo "BLOCKED: $f — ADR 본문 동결 위반." >&2
		echo "ADR 본문 (결정 / 이유 / 트레이드오프) 은 작성 순간 동결입니다." >&2
		echo "결정을 뒤집으려면:" >&2
		echo "  1) 새 ADR 추가 (frontmatter 'supersedes: NNNN')" >&2
		echo "  2) 원본 ADR 의 frontmatter 만 'status: Superseded', 'superseded_by: NNNN'" >&2
		echo "허용된 frontmatter 메타 필드: status, superseded_by, updated, review-profile, date" >&2
		echo "위반 hunk:" >&2
		echo "$body_hunk" | sed 's/^/    /' >&2
		violations=$((violations + 1))
	fi
done <<< "$staged_adrs"

if [ "$violations" -gt 0 ]; then
	exit 1
fi

exit 0
