#!/usr/bin/env bash
# review/measure-rounds.sh — 리뷰 라운드 / 머지율 회귀 계측 (issue #1856).
#
# 사용:
#   bash scripts/review/measure-rounds.sh --since 2026-06-01
#   bash scripts/review/measure-rounds.sh --since 2026-07-25 --until 2026-07-26
#   bash scripts/review/measure-rounds.sh --since 2026-07-25 --until 2026-07-26 --round-def head-oid
#
# 출력 첫 3줄은 issue #1856 완료 조건이 지정한 계약이다:
#   rounds_per_merge=<숫자>
#   merge_rate=<숫자>%
#   merge_rate_by_files=<구간>:<분자>/<분모> ...
#
# 그 뒤로 회귀 판독에 필요한 것만 붙는다 — 정의/윈도/잘림, 두 라운드 정의의
# 동시 값, 라운드 사이 공백 분포, 일자별 시계열, 이 출력을 만든 명령.
#
# 이 스크립트는 읽기 전용이다. label 도 comment 도 달지 않는다.

set -uo pipefail

DEFAULT_REPO="Felix-LeeSM/table-view"
PAGE_SIZE=50
DEFAULT_LIMIT=1000

usage() {
	cat <<'EOF'
review/measure-rounds.sh — 리뷰 라운드 / 머지율 계측

사용:
  bash scripts/review/measure-rounds.sh --since <DATE> [옵션]

옵션:
  --since <DATE>        (필수) 윈도 시작. 포함. YYYY-MM-DD 또는 ISO-8601 Z
  --until <DATE>        윈도 끝. 제외. 기본: 제한 없음
  --round-def <DEF>     comments | head-oid. 기본 comments
  --limit <N>           스캔할 PR 상한. 기본 1000. 걸리면 truncated=yes
  --repo <OWNER/NAME>   기본 Felix-LeeSM/table-view
  --top <N>             가장 긴 라운드 공백 N건 출력. 기본 5
  --no-by-day           일자별 시계열 생략
  --dump-json <FILE>    받은 GraphQL 페이지 원본을 FILE 에 저장
  --from-json <FILE>    네트워크 대신 FILE 을 읽는다 (테스트/재현용)

윈도는 PR 의 createdAt 기준 [since, until) 이다. merge 시각이 아니다 —
"이 날 연 PR 이 어떻게 됐나" 를 묻는 지표라서 그렇다.

이 스크립트가 세는 라운드는 `round_events()` jq 함수가 계산한다. 게이트
(`.github/workflows/review-gate.yml`) 는 그 함수를 안 쓰고 웹훅 payload 의
`pull_request.comments` 를 직접 읽는다 — 자세히는 그 함수 위 주석 참고
(#1968 이 정의를 교체하려는 중이다).
EOF
}

SINCE=""
UNTIL=""
ROUND_DEF="comments"
LIMIT="$DEFAULT_LIMIT"
REPO="$DEFAULT_REPO"
TOP=5
BY_DAY=1
DUMP_JSON=""
FROM_JSON=""

while [ $# -gt 0 ]; do
	# 값을 받는 flag 가 마지막 인자로 오면 `shift 2` 가 실패하고 아무것도 안
	# 밀어서 while 이 영원히 돈다. 한 곳에서 막는다.
	case "$1" in
	--since | --until | --round-def | --limit | --repo | --top | --dump-json | --from-json)
		if [ $# -lt 2 ]; then
			echo "ERROR: $1 에 값이 없다" >&2
			exit 2
		fi
		;;
	esac

	case "$1" in
	-h | --help)
		usage
		exit 0
		;;
	--since)
		SINCE="${2:-}"
		shift 2
		;;
	--until)
		UNTIL="${2:-}"
		shift 2
		;;
	--round-def)
		ROUND_DEF="${2:-}"
		shift 2
		;;
	--limit)
		LIMIT="${2:-}"
		shift 2
		;;
	--repo)
		REPO="${2:-}"
		shift 2
		;;
	--top)
		TOP="${2:-}"
		shift 2
		;;
	--no-by-day)
		BY_DAY=0
		shift
		;;
	--dump-json)
		DUMP_JSON="${2:-}"
		shift 2
		;;
	--from-json)
		FROM_JSON="${2:-}"
		shift 2
		;;
	*)
		echo "ERROR: 모르는 인자: $1" >&2
		usage >&2
		exit 2
		;;
	esac
done

is_date() {
	printf '%s' "$1" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)?$'
}

if [ -z "$SINCE" ]; then
	echo "ERROR: --since 는 필수다" >&2
	usage >&2
	exit 2
fi
if ! is_date "$SINCE"; then
	echo "ERROR: --since 형식이 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM:SSZ 가 아니다: $SINCE" >&2
	exit 2
fi
if [ -n "$UNTIL" ] && ! is_date "$UNTIL"; then
	echo "ERROR: --until 형식이 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM:SSZ 가 아니다: $UNTIL" >&2
	exit 2
fi
case "$ROUND_DEF" in
comments | head-oid) ;;
*)
	echo "ERROR: --round-def 는 comments 또는 head-oid 여야 한다: $ROUND_DEF" >&2
	exit 2
	;;
esac
if ! printf '%s' "$LIMIT" | grep -qE '^[0-9]+$' || [ "$LIMIT" -lt 1 ]; then
	echo "ERROR: --limit 은 1 이상의 정수여야 한다: $LIMIT" >&2
	exit 2
fi
if ! printf '%s' "$TOP" | grep -qE '^[0-9]+$'; then
	echo "ERROR: --top 은 0 이상의 정수여야 한다: $TOP" >&2
	exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
	echo "ERROR: jq 가 필요하다" >&2
	exit 2
fi

# until 미지정이면 상한 없음. ISO-8601 문자열 사전순 비교라 "9999" 로 충분하다.
UNTIL_CMP="${UNTIL:-9999}"

TMPDIR_RUN="$(mktemp -d "${TMPDIR:-/tmp}/measure-rounds.XXXXXX")"
trap 'rm -rf "$TMPDIR_RUN"' EXIT
RAW="$TMPDIR_RUN/pages.json"

GQL='query($owner:String!, $name:String!, $size:Int!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(first:$size, orderBy:{field:CREATED_AT, direction:DESC}, after:$cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt mergedAt state changedFiles
        comments(first:100) { totalCount nodes { createdAt } }
        commits(last:100) { totalCount nodes { commit { oid committedDate } } }
      }
    }
  }
}'

TRUNCATED="no"
SCANNED=0

fetch_pages() {
	local owner name cursor="" page=0 out rc oldest has_next got

	owner="${REPO%%/*}"
	name="${REPO##*/}"
	if [ -z "$owner" ] || [ -z "$name" ] || [ "$owner" = "$name" ]; then
		echo "ERROR: --repo 는 OWNER/NAME 형식이어야 한다: $REPO" >&2
		return 2
	fi
	if ! command -v gh >/dev/null 2>&1; then
		echo "ERROR: gh 가 필요하다 (또는 --from-json 을 써라)" >&2
		return 2
	fi

	: >"$RAW"
	while :; do
		page=$((page + 1))
		if [ -z "$cursor" ] || [ "$cursor" = "null" ]; then
			out="$(gh api graphql -F owner="$owner" -F name="$name" -F size="$PAGE_SIZE" -f query="$GQL" 2>&1)"
			rc=$?
		else
			out="$(gh api graphql -F owner="$owner" -F name="$name" -F size="$PAGE_SIZE" -F cursor="$cursor" -f query="$GQL" 2>&1)"
			rc=$?
		fi
		if [ "$rc" -ne 0 ]; then
			echo "ERROR: gh api graphql 실패 (page=$page, rc=$rc)" >&2
			printf '%s\n' "$out" >&2
			return 1
		fi

		got="$(printf '%s' "$out" | jq -r '.data.repository.pullRequests.nodes | length' 2>/dev/null)"
		if [ -z "$got" ] || [ "$got" = "null" ]; then
			echo "ERROR: 응답에 pullRequests.nodes 가 없다 (page=$page)" >&2
			printf '%s\n' "$out" >&2
			return 1
		fi
		printf '%s\n' "$out" >>"$RAW"
		SCANNED=$((SCANNED + got))

		if [ "$got" -eq 0 ]; then
			break
		fi
		oldest="$(printf '%s' "$out" | jq -r '.data.repository.pullRequests.nodes[-1].createdAt')"
		has_next="$(printf '%s' "$out" | jq -r '.data.repository.pullRequests.pageInfo.hasNextPage')"
		cursor="$(printf '%s' "$out" | jq -r '.data.repository.pullRequests.pageInfo.endCursor')"

		# 가장 오래된 것이 이미 윈도 밖이면 더 받을 이유가 없다.
		# ISO-8601 Z 는 사전순 = 시간순이라 문자열 비교로 충분하다.
		if [[ "$oldest" < "$SINCE" ]]; then
			break
		fi
		if [ "$has_next" != "true" ]; then
			break
		fi
		# limit 에 걸렸는데 아직 윈도 안이라 = 못 본 PR 이 남았다.
		if [ "$SCANNED" -ge "$LIMIT" ]; then
			TRUNCATED="yes"
			break
		fi
	done
	return 0
}

if [ -n "$FROM_JSON" ]; then
	if [ ! -f "$FROM_JSON" ]; then
		echo "ERROR: --from-json 파일이 없다: $FROM_JSON" >&2
		exit 2
	fi
	cp "$FROM_JSON" "$RAW"
	SCANNED="$(jq -s '[.[].data.repository.pullRequests.nodes[]] | length' "$RAW" 2>/dev/null)"
	if [ -z "$SCANNED" ]; then
		echo "ERROR: --from-json 파일이 GraphQL 페이지 형식이 아니다: $FROM_JSON" >&2
		exit 2
	fi
	SOURCE_NOTE="--from-json $FROM_JSON"
else
	if ! fetch_pages; then
		exit 1
	fi
	SOURCE_NOTE="gh api graphql (repo=$REPO, page_size=$PAGE_SIZE)"
fi

if [ -n "$DUMP_JSON" ]; then
	cp "$RAW" "$DUMP_JSON" || {
		echo "ERROR: --dump-json 저장 실패: $DUMP_JSON" >&2
		exit 1
	}
fi

# ── 라운드 정의 (계측용) ─────────────────────────────────────────────────
# 이 스크립트가 내는 라운드 수는 전부 이 함수를 통과한다. 계측 코드를 더 만들지
# 말고 여기에 정의를 추가해라.
#
# 게이트는 여기를 안 지난다. `.github/workflows/review-gate.yml` 의
# `Stop at review round 3` 은 웹훅 payload 의 `pull_request.comments` 를 조건식에서
# 직접 읽는다. 즉 `comments` 정의의 집행 구현은 저 워크플로에 따로 있고, 이 파일의
# 기본값은 그 수와 같은 것을 재도록 맞춰 둔 것이다. 짝이 어긋나는지는
# `scripts/review/measure-rounds.test.sh` 의 "gate coupling" 단계가 본다 — 저 스텝의
# `if:` 표현식이 여전히 코멘트 수를 읽는지, 이 파일의 기본값이 여전히 `comments` 인지를
# 각각 단언한다. 파일 전체 grep 이 아니다 — 같은 리터럴이 에러 문구에도 있어서
# 조건식만 갈아치운 편집을 놓친다.
#
#   comments  현행 프록시. PR 코멘트 1건 = 1라운드. 위 게이트가 조건식에서 읽는
#             값과 같은 수다. 리뷰어는 라운드마다 scorecard 코멘트를 하나 남기지만
#             (memory/workflow/review/memory.md), 코멘트 작성자를 API 로 구분할 수
#             없어서 구현자 응답 / 세션 공지 / "닫는다" 코멘트까지 라운드로 센다.
#
#   head-oid  #1968 이 교체하자고 제안한 정의. 서로 다른 head 커밋에 붙은
#             리뷰 인계의 수. 같은 커밋에 코멘트가 여러 개 달리면 1라운드다.
#             근사: 코멘트 시각 이하의 마지막 커밋을 그 코멘트의 head 로 본다.
#             한계는 이 파일 하단 "못 재는 것" 주석에 적었다.
#
# #1968 이 착지해도 이 파일에서 할 일은 기본값 한 줄 교체다. 그게 전부는 아니다 —
# `review-gate.yml` 의 조건식도 같이 바꿔야 하는데 웹훅 payload 에는 head OID 별
# 집계가 없어서 조건식이 읽을 값 자체가 없다. 산정할 때 이 파일만 보지 마라.
# ─────────────────────────────────────────────────────────────────────────
# `win` 도 여기 있다. 두 번 도는 jq (건수 확인 / 본 집계) 가 같은 윈도를 봐야
# 하는데, 정의를 양쪽에 복사하면 한쪽만 고쳐지는 날이 온다.
JQ_LIB='
def round_events($def):
  (.comments.nodes | map(.createdAt) | sort) as $ts
  | if $def == "head-oid" then
      (.commits.nodes | map(.commit) | sort_by(.committedDate)) as $cs
      | [ $ts[]
          | . as $t
          | { at: $t,
              head: (([ $cs[] | select(.committedDate <= $t) ] | last | .oid) // "before-first-commit") } ]
      | group_by(.head) | map(.[0].at) | sort
    else
      $ts
    end;

def win: map(select(.createdAt >= $since and .createdAt < $until));
def selected: [.[].data.repository.pullRequests.nodes[]] | unique_by(.number) | win;
'

TOTAL="$(jq -s --arg since "$SINCE" --arg until "$UNTIL_CMP" "$JQ_LIB selected | length" "$RAW")"
if [ -z "$TOTAL" ]; then
	echo "ERROR: 입력 파싱 실패" >&2
	exit 1
fi
if [ "$TOTAL" -eq 0 ]; then
	echo "ERROR: 윈도 [$SINCE, ${UNTIL:-∞}) 안에 PR 이 0건이다 — 잘못된 윈도이지 회귀 신호가 아니다" >&2
	exit 3
fi

CMD_LINE="bash scripts/review/measure-rounds.sh --since $SINCE"
[ -n "$UNTIL" ] && CMD_LINE="$CMD_LINE --until $UNTIL"
CMD_LINE="$CMD_LINE --round-def $ROUND_DEF --limit $LIMIT --repo $REPO"
[ -n "$FROM_JSON" ] && CMD_LINE="$CMD_LINE --from-json $FROM_JSON"

jq -s -r \
	--arg since "$SINCE" \
	--arg until "$UNTIL_CMP" \
	--arg until_show "${UNTIL:-∞}" \
	--arg def "$ROUND_DEF" \
	--arg truncated "$TRUNCATED" \
	--arg scanned "$SCANNED" \
	--arg limit "$LIMIT" \
	--arg source "$SOURCE_NOTE" \
	--arg cmd "$CMD_LINE" \
	--argjson top "$TOP" \
	--argjson by_day "$BY_DAY" \
	"$JQ_LIB"'
def n2: (. * 100 | round) / 100;
def rate($num; $den): if $den == 0 then "n/a" else (($num / $den) * 1000 | round) / 10 end;
def per_merge($rounds; $merged):
  if $merged > 0 then (($rounds / $merged) | n2)
  elif $rounds > 0 then "inf"
  else 0 end;
def bucket($prs; $label; f):
  ($prs | map(select(f))) as $b
  | "\($label):\($b | map(select(.state == "MERGED")) | length)/\($b | length)";

def enrich:
  map(. + { r_comments: (round_events("comments") | length),
            r_headoid:  (round_events("head-oid")  | length),
            ev:         round_events($def) });
def summary:
  { prs:      length,
    merged:   (map(select(.state == "MERGED")) | length),
    closed:   (map(select(.state == "CLOSED")) | length),
    open:     (map(select(.state == "OPEN"))   | length),
    rounds:   (map(.ev | length) | add // 0),
    rc:       (map(.r_comments)  | add // 0),
    rh:       (map(.r_headoid)   | add // 0) };

(selected | enrich) as $p
| ($p | summary) as $s
| ([ $p[]
     | . as $pr
     | (.ev) as $e
     | range(0; (($e | length) - 1))
     | . as $i
     | { pr: $pr.number, from: $e[$i], to: $e[$i + 1],
         h: ((($e[$i + 1] | fromdateiso8601) - ($e[$i] | fromdateiso8601)) / 3600 | n2) } ]
   | sort_by(-.h)) as $gaps
| ([ $gaps[].h ] | sort) as $gh
| (($gh | length)) as $gn
| ([ $p[] | select(.comments.totalCount > 100 or .commits.totalCount > 100) | .number ]) as $nested

# ── issue #1856 완료 조건: 아래 3줄의 라벨 문자열은 계약이다 ──
| "rounds_per_merge=\(per_merge($s.rounds; $s.merged))"
, "merge_rate=\(rate($s.merged; $s.prs))%"
, "merge_rate_by_files=\(bucket($p; "0-12"; .changedFiles <= 12)) \(bucket($p; "13+"; .changedFiles >= 13))"
, ""
, "round_def=\($def)  window=[\($since), \($until_show)) by createdAt"
, "prs=\($s.prs) merged=\($s.merged) closed=\($s.closed) open=\($s.open) rounds=\($s.rounds)"
, "rounds_per_merge_by_def=comments:\(per_merge($s.rc; $s.merged)) head-oid:\(per_merge($s.rh; $s.merged))"
, "truncated=\($truncated) scanned=\($scanned) limit=\($limit) source=\($source)"
, (if ($nested | length) > 0
   then "nested_truncated=\($nested | length) PRs over the 100-comment/100-commit page: \($nested | map("#\(.)") | join(" "))"
   else "nested_truncated=0" end)
, ""

# 라운드 사이 공백. 2026-07-29 실측으로 라운드 수보다 이 값이 비용을 지배했다.
, (if $gn == 0
   then "round_gap_hours=n/a (라운드가 2 이상인 PR 이 없다)"
   else "round_gap_hours=p50:\($gh[((0.5 * $gn) | ceil) - 1]) p90:\($gh[((0.9 * $gn) | ceil) - 1]) max:\($gh[-1]) n=\($gn)" end)
, (if $top > 0 and $gn > 0
   then ([ $gaps[0:$top][]
           | "  slowest_gap #\(.pr) \(.h)h  \(.from) -> \(.to)" ] | join("\n"))
   else empty end)

, (if $by_day == 1
   then ""
      , "by_day (day  prs merged rounds rounds_per_merge merge_rate):"
      , ([ $p | group_by(.createdAt[0:10])[]
           | (summary) as $d
           | "  \(.[0].createdAt[0:10])  prs=\($d.prs) merged=\($d.merged) rounds=\($d.rounds) rounds_per_merge=\(per_merge($d.rounds; $d.merged)) merge_rate=\(rate($d.merged; $d.prs))%" ]
         | join("\n"))
   else empty end)

, ""
, "repro:"
, "  \($cmd)"
, "  원자료를 남기려면 위 명령에 --dump-json <FILE> 을 붙여라."
' "$RAW"
rc=$?
if [ "$rc" -ne 0 ]; then
	echo "ERROR: 집계 실패 (jq rc=$rc)" >&2
	exit 1
fi

exit 0

# 못 재는 것 (계측의 사각 — 값을 인용할 때 같이 인용해라):
#
# 1. blocking 집합. 라운드 3부터 리뷰어가 들어가는 회고 모드 — "개별 지적 대신
#    유형 반복 표" (memory/workflow/delivery/memory.md 노드 표) — 가 보는 유형
#    재발은 여기서 안 나온다. scorecard 가 산문이라 blocking 항목을 기계로 셀 수
#    없다. 이 스크립트는 라운드 수와 간격까지만 낸다 — 유형 판정은 리뷰어 몫이다.
# 2. 누가 쓴 코멘트인지. 이 저장소는 계정이 하나라 리뷰어 코멘트와 구현자 응답을
#    API 로 구분할 수 없다. 아래 명령의 결과가 **원소 1개** — login 이 한 종류 —
#    라는 것이 요지다. `n` 은 인용하지 마라: `first:60` 창이 새 PR 이 열릴 때마다
#    미끄러져 코멘트가 많은 뒤쪽 PR 을 떨군다 (2026-07-31 안에서만 143 → 131).
#      gh api graphql -f query='{repository(owner:"Felix-LeeSM",name:"table-view"){
#        pullRequests(first:60,orderBy:{field:CREATED_AT,direction:DESC}){nodes{
#        comments(first:50){nodes{author{login}}}}}}}' \
#        --jq '[.data.repository.pullRequests.nodes[].comments.nodes[].author.login]
#              | group_by(.) | map({login:.[0], n:length})'
#    comments 정의가 라운드를 앞지르는 이유가 이것이고, head-oid 정의는 같은
#    커밋에 달린 응답을 접어서 줄일 뿐 없애지는 못한다.
# 3. head-oid 근사의 오차. 코멘트 시각 이하의 마지막 커밋을 head 로 보는데,
#    committedDate 는 push 시각이 아니다. rebase 나 오래된 커밋을 뒤늦게 push
#    하면 코멘트가 실제와 다른 커밋에 붙는다. commits(last:100) 를 넘는 PR 은
#    앞쪽 커밋이 없어 더 틀린다 (nested_truncated 로 보고한다).
# 4. 대기의 원인. 공백이 CI 대기인지 오케스트레이터 부재인지 구분 못 한다.
#    2026-07-29 의 7시간 공백은 CI 20~25분이었으니 CI 가 아니지만, 그 판정은
#    출력이 아니라 사람이 했다.
# 5. 리뷰 없이 머지된 PR. 라운드 0 은 "리뷰가 없었다" 와 "리뷰가 필요 없었다" 를
#    구분하지 않는다.
# 6. 윈도 밖으로 흐른 PR. createdAt 으로 자르므로, 윈도 끝에 열려 있던 PR 은
#    나중에 머지돼도 그 윈도의 merge_rate 를 깎은 채로 남는다. 최근 며칠을
#    보는 창은 이 편향으로 낮은 쪽으로 치우친다.
