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
# #2330 이 파이프를 뗀 자리 중 하나가 이 워크플로의 인라인 스텝이다. 아래
# "ci.yml 인라인의 파이프 축" 단계가 읽고, env 로 갈아끼우는 이유는 위와 같다.
CI_WORKFLOW="${MEASURE_ROUNDS_CI_WORKFLOW:-$ROOT/.github/workflows/ci.yml}"

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

# 부분 문자열 판정. "있다/없다" 를 파이프라인 status 로 받던 자리를 여기로 모았다 —
# 판정이 한 군데서만 나야 다음 편집이 그 형태를 되살릴 자리가 없다. 이 파일에서 안
# 지나는 자리와 그 이유:
#   - `grep -qF … "$SCRIPT"` · `grep -cF … "$dst"` — grep 이 파일을 직접 열어
#     파이프도 writer 도 없다.
#   - `grep -nF … "$GATE_WORKFLOW" | head -1 | cut …` — 파이프이고 왼쪽이 writer
#     이지만 status 가 아니라 값을 쓴다. head 가 일찍 빠져도 판정이 안 뒤집힌다.
#
# **파이프를 쓰지 않는다.** 옛 구현 `printf '%s\n' "$OUT" | grep -qF -- "$1"` 은
# grep -q 가 첫 일치에서 stdin 을 안 비우고 빠지는 동안 왼쪽 printf 가 아직 쓸 것을
# 갖고 있으면 EPIPE → SIGPIPE 로 141 이 되고, 위 `set -o pipefail` 이 그 141 을
# 파이프라인 status 로 올려 **판정을 뒤집었다** (#2314). assert_has 는 있는 문자열을
# 못 찾은 것처럼 red 가 됐고, 부호가 반대인 assert_lacks 는 같은 141 을 "없음" =
# 통과로 등록해 조용한 거짓 green 을 냈다.
#
# `case` 패턴 안의 따옴표 친 확장은 glob 메타문자까지 리터럴이라 `grep -F` 와 뜻이
# 같고, 프로세스도 파이프도 안 만든다. 다른 점은 needle 에 개행이 있을 때뿐이다 —
# grep -F 는 줄 단위 OR, case 는 그 연속열 그대로다. 개행을 품은 needle 을 넘기려면
# 이 함수부터 다시 봐라. 회귀 가드는 아래 "assertion helpers (#2314)" 절이다.
contains() {
	case "$1" in
	*"$2"*) return 0 ;;
	*) return 1 ;;
	esac
}

assert_has() {
	if contains "$OUT" "$1"; then
		pass "$2"
	else
		fail "$2" "찾는 문자열: $1
$OUT"
	fi
}

assert_lacks() {
	if contains "$OUT" "$1"; then
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
	elif contains "$(gate_condition)" 'steps.rounds.outputs.rounds'; then
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
	elif contains "$(gate_count_step)" "$HEAD_ASSIGN_JQ" && contains "$(gate_count_step)" 'unique | length'; then
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
#   # (a) 해제 검증이 다른 label 을 본다 — 잔존 경로가 통과가 된다.
#   #     리터럴은 그 파일의 표기 그대로다 (#2330 이 파이프를 case 로 바꿨다).
#   #     작은따옴표인 이유: 큰따옴표면 셸이 ${nl} 을 먼저 먹는다.
#   perl -0pi -e 's/reflect:done\$\{nl\}/reflect:never\$\{nl\}/' \
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
	if contains "$(gate_release_condition)" 'always()'; then
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
# 아래 "assertion helpers (#2330)" 절이 쓰는 패딩. 환경 변수나 인자가 아니라 파일로
# 받는 이유: 그 payload 는 파이프 버퍼의 두 배(221183 자)이고, 인자·환경 문자열 하나의
# 길이 상한은 플랫폼마다 다르다 — Linux 의 `MAX_ARG_STRLEN` 은 32 × page size 라
# 4KiB page 에서 131072 바이트이고 CI 러너가 ubuntu-latest 다. 로컬만 보면 이 함정이
# 안 보인다: Darwin arm64 에서는 같은 221183 자 인자가 rc=0 으로 그냥 지나간다
# (`getconf ARG_MAX` 1048576, 개별 상한 없음). 파일 경로는 짧아 그 상한과 무관하다.
# `if` 로 감싸는 이유: 뒤에 붙인 `[ -n … ] && cat …` 는 빈 값일 때 rc=1 이라 스텁
# 전체가 실패로 끝나고, 그러면 위 네 케이스가 label 조회 실패 경로로 새어 나간다.
if [ -n "${STUB_LABEL_PAD:-}" ]; then
	cat "$STUB_LABEL_PAD"
fi
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

	# ── assertion helpers (#2330) ────────────────────────────────────────
	# 잔존 판정이 파이프 status 를 안 탄다는 것의 회귀 가드. 옛 형태
	# `printf '%s\n' "$labels" | grep -qxF 'reflect:done'` 로 되돌리면 여기가 red
	# 다. 부호가 「없어야 한다」라 뒤집혀도 red 를 안 남기는 자리다 — label 이
	# 남았는데 게이트가 「해제됐다」로 통과한다.
	#
	# **`-o pipefail` 을 켜서 돌린다.** 이 스텝은 `shell:` 이 없어 GitHub 이
	# `bash -e {0}` 로 돌리고 그 모드에서는 뒤집힘이 성립하지 않는다 (위 네 케이스가
	# 그 모드다). 값은 그것이 바뀌는 날에 있다 — 같은 저장소의 e2e-smoke.yml ·
	# platform-smoke-canary.yml · release.yml 이 이미 `shell: bash` 를 쓰고, 그 키가
	# 이 스텝에 붙으면 pipefail 이 같이 온다. 이 사본에서 잰 값(payload 221212 자 =
	# 아래 pad 221183 + label 두 줄, 첫 줄이 reflect:done): 옛 형태는 `bash -e -c`
	# 에서 rc=1(탐지) · `bash -e -o pipefail -c` 에서 rc=0(놓침), 새 `case` 형태는
	# 양쪽 다 rc=1.
	#
	# payload 를 파이프 버퍼(64KiB)의 두 배 위로 잡는 이유: 버퍼 언저리는 아직
	# 스케줄링 경합이라 확률로만 나타난다 (#2318 실측 8041B 0/800 · 70057B 799/800 ·
	# 200055B 800/800). 누가 줄이면 아래 두 단언이 green 이어도 아무것도 안 지키므로
	# 크기 자체를 먼저 단언한다.
	local pad='filler-line-for-issue-2330'
	while [ "${#pad}" -lt 200000 ]; do
		pad="$pad
$pad"
	done
	printf '%s\n' "$pad" >"$dir/pad.txt"

	if [ "${#pad}" -ge 131072 ]; then
		pass "SIGPIPE 가드 payload 가 파이프 버퍼(64KiB)의 두 배를 넘는다 (${#pad}, ASCII)"
	else
		fail "SIGPIPE 가드 payload 가 너무 작다: ${#pad}" \
			"131072 를 못 넘으면 결정론 구간 밖이다 — 버퍼 바로 위(70057B)는 위 실측대로 아직 확률이라 가드가 무력해진다."
	fi

	# release_case() 를 안 쓰고 펼쳐 쓴다 — 다른 것은 셸 모드 하나뿐이고 그 하나가
	# 이 단언의 전부라 호출 자리에서 보여야 한다.
	OUT="$(PATH="$dir:$PATH" GITHUB_REPOSITORY="o/r" PR=1 \
		STUB_DELETE_RC=0 STUB_LIST_RC=0 STUB_LABELS="reflect:done review:approved" \
		STUB_LABEL_PAD="$dir/pad.txt" \
		bash -e -o pipefail -c "$script" 2>&1)"
	RC=$?
	assert_rc 1 "pipefail: 파이프 버퍼보다 큰 label 목록에서도 잔존을 잡는다"
	assert_has "::error::reflect:done 해제 실패" "pipefail: 잔존이 조용한 거짓 green 이 되지 않는다"

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

# ── 인자 판정의 회귀 가드 — 자리 × 축 (#2356) ────────────────────────────
# #2330 이 파이프를 뗀 뒤 어느 자리에 어느 축이 걸렸는지가 손으로 갈렸다: 개행 축은
# `--since` · `--limit` · `--top` 에만, 로케일 축은 `--limit` 하나에만, `--until` 은
# 둘 다 없고, `is_date` 는 mutation 등록이 없었다. 자리를 손으로 들고 있으면 다음
# 자리가 또 빈다 — 그래서 **자리를 소스에서 뽑고 축은 자리마다 같은 것을 건다.**
# 아래 완전성 단언은 표와 소스가 어긋나는 순간 red 다. **그 단언이 보는 범위는
# `source_validated_pairs()` 가 인식하는 표기까지다** — 그 밖의 표기로 판정자를
# 배선하면 짝이 애초에 안 생기고, 짝이 없으면 이 절의 축이 통째로 안 걸린 채
# 스위트가 green 이다. 인식하는 표기와 못 보는 표기는 그 함수의 두 주석이 실측과
# 함께 갖는다.
#
# 축 셋. 앞의 둘은 행동으로, 파이프 축은 형태로 잡는다:
#   개행   — 여러 줄 인자는 첫 줄만 맞아도 거절한다. 옛 형태 `printf … | grep -qE`
#            는 grep 이 줄 단위라 통과시켰다. **payload 는 일부러 작다** — 뒤집힘이
#            성립하려면 첫 줄이 맞고 뒤가 더 있어야 하는데, 큰 입력의 올바른 답이
#            이미 「거절」이라 판별력이 0 이 된다 (실측은 아래 harness 문서)
#   로케일 — `case` 브래킷 범위로 옮기면 `[0-9]` 의 집합을 로케일이 정한다.
#            **로케일 이름을 박지 않는다** — 러너의 `locale -a` 에서 실제로 갈리는
#            첫 하나를 골라 그 이름을 단언 label 에 찍는다. 하나도 없으면 통과가
#            아니라 red 다. 판별력은 아래 mutation `is-*-case-range` 다
#   파이프 — 판정을 파이프라인 status 에 싣지 않는다. **자리가 하나다** — 판정자는
#            전부 matches_ere 를 지나므로(완전성 단언이 그것을 소스에서 센다) 그
#            함수 하나에 걸면 어떤 판정자도 이 축을 못 만든다
#
# 전수 열거 명령 · 크기 실측 · 로케일 실측은
# docs/contributor-guide/testing-and-quality.md 「Shell Suite Harness Quality」에 있다.
echo "arg validator axes (#2356):"

# 소스에서 (플래그, 판정자) 짝을 뽑는다. 인자 파서의 flag 절 + 값 대입과 검사부의
# `is_x "$VAR"` 를 변수 이름으로 잇는다.
#
# **인식하는 표기.** 넓힐 때 이 목록과 아래 천장 주석을 같이 고친다.
#   flag 절   `\t--flag)` 와 별칭 `\t--flag | -f)`. 별칭은 가정이 아니라 소스에 이미
#             있는 표기다 — measure-rounds.sh 의 `-h | --help)`. 대안마다 짝을 하나씩
#             내므로 긴 이름 없이 짧은 이름만 붙인 flag 도 보인다
#   값 대입   `\t\tVAR="${2:-}"` · `\t\tVAR="$2"` 와 중괄호·따옴표를 뺀 변종
#   검사      `! is_x "$VAR"` 와 부정 없는 `is_x "$VAR"`
#
# 셋 다 라운드 1 리뷰가 실측으로 뚫은 자리다 — 값 대입 `X="$2"` 도, 별칭 flag 도
# 짝을 안 만들어서 가드 없는 새 판정자가 `SUMMARY` 전량 green 으로 지나갔다.
#
# **이 추출이 못 보는 표기 (천장).** 아래 셋은 여전히 짝이 안 생겨 축이 안 걸린다.
# 넓히지 않은 이유는 형태가 아니라 이름이 없어서다 — 짝의 한쪽이 소스에 존재하지
# 않으면 무엇과 이을지가 정해지지 않는다.
#   1. 판정자 함수 없이 `case "$VAR" in` 으로 그 자리에서 판정하는 flag. 이을 함수
#      이름이 없다. measure-rounds.sh 「셸 `case` 로 안 옮긴다」주석이 이 형태를
#      산문으로 금지하고, 소스의 `--round-def` 가 지금 그 상태다
#   2. 판정자가 아예 없는 값 flag. 소스의 `--repo` · `--dump-json` · `--from-json`
#      이 그 상태이고, 이것을 red 로 만들면 head 가 그 자리들로 즉시 red 다 —
#      「값 flag 는 전부 판정자를 가진다」는 이 스크립트의 계약이 아니다
#   3. 값을 `$2` 가 아닌 경로로 받는 flag (`shift` 뒤 `$1`, getopts `$OPTARG`)
# 실측 (이 사본, head 트리): 1 과 3 을 새 flag `--sha` 로 배선하면 스위트는 rc=0 으로
# 전량 green 인데 `LC_ALL=fa_IR bash scripts/review/measure-rounds.sh … --sha '٣'` 가
# rc=0 으로 통과한다 (기대 2). 2 는 head 가 이미 그 상태다. 셋 다 조용한 green 이라
# 이 주석이 유일한 기록이다.
source_validated_pairs() {
	awk '
	/^\t-[-a-zA-Z0-9]+([ \t]*[|][ \t]*-[-a-zA-Z0-9]+)*\)$/ {
		f = $0
		sub(/^\t/, "", f); sub(/\)$/, "", f); gsub(/[ \t]*[|][ \t]*/, " ", f)
		next
	}
	f != "" && /^\t\t[A-Z_]+="?\$[{]?2(:-)?[}]?"?$/ {
		v = $0; sub(/^\t\t/, "", v); sub(/=.*$/, "", v); flagof[v] = f; f = ""; next
	}
	f != "" && /^\t\t/ { f = "" }
	{
		s = $0
		while (match(s, /is_[a-z_]+ "\$[A-Z_]+"/)) {
			t = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH)
			fn = t; sub(/ .*$/, "", fn)
			vr = t; sub(/^.*"\$/, "", vr); sub(/"$/, "", vr)
			seen[vr] = fn
		}
	}
	END {
		for (v in seen) {
			if (flagof[v] == "") continue
			n = split(flagof[v], alt, " ")
			for (i = 1; i <= n; i++) print alt[i] " " seen[v]
		}
	}
	' "$SCRIPT"
}

# 판정자의 `matches_ere` 호출 줄. 아래 mutation 이 이 줄을 통째로 옛 `case` 형태로
# 바꾼다 — 리터럴을 손으로 옮겨 적으면 패턴이 바뀌는 날 그 사본만 낡는다.
# 주석 줄을 건너뛴다: 함수 안에 `matches_ere` 를 말하는 주석이 한 줄 들어오면 그것이
# 먼저 잡혀서 mutation 대상이 실행 줄이 아니게 된다.
validator_ere_line() {
	awk -v n="$1" '$0 == n "() {" { f = 1; next }
	               f && /^\}$/ { exit }
	               f && /^[ \t]*#/ { next }
	               f && /matches_ere/ { print; exit }' "$SCRIPT"
}

# 판정자 한 줄 = 자리 한 묶음. 탭 구분 필드는 판정자 · 그 판정자가 검사하는 플래그 ·
# 정상값 · 비-ASCII 십진 표기 · 옛 `case` 브래킷 범위 형태(mutation 이 쓴다).
# 이 표를 `VAR="$(cat <<'ROWS' … )"` 로 접지 않는다 — bash 3.2 의 `$( )` 파서가
# 따옴표 친 here-doc 안의 `)` 를 세어, 그 `)` 문자를 값에서 지우고 대신 종료어
# `ROWS` 와 진짜 닫는 `)` 를 값 안으로 끌고 들어온다. **치환은 거기서 안 끝나고
# rc 도 0 이라 조용하다.** 트리거는 `case` 가 아니라 짝이 안 맞는 `)` 다 — 이
# 사본에서 잰 두 형태 (bash 3.2.57 arm64-apple-darwin25, 둘 다 rc=0):
#   `case "$1" in [0-9]) return 0 ;; esac` → `… in [0-9] return 0 ;; esac / ROWS / )`
#   `alpha beta` 와 단독 `)` 한 줄        → `alpha beta / ROWS / )`
# CI 의 bash 5 는 두 형태 다 온전하다 — 이 제약을 잡는 것은 macOS 실행뿐이다.
axis_rows() {
	cat <<'ROWS'
is_date	--since --until	2026-07-25	٢٠٢٦-٠٧-٢٥	case "$1" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) return 0 ;; *) return 1 ;; esac
is_uint	--limit --top	5	٣	case "$1" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac
ROWS
}

axis_table_pairs() {
	local fn flags valid alt form flag
	while IFS=$'\t' read -r fn flags valid alt form; do
		[ -n "$fn" ] || continue
		for flag in $flags; do printf '%s %s\n' "$flag" "$fn"; done
	done <<EOF
$(axis_rows)
EOF
}

# 표가 소스를 덮는가. 어느 쪽으로 어긋났는지가 그대로 처방이라 차집합을 양쪽 다
# 찍는다 — 소스에만 있으면 축이 안 걸린 자리이고(별칭을 새로 붙인 flag 도 여기로
# 온다), 표에만 있으면 표가 없는 자리를 가리키는 것이다.
SOURCE_PAIRS="$(sort <<<"$(source_validated_pairs)")"
TABLE_PAIRS="$(sort <<<"$(axis_table_pairs)")"
if [ -n "$SOURCE_PAIRS" ] && [ "$SOURCE_PAIRS" = "$TABLE_PAIRS" ]; then
	pass "축 표가 소스의 (플래그, 판정자) 짝을 정확히 덮는다"
else
	fail "축 표와 소스의 (플래그, 판정자) 짝이 다르다" \
		"소스에만 있다 (축이 안 걸린 자리 — axis_rows 에 그 flag 를 더해라):
$(comm -23 <(printf '%s\n' "$SOURCE_PAIRS") <(printf '%s\n' "$TABLE_PAIRS"))
표에만 있다 (소스에 없는 자리 — axis_rows 에서 그 flag 를 빼라):
$(comm -13 <(printf '%s\n' "$SOURCE_PAIRS") <(printf '%s\n' "$TABLE_PAIRS"))
소스 전체:
$SOURCE_PAIRS
표 전체:
$TABLE_PAIRS"
fi

# 두 형태가 갈리는 로케일이면 0. 없는 이름이면 setlocale 이 실패해 C 로 남고 두
# 형태 다 거절해서 1 이라, 이름이 생성돼 있는지를 따로 확인할 필요가 없다.
locale_splits_digits() {
	LC_ALL="$1" bash -c 'case "٣" in [0-9]) ;; *) exit 1 ;; esac; ! grep -qE "^[0-9]+$" <<<"٣"' 2>/dev/null
}

SPLIT_LOCALE=""
for L in $(locale -a 2>/dev/null); do
	if locale_splits_digits "$L"; then
		SPLIT_LOCALE="$L"
		break
	fi
done

if [ -z "$SPLIT_LOCALE" ]; then
	fail "두 형태가 갈리는 로케일이 이 러너에 없다 — 로케일 축의 회귀 가드가 무력하다" \
		"locale -a 어디에서도 case '٣' in [0-9]) 가 참이면서 grep -qE '^[0-9]+\$' 가 거짓이 되지 않았다."
fi

# 정상 인자를 먼저 깔고 검사할 플래그를 마지막에 다시 준다 — 파서가 덮어쓰므로
# 자리마다 동반 인자를 따로 들 필요가 없다. 판정은 파싱이 다 끝난 뒤에 돈다.
while IFS=$'\t' read -r AX_FN AX_FLAGS AX_VALID AX_ALT AX_FORM; do
	[ -n "$AX_FN" ] || continue
	for AX_FLAG in $AX_FLAGS; do
		OUT="$(bash "$SCRIPT" --from-json "$FIXTURE" --since 2026-07-25 --until 2026-07-26 \
			"$AX_FLAG" "$(printf '%s\ngarbage' "$AX_VALID")" 2>&1)"
		RC=$?
		# label 에 조사를 안 붙인다 — flag 이름이 변수라 받침이 자리마다 갈린다.
		assert_rc 2 "$AX_FLAG: 여러 줄이면 첫 줄만 맞아도 거절한다 ($AX_FN)"

		if [ -n "$SPLIT_LOCALE" ]; then
			OUT="$(LC_ALL="$SPLIT_LOCALE" bash "$SCRIPT" --from-json "$FIXTURE" \
				--since 2026-07-25 --until 2026-07-26 "$AX_FLAG" "$AX_ALT" 2>&1)"
			RC=$?
			assert_rc 2 "$AX_FLAG: 비-ASCII 십진 숫자면 거절한다 ($AX_FN, LC_ALL=$SPLIT_LOCALE)"
		fi
	done
done <<EOF
$(axis_rows)
EOF

# 파이프 축. 이 자리는 행동으로 못 잡는다 — 두 형태가 갈리려면 `grep -q` 가 입력을
# 다 읽기 전에 빠져야 하는데, 패턴이 `^…$` 앵커라 줄 끝까지 읽어야 하고 여러 줄은
# 개행 `case` 가 grep 앞에서 거절한다. 그래서 EPIPE 가 설 자리가 없다: 파이프만
# 되돌린 변조본은 이 스위트를 단언 줄까지 baseline 과 똑같이 통과했다.
# **두 형태의 답을 같게 만드는 것은 앵커가 아니라 그 개행 `case` 가드다** — 앵커만
# 믿고 가드를 지우면 파이프 축이 되살아난다. 그 사유는 산문이 아니라 아래 mutation
# `matches-ere-newline-guard` 가 잡는다.
# 천장: 판정은 그 줄에 `|` 가 있나까지이고 따옴표를 안 가린다. 지금 ERE 는 `"$2"` 로
# 오지만, 리터럴 ERE 를 그 줄에 인라인하면서 `|` 교대를 쓰면 오탐이다.
# 주석 줄을 건너뛴다: 이 함수 안에 `grep` 이 든 주석이 한 줄 들어오면 그것이 먼저
# 잡혀서, 파이프를 실제로 되살려도 이 단언이 주석을 보고 통과했다 (라운드 1 실측).
matches_ere_grep_line() {
	awk '$0 == "matches_ere() {" { f = 1; next }
	     f && /^\}$/ { exit }
	     f && /^[ \t]*#/ { next }
	     f && /grep/ { print; exit }' "$SCRIPT"
}

MATCHES_ERE_GREP="$(matches_ere_grep_line)"
if [ -z "$MATCHES_ERE_GREP" ]; then
	fail "파이프 축: matches_ere() 의 grep 줄을 못 찾았다" \
		"함수 이름이나 구조가 바뀌었다. 이 스위트의 matches_ere_grep_line() 을 같이 고쳐라."
elif contains "$MATCHES_ERE_GREP" "|"; then
	fail "파이프 축: matches_ere() 가 판정을 파이프라인 status 에 싣는다" \
		"현재 줄: $MATCHES_ERE_GREP
here-string 으로 먹여라 — pipefail 이 올릴 남의 status 가 애초에 없다."
else
	pass "파이프 축: matches_ere() 가 grep 을 파이프 없이 먹인다"
fi

# ── ci.yml 인라인의 파이프 축 (#2356) ────────────────────────────────────
# #2330 이 파이프를 뗀 자리 중 이 하나는 스크립트가 아니라 workflow 인라인이라 어느
# 가드에도 안 들어가 있었다. 위 자리들과 달리 **행동으로 갈린다** — 스텝이
# `set -euo pipefail` 을 스스로 걸고, `| head -1` 을 되돌리면 head 가 첫 줄에서
# 빠져 cargo 가 EPIPE 를 맞고 그 status 가 스텝을 죽인다.
#
# **red 를 만드는 것은 payload 크기이고, 그것을 스텁의 writer 수가 좌우한다.**
# 스텁이 writer 를 둘 쓰면(빌트인 `printf` 뒤에 `cat`) 앞 writer 가 head 를 첫
# 줄에서 빠지게 만들어 뒤 writer 가 **크기와 무관하게** EPIPE 를 맞는다. 그러면
# 아래 크기 하한 단언은 아무것도 안 지킨다 — 라운드 1 리뷰가 payload 1 바이트에서도
# 변조본 rc=141 을 실측했다. 그래서 스텁은 writer 하나로 쓰고, 크기가 red 의 원인이
# 맞는지를 아래 네 실행이 재서 남긴다:
#   큰 payload    지금 형태 rc=0 · 변조본 비영   ← 이 축의 red
#   2 줄 payload  변조본 rc=0                   ← 크기 하한이 red 를 만든다는 증거
#   `testing`     지금 형태 rc=1 · 변조본 rc=1   ← 탐지는 두 형태가 같다
# 마지막 줄이 「판별력이 탐지가 아니라 거짓 red 쪽에 있다」의 실물이다.
#
# RED 재현:
#   d="$(mktemp -d)"; git archive HEAD | tar -x -C "$d"
#   perl -0pi -e "s/\Q--format '{f}' --prefix none)\"\E/--format '{f}' --prefix none | head -1)\"/" \
#     "$d/.github/workflows/ci.yml"
#   MEASURE_ROUNDS_CI_WORKFLOW="$d/.github/workflows/ci.yml" \
#     bash scripts/review/measure-rounds.test.sh
release_graph_step() {
	awk '/- name: Test-only data-dir override stays out of the release graph/{f=1}
	     f && /^[[:space:]]*run:/{g=1; next}
	     g && NF && substr($0, 1, 10) != "          " {exit}
	     g' "$CI_WORKFLOW"
}

# 스텝 body 를 스텁 cargo 로 돌린다. 인자는 스텁 디렉토리 · 스텁이 낼 파일 · body.
# 대입문의 exit status 는 명령 치환의 것이라 `local` 로 받으면 가려진다 — 이 파일의
# OUT/RC 와 같은 이유로 전역이고, 출력도 버리지 않고 OUT 에 남긴다 (실패한 단언의
# 상세가 빈 줄이 되던 자리다).
run_release_graph() {
	OUT="$(PATH="$1:$PATH" STUB_TREE_PAD="$2" bash -c "$3" 2>&1)"
}

check_release_graph_step() {
	# check_gate_signal() 과 같은 이유로 mutation 서브런에서는 끈다 — 대상이
	# 스크립트가 아니라 저장소의 워크플로다.
	[ "${MEASURE_ROUNDS_SKIP_GATE_CHECK:-0}" = "1" ] && return 0

	echo "release-graph step pipe axis (#2356):"

	if [ ! -f "$CI_WORKFLOW" ]; then
		fail "release-graph: ci.yml 이 없다: $CI_WORKFLOW"
		return
	fi

	local body mut dir pad old new mrc
	body="$(release_graph_step)"
	if [ -z "$body" ]; then
		fail "release-graph: 'Test-only data-dir override stays out of the release graph' 스텝의 run: 블록을 못 찾았다" \
			"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 release_graph_step() 을 같이 고쳐라."
		return
	fi

	dir="$(mktemp -d "${TMPDIR:-/tmp}/release-graph.XXXXXX")"
	# trap 에 값을 박아 넣는다 — `$dir` 는 local 이라 trap 이 도는 시점엔 이미
	# 비어 있고, `rm -rf ""` 는 rc=0 으로 아무것도 안 지운 채 지웠다고 보인다.
	trap "rm -rf '$dir'" EXIT

	# 가짜 cargo. **writer 가 하나다** — 위 절 주석의 사유이고, 둘이면 아래 크기
	# 하한 단언과 2 줄 payload 단언이 둘 다 뜻을 잃는다.
	cat >"$dir/cargo" <<'STUB'
#!/usr/bin/env bash
exec cat "$STUB_TREE_PAD"
STUB
	chmod +x "$dir/cargo"

	# 첫 줄은 안전한 feature 목록이고, 뒤에 파이프 버퍼의 두 배가 붙는다.
	pad='filler-line-for-issue-2356'
	while [ "${#pad}" -lt 200000 ]; do
		pad="$pad
$pad"
	done
	printf 'default\n%s\n' "$pad" >"$dir/big.txt"
	printf 'default\nsecond-line\n' >"$dir/small.txt"
	printf 'testing\n' >"$dir/testing.txt"
	if [ "${#pad}" -ge 131072 ]; then
		pass "release-graph: EPIPE 가드 payload 가 파이프 버퍼(64KiB)의 두 배를 넘는다 (${#pad}, ASCII)"
	else
		fail "release-graph: EPIPE 가드 payload 가 너무 작다: ${#pad}" \
			"131072 를 못 넘으면 결정론 구간 밖이다 — 아래 small.txt 단언이 작은 payload 에서 두 형태가 안 갈린다는 것을 재고 있다."
	fi

	run_release_graph "$dir" "$dir/big.txt" "$body"
	RC=$?
	assert_rc 0 "release-graph: 큰 cargo 출력에서 스텝이 거짓 red 를 안 낸다"

	# 치환의 양쪽을 변수로 준다. `${body/"…"/"…"}` 처럼 안쪽에 따옴표를 직접 쓰면
	# bash 3.2 가 **치환 쪽** 따옴표를 안 떼서 변조본이 문법 오류로 죽고, 아래
	# 「비영으로 죽는다」가 그 rc=2 를 통과로 받는다 (라운드 1 실측). 셸 버전에
	# 안 기대도록 `bash -n` 으로 변조본이 파싱되는지를 먼저 본다.
	old='--prefix none)"'
	new='--prefix none | head -1)"'
	mut="${body/"$old"/$new}"
	if [ "$mut" = "$body" ]; then
		fail "release-graph: '| head -1' 재도입 치환이 no-op 이다" \
			"cargo tree 호출의 표기가 바뀌었다. 이 단언의 치환 리터럴을 같이 고쳐라."
	elif ! bash -n -c "$mut" 2>/dev/null; then
		fail "release-graph: '| head -1' 변조본이 문법 오류다 — 치환이 따옴표를 남겼다" \
			"$mut"
	else
		run_release_graph "$dir" "$dir/big.txt" "$mut"
		mrc=$?
		if [ "$mrc" -ne 0 ]; then
			pass "release-graph: '| head -1' 을 되돌리면 큰 출력이 비영으로 죽는다 (rc=$mrc)"
		else
			fail "release-graph: '| head -1' 재도입본이 rc=0 — 이 단언이 그 회귀를 못 잡는다" \
				"payload ${#pad} 자로도 EPIPE 가 안 났다."
		fi

		# 위 크기 하한이 실제로 red 를 만드는가. 2 줄이면 스텁의 유일한 writer 가
		# head 보다 먼저 다 쓰고 끝나서 두 형태가 안 갈린다 — 여기가 rc≠0 이면
		# red 의 원인이 크기가 아니라 스텁의 구조라는 뜻이다.
		run_release_graph "$dir" "$dir/small.txt" "$mut"
		RC=$?
		assert_rc 0 "release-graph: 2 줄 payload 에서는 변조본도 안 죽는다 — red 를 만드는 것은 크기다"

		# 탐지는 두 형태가 같다. 이 축의 판별력이 탐지가 아니라 거짓 red 쪽에
		# 있다는 서술을 여기서 실행으로 확인한다.
		run_release_graph "$dir" "$dir/testing.txt" "$body"
		RC=$?
		assert_rc 1 "release-graph: 첫 줄이 testing 이면 지금 형태가 스텝을 죽인다"
		run_release_graph "$dir" "$dir/testing.txt" "$mut"
		RC=$?
		assert_rc 1 "release-graph: 첫 줄이 testing 이면 '| head -1' 형태도 똑같이 죽는다"
	fi

	rm -rf "$dir"
	trap - EXIT
}
check_release_graph_step

# ── assertion helpers (#2314) ────────────────────────────────────────────
# contains() 가 파이프를 안 쓴다는 것의 회귀 가드. 옛 형태로 되돌리면 여기가 red 다.
#
# 옛 구현은 `printf '%s\n' "$OUT" | grep -qF -- "$1"` 이었다. grep -q 는 첫 일치에서
# stdin 을 안 비우고 빠지고, 왼쪽 printf 가 파이프 버퍼(64KiB)보다 큰 것을 써야 하면
# grep 이 비워 주기를 기다리며 막혔다가 이미 빠진 grep 때문에 EPIPE → SIGPIPE 로 141
# 이 된다. `set -o pipefail` 이 그 141 을 파이프라인 status 로 올려 판정을 뒤집는다.
#
# payload 를 파이프 버퍼의 두 배로 잡는 이유: 버퍼 바로 위는 아직 확률이다.
# 2026-08-12 macOS 실측 한 판(4-way 동시 × 200, 첫 줄 일치, 옛 구현,
# flip = 있는 문자열을 "없음" 으로 낸 횟수. 전부 printf 쪽 141):
#   1543B 0/800 · 8041B 0/800 · 40037B 133/800 · 70057B 799/800 ·
#   200055B 800/800 · 600043B 800/800
# 70057B 는 판마다 흔들린다 — 같은 명령이 800/800 · 791/800 · 799/800 을 냈다.
# 800/800 이 흔들리지 않은 것은 200055B 부터라 아래 하한을 131072 로 잡는다.
# 재현 명령은 PR #2318 body 「기전의 경계」절에 있다.
# 이 절은 $OUT 을 덮어쓴다 — 여기 아래에서 위 measure() 의 출력을 읽는 단언이 없다.
echo "assertion helpers (#2314):"

SIGPIPE_PAD='filler-line-for-issue-2314'
while [ "${#SIGPIPE_PAD}" -lt 200000 ]; do
	SIGPIPE_PAD="$SIGPIPE_PAD
$SIGPIPE_PAD"
done
OUT="NEEDLE-2314
$SIGPIPE_PAD"

# ① payload 가 실제로 파이프 버퍼를 넘는가. 이게 깨지면 아래 둘은 green 이어도
#    아무것도 안 지킨다 — 옛 구현이 여기서 안 죽는 크기로 줄어든 것이다.
if [ "${#OUT}" -ge 131072 ]; then
	pass "SIGPIPE 가드 payload 가 파이프 버퍼(64KiB)의 두 배를 넘는다 (${#OUT}, ASCII)"
else
	fail "SIGPIPE 가드 payload 가 너무 작다: ${#OUT}" \
		"131072 를 못 넘으면 결정론 구간 밖이다 — 버퍼 바로 위(70057B)는 위 실측대로 아직 확률이라 가드가 무력해진다."
fi

# ② assert_has — 있는 문자열을 SIGPIPE 로 놓치지 않는다. 옛 구현에서는 141 이
#    pipefail 을 타고 올라와 이 단언이 red 였다 (눈에 띄는 쪽).
assert_has "NEEDLE-2314" "assert_has: 파이프 버퍼보다 큰 출력의 첫 줄 일치를 놓치지 않는다"

# ③ assert_lacks — 있는 문자열이 조용한 거짓 통과가 되지 않는다. **이쪽이 더
#    위험하다**: 부호가 반대라 같은 141 이 "없음" = 통과로 등록되어 red 조차 안
#    남겼다. 여기서 올바른 동작은 FAIL 이라 서브셸에서 불러 출력만 본다 —
#    total/fails 증가는 서브셸과 함께 버려진다.
sigpipe_probe="$(assert_lacks "NEEDLE-2314" "probe" 2>&1)"
if contains "$sigpipe_probe" "FAIL probe"; then
	pass "assert_lacks: 파이프 버퍼보다 큰 출력에 있는 문자열을 통과로 등록하지 않는다"
else
	fail "assert_lacks: 있는 문자열이 통과로 등록됐다 — 조용한 거짓 green" \
		"assert_lacks 가 낸 것:
$sigpipe_probe"
fi

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
	# 판정자마다 옛 셸 `case` 브래킷 범위로 되돌린다 — 자리는 위 축 표에서 오고
	# 대상 줄은 소스에서 뽑으므로 판정자를 더하면 이 변형도 같이 는다. 이 변형을
	# 잡는 것은 위 로케일 축뿐이고 그 절이 고른 로케일에서만 두 형태가 갈린다 —
	# 여러 줄 인자는 양쪽 다 거절해서 개행 축은 이 변형을 못 가른다. 갈리는
	# 로케일이 없는 러너에서는 그 절이 먼저 red 를 낸다.
	while IFS=$'\t' read -r MUT_FN MUT_FLAGS MUT_VALID MUT_ALT MUT_FORM; do
		[ -n "$MUT_FN" ] || continue
		MUT_OLD="$(validator_ere_line "$MUT_FN")"
		if [ -z "$MUT_OLD" ]; then
			fail "mutation[${MUT_FN//_/-}-case-range]: $MUT_FN() 의 matches_ere 줄을 소스에서 못 찾았다"
			continue
		fi
		mutation_case "${MUT_FN//_/-}-case-range" "$MUT_OLD" "	$MUT_FORM"
	done <<EOF
$(axis_rows)
EOF

	# 파이프 재도입. 위 파이프 축 단언이 잡는다 — 행동으로는 안 갈리는 자리라
	# 이 변형이 그 단언의 판별력이다.
	mutation_case "matches-ere-pipe" \
		"	grep -qE -- \"\$2\" <<<\"\$1\"" \
		"	printf '%s' \"\$1\" | grep -qE -- \"\$2\""
	# 개행 `case` 가드. 이것이 서 있는 동안만 here-string 과 파이프의 답이 같다 —
	# 위 파이프 축 주석이 그 사유로 드는 문장을 여기서 실행으로 확인한다.
	mutation_case "matches-ere-newline-guard" \
		"	*\$'\n'*) return 1 ;;" \
		"	*\$'\n'*) : ;;"
fi

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
