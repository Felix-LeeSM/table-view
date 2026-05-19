#!/usr/bin/env bash
# check-tdd-cycle.sh
# code profile sprint 의 RED commit 존재 확인. pre-push 의 8 stage.
#
# 동작:
#   1. 현재 branch 가 main 이면 skip (push 대상 branch 만 검사).
#   2. branch name 에서 sprint number 추출 (sprint-NNN/...).
#   3. docs/sprints/sprint-NNN/contract.md 에서 review-profile 추출.
#   4. profile != "code" 이면 skip (infra / docs / security 무관).
#   5. merge-base..HEAD 에 RED 표식 commit 없으면 fail.
#
# 환경:
#   - SKIP_TDD_CYCLE=1 으로 강제 skip 가능 (긴급 hotfix 시 사용자 명시).
#   - origin/main local ref 없으면 main local ref 로 fallback. fetch 호출 금지.

set -euo pipefail

if [ "${SKIP_TDD_CYCLE:-0}" = "1" ]; then
	echo "[check-tdd-cycle] SKIP_TDD_CYCLE=1 → skip"
	exit 0
fi

current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
	exit 0
fi

# branch name 에서 sprint number 추출. grep 0-match → exit 1; pipefail 하에서
# script 가 죽지 않도록 `|| true` 로 흡수 (sprint-* 외 branch 명, 예:
# `chore/sprint-contracts-393-395` 처럼 sprint- 다음이 비숫자, 는 skip 의도).
sprint_num="$(echo "$current_branch" | grep -oE 'sprint-[0-9]+' | head -1 | sed 's/sprint-//' || true)"
if [ -z "$sprint_num" ]; then
	# sprint branch 가 아닌 경우 skip (feature / chore 등)
	exit 0
fi

contract="docs/sprints/sprint-${sprint_num}/contract.md"
if [ ! -f "$contract" ]; then
	# contract 없으면 best-effort skip (사용자가 sprint 룰 위반이면 다른 hook 이 잡음)
	exit 0
fi

# frontmatter 에서 review-profile 추출 (yq 없이 awk 로)
profile="$(awk '
	/^---$/ { c++; next }
	c == 1 && /^review-profile:/ {
		sub(/^review-profile:[[:space:]]*/, "")
		gsub(/[[:space:]]+$/, "")
		gsub(/^"|"$/, "")
		print
		exit
	}
	c >= 2 { exit }
' "$contract")"

if [ "$profile" != "code" ]; then
	# code profile 만 RED commit 강제. infra / security / docs 는 skip.
	exit 0
fi

# base 결정 — read-only. hook 안에서 FETCH_HEAD / remote ref 를 변경하지 않는다.
base="$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || true)"
if [ -z "$base" ]; then
	# local main 계열 ref 가 없으면 best-effort skip
	exit 0
fi

# RED commit 신호: subject 에 [RED] / RED: / test.*fail
red_found=0
while IFS= read -r subject; do
	if echo "$subject" | grep -qiE '(^|[[:space:]])(\[RED\]|RED:|test:[[:space:]]*RED|test.+fail)'; then
		red_found=1
		break
	fi
done < <(git log "${base}..HEAD" --format="%s" 2>/dev/null)

if [ "$red_found" = "0" ]; then
	echo "BLOCKED: code profile sprint (${sprint_num}) 에 RED commit 없음." >&2
	echo "TDD 사이클: RED → GREEN → (Refactor). RED commit subject 표식:" >&2
	echo "  - '[RED] ...' / 'RED: ...' / 'test: RED ...' / 'test ... failing'" >&2
	echo "긴급 hotfix 면 'SKIP_TDD_CYCLE=1 git push' (사용자 명시 시 한정)." >&2
	exit 1
fi

exit 0
