#!/usr/bin/env bash
# review/measure-rounds.test.sh — scripts/review/measure-rounds.sh 회귀 스위트.
#
# 네트워크를 타지 않는다. 입력은 scripts/review/fixtures/ 의 실제 GraphQL 캡처
# 한 벌이고, 기대값은 issue #1856 의 baseline 표 그대로다.
#
# 실행:
#   bash scripts/review/measure-rounds.test.sh
#
# 배선: scripts/__tests__/measure-rounds.test.ts 가 이 파일을 실행하고, 그 래퍼를
# `vitest run` 이 집는다 (vite.config.ts 의 test.exclude 에 scripts/ 가 없다).
# CI 에서는 `Frontend Tests (shard N/3)` 잡이 그 명령을 돌린다. 이미 도는 러너에
# 붙인 것이라 워크플로를 건드리지 않았다 — 아무도 안 돌리는 스위트는 red 가 될 수
# 없다. 확인:
#   pnpm exec vitest list | grep measure-rounds
#
# 끝에 mutation 단계가 붙어 있다. 변조본을 만들어 이 스위트가 실제로 red 가
# 되는지 보고, 미변조 사본이 green 인 것(양성 대조)까지 확인한다. 변조가
# 조용히 no-op 이면 perl 이 죽는다 — 치환 대상 문자열을 못 찾으면 실패다.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# 자기 경로. mutation 단계가 자신을 다시 부르는데, 리터럴로 박아두면 파일을
# 옮겼을 때 "미변조 사본이 red" 라는 엉뚱한 실패로 나타난다.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${BASH_SOURCE[0]##*/}"
SCRIPT="${MEASURE_ROUNDS_SCRIPT:-$ROOT/scripts/review/measure-rounds.sh}"
FIXTURE="$ROOT/scripts/review/fixtures/measure-rounds-2026-07-24_27.json"
# 게이트 워크플로. 아래 "gate coupling" 단계가 읽는다. env 로 갈아끼울 수 있는
# 것은 그 단계의 RED 를 손으로 재현하기 위해서다 (MEASURE_ROUNDS_SCRIPT 와 같은
# 이유). 기본값은 저장소의 진짜 파일이다.
GATE_WORKFLOW="${MEASURE_ROUNDS_GATE_WORKFLOW:-$ROOT/.github/workflows/review-gate.yml}"

if [ ! -f "$SCRIPT" ]; then
	echo "FAIL: 대상 스크립트가 없다: $SCRIPT" >&2
	exit 1
fi
if [ ! -f "$FIXTURE" ]; then
	echo "FAIL: fixture 가 없다: $FIXTURE" >&2
	exit 1
fi

total=0
fails=0

pass() {
	total=$((total + 1))
	echo "  ok   $1"
}

fail() {
	total=$((total + 1))
	fails=$((fails + 1))
	echo "  FAIL $1" >&2
	if [ -n "${2:-}" ]; then
		printf '%s\n' "$2" | sed 's/^/         /' >&2
	fi
}

OUT=""
RC=0
measure() {
	OUT="$(bash "$SCRIPT" --from-json "$FIXTURE" "$@" 2>&1)"
	RC=$?
}

assert_rc() {
	if [ "$RC" -eq "$1" ]; then
		pass "$2 (rc=$1)"
	else
		fail "$2: rc=$RC, 기대 $1" "$OUT"
	fi
}

assert_nth_line() {
	local n="$1" want="$2" label="$3" got
	got="$(printf '%s\n' "$OUT" | sed -n "${n}p")"
	if [ "$got" = "$want" ]; then
		pass "$label"
	else
		fail "$label" "want: $want
got : $got"
	fi
}

assert_has() {
	if printf '%s\n' "$OUT" | grep -qF -- "$1"; then
		pass "$2"
	else
		fail "$2" "찾는 문자열: $1
$OUT"
	fi
}

assert_lacks() {
	if printf '%s\n' "$OUT" | grep -qF -- "$1"; then
		fail "$2" "없어야 할 문자열: $1"
	else
		pass "$2"
	fi
}

echo "measure-rounds contract:"

# ── issue #1856 완료 조건 — 라벨 문자열과 순서가 계약이다 ──
# baseline: 2026-07-25 붕괴 구간 rounds/merge 8.2, merge rate 46%.
# 그 표는 옛 기본 정의(comments)로 잰 값이라 정의를 인자로 못박는다 — #1968 이
# 기본값을 head-oid 로 옮겼고, 기본 경로는 아래 "round definition" 절이 본다.
measure --since 2026-07-25 --until 2026-07-26 --round-def comments
assert_rc 0 "baseline window exits 0"
assert_nth_line 1 "rounds_per_merge=8.17" "line1 rounds_per_merge (baseline 8.2)"
assert_nth_line 2 "merge_rate=46.2%" "line2 merge_rate (baseline 46%)"
assert_nth_line 3 "merge_rate_by_files=0-12:5/8 13+:1/5" "line3 merge_rate_by_files"

# baseline: ≥13파일 PR merge rate 4/10.
measure --since 2026-07-24 --until 2026-07-26 --round-def comments
assert_has "13+:4/10" "ge13 bucket (baseline 4/10)"
assert_nth_line 1 "rounds_per_merge=2.54" "week window rounds_per_merge"

echo "round definition (#1968):"

# 계측 쪽 두 정의는 measure-rounds.sh 의 round_events() 가 계산한다. 한 번의 실행이
# 둘 다 내므로 정의를 갈아도 이 파일에서 바뀌는 것은 기본값 한 줄이다 — 게이트 쪽
# (`review-gate.yml`) 은 별도 구현이라 별도로 바뀐다.
#
# 기본 정의는 게이트와 묶여 있다. 아래 단언들이 그 짝을 양쪽에서 고정한다 —
# 게이트가 라운드를 세는 신호가 head OID 인가 / 이 도구의 기본 정의가 그 신호인가.
# 한쪽만 움직이면 그쪽이 red 다.
measure --since 2026-07-25 --until 2026-07-26

# 게이트 쪽. 검사 범위는 두 스텝뿐이다 — `Stop at review round 3` 의 `if:` **표현식**과
# 그 표현식이 읽는 값을 만드는 `Count review rounds by head OID` 의 `run:` 블록.
# 파일 전체를 grep 하면 같은 리터럴이 사람용 주석 · 에러 문구에도 있어서, 집행
# 조건만 갈아치우고 문구를 남긴 편집을 못 잡는다.
#
# RED 재현 2종. 둘 다 이 단계에서 red 가 나야 한다:
#   d="$(mktemp -d)"; git archive HEAD | tar -x -C "$d"
#   # (a) 집행 조건의 신호만 label 로 교체하고 나머지는 남긴다
#   perl -0pi -e "s/\Q&& steps.rounds.outputs.rounds >= 3\E/\
#&& contains(github.event.pull_request.labels.*.name, 'round:3')/" \
#     "$d/.github/workflows/review-gate.yml"
#   # (b) 집행 조건 줄만 지운다
#   #     perl -ni -e 'print unless /steps.rounds.outputs.rounds >= 3/' \
#   #       "$d/.github/workflows/review-gate.yml"
#   MEASURE_ROUNDS_GATE_WORKFLOW="$d/.github/workflows/review-gate.yml" \
#     bash scripts/review/measure-rounds.test.sh
gate_condition() {
	awk '/- name: Stop at review round 3/{f=1}
	     f && /^[[:space:]]*if:/{g=1}
	     g && /^[[:space:]]*run:/{exit}
	     g' "$GATE_WORKFLOW"
}

gate_count_step() {
	awk '/- name: Count review rounds by head OID/{f=1}
	     f && /^[[:space:]]*run:/{g=1}
	     g && /^[[:space:]]*- name:/{exit}
	     g' "$GATE_WORKFLOW"
}

# 게이트와 이 스크립트가 head 를 배정하는 jq 표기. 양쪽에 같은 줄이 있어야
# "같은 것을 센다" 가 검사 가능한 문장이 된다 — 정의가 두 파일에 복제돼 있어서
# 이 단언이 유일한 drift 감시다.
HEAD_ASSIGN_JQ='(.commits.nodes | map(.commit) | sort_by(.committedDate)) as $cs'

check_gate_signal() {
	# 이 단언들만 대상이 스크립트가 아니라 저장소의 워크플로 파일이다. 그래서
	# 스크립트 변조본을 물리는 mutation 서브런에서는 끈다 — 안 그러면 게이트가
	# 바뀐 날 자식 실행이 같은 이유로 red 가 되어 양성 대조가 "harness 가 깨졌다"
	# 로 오보한다. 기본 경로(env 없음)에서는 항상 돈다.
	[ "${MEASURE_ROUNDS_SKIP_GATE_CHECK:-0}" = "1" ] && return 0

	if [ ! -f "$GATE_WORKFLOW" ]; then
		fail "gate coupling: 게이트 워크플로가 없다: $GATE_WORKFLOW"
		return
	fi

	# ① 집행 조건이 집계 스텝의 output 을 읽는가.
	if [ -z "$(gate_condition)" ]; then
		fail "gate coupling: 'Stop at review round 3' 스텝의 if: 조건을 못 찾았다" \
			"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 gate_condition() 을 같이 고쳐라."
	elif gate_condition | grep -qF 'steps.rounds.outputs.rounds'; then
		pass "게이트 집행 조건이 head-oid 라운드 수를 읽는다 (기본 round_def 의 짝)"
	else
		fail "gate coupling: 게이트 집행 조건이 라운드 집계 output 을 안 읽는다" \
			"게이트가 세는 신호가 바뀌었다. measure-rounds.sh 의 기본 ROUND_DEF 를 그 신호에 맞춰라 (#1968).
현재 조건:
$(gate_condition)"
	fi

	# ② 그 값을 만드는 스텝이 실제로 서로 다른 head OID 를 세는가. output 이름만
	#    맞고 집계가 다른 것을 세면 ①은 통과한다.
	if [ -z "$(gate_count_step)" ]; then
		fail "gate coupling: 'Count review rounds by head OID' 스텝의 run: 블록을 못 찾았다" \
			"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 gate_count_step() 을 같이 고쳐라."
	elif gate_count_step | grep -qF "$HEAD_ASSIGN_JQ" && gate_count_step | grep -qF 'unique | length'; then
		pass "게이트 집계 스텝이 서로 다른 head OID 를 센다"
	else
		fail "gate coupling: 게이트 집계 스텝이 head OID 를 세지 않는다" \
			"찾는 표기: $HEAD_ASSIGN_JQ
그리고: unique | length
현재 집계 스텝:
$(gate_count_step)"
	fi

	# ③ 그 표기가 이 스크립트의 round_events() 와 같은가. 둘이 갈라지면 게이트가
	#    막는 수와 이 도구가 보고하는 수가 달라진다.
	if grep -qF "$HEAD_ASSIGN_JQ" "$SCRIPT"; then
		pass "두 구현이 head 를 같은 표기로 배정한다"
	else
		fail "gate coupling: measure-rounds.sh 의 head 배정 표기가 게이트와 다르다" \
			"찾는 표기: $HEAD_ASSIGN_JQ"
	fi
}
check_gate_signal

# ── reflect:done 해제 (#1968) ────────────────────────────────────────────
# 새 head OID = 새 라운드이므로 `reflect:done` 도 라운드마다 다시 받아야 한다.
# 위 단계들과 달리 여기서는 스텝의 `run:` 블록을 **실제로 실행한다** — grep 만으로는
# "DELETE 는 하는데 실패를 삼킨다" 는 편집을 못 잡는다. gh 는 스텁이 가로챈다.
#
# RED 재현 3종. 각각 아래 ①~③ 중 하나를 죽인다:
#   d="$(mktemp -d)"; git archive HEAD | tar -x -C "$d"
#   # (a) 해제 검증이 다른 label 을 본다 — 잔존 경로가 통과가 된다
#   perl -0pi -e "s/grep -qxF 'reflect:done'/grep -qxF 'reflect:never'/" \
#     "$d/.github/workflows/review-gate.yml"
#   # (b) 해제 스텝의 always() 를 뗀다 — dismissal 의 exit 1 뒤라 영영 안 돈다
#   perl -0pi -e "s/\Qif: always() && github.event_name\E/if: github.event_name/" \
#     "$d/.github/workflows/review-gate.yml"
#   # (c) 두 스텝 블록의 순서를 손으로 맞바꾼다 (해제 스텝을 dismissal 앞으로)
#   #     — 그러면 해제의 exit 1 이 dismissal 을 skip 시킨다
#   MEASURE_ROUNDS_GATE_WORKFLOW="$d/.github/workflows/review-gate.yml" \
#     bash scripts/review/measure-rounds.test.sh
# 위 두 추출기와 달리 `run: |` 줄을 빼고 본문만 낸다 — 실행할 것이라서다. 다음
# 스텝의 `- name:` 앞에는 그 스텝의 주석이 먼저 오므로 이름이 아니라 들여쓰기로
# 끊는다: 블록 본문은 10칸 이상이고 스텝 주석은 6칸이다.
gate_release_step() {
	awk '/- name: Release reflect:done on a new round/{f=1}
	     f && /^[[:space:]]*run:/{g=1; next}
	     g && NF && substr($0, 1, 10) != "          " {exit}
	     g' "$GATE_WORKFLOW"
}

# 해제 스텝의 실행 조건. 본문(run:)이 아니라 `if:` 를 보는 단언이 있어서 따로 뽑는다
# — 이 스텝은 `if:` 다음이 `env:` 라 거기서 끊는다.
gate_release_condition() {
	awk '/- name: Release reflect:done on a new round/{f=1}
	     f && /^[[:space:]]*if:/{g=1}
	     g && /^[[:space:]]*env:/{exit}
	     g' "$GATE_WORKFLOW"
}

check_reflect_release() {
	# check_gate_signal() 과 같은 이유로 mutation 서브런에서는 끈다 — 대상이
	# 스크립트가 아니라 저장소의 워크플로다.
	[ "${MEASURE_ROUNDS_SKIP_GATE_CHECK:-0}" = "1" ] && return 0

	echo "reflect:done release (#1968):"

	# ① 해제 스텝이 dismissal 보다 **뒤**에 있는가. 앞에 두면 이 스텝의 exit 1 이
	#    dismissal 을 skip 시켜(뒤 스텝의 `if:` 는 암묵 `success()`) 유일한
	#    stale-approval 가드가 사라진다 — PR #2081 라운드 2 가 잡은 결함이다.
	local rel_line dis_line
	rel_line="$(grep -nF -- '- name: Release reflect:done on a new round' "$GATE_WORKFLOW" | head -1 | cut -d: -f1)"
	dis_line="$(grep -nF -- '- name: Dismiss stale approval on new commits' "$GATE_WORKFLOW" | head -1 | cut -d: -f1)"
	if [ -n "$rel_line" ] && [ -n "$dis_line" ] && [ "$dis_line" -lt "$rel_line" ]; then
		pass "해제 스텝이 dismissal(의도적 exit 1) 뒤에 있다"
	else
		fail "gate coupling: reflect:done 해제 스텝이 없거나 dismissal 앞에 있다" \
			"Release=${rel_line:-없음} Dismiss=${dis_line:-없음} — 앞에 두면 이 스텝의 exit 1 이 dismissal 을 skip 시킨다."
	fi

	# ② 그 뒤에서 실제로 도는가. dismissal 이 exit 1 한 뒤라 `always()` 가 없으면
	#    이 스텝은 영영 안 돌고 label 이 영구히 남는다. 순서만으로는 부족하다.
	if gate_release_condition | grep -qF 'always()'; then
		pass "해제 스텝이 always() 라 dismissal 의 exit 1 뒤에도 돈다"
	else
		fail "gate coupling: reflect:done 해제 스텝의 if: 에 always() 가 없다" \
			"dismissal 이 의도적으로 exit 1 하므로 always() 없이는 실행되지 않는다.
현재 조건:
$(gate_release_condition)"
	fi

	# ③ 그 스텝의 run: 블록을 실제로 돌린다. 남는 들여쓰기는 bash 가 무시한다.
	local script
	script="$(gate_release_step)"
	if [ -z "$script" ]; then
		fail "gate coupling: 'Release reflect:done on a new round' 스텝의 run: 블록을 못 찾았다" \
			"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 gate_release_step() 을 같이 고쳐라."
		return
	fi

	local dir
	dir="$(mktemp -d "${TMPDIR:-/tmp}/reflect-release.XXXXXX")"
	# 가짜 gh. `-X` 가 있으면 DELETE, 없으면 label 조회다.
	cat >"$dir/gh" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do
	[ "$a" = "-X" ] && exit "${STUB_DELETE_RC:-0}"
done
[ "${STUB_LIST_RC:-0}" = 0 ] || exit "$STUB_LIST_RC"
printf '%s\n' $STUB_LABELS
STUB
	chmod +x "$dir/gh"

	release_case() {
		OUT="$(PATH="$dir:$PATH" GITHUB_REPOSITORY="o/r" PR=1 \
			STUB_DELETE_RC="$1" STUB_LIST_RC="$2" STUB_LABELS="$3" \
			bash -e -c "$script" 2>&1)"
		RC=$?
	}

	# 라벨 있음 — DELETE 성공, 재조회에 없다.
	release_case 0 0 "review:approved"
	assert_rc 0 "해제: 붙어 있던 reflect:done 을 뗀다"
	assert_has "::notice::reflect:done released" "해제 성공을 로그에 남긴다"

	# 라벨 없음 — DELETE 가 404 로 실패해도 결과는 같으니 통과다.
	release_case 1 0 "review:approved"
	assert_rc 0 "해제: 애초에 안 붙어 있으면 404 를 실패로 보지 않는다"

	# API 실패 — 재조회가 죽으면 남았는지 알 수 없다. 통과로 강등하지 않는다.
	release_case 0 1 ""
	assert_rc 1 "fail-closed: label 조회 실패는 통과가 아니다"
	assert_has "::error::reflect:done 해제를 확인하지 못했다" "조회 실패를 에러로 찍는다"

	# 해제 실패 — DELETE 는 0 인데 label 이 남았다. 여기서 안 막으면 다음 라운드가
	# 사용자 승인 없이 게이트를 통과한다.
	release_case 0 0 "reflect:done review:approved"
	assert_rc 1 "fail-closed: label 이 남으면 실패다"
	assert_has "::error::reflect:done 해제 실패" "잔존을 에러로 찍는다"

	rm -rf "$dir"
}
# 호출은 아래 "도구 쪽 짝" 뒤다 — release_case() 가 공용 OUT/RC 를 덮어쓰는데,
# 그 단언들은 위 measure() 가 남긴 OUT 을 아직 읽는다.

# 도구 쪽 짝. 변조본에도 적용된다 — 기본값을 뒤집는 편집은 여기서 죽는다.
assert_has "round_def=head-oid" "기본 라운드 정의가 head-oid"
assert_nth_line 1 "rounds_per_merge=5.5" "기본 정의는 같은 커밋의 코멘트를 접는다"
assert_has "rounds=33" "head-oid 라운드 합 (comments 49 대비 16 감소)"
assert_has "rounds_per_merge_by_def=comments:8.17 head-oid:5.5" "head-oid 모드가 두 정의를 다 낸다"

measure --since 2026-07-25 --until 2026-07-26 --round-def comments
assert_nth_line 1 "rounds_per_merge=8.17" "옛 정의는 플래그로 계속 잴 수 있다"
assert_has "round_def=comments" "round_def label follows the flag"
assert_has "rounds_per_merge_by_def=comments:8.17 head-oid:5.5" "comments 모드도 두 정의를 다 낸다"

check_reflect_release

echo "window:"

measure --since 2026-07-25 --until 2026-07-26
assert_has "prs=13 merged=6 closed=7 open=0 rounds=33" "until 은 제외 경계"
measure --since 2026-07-25 --until 2026-07-27
assert_has "prs=28" "until 을 하루 늘리면 07-26 이 들어온다"
measure --since 2026-07-24 --until 2026-07-25
assert_has "prs=36" "since 는 포함 경계"
measure --since 2026-07-25 --until 2026-07-26 --limit 7
assert_has "limit=7" "limit 값이 출력에 남는다"
assert_has "truncated=no" "잘림 여부를 출력에 적는다"
assert_has "nested_truncated=0" "코멘트/커밋 100건 페이지 잘림도 보고한다"

echo "round gap:"

# 2026-07-29 실측 — 라운드 수보다 라운드 사이 공백이 비용을 지배했다.
measure --since 2026-07-25 --until 2026-07-26
assert_has "round_gap_hours=p50:5.4 p90:36.78 max:48.81 n=20" "공백 분포"
assert_nth_line 12 "  slowest_gap #1800 48.81h  2026-07-25T03:58:04Z -> 2026-07-27T04:46:31Z" "가장 긴 공백이 맨 위"
assert_nth_line 13 "  slowest_gap #1825 36.88h  2026-07-25T15:54:05Z -> 2026-07-27T04:46:38Z" "두 번째로 긴 공백이 그다음"
measure --since 2026-07-25 --until 2026-07-26 --top 0
assert_lacks "slowest_gap" "--top 0 은 목록을 끈다"

echo "series and repro:"

measure --since 2026-07-24 --until 2026-07-27
assert_has "  2026-07-25  prs=13 merged=6 rounds=33 rounds_per_merge=5.5 merge_rate=46.2%" "일자별 시계열이 붕괴일을 드러낸다"
assert_has "  2026-07-24  prs=36 merged=33 rounds=44 rounds_per_merge=1.33 merge_rate=91.7%" "정상일도 같은 줄 형식"
measure --since 2026-07-24 --until 2026-07-27 --no-by-day
assert_lacks "by_day" "--no-by-day"
measure --since 2026-07-25 --until 2026-07-26
assert_has "  bash scripts/review/measure-rounds.sh --since 2026-07-25 --until 2026-07-26 --round-def head-oid" "출력이 자기 재현 명령을 포함한다"

echo "errors:"

OUT="$(bash "$SCRIPT" --from-json "$FIXTURE" 2>&1)"
RC=$?
assert_rc 2 "--since 누락"
OUT="$(bash "$SCRIPT" --since 20260725 --from-json "$FIXTURE" 2>&1)"
RC=$?
assert_rc 2 "--since 형식 오류"
OUT="$(bash "$SCRIPT" --since 2026-07-25 --round-def rounds --from-json "$FIXTURE" 2>&1)"
RC=$?
assert_rc 2 "--round-def 오타"
OUT="$(bash "$SCRIPT" --since 2026-01-01 --until 2026-01-02 --from-json "$FIXTURE" 2>&1)"
RC=$?
assert_rc 3 "빈 윈도는 0 이 아니라 오류"
OUT="$(bash "$SCRIPT" --since 2026-07-25 --from-json "$ROOT/scripts/review/does-not-exist.json" 2>&1)"
RC=$?
assert_rc 2 "--from-json 파일 없음"
# 값 없는 flag 가 마지막 인자일 때. `shift 2` 가 실패하면 while 이 영원히 돈다 —
# 이 케이스가 red 가 아니라 hang 으로 나타나면 그게 회귀 신호다.
OUT="$(bash "$SCRIPT" --from-json "$FIXTURE" --since 2>&1)"
RC=$?
assert_rc 2 "값 없는 --since 가 마지막 인자"
OUT="$(bash "$SCRIPT" --since 2026-07-25 --until 2026-07-26 --from-json "$FIXTURE" --top 2>&1)"
RC=$?
assert_rc 2 "값 없는 --top 이 마지막 인자"
OUT="$(bash "$SCRIPT" --since 2026-07-25 --wat 2>&1)"
RC=$?
assert_rc 2 "모르는 인자"

# ── mutation — 이 스위트가 실제로 잡는지 ─────────────────────────────────
# 변조본을 만들고, 그 변조가 파일에 착지했는지 확인한 뒤, 같은 스위트를 변조본에
# 물려 red 가 되는지 본다. 양성 대조(미변조 사본)가 green 이어야 결과가 의미를
# 가진다 — 대조가 red 면 harness 자체가 깨진 것이다.
if [ "${MEASURE_ROUNDS_SKIP_MUTATION:-0}" != "1" ]; then
	echo "mutation:"
	MUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/measure-rounds-mut.XXXXXX")"
	trap 'rm -rf "$MUT_DIR"' EXIT

	# 리터럴 치환. 정규식이 아니라 index/substr 이라 메타문자 이스케이프 문제가
	# 없고, 대상이 없으면 죽는다 — 조용한 no-op 이 불가능하다.
	write_mutant() {
		local dst="$1" old="$2" new="$3"
		perl -e '
			my ($src, $o, $n) = @ARGV;
			open my $fh, "<", $src or die "open: $!\n";
			local $/;
			my $t = <$fh>;
			close $fh;
			my $i = index($t, $o);
			die "MUTATION TARGET NOT FOUND\n" if $i < 0;
			my $j = index($t, $o, $i + length($o));
			die "MUTATION TARGET NOT UNIQUE\n" if $j >= 0;
			substr($t, $i, length($o), $n);
			print $t;
		' "$SCRIPT" "$old" "$new" >"$dst"
	}

	# 서브런 출력. 버리면 양성 대조가 red 일 때 "harness 가 깨졌다" 한 줄만 남고
	# 어느 단언이 깨졌는지가 사라진다 — issue #2085 의 shard flake 가 정확히 그
	# 상태로 진단 불가였다. 변조 6종의 red 는 기대된 결과라 안 찍는다.
	SUB_OUT=""
	run_suite_against() {
		# `MEASURE_ROUNDS_SKIP_GATE_CHECK=1` — 자식 실행이 판정하는 것은 변조된
		# 스크립트이지 저장소의 워크플로가 아니다. 켜 두면 게이트가 바뀐 날
		# 양성 대조와 변조 6종이 전부 같은 이유로 red 가 되어 결과가 무의미해진다.
		#
		# 대입문의 exit status 는 명령 치환의 것이다 — `local` 로 받으면 `local`
		# 의 0 에 가려지므로 전역이다 (이 파일의 OUT/RC 와 같은 이유).
		SUB_OUT="$(MEASURE_ROUNDS_SCRIPT="$1" MEASURE_ROUNDS_SKIP_MUTATION=1 \
			MEASURE_ROUNDS_SKIP_GATE_CHECK=1 bash "$SELF" 2>&1)"
	}

	# 양성 대조.
	cp "$SCRIPT" "$MUT_DIR/control.sh"
	if diff -q "$SCRIPT" "$MUT_DIR/control.sh" >/dev/null 2>&1; then
		if run_suite_against "$MUT_DIR/control.sh"; then
			pass "positive control: 미변조 사본은 green"
		else
			fail "positive control: 미변조 사본이 red — harness 가 깨졌다" \
				"$SUB_OUT"
		fi
	else
		fail "positive control: 사본이 원본과 다르다"
	fi

	mutation_case() {
		local name="$1" old="$2" new="$3"
		local dst="$MUT_DIR/mutant.sh"
		rm -f "$dst"
		if ! write_mutant "$dst" "$old" "$new"; then
			fail "mutation[$name]: 치환 실패 (대상 없음/중복)"
			return
		fi
		# 착지 확인 — 새 리터럴이 실제로 들어갔고 파일이 원본과 다르다.
		if [ "$(grep -cF -- "$new" "$dst")" -lt 1 ]; then
			fail "mutation[$name]: 새 리터럴이 파일에 없다 — 치환이 no-op 이다"
			return
		fi
		if diff -q "$SCRIPT" "$dst" >/dev/null 2>&1; then
			fail "mutation[$name]: 변조본이 원본과 동일하다 — 치환이 no-op 이다"
			return
		fi
		if run_suite_against "$dst"; then
			fail "mutation[$name]: 변조본이 green — 이 스위트가 그 회귀를 못 잡는다"
		else
			pass "mutation[$name] 이 red 가 된다"
		fi
	}

	mutation_case "files-bucket-boundary" \
		'bucket($p; "0-12"; .changedFiles <= 12)' \
		'bucket($p; "0-12"; .changedFiles <= 13)'
	mutation_case "merged-count" \
		'merged:   (map(select(.state == "MERGED")) | length),' \
		'merged:   (map(select(.state != "MERGED")) | length),'
	mutation_case "head-oid-dedupe" \
		'| group_by(.head) | map(.[0].at) | sort' \
		'| map(.at) | sort'
	mutation_case "gap-ordering" \
		'| sort_by(-.h)) as $gaps' \
		'| sort_by(.h)) as $gaps'
	mutation_case "window-upper-bound" \
		'def win: map(select(.createdAt >= $since and .createdAt < $until));' \
		'def win: map(select(.createdAt >= $since));'
	mutation_case "round-events-comment-source" \
		'(.comments.nodes | map(.createdAt) | sort) as $ts' \
		'(.commits.nodes | map(.commit.committedDate) | sort) as $ts'
fi

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
