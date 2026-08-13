#!/usr/bin/env bash
# release/verify-tag-ci.test.sh — release.yml 의 `verify-tag-ci` 게이트 회귀 스위트 (#2168).
#
# 네트워크를 타지 않는다. 대상은 저장소의 진짜 워크플로 파일이고, GitHub API 는
# PATH 앞에 놓는 `gh` 스텁이 가로챈다.
#
# 실행:
#   bash scripts/release/verify-tag-ci.test.sh
#
# 배선: scripts/__tests__/verify-tag-ci.test.ts 가 이 파일을 실행하고, 그 래퍼를
# `vitest run` 이 집는다 (vite.config.ts 의 test.exclude 에 scripts/ 가 없다).
# CI 에서는 `Frontend Tests (shard N/3)` 잡이 그 명령을 돌린다. 이미 도는 러너에
# 붙인 것이라 워크플로를 안 건드렸다 — 아무도 안 돌리는 스위트는 red 가 될 수 없다.
# 확인:
#   pnpm exec vitest list | grep verify-tag-ci
#
# 검사 대상은 네 가지다:
#   ① release.yml 에 태그 SHA 의 check-runs 를 검증하는 job 이 있다
#   ② 그 job 이 실패하면 릴리스 run 이 red 로 끝난다 (needs:/if: 커플링,
#      continue-on-error 부재)
#   ③ versioning-and-artifacts.md 의 보증 문구가 그 job 을 가리킨다
#   ④ mutation — 게이트를 무력화하는 편집을 실제로 만들어 ①~③ 이 red 가 되는지,
#      그리고 어느 단언이 그 red 를 내는지. 양성 대조(미변조 사본)도 같이 돈다
#
# ②는 스텝 이름 존재 확인으로 끝내지 않는다. 워크플로에서 `run:` 블록을 그대로
# 뽑아 **실행**한다 — grep 만으로는 "실패를 찍기는 하는데 exit 0 으로 강등한다" 는
# 편집을 못 잡는다. 게이트 로직을 `--jq` 가 아니라 shell 에 둔 것이 이 때문이다.
#
# ④의 변조는 커밋된 픽스처(scripts/release/fixtures/release-verify-tag-ci-job.txt)
# 를 고쳐 만들고, 고친 결과를 job 자리에 통째로 끼워 넣는다. 픽스처가 저장소의
# job 과 바이트 동일한지를 먼저 대조하므로 변조의 근거가 낡으면 그 자리에서 멈춘다
# (#2180). 이전 판은 앵커에서 리터럴까지를 `.*?` 로 잡는 정규식 span 이었고, 그
# 리터럴을 언급하는 주석 한 줄이 span 끝을 가로채 변조가 조용한 no-op 이 됐다.
#
# 태그 스텝을 픽스처에 고정하는 같은 형태가
# scripts/release/cargo-package-version.test.sh 에 있다 (#2175).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# 자기 경로. mutation 단계가 변조본을 물려 자신을 다시 부른다 — 리터럴로 박으면
# 파일을 옮겼을 때 "미변조 사본이 red" 라는 엉뚱한 실패로 나타난다.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${BASH_SOURCE[0]##*/}"
# env 로 갈아끼울 수 있는 것은 이 스위트의 RED 를 손으로 재현하기 위해서다
# (measure-rounds.test.sh 의 MEASURE_ROUNDS_GATE_WORKFLOW 와 같은 이유).
# 기본값은 저장소의 진짜 파일이다. mutation 단계도 이 두 변수로 변조본을 물린다.
RELEASE_WORKFLOW="${VERIFY_TAG_CI_RELEASE_WORKFLOW:-$ROOT/.github/workflows/release.yml}"
AUTOTAG_WORKFLOW="${VERIFY_TAG_CI_AUTOTAG_WORKFLOW:-$ROOT/.github/workflows/auto-tag-release.yml}"
RELEASE_DOC="${VERIFY_TAG_CI_DOC:-$ROOT/docs/contributor-guide/release/versioning-and-artifacts.md}"

JOB_KEY="verify-tag-ci"
JOB_NAME="Verify tag SHA CI is green"
STEP_NAME="Fail the release run when the tagged SHA has failing non-advisory checks"
# 문서가 그대로 들고 있어야 하는 보증 문구. 아래 단언과 mutation 이 같은 문자열을
# 쓴다 — 손으로 두 번 적으면 문구를 고친 날 한쪽만 낡는다.
DOC_GUARANTEE='The tag must also point to a `main` commit SHA that passed the Pre-Release'

# 게이트 job 의 기대본. mutation 단계가 이 파일과 바이트로 대조하고, 변조는 이
# 파일의 텍스트를 고쳐 만든다. 갱신 명령은 실패 메시지가 그대로 찍는다.
GATE_JOB_FIXTURE="$ROOT/scripts/release/fixtures/release-verify-tag-ci-job.txt"
GATE_JOB_UPDATE_CMD="bash scripts/release/verify-tag-ci.test.sh --print-gate-job > scripts/release/fixtures/release-verify-tag-ci-job.txt"
GATE_JOB_PIN_FAIL="mutation: 게이트 job 이 커밋된 픽스처와 바이트로 다르다"

for f in "$RELEASE_WORKFLOW" "$AUTOTAG_WORKFLOW" "$RELEASE_DOC"; do
	if [ ! -f "$f" ]; then
		echo "FAIL: 대상 파일이 없다: $f" >&2
		exit 1
	fi
done

# 잡 블록은 다음 최상위 키(2칸 들여쓰기)까지다. 이 잡이 파일 마지막이면 EOF 가 끝.
# ①의 단언 · 픽스처 생성기 · mutation 단계가 이 추출기를 공유한다 — 갈라지면
# 픽스처를 갱신한 그다음 실행이 red 가 된다.
job_block() {
	awk -v key="  ${JOB_KEY}:" '
		$0 == key {f = 1; print; next}
		f && /^  [^ ]/ {exit}
		f' "$RELEASE_WORKFLOW"
}

# 픽스처 생성기. 단언 출력이 섞이지 않도록 스위트 본문보다 먼저 끝낸다. 추출이
# 비면 멈춘다 — 빈 픽스처를 커밋하면 빈 추출과 바이트 동일해져 대조가 영영 green
# 이고, 변조의 치환 대상도 빈 문자열이 된다.
if [ "${1:-}" = "--print-gate-job" ]; then
	if [ -z "$(job_block)" ]; then
		echo "FAIL: '${JOB_KEY}' job 을 못 찾았다: $RELEASE_WORKFLOW" >&2
		exit 1
	fi
	job_block
	exit 0
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

assert_rc() {
	if [ "$RC" -eq "$1" ]; then
		pass "$2 (rc=$1)"
	else
		fail "$2: rc=$RC, 기대 $1" "$OUT"
	fi
}

# 부분 문자열 판정. "있다/없다" 를 파이프라인 status 로 받던 자리를 여기로 모았다 —
# 판정이 한 군데서만 나야 다음 편집이 그 형태를 되살릴 자리가 없다 (#2319, 선행 #2314).
#
# **파이프를 쓰지 않는다.** 옛 구현 `printf '%s\n' "$OUT" | grep -qF -- "$1"` 은
# grep -q 가 첫 일치에서 stdin 을 안 비우고 빠지는 동안 왼쪽 printf 가 아직 쓸 것을
# 갖고 있으면 EPIPE 를 맞았다. 그 status 는 자리마다 갈린다 —
# EXIT trap 이 아직 안 걸린 자리에서만 SIGPIPE 로 141 이고, trap 이 걸린 뒤에는 bash 가
# SIGPIPE 로 못 죽어 printf 가 rc=1 과 `printf: write error: Broken pipe` 로 돌아온다.
# 어느 쪽이든 비영이라 위 `set -o pipefail` 이 그것을 파이프라인 status 로 올려
# **판정을 뒤집었다.**
#
# 이 파일 안에 그 경계가 있다 — 아래 assert_has 와 continue-on-error 가드는 `trap
# 'rm -rf "$TMP"' EXIT` 보다 위라 141 쪽이고, 스텁부터 회귀 가드까지는 그 아래라 rc=1
# 쪽이다. 뒤집힘 자체는 어느 쪽이든 성립한다.
#
# `case` 패턴 안의 따옴표 친 확장은 glob 메타문자까지 리터럴이라 `grep -F` 와 뜻이
# 같고, 프로세스도 파이프도 안 만든다. 다른 점은 needle 에 개행이 있을 때뿐이다 —
# grep -F 는 줄 단위 OR, case 는 그 연속열 그대로다. 개행을 품은 needle 을 넘기려면
# 이 함수부터 다시 봐라. 회귀 가드는 아래 "assertion helpers (#2319)" 절이다.
#
# 이 파일에서 여기를 안 지나는 grep 과 그 이유:
#   - `grep -qF -- "$1" "$2"` (assert_file_has) · `grep -qE … "$AUTOTAG_WORKFLOW"`
#     — grep 이 파일을 직접 열어 파이프도 writer 도 없다.
#   - `printf '%s\n' "$2" | sed …` (fail) — 파이프이고 왼쪽이 writer 이지만 sed 가
#     입력을 끝까지 읽고, status 가 아니라 출력을 쓴다.
contains() {
	case "$1" in
	*"$2"*) return 0 ;;
	*) return 1 ;;
	esac
}

# 정규식 판정. `case` 로는 줄머리 앵커(`^`)를 못 써서 grep 을 그대로 두되
# **파이프라인을 안 만든다** — here-string 은 파이프라인이 아니라 `pipefail` 이
# 올릴 남의 status 가 애초에 없고, `$?` 는 grep 것 하나뿐이다. 아래
# continue-on-error 가드가 이것을 쓴다.
matches_ere() {
	grep -qE -- "$2" <<<"$1"
}

assert_has() {
	if contains "$OUT" "$1"; then
		pass "$2"
	else
		fail "$2" "찾는 문자열: $1
$OUT"
	fi
}

# ── ① job 이 존재하는가 ──────────────────────────────────────────────────
# 아래 라벨 변수들은 mutation 단계가 "그 단언이 낸 red 인지" 를 확인할 때 다시
# 쓴다. 손으로 두 번 적으면 문구를 고친 날 한쪽만 낡는다.
LBL_JOB_MISSING="release.yml 에 '${JOB_KEY}' job 이 없다"

echo "release.yml gate job (#2168):"

JOB="$(job_block)"
if [ -z "$JOB" ]; then
	fail "$LBL_JOB_MISSING" \
		"태그 SHA 의 check-runs 를 검증하는 자리가 사라졌다. 이 스위트의 JOB_KEY 를 같이 고쳐라."
else
	pass "release.yml 에 '${JOB_KEY}' job 이 있다"
fi

OUT="$JOB"
assert_has "name: ${JOB_NAME}" "job 이름이 문서에서 부르는 이름과 같다"
assert_has "commits/\${GITHUB_SHA}/check-runs" "태그 SHA(GITHUB_SHA)의 check-runs 를 조회한다"

# ── ② 실패가 릴리스 run 을 red 로 만드는가 ───────────────────────────────
# GitHub Actions 에서 잡 실패는 기본적으로 run 을 red 로 만든다. 그 연결을 끊는
# 편집은 셋뿐이다: continue-on-error 로 삼키기, 릴리스 경로에서 skip 시키는 `if:`,
# 그리고 run 블록이 실패를 찍고도 0 으로 나가기. 앞의 둘을 여기서, 셋째를 아래
# "gate behaviour" 에서 잡는다.
LBL_NO_CONTINUE_ON_ERROR="커플링: job 에 continue-on-error 가 붙어 실패가 삼켜진다"
LBL_NEEDS_BUILD="build 뒤에 돈다 (본 CI 가 완주할 시간을 벌어 준다)"
LBL_IF_ALWAYS="build 레그가 죽어도 태그 SHA 의 판정은 낸다"
# 줄머리 앵커라 `contains` 로 못 옮긴다 — 리터럴 판정은 `# continue-on-error:` 로
# 주석 처리된 줄까지 잡아 거짓 red 를 낸다. 이 표기를 아래 가드와 회귀 가드가 같이
# 쓴다. 손으로 두 번 적으면 문구를 고친 날 한쪽만 낡는다.
COE_KEY_ERE='^[[:space:]]*continue-on-error:'

# **부호가 반대인 가드다** — 키가 있으면 fail 이라, 판정이 뒤집히면 red 가 아니라
# 조용한 거짓 green 이 된다. 아래 "assertion helpers (#2319)" 절이 큰 payload 로
# 이 함수를 다시 불러 그 뒤집힘을 재현한다.
check_continue_on_error() {
	if matches_ere "$1" "$COE_KEY_ERE"; then
		fail "$LBL_NO_CONTINUE_ON_ERROR" \
			"이 잡이 red 여도 릴리스 run 이 green 으로 끝난다 — #2168 이 만들려던 신호가 사라진다."
	else
		pass "job 에 continue-on-error 가 없다 (실패가 릴리스 run 을 red 로 만든다)"
	fi
}
check_continue_on_error "$JOB"

assert_has "needs: build" "$LBL_NEEDS_BUILD"
assert_has "if: always()" "$LBL_IF_ALWAYS"
assert_has "checks: read" "job 이 check-runs 를 읽을 권한을 스스로 좁혀 받는다"

# ── ③ 문서의 보증 문구가 이 job 을 가리키는가 ────────────────────────────
echo "doc coupling:"

# 파일을 통째로 OUT 에 담지 않는다 — 실패 한 건에 문서 전문이 딸려 나오면 어느
# 단언이 깨졌는지가 그 안에 묻힌다.
assert_file_has() {
	if grep -qF -- "$1" "$2"; then
		pass "$3"
	else
		fail "$3" "찾는 문자열: $1
없는 파일: $2"
	fi
}

LBL_DOC_GUARANTEE_KEPT="보증 문구가 그대로 살아 있다 (처방 2 기각)"
LBL_DOC_NAMES_JOB="문서가 그 보증을 집행하는 job 을 이름으로 가리킨다"

# 오너 결정(2026-08-05): 보증 문구는 낮추지 않는다. 실제 동작에 맞춰 문서를
# 깎는 처방 2 는 기각됐고, 대신 파이프라인이 문구를 따라오게 만들었다.
assert_file_has "$DOC_GUARANTEE" "$RELEASE_DOC" "$LBL_DOC_GUARANTEE_KEPT"
assert_file_has "$JOB_NAME" "$RELEASE_DOC" "$LBL_DOC_NAMES_JOB"

# 오너 결정: 태그는 지금처럼 즉시 만든다. 이슈 본문의 처방 1(auto-tag 가 CI 를
# 기다린다)이 기각됐는데, 이슈를 읽고 온 다음 노드가 그쪽을 구현하기 쉽다.
if grep -qE '^[[:space:]]*workflow_run:' "$AUTOTAG_WORKFLOW"; then
	fail "auto-tag 가 workflow_run 트리거로 바뀌었다 (기각된 처방 1)" \
		"태그가 CI 완주만큼 늦고, 태그가 안 붙으면 release.yml 이 아예 안 돈다. 게이트는 draft 쪽(verify-tag-ci)이다."
else
	pass "auto-tag 트리거는 그대로 — 태그는 여전히 즉시 붙는다"
fi

# ── gate behaviour — run: 블록을 실제로 돌린다 ───────────────────────────
# `run: |` 줄을 빼고 본문만 낸다. 본문은 10칸 이상이고, 잡을 끝내는 것은 그보다
# 얕은 첫 비어 있지 않은 줄(또는 EOF)이다.
gate_step() {
	awk -v step="- name: ${STEP_NAME}" '
		index($0, step) {f = 1}
		f && /^[[:space:]]*run:/ {g = 1; next}
		g && NF && substr($0, 1, 10) != "          " {exit}
		g' "$RELEASE_WORKFLOW"
}

# RED 재현은 손으로 적어 두지 않는다 — 아래 ④ mutation 단계가 매 실행마다 돌린다.
# 주석에 적어 둔 재현 절차는 그 사본만 낡고, 낡았다는 것을 아무도 안 알려 준다.
echo "gate behaviour (stubbed gh):"

GATE="$(gate_step)"
if [ -z "$GATE" ]; then
	fail "'${STEP_NAME}' 스텝의 run: 블록을 못 찾았다" \
		"스텝 이름이나 워크플로 구조가 바뀌었다. 이 스위트의 gate_step() 을 같이 고쳐라."
	echo ""
	echo "SUMMARY: $((total - fails))/$total PASS"
	exit 1
fi
pass "게이트 스텝의 run: 블록을 뽑았다"

SELF_RUN_ID="30969310866"
SHA="39019c3cbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
# 실제 v0.7.0 태그 SHA 의 check-runs 모양 그대로다 — 릴리스 run 자신의 잡은
# details_url 에 자기 run id 를 달고 같은 커밋에 붙는다.
SELF_URL="https://github.com/o/r/actions/runs/${SELF_RUN_ID}/job/92189987748"
CI_URL="https://github.com/o/r/actions/runs/30969298465/job/92189950259"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/verify-tag-ci.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# 호출 순번별로 출력/종료코드를 갈아끼울 수 있는 gh 스텁. 폴링이 진짜로 다시
# 조회하는지 보려면 1회차와 2회차가 달라야 한다.
#
# 실행 파일은 한 벌만 만들고 호출마다 `$STUB_DIR` 로 데이터 디렉토리만 갈아끼운다.
# macOS 는 새로 만든 실행 파일마다 검사를 걸어 케이스당 100ms 대를 먹는데, 아래
# mutation 단계가 이 스위트를 여러 번 다시 돌리므로 그 값이 그대로 곱해진다.
STUB_BIN="$TMP/bin"
mkdir -p "$STUB_BIN"
cat >"$STUB_BIN/gh" <<'STUB'
#!/usr/bin/env bash
d="$STUB_DIR"
n=$(($(cat "$d/count" 2>/dev/null || echo 0) + 1))
printf '%s' "$n" >"$d/count"
out="$d/call-$n.out"
[ -f "$out" ] || out="$d/default.out"
rc="$d/call-$n.rc"
[ -f "$rc" ] || rc="$d/default.rc"
[ -f "$out" ] && cat "$out"
exit "$(cat "$rc" 2>/dev/null || echo 0)"
STUB
chmod +x "$STUB_BIN/gh"

new_stub() {
	mktemp -d "$TMP/stub.XXXXXX"
}

# `bash -e -c` 인 것은 취향이 아니다 — `shell:` 을 안 적은 스텝을 GitHub 러너가
# `bash -e {0}` 으로 돌린다. -e 없이 재현하면 "런너에서만 조기 종료" 하는 편집을
# 여기서 못 잡는다.
run_gate() {
	local d="$1" wait_s="${2:-0}"
	OUT="$(PATH="$STUB_BIN:$PATH" STUB_DIR="$d" \
		GITHUB_REPOSITORY="o/r" GITHUB_SHA="$SHA" GITHUB_RUN_ID="$SELF_RUN_ID" \
		TAG_CI_WAIT_SECONDS="$wait_s" TAG_CI_POLL_SECONDS=0 \
		bash -e -c "$GATE" 2>&1)"
	RC=$?
}

row() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"; }

# 라벨 — mutation 단계가 "그 단언이 낸 red 인지" 를 확인할 때 다시 쓴다.
LBL_FAILURE_IS_RED="체크 하나가 failure 면 실패"
LBL_SELF_RUN_EXCLUDED="이 릴리스 run 자신의 체크는 제외한다"
LBL_NON_BLOCKING_OK="(non-blocking) 체크의 red 는 릴리스를 막지 않는다"
LBL_POLL_SEES_FINAL="폴링이 끝난 뒤의 결과를 본다"
LBL_ZERO_ROWS_RED="fail-closed: 체크가 0건이면 실패"
conclusion_label() { printf "결론 '%s' 도 red 로 센다" "$1"; }

# 전부 green — skipped/neutral 도 실패가 아니다.
d="$(new_stub)"
{
	row "Rust Static Analysis" completed success "$CI_URL"
	row "Frontend Checks" completed neutral "$CI_URL"
	row "Runtime Happy Path" completed skipped "$CI_URL"
} >"$d/default.out"
run_gate "$d"
assert_rc 0 "전부 green 이면 통과"
assert_has "3 check runs green" "green 인 체크 수를 로그에 남긴다"

# 이 잡이 세는 체크 중 하나라도 red 면 릴리스 run 이 red 다. 이것이 #2168 의
# 본체다. "하나라도" 가 전수가 아닌 이유는 아래 두 절에 있다 — 자기 run 의 잡과
# `(non-blocking)` 이름은 애초에 안 센다.
d="$(new_stub)"
{
	row "Rust Static Analysis" completed success "$CI_URL"
	row "Integration Tests (Docker)" completed failure "$CI_URL"
} >"$d/default.out"
run_gate "$d"
assert_rc 1 "$LBL_FAILURE_IS_RED"
assert_has "Integration Tests (Docker)" "실패한 체크의 이름을 찍는다"
assert_has "Do NOT publish this draft" "publish 하지 말라고 말한다"

# failure 말고도 red 인 결론들. 통과 집합을 넓히는 편집은 여기서 죽는다.
for c in timed_out cancelled action_required startup_failure stale; do
	d="$(new_stub)"
	{
		row "Rust Static Analysis" completed success "$CI_URL"
		row "Runtime Happy Path" completed "$c" "$CI_URL"
	} >"$d/default.out"
	run_gate "$d"
	assert_rc 1 "$(conclusion_label "$c")"
done

# 자기 자신의 잡은 세지 않는다. 세면 영원히 자기를 기다리다 예산 만료로 죽는다.
d="$(new_stub)"
{
	row "Rust Static Analysis" completed success "$CI_URL"
	row "Bundle (macOS arm64)" in_progress pending "$SELF_URL"
	row "$JOB_NAME" in_progress pending "$SELF_URL"
	row "Verify latest.json is present" completed failure "$SELF_URL"
} >"$d/default.out"
run_gate "$d"
assert_rc 0 "$LBL_SELF_RUN_EXCLUDED"

# `(non-blocking)` 접미사는 이 저장소가 자문 체크에 붙이는 표식이다 (ci.yml).
# RUSTSEC 권고 하나가 모든 릴리스를 red 로 만들면 안 된다 (2026-07-02 사고).
d="$(new_stub)"
{
	row "Rust Static Analysis" completed success "$CI_URL"
	row "Dependency Advisories (non-blocking)" completed failure "$CI_URL"
	row "WASM Size Budget (non-blocking)" completed failure "$CI_URL"
} >"$d/default.out"
run_gate "$d"
assert_rc 0 "$LBL_NON_BLOCKING_OK"

# 아직 도는 체크는 기다린다 — 그리고 예산이 끝나면 통과로 강등하지 않는다.
d="$(new_stub)"
{
	row "Rust Static Analysis" completed success "$CI_URL"
	row "Frontend Tests (shard 1/3)" in_progress pending "$CI_URL"
} >"$d/default.out"
run_gate "$d" 0
assert_rc 1 "fail-closed: 예산이 끝나도 안 끝난 체크가 있으면 실패"
assert_has "Frontend Tests (shard 1/3)" "안 끝난 체크의 이름을 찍는다"

# 그 기다림이 진짜 재조회인지. 1회차 pending, 2회차 success.
d="$(new_stub)"
row "Frontend Tests (shard 1/3)" in_progress pending "$CI_URL" >"$d/call-1.out"
row "Frontend Tests (shard 1/3)" completed success "$CI_URL" >"$d/call-2.out"
run_gate "$d" 60
assert_rc 0 "$LBL_POLL_SEES_FINAL"
if [ "$(cat "$d/count")" = "2" ]; then
	pass "폴링이 실제로 다시 조회한다 (gh 2회 호출)"
else
	fail "폴링이 재조회하지 않았다" "gh 호출 횟수: $(cat "$d/count")"
fi

# API 가 죽으면 판정 불가다. 판정 불가를 통과로 강등하지 않는다.
d="$(new_stub)"
printf '1' >"$d/default.rc"
run_gate "$d"
assert_rc 1 "fail-closed: check-runs 조회 실패는 통과가 아니다"
assert_has "An unreadable verdict is not a pass" "조회 실패를 에러로 찍는다"

# 손으로 밀어 넣은 태그가 CI 를 한 번도 안 돈 커밋을 가리키는 경우. 0건을
# "실패 없음" 으로 읽으면 게이트가 통째로 무의미해진다.
d="$(new_stub)"
: >"$d/default.out"
run_gate "$d"
assert_rc 1 "$LBL_ZERO_ROWS_RED"
assert_has "CI never verified" "검증된 적 없는 커밋이라고 말한다"

d="$(new_stub)"
row "Bundle (macOS arm64)" completed success "$SELF_URL" >"$d/default.out"
run_gate "$d"
assert_rc 1 "fail-closed: 자기 run 의 체크만 있으면 0건과 같다"

# ── assertion helpers (#2319) ────────────────────────────────────────────
# contains() · matches_ere() 가 판정을 파이프 status 에 안 싣는다는 것의 회귀 가드.
# 옛 형태로 되돌리면 여기가 red 다.
#
# 옛 구현은 `printf '%s\n' "$X" | grep -q…` 였다. grep -q 는 첫 일치에서 stdin 을
# 안 비우고 빠지고, 왼쪽 printf 가 파이프 버퍼(64KiB)보다 큰 것을 써야 하면 grep 이
# 비워 주기를 기다리며 막혔다가 이미 빠진 grep 때문에 EPIPE 를 맞는다. `set -o pipefail`
# 이 그 비영 status 를 파이프라인 status 로 올려 판정을 뒤집는다. 값은 갈린다 — 이 절은
# 위 `trap … EXIT` 아래라 rc=1 이고, 이 절이 지키는 진짜 continue-on-error 가드는 trap
# 보다 위라 141 이었다. 뒤집힘은 양쪽이 같아 가드는 그대로 선다 (기전은 위 contains()
# 주석).
#
# payload 를 파이프 버퍼의 두 배로 잡는 이유: 버퍼 바로 위는 아직 확률이다.
# 2026-08-13 macOS 실측 한 판(bash 3.2.57 + BSD grep 2.6.0, 4-way 동시 × 200,
# 첫 줄 일치, 옛 파이프 형태, flip = 있는 것을 "없음" 으로 낸 횟수. 그 race.sh 는 EXIT
# trap 을 안 걸어 flip 이 전부 printf 쪽 141 이었다 — 이 절 안에서는 같은 flip 이 rc=1
# 로 온다. 세는 것은 뒤집힘이지 status 값이 아니다):
#   8041B 0/800 · 70057B 799/800 · 200055B 800/800
# 같은 판에서 `case` 형태와 here-string 형태는 세 크기 모두 0/800 이었다.
# 재현 명령은 PR #2318 body 「기전의 경계」절의 race.sh 이고, `hs` 모드는 그것에
# `grep -qE -- "$NEEDLE" <<<"$OUT"` 한 갈래를 더한 것이다.
# 이 절은 $OUT 을 덮어쓴다 — 여기 아래에서 위 run_gate() 의 출력을 읽는 단언이 없다.
echo "assertion helpers (#2319):"

SIGPIPE_PAD='filler-line-for-issue-2319'
while [ "${#SIGPIPE_PAD}" -lt 200000 ]; do
	SIGPIPE_PAD="$SIGPIPE_PAD
$SIGPIPE_PAD"
done

# ① payload 가 실제로 파이프 버퍼를 넘는가. 이게 깨지면 아래 둘은 green 이어도
#    아무것도 안 지킨다 — 옛 구현이 여기서 안 죽는 크기로 줄어든 것이다.
if [ "${#SIGPIPE_PAD}" -ge 131072 ]; then
	pass "SIGPIPE 가드 payload 가 파이프 버퍼(64KiB)의 두 배를 넘는다 (${#SIGPIPE_PAD}, ASCII)"
else
	fail "SIGPIPE 가드 payload 가 너무 작다: ${#SIGPIPE_PAD}" \
		"131072 를 못 넘으면 결정론 구간 밖이다 — 버퍼 바로 위(70057B)는 위 실측대로 아직 확률이라 가드가 무력해진다."
fi

# ② assert_has — 있는 문자열을 EPIPE 로 놓치지 않는다. 옛 구현에서는 그 비영 status 가
#    pipefail 을 타고 올라와 이 단언이 red 였다 (눈에 띄는 쪽).
OUT="NEEDLE-2319
$SIGPIPE_PAD"
assert_has "NEEDLE-2319" "assert_has: 파이프 버퍼보다 큰 출력의 첫 줄 일치를 놓치지 않는다"

# ③ continue-on-error 가드 — **이쪽이 더 위험하다.** 부호가 반대라 같은 비영 status 가
#    「키 없음」 = 통과로 등록되어 red 조차 안 남긴다. 여기서 올바른 동작이 곧
#    FAIL 이라 서브셸에서 불러 출력만 본다 — total/fails 증가는 서브셸과 함께
#    버려진다. 이 판정이 뒤집히면 릴리스 게이트에 continue-on-error 가 붙어
#    실패가 통째로 삼켜져도 이 스위트가 green 을 찍는다.
coe_probe="$(check_continue_on_error "    continue-on-error: true
$SIGPIPE_PAD" 2>&1)"
if contains "$coe_probe" "FAIL $LBL_NO_CONTINUE_ON_ERROR"; then
	pass "continue-on-error 가드: 파이프 버퍼보다 큰 job 블록에 있는 키를 통과로 등록하지 않는다"
else
	fail "continue-on-error 가드: 있는 키가 통과로 등록됐다 — 조용한 거짓 green" \
		"가드가 낸 것:
$coe_probe"
fi

# ── ④ mutation — 위 단언들이 실제로 잡는지 ───────────────────────────────
# 판정 대상이 저장소의 워크플로 · 문서라서, 변조본을 만들어 env 로 물리고 이
# 스위트를 다시 돌린다. 서브런은 이 단계를 끈다 (무한 재귀가 된다).
if [ "${VERIFY_TAG_CI_SKIP_MUTATION:-0}" != "1" ]; then
	echo "mutation:"

	MUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-tag-ci-mut.XXXXXX")"
	trap 'rm -rf "$TMP" "$MUT_DIR"' EXIT

	# 리터럴 치환. 정규식이 아니라 index/substr 이라 앵커에서 리터럴까지를 `.*?` 로
	# 잡는 span 을 애초에 쓸 수 없다 (#2180). 대상이 없으면 여기서 죽고, 바꾼 게
	# 없으면 아래 호출부의 `cmp` 가 잡는다. 등장하는 자리는 남기지 않고 바꾼다:
	# 하나라도 남으면 `grep -qF` 로 된 단언이 그대로 통과한다.
	write_mutant() {
		local src="$1" dst="$2" old="$3" new="$4"
		perl -e '
			my ($src, $o, $n) = @ARGV;
			open my $fh, "<", $src or die "open: $!\n";
			local $/;
			my $t = <$fh>;
			close $fh;
			my ($hits, $i) = (0, 0);
			while (($i = index($t, $o, $i)) >= 0) {
				substr($t, $i, length($o), $n);
				$i += length($n);
				$hits++;
			}
			die "MUTATION TARGET NOT FOUND\n" unless $hits;
			print $t;
		' "$src" "$old" "$new" >"$dst"
	}

	# 서브런 출력. 버리면 양성 대조가 red 일 때 어느 단언이 깨졌는지가 사라진다.
	# 대입문의 exit status 는 명령 치환의 것이라 전역이어야 한다 — `local` 로
	# 받으면 status 가 `local` 의 것이 되어 항상 0 이다.
	SUB_OUT=""
	run_suite_against() {
		SUB_OUT="$(VERIFY_TAG_CI_RELEASE_WORKFLOW="$1" VERIFY_TAG_CI_DOC="$2" \
			VERIFY_TAG_CI_SKIP_MUTATION=1 bash "$SELF" 2>&1)"
	}

	# 양성 대조. 이게 red 면 아래 변조본의 red 는 아무것도 증명하지 못한다.
	cp "$RELEASE_WORKFLOW" "$MUT_DIR/control.yml"
	cp "$RELEASE_DOC" "$MUT_DIR/control.md"
	if run_suite_against "$MUT_DIR/control.yml" "$MUT_DIR/control.md"; then
		pass "positive control: 미변조 사본은 green"
	else
		fail "positive control: 미변조 사본이 red — harness 가 깨졌다" "$SUB_OUT"
	fi

	# "스위트가 red" 로 끝내지 않고 **그 단언이** 낸 red 인지까지 본다 — 안 그러면
	# 다른 단언이 깨져도 통과로 읽힌다.
	assert_mutant() {
		local name="$1" wf="$2" doc="$3" want="$4"
		if run_suite_against "$wf" "$doc"; then
			fail "mutation[$name]: 변조본이 green — 이 스위트가 그 편집을 못 잡는다" "$SUB_OUT"
		elif contains "$SUB_OUT" "$want"; then
			pass "mutation[$name]: '$want' 가 red 를 낸다"
		else
			fail "mutation[$name]: 스위트는 red 인데 기대한 단언이 아니다 (기대: $want)" "$SUB_OUT"
		fi
	}

	# 게이트 job 의 변조는 커밋된 픽스처를 고쳐 만들고, 고친 결과를 job 자리에
	# 통째로 끼워 넣는다 — 끼워 넣을 때의 치환 대상은 픽스처 텍스트 전체다.
	job_mutation_case() {
		local name="$1" old="$2" new="$3" want="$4"
		local fx="$MUT_DIR/fx-$name.txt" dst="$MUT_DIR/wf-$name.yml"
		if ! write_mutant "$GATE_JOB_FIXTURE" "$fx" "$old" "$new"; then
			fail "mutation[$name]: 픽스처에서 치환 대상을 못 찾았다"
			return
		fi
		if cmp -s "$GATE_JOB_FIXTURE" "$fx"; then
			fail "mutation[$name]: 고친 픽스처가 원본과 같다 — 치환이 no-op 이다"
			return
		fi
		# `$(cat …)` 가 양쪽의 끝 개행을 똑같이 떼므로 남는 바이트는 원본 그대로다.
		if ! write_mutant "$RELEASE_WORKFLOW" "$dst" "$(cat "$GATE_JOB_FIXTURE")" "$(cat "$fx")"; then
			fail "mutation[$name]: 워크플로에서 job 블록을 못 찾았다"
			return
		fi
		assert_mutant "$name" "$dst" "$RELEASE_DOC" "$want"
	}

	doc_mutation_case() {
		local name="$1" old="$2" new="$3" want="$4"
		local dst="$MUT_DIR/doc-$name.md"
		if ! write_mutant "$RELEASE_DOC" "$dst" "$old" "$new"; then
			fail "mutation[$name]: 문서에서 치환 대상을 못 찾았다"
			return
		fi
		if cmp -s "$RELEASE_DOC" "$dst"; then
			fail "mutation[$name]: 변조본이 원본과 같다 — 치환이 no-op 이다"
			return
		fi
		assert_mutant "$name" "$RELEASE_WORKFLOW" "$dst" "$want"
	}

	# 픽스처가 저장소의 job 과 바이트 동일한가. 어긋난 채로 끼워 넣으면 job 이
	# 픽스처로 되돌아가 변조 아닌 것이 섞인다 — 그래서 이것이 아래 전부의 선행 조건이다.
	fixture_ok=0
	if [ ! -f "$GATE_JOB_FIXTURE" ]; then
		fail "$GATE_JOB_PIN_FAIL" "기대본 픽스처가 없다: ${GATE_JOB_FIXTURE#"$ROOT/"}
만드는 법:
  $GATE_JOB_UPDATE_CMD"
	else
		job_block >"$MUT_DIR/job.actual"
		if cmp -s "$GATE_JOB_FIXTURE" "$MUT_DIR/job.actual"; then
			pass "게이트 job 이 커밋된 픽스처와 바이트 동일하다"
			fixture_ok=1
		else
			fail "$GATE_JOB_PIN_FAIL" \
				"$(diff -u -L expected -L actual "$GATE_JOB_FIXTURE" "$MUT_DIR/job.actual")

바이트 비교라서 공백·주석만 바뀌어도 여기서 걸린다. 릴리스를 막는 게이트가 바뀌었다는
뜻이므로, 의도한 변경이면 픽스처를 갱신해 같은 커밋에 담아라:
  $GATE_JOB_UPDATE_CMD"
		fi
	fi

	if [ "$fixture_ok" = "1" ]; then
		# 실패 경로가 red 를 찍고도 0 으로 나간다. 따옴표와 백슬래시가 그대로라
		# heredoc 으로 받는다.
		FAILED_EXIT_1="$(
			cat <<'YML'
            printf '%s\n' "$failed" >&2
            exit 1
YML
		)"
		FAILED_EXIT_0="$(
			cat <<'YML'
            printf '%s\n' "$failed" >&2
            exit 0
YML
		)"

		job_mutation_case "failure-exits-zero" "$FAILED_EXIT_1" "$FAILED_EXIT_0" \
			"$LBL_FAILURE_IS_RED"
		job_mutation_case "continue-on-error-swallows-failure" \
			'    permissions:
      checks: read' \
			'    continue-on-error: true
    permissions:
      checks: read' \
			"$LBL_NO_CONTINUE_ON_ERROR"
		job_mutation_case "needs-build-dropped" '    needs: build
' '' "$LBL_NEEDS_BUILD"
		job_mutation_case "if-always-dropped" '    if: always()
' '' "$LBL_IF_ALWAYS"
		job_mutation_case "self-run-checks-counted" \
			'NF && index($4, self) == 0 && ' 'NF && ' "$LBL_SELF_RUN_EXCLUDED"
		job_mutation_case "non-blocking-filter-dropped" \
			' && $1 !~ /\(non-blocking\)$/ {' ' {' "$LBL_NON_BLOCKING_OK"
		job_mutation_case "running-checks-not-awaited" \
			'            [ -z "$running" ] && break' '            break' \
			"$LBL_POLL_SEES_FINAL"
		job_mutation_case "zero-rows-read-as-pass" \
			'          if [ -z "$rows" ]; then' '          if false; then' \
			"$LBL_ZERO_ROWS_RED"
		job_mutation_case "timed-out-demoted-to-pass" \
			'$3 != "skipped"' '$3 != "skipped" && $3 != "timed_out"' \
			"$(conclusion_label timed_out)"
		# 치환 대상이 픽스처 전체다 — job 을 통째로 지운다.
		job_mutation_case "gate-job-deleted" "$(cat "$GATE_JOB_FIXTURE")" "" \
			"$LBL_JOB_MISSING"
	fi

	doc_mutation_case "doc-stops-naming-the-job" "$JOB_NAME" "the release CI check" \
		"$LBL_DOC_NAMES_JOB"
	doc_mutation_case "doc-guarantee-lowered" "$DOC_GUARANTEE" \
		"The tag points at whatever merged." "$LBL_DOC_GUARANTEE_KEPT"
fi

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
