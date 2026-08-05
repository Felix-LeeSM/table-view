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
# 검사 대상은 세 가지다:
#   ① release.yml 에 태그 SHA 의 check-runs 를 검증하는 job 이 있다
#   ② 그 job 이 실패하면 릴리스 run 이 red 로 끝난다 (needs:/if: 커플링,
#      continue-on-error 부재)
#   ③ versioning-and-artifacts.md 의 보증 문구가 그 job 을 가리킨다
#
# ②는 스텝 이름 존재 확인으로 끝내지 않는다. 워크플로에서 `run:` 블록을 그대로
# 뽑아 **실행**한다 — grep 만으로는 "실패를 찍기는 하는데 exit 0 으로 강등한다" 는
# 편집을 못 잡는다. 게이트 로직을 `--jq` 가 아니라 shell 에 둔 것이 이 때문이다.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# env 로 갈아끼울 수 있는 것은 이 스위트의 RED 를 손으로 재현하기 위해서다
# (measure-rounds.test.sh 의 MEASURE_ROUNDS_GATE_WORKFLOW 와 같은 이유).
# 기본값은 저장소의 진짜 파일이다.
RELEASE_WORKFLOW="${VERIFY_TAG_CI_RELEASE_WORKFLOW:-$ROOT/.github/workflows/release.yml}"
AUTOTAG_WORKFLOW="${VERIFY_TAG_CI_AUTOTAG_WORKFLOW:-$ROOT/.github/workflows/auto-tag-release.yml}"
RELEASE_DOC="${VERIFY_TAG_CI_DOC:-$ROOT/docs/contributor-guide/release/versioning-and-artifacts.md}"

JOB_KEY="verify-tag-ci"
JOB_NAME="Verify tag SHA CI is green"
STEP_NAME="Fail the release run when the tagged SHA has failing non-advisory checks"

for f in "$RELEASE_WORKFLOW" "$AUTOTAG_WORKFLOW" "$RELEASE_DOC"; do
	if [ ! -f "$f" ]; then
		echo "FAIL: 대상 파일이 없다: $f" >&2
		exit 1
	fi
done

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

assert_has() {
	if printf '%s\n' "$OUT" | grep -qF -- "$1"; then
		pass "$2"
	else
		fail "$2" "찾는 문자열: $1
$OUT"
	fi
}

# ── ① job 이 존재하는가 ──────────────────────────────────────────────────
# 잡 블록은 다음 최상위 키(2칸 들여쓰기)까지다. 이 잡이 파일 마지막이면 EOF 가 끝.
job_block() {
	awk -v key="  ${JOB_KEY}:" '
		$0 == key {f = 1; print; next}
		f && /^  [^ ]/ {exit}
		f' "$RELEASE_WORKFLOW"
}

echo "release.yml gate job (#2168):"

JOB="$(job_block)"
if [ -z "$JOB" ]; then
	fail "release.yml 에 '${JOB_KEY}' job 이 없다" \
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
if printf '%s\n' "$JOB" | grep -qE '^[[:space:]]*continue-on-error:'; then
	fail "커플링: job 에 continue-on-error 가 붙어 실패가 삼켜진다" \
		"이 잡이 red 여도 릴리스 run 이 green 으로 끝난다 — #2168 이 만들려던 신호가 사라진다."
else
	pass "job 에 continue-on-error 가 없다 (실패가 릴리스 run 을 red 로 만든다)"
fi

assert_has "needs: build" "build 뒤에 돈다 (본 CI 가 완주할 시간을 벌어 준다)"
assert_has "if: always()" "build 레그가 죽어도 태그 SHA 의 판정은 낸다"
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

# 오너 결정(2026-08-05): 보증 문구는 낮추지 않는다. 실제 동작에 맞춰 문서를
# 깎는 처방 2 는 기각됐고, 대신 파이프라인이 문구를 따라오게 만들었다.
assert_file_has 'The tag must also point to a `main` commit SHA that passed the Pre-Release' \
	"$RELEASE_DOC" "보증 문구가 그대로 살아 있다 (처방 2 기각)"
assert_file_has "$JOB_NAME" "$RELEASE_DOC" "문서가 그 보증을 집행하는 job 을 이름으로 가리킨다"

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

# RED 재현. 대상이 이 스크립트가 아니라 저장소의 워크플로 · 문서라서 mutation
# 하네스를 여기 넣지 않고 재현 명령만 남긴다 (measure-rounds.test.sh 의 게이트
# 단언과 같은 이유). 아래 각 줄은 대응하는 단언을 red 로 만들려는 변조다. 몇 개가
# 깨지는지는 여기 안 적는다 — 돌려 보면 나오고, 적어 두면 스위트가 자라는 날 낡는다.
#
# 변조를 쓸 때 세 가지가 조용한 no-op 을 만든다. 셋 다 실제로 밟았다:
#   · perl 은 패턴/치환의 `$3` `$4` 를 캡처 변수로 먹는다 — `\$` 로 escape 하거나
#     `.` 로 대신 쓴다. 안 그러면 빈 문자열로 치환돼 엉뚱한 것이 바뀐다.
#   · `if: always()` 는 verify-latest-json 에도 있고 그쪽이 파일에서 먼저다.
#     `timeout-minutes: 30` 까지 붙여야 이 잡을 고른다.
#   · **레시피는 regex span 이고, span 끝은 산문이 가로챌 수 있다.** 끝을 `exit 1`
#     로 쓴 줄이 release.yml 주석에 새로 들어간 리터럴 `exit 1` 에서 멈춰, 주석 한
#     줄만 바꾸는 no-op 이 된 적이 있다. 앵커도 끝도 주석이 못 적는 실행 코드
#     모양으로 건다 — 아래 `[ -n ".failed" ]` 처럼.
#
# **적용한 뒤 반드시 `diff` 로 무엇이 바뀌었는지 확인하고 스위트를 돌려라.** 그
# 절차를 안 밟아 no-op 을 green 으로 넘긴 적이 있다 — 이 파일이 그 절차를 적어
# 두고도 그랬다. span 을 닫힌 비교로 바꾸는 재설계는 이슈 #2180 이다.
#
#   d="$(mktemp -d)"
#   cp .github/workflows/release.yml "$d/m.yml"
#   cp docs/contributor-guide/release/versioning-and-artifacts.md "$d/m.md"
#   # 워크플로 쪽 — 하나 골라 적용한다
#   perl -0pi -e 's/(    permissions:\n      checks: read)/    continue-on-error: true\n$1/' "$d/m.yml"   # 실패를 삼킨다
#   perl -0pi -e 's/index\(.4, self\) == 0 && //' "$d/m.yml"                                             # 자기 run 제외를 뺀다
#   perl -0pi -e 's/\[ -z ".running" \] && break/break/' "$d/m.yml"                                      # 안 끝난 체크를 안 기다린다
#   perl -0pi -e 's/if \[ -z ".rows" \]; then/if false; then/' "$d/m.yml"                                # 0건을 통과로 읽는다
#   perl -0pi -e 's/ && .1 !~ [^{]+\{/ {/' "$d/m.yml"                                                    # (non-blocking) 필터를 뺀다
#   perl -0pi -e 's/    needs: build\n    # Report/    # Report/' "$d/m.yml"                              # needs: build 를 뗀다
#   perl -0pi -e 's/    if: always\(\)\n    runs-on: ubuntu-22.04\n    timeout-minutes: 30/    runs-on: ubuntu-22.04\n    timeout-minutes: 30/' "$d/m.yml"  # if: always() 를 뗀다
#   perl -0pi -e 's/(\[ -n ".failed" \].*?)exit 1/${1}exit 0/s' "$d/m.yml"                                # red 를 찍고도 0 으로 나간다
#   perl -0pi -e 's/\$3 != "skipped"/\$3 != "skipped" && \$3 != "timed_out"/' "$d/m.yml"                  # timed_out 을 통과로 강등
#   perl -0pi -e 's/\n  # #2168.*\z//s' "$d/m.yml"                                                       # 게이트 job 을 통째로 지운다
#   # 문서 쪽
#   perl -0pi -e 's/`Verify tag SHA CI is green`/the release CI check/g' "$d/m.md"                        # job 이름을 안 부른다
#   perl -0pi -e 's/The tag must also point to a `main` commit SHA that passed the Pre-Release\n  Verification Gate\./The tag points at whatever merged./' "$d/m.md"  # 보증 문구를 낮춘다
#   # 안 고른 쪽은 원본이어야 하므로 둘 다 넘긴다
#   VERIFY_TAG_CI_RELEASE_WORKFLOW="$d/m.yml" VERIFY_TAG_CI_DOC="$d/m.md" \
#     bash scripts/release/verify-tag-ci.test.sh
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
new_stub() {
	local d
	d="$(mktemp -d "$TMP/stub.XXXXXX")"
	cat >"$d/gh" <<'STUB'
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
	chmod +x "$d/gh"
	printf '%s' "$d"
}

# `bash -e -c` 인 것은 취향이 아니다 — `shell:` 을 안 적은 스텝을 GitHub 러너가
# `bash -e {0}` 으로 돌린다. -e 없이 재현하면 "런너에서만 조기 종료" 하는 편집을
# 여기서 못 잡는다.
run_gate() {
	local d="$1" wait_s="${2:-0}"
	OUT="$(PATH="$d:$PATH" STUB_DIR="$d" \
		GITHUB_REPOSITORY="o/r" GITHUB_SHA="$SHA" GITHUB_RUN_ID="$SELF_RUN_ID" \
		TAG_CI_WAIT_SECONDS="$wait_s" TAG_CI_POLL_SECONDS=0 \
		bash -e -c "$GATE" 2>&1)"
	RC=$?
}

row() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"; }

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
assert_rc 1 "체크 하나가 failure 면 실패"
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
	assert_rc 1 "결론 '$c' 도 red 로 센다"
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
assert_rc 0 "이 릴리스 run 자신의 체크는 제외한다"

# `(non-blocking)` 접미사는 이 저장소가 자문 체크에 붙이는 표식이다 (ci.yml).
# RUSTSEC 권고 하나가 모든 릴리스를 red 로 만들면 안 된다 (2026-07-02 사고).
d="$(new_stub)"
{
	row "Rust Static Analysis" completed success "$CI_URL"
	row "Dependency Advisories (non-blocking)" completed failure "$CI_URL"
	row "WASM Size Budget (non-blocking)" completed failure "$CI_URL"
} >"$d/default.out"
run_gate "$d"
assert_rc 0 "(non-blocking) 체크의 red 는 릴리스를 막지 않는다"

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
assert_rc 0 "폴링이 끝난 뒤의 결과를 본다"
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
assert_rc 1 "fail-closed: 체크가 0건이면 실패"
assert_has "CI never verified" "검증된 적 없는 커밋이라고 말한다"

d="$(new_stub)"
row "Bundle (macOS arm64)" completed success "$SELF_URL" >"$d/default.out"
run_gate "$d"
assert_rc 1 "fail-closed: 자기 run 의 체크만 있으면 0건과 같다"

echo ""
echo "SUMMARY: $((total - fails))/$total PASS"
if [ "$fails" -gt 0 ]; then
	exit 1
fi
exit 0
