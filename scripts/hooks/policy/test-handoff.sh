#!/usr/bin/env bash
# Regression tests for scripts/handoff.mjs — 인계 write / read / state.
#
# `gh` 를 PATH 앞에 놓은 가짜로 갈아끼우고, 케이스 디렉터리의 캔 응답을 읽게 한다.
# 진짜 GitHub 을 안 건드리면서 argv 와 코멘트 본문까지 검사할 수 있다.
#
# 파일 끝의 mutation 증명이 이 스위트의 진짜 검증이다. 케이스가 GREEN 인 것은
# "돌았다" 만 말하고 "잡는다" 는 말하지 않는다. `assert_mutation` 은 표적이 실제로
# 치환됐는지(`cmp`)와 mutant 가 여전히 파싱되는지(`node --check`)를 먼저 보는데,
# 둘 다 없으면 아무것도 안 바꾼 mutation 은 GREEN 을, 문법을 깬 mutation 은 파서가
# 주는 RED 를 증명으로 오독하게 된다. 표적 문자열은 이 파일 저자의 머릿속 표기가
# 아니라 handoff.mjs 에서 그대로 복사한 실제 표기다.

set -euo pipefail

# shellcheck source=../lib/git-fixture.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/git-fixture.sh" || exit 1
scrub_git_env

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HANDOFF="$ROOT/scripts/handoff.mjs"
TMP_DIR="$(fixture_mktemp handoff-check)"
trap 'rm -rf "$TMP_DIR"' EXIT

# #1918 §7 의 예시 값. 40자 full OID.
AT="2420164486b0ccedd2fae3fe41c4e35eed897e6c"
BASE_OID="2826a660962382306f3578f9d6268162e8968b65"
OTHER_OID="6f6edf73ea38ccbc20d2a30cb9b4478ea0b3b682"

FAILURES=0
QUIET=0
BIN="$HANDOFF"
RUN_DIR=""
CASE=""

note_fail() {
	FAILURES=$((FAILURES + 1))
	[ "$QUIET" = "1" ] || echo "  FAIL: $*" >&2
}

expect_eq() { # label actual want
	[ "$2" = "$3" ] || note_fail "$1: got '$2' want '$3'"
}

expect_in() { # label file needle
	grep -Fq -- "$3" "$2" || note_fail "$1: '$3' 없음 in $(basename "$2")"
}

expect_not_in() { # label file needle
	grep -Fq -- "$3" "$2" && note_fail "$1: '$3' 가 있으면 안 된다 in $(basename "$2")"
	return 0
}

# ----------------------------------------------------------------- 가짜 gh

mkdir -p "$TMP_DIR/bin"
cat >"$TMP_DIR/bin/gh" <<'FAKE_GH'
#!/usr/bin/env bash
# 캔 응답을 돌려주는 가짜 gh. 모든 호출을 argv 로 기록한다.
set -u
dir="$HANDOFF_CASE"
printf '%s\n' "$*" >>"$dir/calls.log"
unexpected() {
	echo "fake gh: 예상 못 한 호출: $*" >&2
	exit 9
}
case "${1:-}" in
issue)
	case "${2:-}" in
	view) cat "$dir/issue.json" ;;
	comment) cat >>"$dir/comment-body" ;;
	edit) : ;;
	*) unexpected "$@" ;;
	esac
	;;
pr)
	case "${2:-}" in
	view) cat "$dir/pr.json" ;;
	edit) : ;;
	*) unexpected "$@" ;;
	esac
	;;
api) cat "$dir/compare" ;;
*) unexpected "$@" ;;
esac
FAKE_GH
chmod +x "$TMP_DIR/bin/gh"

# ------------------------------------------------------------- 케이스 헬퍼

new_case() { # name
	CASE="$RUN_DIR/$1"
	mkdir -p "$CASE"
	: >"$CASE/calls.log"
	: >"$CASE/comment-body"
	: >"$CASE/out"
	: >"$CASE/err"
	printf 'identical\n' >"$CASE/compare"
}

RC=0
handoff() { # ... args
	set +e
	PATH="$TMP_DIR/bin:$PATH" HANDOFF_CASE="$CASE" node "$BIN" "$@" \
		>"$CASE/out" 2>"$CASE/err"
	RC=$?
	set -e
}

# 인계 YAML 을 코멘트 본문(코드펜스)으로 감싼다.
fenced() { # yaml-file
	printf '```yaml\n%s\n```\n' "$(cat "$1")"
}

# JSON 은 printf 로 짓는다. node 로 지으면 케이스마다 프로세스가 둘씩 늘고,
# mutation 이 그걸 9번 반복해서 스위트가 눈에 띄게 느려진다 — 같은 기계에서 3회씩
# 재서 21.8/21.9/22.2s 대 14.4/14.5/15.5s 였다. 본문처럼 escape 가 필요한 값만
# awk 로 감싼다 — 손으로 escape 하면 실수가 케이스를 조용히 무력화한다.
json_labels() { # csv -> [{"name":..},..]
	local out="" name
	local IFS=','
	for name in ${1:-}; do
		[ -n "$name" ] || continue
		out="$out{\"name\":\"$name\"},"
	done
	printf '[%s]' "${out%,}"
}

json_string() { # file -> "escaped"
	printf '"%s"' "$(awk 'BEGIN { ORS = "" }
		{ gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); print (NR > 1 ? "\\n" : "") $0 }' "$1")"
}

make_issue_json() { # out issue-state labels-csv [body-file ...]
	local out="$1" state="$2" labels="$3" comments="" body
	shift 3
	for body in "$@"; do
		comments="$comments{\"body\":$(json_string "$body")},"
	done
	printf '{"state":"%s","labels":%s,"comments":[%s],"closedByPullRequestsReferences":[]}' \
		"$state" "$(json_labels "$labels")" "${comments%,}" >"$out"
}

make_state_json() { # issue-state issue-labels pr-json-or-none
	local refs="[]" number
	if [ "$3" != "none" ]; then
		number="${3#*\"number\":}"
		number="${number%%,*}"
		refs="[{\"url\":\"https://github.com/o/r/pull/$number\"}]"
		printf '%s' "$3" >"$CASE/pr.json"
	fi
	printf '{"state":"%s","labels":%s,"closedByPullRequestsReferences":%s}' \
		"$1" "$(json_labels "$2")" "$refs" >"$CASE/issue.json"
}

pr_json() { # number state labels-csv rounds checks-json
	local comments="" i
	for ((i = 0; i < $4; i++)); do comments="$comments{\"body\":\"x\"},"; done
	printf '{"number":%s,"state":"%s","labels":%s,"comments":[%s],"statusCheckRollup":%s}' \
		"$1" "$2" "$(json_labels "$3")" "${comments%,}" "$5"
}

GREEN_CHECKS='[{"name":"ci","status":"COMPLETED","conclusion":"SUCCESS"}]'
PENDING_CHECKS='[{"name":"ci","status":"IN_PROGRESS","conclusion":""}]'
FAILED_CHECKS='[{"name":"ci","status":"COMPLETED","conclusion":"FAILURE"}]'

valid_handoff() { # out-file [at] [base_oid]
	cat >"$1" <<YAML
handoff:
  v: 1
  from: pr-reviewer
  to: issue-implement
  subject: pr/7
  at: ${2:-$AT}
  base_oid: ${3:-$BASE_OID}
  run_id: pr7-r1-review
  verdict: red
  findings:
    - id: B1
      severity: blocking
      where: scripts/handoff.mjs:1
      evidence:
        cmd: "node scripts/handoff.mjs state --issue 7"
        got: "BROKEN"
        want: "WAIT checks"
      action:
        type: fix
        cmd: "bash scripts/hooks/policy/test-handoff.sh"
YAML
}

# --------------------------------------------------------------- write 케이스

case_write_missing_field() {
	new_case write-missing-field
	valid_handoff "$CASE/in.yaml"
	grep -v '^  run_id:' "$CASE/in.yaml" >"$CASE/in2.yaml"
	make_issue_json "$CASE/issue.json" OPEN "wip:pr-reviewer"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in2.yaml"
	expect_eq "write/필드 누락 exit" "$RC" "1"
	expect_in "write/필드 누락 메시지" "$CASE/err" "누락: handoff.run_id"
	expect_not_in "write/필드 누락은 안 쓴다" "$CASE/calls.log" "issue comment"
}

case_write_short_oid() {
	new_case write-short-oid
	valid_handoff "$CASE/in.yaml" "24201644"
	make_issue_json "$CASE/issue.json" OPEN "wip:pr-reviewer"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/short OID exit" "$RC" "1"
	expect_in "write/short OID 메시지" "$CASE/err" "handoff.at: full OID 40자"
	expect_not_in "write/short OID 는 안 쓴다" "$CASE/calls.log" "issue comment"
}

case_write_releases_wip() {
	new_case write-releases-wip
	valid_handoff "$CASE/in.yaml"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/정상 exit" "$RC" "0"
	expect_in "write/코멘트 append" "$CASE/calls.log" "issue comment 7 --body-file -"
	# run_id 는 외부 쓰기 3곳에만 붙는다 — 붙는 자리(코멘트 본문)와
	expect_in "write/run_id 는 코멘트에" "$CASE/comment-body" "run_id: pr7-r1-review"
	# 안 붙는 자리(label 조작. GitHub API 가 이미 멱등이다).
	grep -F -- "--remove-label" "$CASE/calls.log" >"$CASE/label-calls" || true
	expect_in "write/wip 해제" "$CASE/label-calls" "issue edit 7 --remove-label wip:pr-reviewer"
	expect_not_in "write/label 에는 run_id 없음" "$CASE/label-calls" "pr7-r1-review"
}

case_write_idempotent() {
	new_case write-idempotent
	valid_handoff "$CASE/in.yaml"
	fenced "$CASE/in.yaml" >"$CASE/existing.md"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer" "$CASE/existing.md"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/멱등 exit" "$RC" "0"
	expect_in "write/멱등 SKIP" "$CASE/out" "SKIP issue/7 run_id=pr7-r1-review"
	expect_not_in "write/멱등이면 두 번 안 쓴다" "$CASE/calls.log" "issue comment"
}

case_write_foreign_stage() {
	new_case write-foreign-stage
	valid_handoff "$CASE/in.yaml"
	make_issue_json "$CASE/issue.json" OPEN "task"
	handoff write --stage issue-implement --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/남의 인계 exit" "$RC" "1"
	expect_in "write/남의 인계 메시지" "$CASE/err" "남의 인계를 대신 쓰지 않는다"
}

case_write_subject_mismatch() {
	new_case write-subject-mismatch
	valid_handoff "$CASE/in.yaml"
	make_issue_json "$CASE/issue.json" OPEN "task"
	handoff write --stage pr-reviewer --issue 7 --pr 9 <"$CASE/in.yaml"
	expect_eq "write/subject 불일치 exit" "$RC" "1"
	expect_in "write/subject 불일치 메시지" "$CASE/err" "--pr 9 과 다르다"
}

# ---------------------------------------------------------------- read 케이스

setup_read_case() { # name issue-labels at head [base_oid]
	new_case "$1"
	valid_handoff "$CASE/in.yaml" "$3" "${5:-$BASE_OID}"
	fenced "$CASE/in.yaml" >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "$2" "$CASE/comment.md"
	printf '{"headRefOid":"%s"}' "$4" >"$CASE/pr.json"
}

case_read_head_match() {
	setup_read_case read-head-match "task" "$AT" "$AT"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/head 일치 exit" "$RC" "0"
	expect_in "read/인계 반환" "$CASE/out" "run_id: pr7-r1-review"
	expect_in "read/wip 부착" "$CASE/calls.log" "issue edit 7 --add-label wip:issue-implement"
}

case_read_at_ancestor() {
	setup_read_case read-at-ancestor "task" "$AT" "$OTHER_OID"
	printf 'ahead\n' >"$CASE/compare"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/조상이면 재시도 exit" "$RC" "3"
	expect_in "read/재시도 메시지" "$CASE/err" "RETRY:"
	# 반송된 read 가 wip 을 남기면 다음 시도가 원인을 "앞 node 가 죽었다" 로 읽는다.
	expect_not_in "read/반송은 wip 을 안 남긴다" "$CASE/calls.log" "--add-label"
}

case_read_at_diverged() {
	setup_read_case read-at-diverged "task" "$AT" "$OTHER_OID"
	printf 'diverged\n' >"$CASE/compare"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/조상 아니면 사용자 exit" "$RC" "4"
	expect_in "read/사용자 메시지" "$CASE/err" "USER:"
	expect_in "read/compare 상태 인용" "$CASE/err" "compare=diverged"
}

case_read_base_oid_ignored() {
	# base_oid 는 기록만 하고 무효화 트리거가 아니다 — at 이 head 와 같으면
	# base_oid 가 무엇이든 통과해야 한다 (#1918 §7).
	setup_read_case read-base-oid-ignored "task" "$AT" "$AT" "$OTHER_OID"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/base_oid 만 달라도 통과" "$RC" "0"
	expect_in "read/base_oid 기록됨" "$CASE/out" "base_oid: $OTHER_OID"
}

case_read_missing_field() {
	new_case read-missing-field
	valid_handoff "$CASE/in.yaml"
	grep -v '^        want:' "$CASE/in.yaml" >"$CASE/in2.yaml"
	fenced "$CASE/in2.yaml" >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "$CASE/comment.md"
	printf '{"headRefOid":"%s"}' "$AT" >"$CASE/pr.json"
	handoff read --stage issue-implement --issue 7
	# 필드 누락 상한은 0 이다 — 재시도가 아니라 곧장 사용자.
	expect_eq "read/필드 누락 exit" "$RC" "4"
	expect_in "read/필드 누락 메시지" "$CASE/err" "누락: handoff.findings[0].evidence.want"
}

case_read_dead_predecessor() {
	setup_read_case read-dead-predecessor "task,wip:issue-implement" "$AT" "$AT"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/죽은 앞 시도 exit" "$RC" "4"
	expect_in "read/죽은 앞 시도 메시지" "$CASE/err" "앞 시도가 인계를 쓰기 전에 죽었다"
}

case_read_no_handoff() {
	new_case read-no-handoff
	printf 'no handoff here\n' >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "$CASE/comment.md"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/인계 없음 exit" "$RC" "4"
	expect_in "read/인계 없음 메시지" "$CASE/err" "앞으로 온 인계가 없다"
}

case_read_fixture_fence() {
	# fixture 블록 스칼라 안에 백틱 3개 펜스가 들어와도 인계 블록이 안 끊긴다.
	new_case read-fixture-fence
	cat >"$CASE/in.yaml" <<YAML
handoff:
  v: 1
  from: pr-reviewer
  to: issue-implement
  subject: issue/7
  run_id: pr7-r2-review
  verdict: red
  findings:
    - id: B1
      severity: blocking
      where: docs/x.md:1
      evidence:
        cmd: "wc -l docs/x.md"
        got: "0"
        want: "1"
      action:
        type: fixture
      fixture: |
        \`\`\`sh
        git grep -c X
        \`\`\`
YAML
	printf '````yaml\n%s\n````\n' "$(cat "$CASE/in.yaml")" >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "$CASE/comment.md"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/중첩 펜스 exit" "$RC" "0"
	expect_in "read/중첩 펜스 본문 보존" "$CASE/out" "git grep -c X"
}

# --------------------------------------------------------------- state 케이스

expect_state() { # label issue-state issue-labels pr-json want
	new_case "state-$1"
	make_state_json "$2" "$3" "$4"
	handoff state --issue 7
	expect_eq "state/$1 exit" "$RC" "0"
	expect_eq "state/$1" "$(cat "$CASE/out")" "$5"
}

case_state_rows() {
	# needs:user 는 최상단이다 — PR 쪽에 붙어도, green 이어도 사용자가 먼저다.
	expect_state needs-user-on-pr OPEN "task" \
		"$(pr_json 7 OPEN "review:approved,needs:user" 0 "$GREEN_CHECKS")" "BLOCKED needs:user"
	expect_state needs-user-on-issue OPEN "task,needs:user" "none" "BLOCKED needs:user"
	expect_state closed CLOSED "task" "none" "DONE"
	expect_state raw OPEN "raw" "none" "BLOCKED raw-promotion"
	expect_state unlabeled OPEN "" "none" "BLOCKED raw-promotion"
	expect_state task-no-pr OPEN "task" "none" "RUN issue-implement"
	expect_state task-closed-pr OPEN "task" \
		"$(pr_json 7 CLOSED "review:approved" 0 "$GREEN_CHECKS")" "RUN issue-implement"
	# 수정 푸시 직후: changes-requested 가 남고 새 커밋엔 리뷰가 없다 → 구현자.
	# 라운드가 임계 미만이라 회고 줄이 이 자리를 가로채지 않는 것도 같이 고정한다.
	expect_state changes-requested OPEN "task" \
		"$(pr_json 7 OPEN "review:changes-requested" 1 "$GREEN_CHECKS")" "RUN issue-implement"
	expect_state no-verdict OPEN "task" \
		"$(pr_json 7 OPEN "" 0 "$GREEN_CHECKS")" "RUN pr-reviewer"
	# 승인에서 마지막 required check 까지 7분26초가 실측된 자리 (#1938).
	expect_state approved-checks-pending OPEN "task" \
		"$(pr_json 7 OPEN "review:approved" 0 "$PENDING_CHECKS")" "WAIT checks"
	expect_state approved-checks-green OPEN "task" \
		"$(pr_json 7 OPEN "review:approved" 0 "$GREEN_CHECKS")" "RUN pr-finalize"
	# 라운드 3 red — 실제로 일어나는 상태다. verdict label 은 changes-requested 이고,
	# checks 의 실패는 다른 게 아니라 라운드 게이트 자신이다 (`review-gate` 가
	# `comments >= cap && !reflect:done` 이면 `exit 1`, 그리고 유일한 required check).
	# 회고 줄이 changes-requested 아래 있으면 여기서 구현자가 다시 불려 나가는데,
	# 그게 같은 게이트가 금지한 "같은 유형에 fix 를 더 쌓기" 다.
	expect_state round3-changes-requested OPEN "task" \
		"$(pr_json 7 OPEN "review:changes-requested" 5 "$FAILED_CHECKS")" "RUN round-reflect"
	# 라운드 3 green(=리뷰어가 승인) — 이때도 게이트가 죽어 있으니 checks 는 failed 다.
	expect_state round3-approved OPEN "task" \
		"$(pr_json 7 OPEN "review:approved" 5 "$FAILED_CHECKS")" "RUN round-reflect"
	# `reflect:done` 이 붙으면 게이트가 풀리고 checks 가 green 이 될 수 있다. #1922 의
	# "라운드 3에서 green 이면 종결" 은 이 상태를 말한다 — 회고 줄이 안 걸린다.
	expect_state round3-reflect-done-green OPEN "task" \
		"$(pr_json 7 OPEN "review:approved,reflect:done" 5 "$GREEN_CHECKS")" "RUN pr-finalize"
	expect_state round3-reflect-done-failed OPEN "task" \
		"$(pr_json 7 OPEN "review:approved,reflect:done" 5 "$FAILED_CHECKS")" "BROKEN"
	# 임계를 넘었는데 checks 가 green 인 조합은 게이트가 required 인 한 도달 불가다
	# (green ⟹ 게이트 통과 ⟹ 임계 미만 또는 reflect:done). 그래도 우선순위는
	# 고정해 둔다 — 차단기가 종결보다 위다.
	expect_state round3-green-unreachable OPEN "task" \
		"$(pr_json 7 OPEN "review:approved" 5 "$GREEN_CHECKS")" "RUN round-reflect"
	# 어느 줄에도 안 맞는다 = 라우팅 구멍. WAIT 과 뭉치면 안 된다.
	expect_state broken OPEN "task" \
		"$(pr_json 7 OPEN "review:approved" 0 "$FAILED_CHECKS")" "BROKEN"
	# 체크가 아직 하나도 안 생긴 PR 을 green 으로 읽으면 검증 0인 채 머지 줄로 간다.
	expect_state approved-no-checks OPEN "task" \
		"$(pr_json 7 OPEN "review:approved" 0 "[]")" "WAIT checks"
	# labeled 재실행 창: 옛 실패와 새 큐가 같이 보이면 pending 이 이긴다.
	expect_state approved-mixed OPEN "task" \
		"$(pr_json 7 OPEN "review:approved" 0 '[{"name":"a","status":"COMPLETED","conclusion":"FAILURE"},{"name":"b","status":"QUEUED","conclusion":""}]')" \
		"WAIT checks"
}

case_state_broken_is_not_wait() {
	# 두 반환이 실제로 다른 문자열인지 본다. 뭉치면 정상 대기와 라우팅 구멍이
	# 관측상 같아진다 — 이 반환이 존재하는 이유 자체가 그 구분이다.
	local broken wait
	broken="$(cat "$RUN_DIR/state-broken/out")"
	wait="$(cat "$RUN_DIR/state-approved-checks-pending/out")"
	[ "$broken" != "$wait" ] || note_fail "state/BROKEN 이 WAIT 과 같은 값이다 ('$broken')"
	expect_eq "state/BROKEN 값" "$broken" "BROKEN"
}

# ------------------------------------------------------------------ 실행 묶음

run_all_cases() { # bin label
	BIN="$1"
	RUN_DIR="$TMP_DIR/runs/$2"
	FAILURES=0
	mkdir -p "$RUN_DIR"

	case_write_missing_field
	case_write_short_oid
	case_write_releases_wip
	case_write_idempotent
	case_write_foreign_stage
	case_write_subject_mismatch

	case_read_head_match
	case_read_at_ancestor
	case_read_at_diverged
	case_read_base_oid_ignored
	case_read_missing_field
	case_read_dead_predecessor
	case_read_no_handoff
	case_read_fixture_fence

	case_state_rows
	case_state_broken_is_not_wait

	[ "$FAILURES" = "0" ]
}

run_all_cases "$HANDOFF" real || {
	echo "FAIL: handoff.mjs 케이스 $FAILURES 건 실패" >&2
	exit 1
}
echo "  cases: 모두 통과 (real)"

# --------------------------------------------- 라운드 임계는 워크플로가 소유

# 임계값을 여기서 다시 적으면 세 번째 사본이 된다. 저장소 밖 픽스처에 다른 값을
# 넣고 그 값이 판정을 바꾸는지 본다 — 코드에 3 이 박혀 있으면 rounds=5 가 회고로
# 가서 이 단언이 깨진다. 저장소 루트는 cwd 에서 오고 모듈은 스크립트 위치에서
# 오므로, 픽스처 안에서 진짜 handoff.mjs 를 그대로 돌릴 수 있다.
FIXTURE="$TMP_DIR/cap-fixture"
fixture_init_repo "$FIXTURE"
mkdir -p "$FIXTURE/.github/workflows"
printf 'github.event.pull_request.comments >= 9\n' >"$FIXTURE/.github/workflows/review-gate.yml"

CASE="$TMP_DIR/runs/cap"
mkdir -p "$CASE"
: >"$CASE/calls.log"
make_state_json OPEN "task" "$(pr_json 7 OPEN "review:approved" 5 "$FAILED_CHECKS")"

set +e
(cd "$FIXTURE" && PATH="$TMP_DIR/bin:$PATH" HANDOFF_CASE="$CASE" \
	node "$HANDOFF" state --issue 7 >"$CASE/out" 2>"$CASE/err")
RC=$?
set -e
expect_eq "cap/exit" "$RC" "0"
expect_eq "cap/임계 9 에서는 라운드 5 가 회고가 아니다" "$(cat "$CASE/out")" "BROKEN"

[ "$FAILURES" = "0" ] || {
	echo "FAIL: 라운드 임계 케이스 $FAILURES 건 실패" >&2
	cat "$CASE/err" >&2
	exit 1
}
echo "  round cap: .github/workflows/review-gate.yml 에서 읽는다"

# ------------------------------------------------------------ mutation 증명

# 케이스가 GREEN 이라는 것은 "돌았다" 이지 "잡는다" 가 아니다. 아래 mutation 은
# 각 수용 기준의 방어선을 하나씩 끊고, 이 파일의 판정이 그때마다 RED 로 뒤집히는지
# 본다. 표적 문자열은 전부 handoff.mjs 에서 그대로 복사한 실제 표기다 — 작성자
# 머릿속 표기로 만들면 작성자의 사각을 그대로 물려받는다.
MUTANT_DIR="$TMP_DIR/mutants"
mkdir -p "$MUTANT_DIR/node_modules"
# 모듈은 스크립트 위치에서 해석된다. 저장소 밖 mutant 가 `yaml` 을 못 찾으면 전부
# 같은 이유로 죽어서 mutation 이 아무것도 증명하지 못한다 — 붙여준다.
ln -s "$(node -p 'require("node:path").dirname(require.resolve("yaml/package.json"))')" \
	"$MUTANT_DIR/node_modules/yaml"

verdict_for() { # bin label
	QUIET=1
	if run_all_cases "$1" "$2"; then
		QUIET=0
		printf 'green\n'
	else
		QUIET=0
		printf 'red\n'
	fi
}

# 한 단계 치환. 적용 안 된 단계는 원본을 그대로 돌려서 GREEN 을 준다 — `\Q` 안에서
# 변수가 보간돼 패턴이 빈 문자열이 된 사고가 이 저장소에 있었다. 단계마다 본다.
mutate_step() { # name step victim replacement in out
	awk -v victim="$3" -v body="$4" '
		index($0, victim) {
			if (body != "") print body
			next
		}
		{ print }
	' "$5" >"$6"
	! cmp -s "$5" "$6" || {
		echo "FAIL: mutation $1 의 $2 단계가 적용되지 않았다 — 표적이 없다: '$3'" >&2
		exit 1
	}
}

# 줄을 옮기는 mutation 은 두 단계다 — 원래 자리에서 지우고, 옮길 자리 아래에 다시
# 넣는다. 지우기만 하면 "줄이 사라졌다" 를 보는 것이지 "순서가 뒤집혔다" 가 아니다.
assert_mutation() { # name victim replacement [victim2 replacement2]
	local name="$1" victim="$2" replacement="$3" victim2="${4:-}" replacement2="${5:-}"
	local mutant got

	mutant="$MUTANT_DIR/$name.mjs"
	mutate_step "$name" 1 "$victim" "$replacement" "$HANDOFF" "$mutant"
	if [ -n "$victim2" ]; then
		mutate_step "$name" 2 "$victim2" "$replacement2" "$mutant" "$mutant.step2"
		mv "$mutant.step2" "$mutant"
	fi

	# 문법이 깨진 mutant 는 어느 케이스로도 RED 다. 그러면 이 증명이 "그 방어선을
	# 잡는다" 가 아니라 "파서가 잡는다" 를 보게 된다.
	node --check "$mutant" || {
		echo "FAIL: mutation $name 이 문법을 깼다 — RED 가 mutation 때문인지 알 수 없다" >&2
		exit 1
	}

	got="$(verdict_for "$mutant" "$name")"
	[ "$got" = "red" ] || {
		echo "FAIL: mutation $name: 스위트가 $got — 이 방어선을 아무 케이스도 안 잡는다" >&2
		exit 1
	}
	echo "  mutation $name: red"
}

# write 가 wip:<node> 를 해제한다
assert_mutation wip-not-released \
	'  if (wip && labels.has(wip)) gh("issue", "edit", String(options.issue), "--remove-label", wip);' \
	''

# BROKEN 이 WAIT 과 안 뭉친다
assert_mutation broken-folded-into-wait \
	'  return "BROKEN";' \
	'  return "WAIT checks";'

# at 이 40자가 아니면 거부한다
assert_mutation short-oid-accepted \
	'const FULL_OID = /^[0-9a-f]{40}$/;' \
	'const FULL_OID = /^[0-9a-f]{7,40}$/;'

# 조상 여부가 재시도와 사용자 report 를 가른다
assert_mutation ancestor-branch-dead \
	'      if (status === "ahead") {' \
	'      if (false) {'

# base_oid 는 무효화 트리거가 아니다
assert_mutation base-oid-as-trigger \
	'    const head = ghJson("pr", "view", prNumber, "--json", "headRefOid").headRefOid;' \
	'    const head = ghJson("pr", "view", prNumber, "--json", "headRefOid").headRefOid;\n    if (String(handoff.base_oid) !== String(head)) toUser("base drift");'

# run_id 가 코멘트의 멱등 키다
assert_mutation run-id-not-idempotent \
	'    handoffsIn(comment.body).some((entry) => String(entry.doc.handoff.run_id) === String(handoff.run_id)),' \
	'    handoffsIn(comment.body).some((entry) => String(entry.doc.handoff.run_id) === "다른-run-id"),'

# needs:user 는 PR 쪽에 붙어도 최상단이다
assert_mutation needs-user-pr-side-dropped \
	'  if (context.issueLabels.has("needs:user") || context.prLabels.has("needs:user")) {' \
	'  if (context.issueLabels.has("needs:user")) {'

# approved & checks 미완 줄이 종결 줄 위에 있다
assert_mutation wait-row-dead \
	'  if (context.checks === "pending") return "WAIT checks";' \
	''

# 회고 줄이 있다
assert_mutation round-row-dead \
	'  if (context.rounds >= context.cap && !context.prLabels.has("reflect:done")) return "RUN round-reflect";' \
	''

# 회고 줄이 `review:changes-requested` **위**에 있다. 아래로 되돌리면 라운드 3 red 가
# 구현자로 가고, 그게 게이트가 금지한 "같은 유형에 fix 를 더 쌓기" 다.
assert_mutation round-row-below-changes-requested \
	'  if (context.rounds >= context.cap && !context.prLabels.has("reflect:done")) return "RUN round-reflect";' \
	'' \
	'  if (context.prLabels.has("review:changes-requested")) return "RUN issue-implement";' \
	'  if (context.prLabels.has("review:changes-requested")) return "RUN issue-implement";\n  if (context.rounds >= context.cap && !context.prLabels.has("reflect:done")) return "RUN round-reflect";'

echo "PASS: handoff write / read / state"
