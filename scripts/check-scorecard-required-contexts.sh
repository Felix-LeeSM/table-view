#!/usr/bin/env bash
# check-scorecard-required-contexts.sh — scorecard 가 non-SUCCESS required context 의
# 이름을 싣는지 대조한다 (issue #2443).
#
# PR #2415 의 리뷰 라운드 셋이 「`review-gate` 만 fail, 나머지 required 전부 pass」라고
# 적었는데 실제로는 `Runtime Happy Path` 가 첫 push 부터 세 head 전부 red 였다. 리뷰어
# 셋이 독립적으로 같은 자리에서 틀렸으므로 개인 실수가 아니라 scorecard 형식 틀의
# 빈자리다 — required 를 이름으로 열거하는 자리가 없어서 「전부 pass」라는 전칭이 그
# 집합을 아무도 열거하지 않은 채 통과했다. 이 스크립트는 그 빈자리를 기계로 대조한다:
# **rollup 에 non-SUCCESS 인 required context 가 있는데 그 이름이 scorecard 본문
# 어디에도 없으면 red 다.** 슬롯 쪽 계약은 .agents/prompts/pr-review.md 「반환 형식」의
# 「자동 layer: required context 대조」가 갖는다.
#
# ## 무엇을 대조하는가 — 이 주석이 판정을 정의한다
#
#   required  = <MEMORY_FILE> 의 `<!-- ci-gates:required-contexts -->` 마커 쌍 안에서
#               「`- ` + backtick 이름 하나 + backtick」으로만 이뤄진 줄. 한 줄에 하나.
#               마커 쌍의 SOT 는 memory/runbook/pr-merge-gates/memory.md 다 — 이름을
#               이 파일로 복제하지 않는다. 목록이 바뀔 때 두 벌이 갈리기 때문이다.
#               이력 서술 줄은 그 형태가 아니라서 섞여 들지 않는다 — `Detect Change
#               Scope` 는 2026-07-31 에 제거됐는데, 그 이력 줄에 남은 backtick 이름이
#               required 로 읽히는 오판이 이 규칙이 막는 것이다.
#   rollup    = <ROLLUP_JSON_FILE> — `statusCheckRollup` **배열** 그 자체다. workflow
#               스텝이 `gh pr view --json statusCheckRollup -q .statusCheckRollup` 로
#               떼어 넘기는 그 값. 항목 이름은 `.name`(CheckRun) 아니면
#               `.context`(StatusContext)이고, 결론은 `.conclusion` 아니면 `.state` 다.
#               둘 다 없으면(아직 끝나지 않은 CheckRun) `PENDING` 으로 읽는다.
#               **non-SUCCESS = 결론이 정확히 `SUCCESS` 가 아니다** — FAILURE ·
#               TIMED_OUT · CANCELLED · ERROR 뿐 아니라 결론이 아직 없는 것도 이름
#               대조 대상이다.
#   scorecard = <SCORECARD_FILE...> 각 파일의 본문 전부. 이름이 어느 절에 앉는지는
#               안 본다 — 부분 일치로 본문 어디든 있으면 싣은 것이다.
#
#   위반 = required 이름인데 rollup 결론이 non-SUCCESS 이고, 그 이름이 그 어느
#          scorecard 본문에도 없다. rollup 에 그 이름이 아예 없으면(아직 보고 안 함)
#          대조할 결론이 없으므로 위반이 아니다 — 그 상태는 ruleset 이 이미 BLOCKED
#          로 막는다.
#
#   **`review-gate` 자신은 이 대조에 안 들어간다.** required 집합이 위 마커 블록
#   (ruleset `pr_to_main`)이라 legacy branch protection 쪽 `review-gate` 는 집합
#   밖이다. verdict label 이 붙기 전엔 `review-gate` 가 언제나 non-SUCCESS 이므로
#   집합에 넣으면 모든 라운드 1 이 red 가 된다 — 목록을 블록에서 읽는 것이 그 이름을
#   가르는 유일한 근거이고, 별도 제외 규칙은 없다.
#
# ## 빈 입력과 못 읽은 입력은 검사 불성립이다 (exit 2)
#
#   마커 쌍이 성립하지 않거나, 쌍 안에서 이름을 하나도 못 읽거나, rollup 이 배열이
#   아니거나 JSON 이 아니거나, 이름 없는 scorecard 파일(없는 경로 · 빈 파일)을
#   받으면 끊는다. 이 상태를 「위반 0」으로 읽으면 목록이 옮겨지거나 payload 모양이
#   바뀌는 날 게이트가 아무것도 안 재면서 green 이 된다 —
#   scripts/check-ci-test-calls.sh 의 「0 개를 위반 0 으로 통과시키지 않는다」와 같은
#   판정이다.
#
#   **scorecard 파일 0 개는 위반이 아니라 통과다.** opened / synchronize 처럼 아직
#   리뷰가 안 붙은 이벤트에서도 집행 스텝이 돌고, 그때 "scorecard 가 없다" 는 못 잰
#   것이 아니라 참이다 — scripts/check-review-size-cap.sh 의 「0 장은 통과다」와 같은
#   판정이고, 집행 스텝이 `## Scorecard` 로 시작하는 코멘트만 골라 넘기는 것도 같다.
#
# 사용:
#   bash scripts/check-scorecard-required-contexts.sh <MEMORY_FILE> <ROLLUP_JSON_FILE> [SCORECARD_FILE ...]
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

set -uo pipefail

# 위반 이름과 집계 줄의 순서를 고정한다 — collation 이 로케일마다 달라서 같은 입력이
# 환경에 따라 다른 출력을 내는 것을 막는다 (scripts/check-ci-test-calls.sh 와 같은 사유).
export LC_ALL=C

if [ "$#" -lt 2 ]; then
	echo "FAIL 검사 불성립: 인자가 모자라다 — 사용: bash $0 <MEMORY_FILE> <ROLLUP_JSON_FILE> [SCORECARD_FILE ...]" >&2
	exit 2
fi
mem="$1"
rollup="$2"
shift 2

required_n="?"
non_success_n="?"
missing_n=0
sheets="?"
list_label="미측정"

summary() {
	printf 'required %s 종 — rollup non-SUCCESS %s 종, scorecard %s 장, 이름 없는 required %s 종 (목록: %s)' \
		"$required_n" "$non_success_n" "$sheets" "$missing_n" "$list_label"
}

fail() { # $1 required 이름, $2 rollup 결론
	echo "FAIL $1: rollup 결론이 $2 인데 이름이 그 어느 scorecard 에도 없다" >&2
	missing_n=$((missing_n + 1))
}

die() {
	echo "FAIL 검사 불성립: $1" >&2
	echo "집계: $(summary)" >&2
	echo "::error::scorecard required 이름 대조가 성립하지 않았다 (위 FAIL 줄): $1" >&2
	exit 2
}

for f in "$mem" "$rollup"; do
	[ -f "$f" ] || die "검사할 파일이 없다: $f"
done
list_label="$mem"

# 마커 쌍이 1 쌍이어야 그 사이가 「목록」이라고 말할 수 있다. awk 는 이름 줄만 stdout 에
# 내고 구조가 어긋나면 rc 3 으로 나간다 — rc 를 버리면 옮겨진 블록을 「빈 목록」으로
# 읽게 되고, 그때 나가야 하는 답은 위반 대조가 아니라 검사 불성립이다.
if ! names="$(awk '
	/<!--[[:space:]]*ci-gates:required-contexts[[:space:]]*-->/ { if (inside) exit 3; inside = 1; next }
	/<!--[[:space:]]*\/ci-gates[[:space:]]*-->/ { if (!inside) exit 3; inside = 0; next }
	inside && /^[[:space:]]*-[[:space:]]*`[^`]+`[[:space:]]*$/ {
		line = $0
		sub(/^[[:space:]]*-[[:space:]]*`/, "", line)
		sub(/`[[:space:]]*$/, "", line)
		print line
	}
	END { if (inside) exit 3 }
' "$mem")"; then
	die "required context 마커 쌍이 1 쌍으로 성립하지 않는다: $mem"
fi

names="$(printf '%s\n' "$names" | sort -u)"
required_n="$(printf '%s\n' "$names" | grep -c '.')"
[ "${required_n:-0}" -ge 1 ] ||
	die "마커 쌍 안에서 required context 이름을 하나도 못 읽었다 — 목록 형태가 바뀌었다: $mem"

# rollup 은 배열이어야 한다. `gh pr view --json statusCheckRollup` 의 통째 출력(오브젝트)을
# 넘기면 jq 가 값을 훑어 빈 이름 행을 내고, 그 대조는 아무것도 안 재고 green 이 된다 —
# 스텝이 `.statusCheckRollup` 을 뗐는지를 여기서 받는다.
if ! type="$(jq -r 'type' "$rollup" 2>/dev/null)"; then
	die "rollup JSON 을 못 읽었다: $rollup"
fi
[ "$type" = "array" ] || die "rollup 파일이 배열이 아니다 (type=$type) — .statusCheckRollup 을 떼서 넘겨라: $rollup"
if ! rows="$(jq -r '.[] | [(.name // .context // ""), ((.conclusion // .state) // "PENDING")] | @tsv' "$rollup" 2>/dev/null)"; then
	die "rollup JSON 의 항목을 못 읽었다: $rollup"
fi

bodies=""
sheets=0
for f in "$@"; do
	[ -f "$f" ] || die "scorecard 파일이 없다: $f"
	if ! body="$(tr -d '\r' <"$f")"; then
		die "scorecard 파일을 못 읽었다: $f"
	fi
	[ -n "$body" ] || die "scorecard 파일이 비어 있다: $f"
	bodies="${bodies}${body}"
	bodies="$bodies
"
	sheets=$((sheets + 1))
done

# scorecard 0 장은 위반이 아니라 「아직 리뷰가 없다」다 — 위 헤더. 그래도 non-SUCCESS
# 집계는 세서 집계 줄이 무엇을 못 본 건지를 말하게 둔다. 검사 불성립이 아니라 하중
# 부재라 rc 0 이다.
non_success_n=0
while IFS= read -r name; do
	[ -n "$name" ] || continue
	# 같은 이름의 항목이 rollup 에 둘 이상 쌓여 있으면(두 suite · CheckRun 과 StatusContext
	# 공존) non-SUCCESS 쪽 하나만 보면 된다 — 이름이 없다는 위반은 결론별로 갈라지지 않는다.
	state="$(printf '%s\n' "$rows" | awk -F'\t' -v n="$name" '$1 == n && $2 != "SUCCESS" { print $2; exit }')"
	[ -n "$state" ] || continue
	non_success_n=$((non_success_n + 1))
	[ "$sheets" -ge 1 ] || continue
	# 부분 일치는 fork 없이 case 로 본다 — 이름이 목록에 몇 개 늘어도 subprocess 가 안 는다
	# (scripts/check-ci-test-calls.sh 의 has() 와 같은 형태).
	case "$bodies" in
	*"$name"*) ;;
	*) fail "$name" "$state" ;;
	esac
done <<<"$names"

if [ "$sheets" -eq 0 ]; then
	echo "ok: $(summary) — 리뷰가 아직 없다 (opened / synchronize)"
	exit 0
fi

if [ "$missing_n" -gt 0 ]; then
	echo "집계: $(summary)" >&2
	echo "::error::scorecard 가 non-SUCCESS required context 의 이름을 안 적었다 ($missing_n 종, 위 FAIL 줄). 그 이름을 scorecard 코멘트에 적고 이 job 을 re-run 해라 — 이 스텝은 코멘트를 API 로 다시 읽으므로 새 commit 없이 풀린다. 슬롯 형식은 .agents/prompts/pr-review.md 「반환 형식」의 「자동 layer: required context 대조」 (issue #2443)." >&2
	exit 1
fi

echo "ok: $(summary)"
