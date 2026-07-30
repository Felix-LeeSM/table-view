#!/usr/bin/env bash
# Regression tests for scripts/handoff.mjs — 인계 write / read.
# (`state` 는 이 스위트에 없다. #2006 이 소유한다.)
#
# `gh` 를 PATH 앞에 놓은 가짜로 갈아끼우고, 케이스 디렉터리의 캔 응답을 읽게 한다.
# 진짜 GitHub 을 안 건드리면서 argv 와 코멘트 본문까지 검사할 수 있다.
#
# 파일 끝의 mutation 증명이 이 스위트의 진짜 검증이다. 케이스가 GREEN 인 것은
# "돌았다" 만 말하고 "잡는다" 는 말하지 않는다. 그 증명이 서려면 네 겹이 필요하고,
# 넷 다 이 파일에 있다:
#
#   1. 표적이 실제로 치환됐나 — `cmp -s` (아무것도 안 바꾼 mutation 은 GREEN 이다)
#   2. mutant 가 여전히 파싱되나 — `node --check` (문법을 깨면 파서의 RED 를 증명으로
#      오독한다)
#   3. **변조 안 한 사본이 같은 자리에서 통과하나** — 양성 대조. 없으면 mutant 전부가
#      환경 오류로 같이 죽어도 `mutation …: red` 17줄 + `PASS` + exit 0 이 나온다.
#      실제로 그럴 수 있었다: `ln -s "$(node -p …)"` 는 명령치환이 실패해도
#      `set -euo pipefail` 이 안 잡고 `ln -s "" t` 가 rc=0 으로 길이 0짜리 링크를
#      만든다 (둘 다 실측). 그러면 mutant 가 전부 `MODULE_NOT_FOUND` 로 죽는다.
#   4. **환경 오류를 assertion 사망과 갈라 보나** — `env_broken()`. 그리고 그 판별기가
#      죽지 않았는지를 음성 대조가 본다 (`yaml` 을 뗀 자리에서 `broken` 이 나와야 한다).
#
# 표적 문자열은 이 파일 저자의 머릿속 표기가 아니라 handoff.mjs 에서 그대로 복사한
# 실제 표기다.

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

# 코멘트마다 작성자 신뢰도를 붙인다. `<ASSOC>=<파일>` 이면 그 authorAssociation,
# 아니면 OWNER. 저장소가 PUBLIC 이라 이 필드가 인계의 신뢰 경계다.
make_issue_json() { # out issue-state labels-csv [[ASSOC=]body-file ...]
	local out="$1" state="$2" labels="$3" comments="" spec assoc body
	shift 3
	for spec in "$@"; do
		case "$spec" in
		*=*)
			assoc="${spec%%=*}"
			body="${spec#*=}"
			;;
		*)
			assoc="OWNER"
			body="$spec"
			;;
		esac
		comments="$comments{\"author\":{\"login\":\"tester-$assoc\"},\"authorAssociation\":\"$assoc\",\"body\":$(json_string "$body")},"
	done
	printf '{"state":"%s","labels":%s,"comments":[%s],"closedByPullRequestsReferences":[]}' \
		"$state" "$(json_labels "$labels")" "${comments%,}" >"$out"
}

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
        cmd: "node scripts/handoff.mjs read --stage issue-implement --issue 7"
        got: "exit 4"
        want: "exit 0"
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

case_write_run_id_collision() {
	# 같은 (from,to,subject,run_id) 로 다른 내용을 쓰면 거부다. 스킵하면 새 판정이
	# 조용히 버려지고, wip 까지 풀려서 다음 node 가 사망 탐지도 못 한다.
	new_case write-run-id-collision
	valid_handoff "$CASE/old.yaml" "$OTHER_OID"
	fenced "$CASE/old.yaml" >"$CASE/existing.md"
	valid_handoff "$CASE/in.yaml"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer" "$CASE/existing.md"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/키 충돌 exit" "$RC" "1"
	expect_in "write/키 충돌 메시지" "$CASE/err" "run_id 는 라운드가 아니라 시도 단위여야 한다"
	expect_not_in "write/키 충돌이면 안 쓴다" "$CASE/calls.log" "issue comment"
	expect_not_in "write/키 충돌이면 wip 을 안 뗀다" "$CASE/calls.log" "--remove-label"
}

case_write_cross_identity_same_run_id() {
	# 역할이 다르면 같은 run_id 라도 다른 인계다. 좁히지 않으면 뒤에 쓰는 쪽이 삼켜진다.
	new_case write-cross-identity-same-run-id
	valid_handoff "$CASE/old.yaml"
	fenced "$CASE/old.yaml" >"$CASE/existing.md"
	cat >"$CASE/in.yaml" <<YAML
handoff:
  v: 1
  from: issue-implement
  to: pr-reviewer
  subject: pr/7
  at: $AT
  base_oid: $BASE_OID
  run_id: pr7-r1-review
YAML
	make_issue_json "$CASE/issue.json" OPEN "task,wip:issue-implement" "$CASE/existing.md"
	handoff write --stage issue-implement --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/역할 다르면 별개 exit" "$RC" "0"
	expect_in "write/역할 다르면 올린다" "$CASE/calls.log" "issue comment 7 --body-file -"
	expect_in "write/역할 다르면 wip 해제" "$CASE/calls.log" "--remove-label wip:issue-implement"
}

case_write_fence_variant_dedupe() {
	# GitHub 이 똑같이 렌더하는 변종 펜스로 이미 올라가 있으면 중복 append 가 아니라
	# SKIP 이어야 한다. 중복 스캔이 fail-open 이면 같은 인계가 두 번 쌓인다.
	new_case write-fence-variant-dedupe
	valid_handoff "$CASE/in.yaml"
	printf '~~~yaml\n%s\n~~~\n' "$(cat "$CASE/in.yaml")" >"$CASE/existing.md"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer" "$CASE/existing.md"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/변종 펜스 exit" "$RC" "0"
	expect_in "write/변종 펜스 SKIP" "$CASE/out" "SKIP issue/7"
	expect_not_in "write/변종 펜스면 두 번 안 쓴다" "$CASE/calls.log" "issue comment"
}

case_write_read_roundtrip_indented() {
	# 검증한 문자열과 올리는 문자열이 다르면 write 는 exit 0 인데 read 가 "인계가
	# 없다" 를 준다. 들여쓴 문서 + 형제 키가 그걸 드러낸 fixture 다.
	new_case write-roundtrip-indented
	cat >"$CASE/in.yaml" <<'YAML'
  handoff:
    v: 1
    from: pr-reviewer
    to: issue-implement
    subject: issue/7
    run_id: rt1
  other: x
YAML
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer"
	handoff write --stage pr-reviewer --issue 7 <"$CASE/in.yaml"
	expect_eq "roundtrip/write exit" "$RC" "0"
	expect_in "roundtrip/write 기록" "$CASE/out" "WROTE issue/7 run_id=rt1"

	local posted="$CASE/comment-body"
	new_case write-roundtrip-indented-read
	make_issue_json "$CASE/issue.json" OPEN "task" "$posted"
	handoff read --stage issue-implement --issue 7
	expect_eq "roundtrip/read exit" "$RC" "0"
	expect_in "roundtrip/인계 반환" "$CASE/out" "run_id: rt1"
	expect_in "roundtrip/형제 키 보존" "$CASE/out" "other: x"
}

case_write_labels_never_touch_pr() {
	# --pr 을 줘도 label 은 이슈에만 간다. PR label 이벤트는 review-gate 를 깨우고,
	# 같은 초에 둘 나면 run 하나가 죽어 BLOCKED 가 고착된다 (#1879).
	new_case write-labels-never-touch-pr
	valid_handoff "$CASE/in.yaml"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer,needs:user"
	handoff write --stage pr-reviewer --issue 7 --pr 7 \
		--add-label reviewing --remove-label needs:user <"$CASE/in.yaml"
	expect_eq "labels/--pr 있어도 exit" "$RC" "0"
	grep -E '^issue edit 7' "$CASE/calls.log" >"$CASE/issue-calls" || true
	expect_in "labels/이슈에 add" "$CASE/issue-calls" "--add-label reviewing"
	expect_in "labels/이슈에서 remove" "$CASE/issue-calls" "--remove-label needs:user"
	expect_not_in "labels/PR 은 안 건드린다" "$CASE/calls.log" "pr edit"
}

case_write_labels_on_issue() {
	# --pr 이 없으면 이슈가 대상이다 (승격 전사가 그 자리).
	new_case write-labels-on-issue
	cat >"$CASE/in.yaml" <<'YAML'
handoff:
  v: 1
  from: user
  to: issue-refine
  subject: issue/7
  run_id: promote-7
YAML
	make_issue_json "$CASE/issue.json" OPEN "raw,needs:user"
	handoff write --stage user --issue 7 --add-label task --remove-label needs:user <"$CASE/in.yaml"
	expect_eq "labels/이슈 exit" "$RC" "0"
	grep -E '^issue edit 7' "$CASE/calls.log" >"$CASE/issue-calls" || true
	expect_in "labels/이슈에 add" "$CASE/issue-calls" "--add-label task"
	expect_in "labels/이슈에서 remove" "$CASE/issue-calls" "--remove-label needs:user"
	expect_not_in "labels/PR 은 안 건드린다" "$CASE/calls.log" "pr edit"
	# user 는 node 가 아니라 wip label 이 없다.
	expect_not_in "labels/user 는 wip 없음" "$CASE/calls.log" "wip:user"
}

case_write_labels_noop() {
	# 이미 붙은 것을 또 붙이거나 없는 것을 떼지 않는다 — 호출 자체가 없어야 한다.
	new_case write-labels-noop
	valid_handoff "$CASE/in.yaml"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer"
	handoff write --stage pr-reviewer --issue 7 --pr 7 \
		--add-label task --remove-label reflect:done <"$CASE/in.yaml"
	expect_eq "labels/noop exit" "$RC" "0"
	expect_not_in "labels/이미 있으면 add 안 함" "$CASE/calls.log" "--add-label"
	expect_not_in "labels/없으면 remove 안 함" "$CASE/calls.log" "--remove-label reflect:done"
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

case_read_untrusted_author() {
	# 저장소가 PUBLIC 이다. 아무나 단 코멘트의 인계는 받는 node 가 돌릴 명령을
	# 실어 나르므로 권위 있는 입력이 될 수 없다.
	new_case read-untrusted-author
	valid_handoff "$CASE/in.yaml" "$AT"
	fenced "$CASE/in.yaml" >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "NONE=$CASE/comment.md"
	printf '{"headRefOid":"%s"}' "$AT" >"$CASE/pr.json"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/신뢰 밖 작성자 exit" "$RC" "4"
	expect_in "read/신뢰 밖 거부 사유" "$CASE/err" "authorAssociation=NONE 은 신뢰 경계 밖이다"
	expect_not_in "read/신뢰 밖 인계를 반환하지 않는다" "$CASE/out" "run_id"
	expect_not_in "read/거부면 wip 을 안 붙인다" "$CASE/calls.log" "--add-label"
}

case_read_untrusted_cannot_override() {
	# 신뢰 밖 코멘트가 **나중에** 와도 최신 인계 자리를 뺏지 못한다.
	new_case read-untrusted-cannot-override
	valid_handoff "$CASE/good.yaml" "$AT"
	fenced "$CASE/good.yaml" >"$CASE/good.md"
	sed 's/^  run_id: .*/  run_id: forged/' "$CASE/good.yaml" >"$CASE/bad.yaml"
	fenced "$CASE/bad.yaml" >"$CASE/bad.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "OWNER=$CASE/good.md" "NONE=$CASE/bad.md"
	printf '{"headRefOid":"%s"}' "$AT" >"$CASE/pr.json"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/신뢰 있는 인계 exit" "$RC" "0"
	expect_in "read/신뢰 있는 인계를 준다" "$CASE/out" "run_id: pr7-r1-review"
	expect_not_in "read/위조본을 안 준다" "$CASE/out" "forged"
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

case_read_contributor_rejected() {
	# 신뢰 집합의 **경계**. `NONE` 만 때리면 집합을 넓히는 편집이 안 잡힌다 —
	# `CONTRIBUTOR` 는 PR 한 번 머지된 외부인이고, PUBLIC 저장소에서 가장 싼 위조
	# 경로다. GitHub 이 이 필드에 줄 수 있는 값 8종은 handoff.mjs 의 allowlist 주석에
	# 전수로 적혀 있다.
	new_case read-contributor-rejected
	valid_handoff "$CASE/in.yaml" "$AT"
	fenced "$CASE/in.yaml" >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "CONTRIBUTOR=$CASE/comment.md"
	printf '{"headRefOid":"%s"}' "$AT" >"$CASE/pr.json"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/CONTRIBUTOR 거부 exit" "$RC" "4"
	expect_in "read/CONTRIBUTOR 거부 사유" "$CASE/err" "authorAssociation=CONTRIBUTOR 은 신뢰 경계 밖이다"
	expect_not_in "read/CONTRIBUTOR 인계를 반환하지 않는다" "$CASE/out" "run_id"
}

case_read_uppercase_fence() {
	# GitHub 은 ```YAML 과 ```yaml 을 같은 바이트로 렌더한다 (handoff.mjs 의 FENCE
	# 주석에 `gh api /markdown` 확인 명령이 있다). 대소문자를 가리면 정상 인계를
	# "없다" 로 읽는다.
	new_case read-uppercase-fence
	valid_handoff "$CASE/in.yaml" "$AT"
	printf '```YAML\n%s\n```\n' "$(cat "$CASE/in.yaml")" >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "$CASE/comment.md"
	printf '{"headRefOid":"%s"}' "$AT" >"$CASE/pr.json"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/대문자 펜스 exit" "$RC" "0"
	expect_in "read/대문자 펜스 인계 반환" "$CASE/out" "run_id: pr7-r1-review"
}

case_write_uppercase_fence_dedupe() {
	# 같은 인계가 ```YAML 펜스로 이미 있는데 중복 스캔이 그걸 못 보면 fail-open 이라
	# 코멘트가 두 번 올라간다. `read` 는 fail-closed 지만 `write` 는 아니다.
	new_case write-uppercase-fence-dedupe
	valid_handoff "$CASE/in.yaml"
	printf '```YAML\n%s\n```\n' "$(cat "$CASE/in.yaml")" >"$CASE/existing.md"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer" "$CASE/existing.md"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/대문자 펜스 exit" "$RC" "0"
	expect_in "write/대문자 펜스 SKIP" "$CASE/out" "SKIP issue/7"
	expect_not_in "write/대문자 펜스면 두 번 안 쓴다" "$CASE/calls.log" "issue comment"
}

case_write_untrusted_collision_ignored() {
	# `write` 쪽 신뢰 필터. 외부인이 같은 (from,to,subject,run_id) 로 다른 내용을
	# 심어도 정상 write 를 막지 못해야 한다 — 막히면 외부인이 인계를 exit 1 로
	# 고착시킬 수 있다.
	new_case write-untrusted-collision-ignored
	valid_handoff "$CASE/old.yaml" "$OTHER_OID"
	fenced "$CASE/old.yaml" >"$CASE/forged.md"
	valid_handoff "$CASE/in.yaml"
	make_issue_json "$CASE/issue.json" OPEN "task,wip:pr-reviewer" "NONE=$CASE/forged.md"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/신뢰 밖 충돌은 무시 exit" "$RC" "0"
	expect_in "write/신뢰 밖 충돌이어도 올린다" "$CASE/out" "WROTE issue/7"
	expect_in "write/신뢰 밖 거부 사유는 남긴다" "$CASE/err" "신뢰 경계 밖이다"
}

case_read_module_missing() {
	# BF2. `yaml` 이 안 잡히는 자리에서 도는 것은 **운영 실패(exit 2)** 다.
	# 이 구분이 없으면 `read` 는 exit 4 `앞 node 가 아예 안 돌았다` (#1918 §10 의 사망
	# 탐지 신호이자 스킬이 "재시도로 안 고쳐진다" 로 못박은 코드) 를 주고, `write` 는
	# exit 1 (=입력을 고쳐 다시 써라) 을 줘서 agent 가 멀쩡한 YAML 을 계속 고친다.
	# 둘 다 진짜 원인은 `npm install` 한 줄이다.
	new_case read-module-missing
	# 이 케이스만 일부러 모듈 오류를 낸다. env_broken() 이 이 표식을 보고 건너뛴다 —
	# 안 그러면 정상 실행이 매번 "환경이 깨졌다" 로 읽힌다.
	printf 'BF2\n' >"$CASE/expects-module-error"
	local bare="$CASE/bare" saved="$BIN"
	mkdir -p "$bare"
	cp "$BIN" "$bare/handoff.mjs"
	valid_handoff "$CASE/in.yaml" "$AT"
	fenced "$CASE/in.yaml" >"$CASE/comment.md"
	make_issue_json "$CASE/issue.json" OPEN "task" "$CASE/comment.md"
	printf '{"headRefOid":"%s"}' "$AT" >"$CASE/pr.json"

	BIN="$bare/handoff.mjs"
	handoff read --stage issue-implement --issue 7
	expect_eq "read/모듈 부재 exit" "$RC" "2"
	expect_in "read/모듈 부재 원인" "$CASE/err" "npm install"
	expect_not_in "read/모듈 부재를 사망 신호로 안 읽는다" "$CASE/err" "앞 node 가 아예 안 돌았다"
	handoff write --stage pr-reviewer --issue 7 --pr 7 <"$CASE/in.yaml"
	expect_eq "write/모듈 부재 exit" "$RC" "2"
	expect_not_in "write/모듈 부재를 입력 실패로 안 읽는다" "$CASE/err" "표준입력 YAML 파싱 실패"
	BIN="$saved"
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
	case_write_run_id_collision
	case_write_cross_identity_same_run_id
	case_write_fence_variant_dedupe
	case_write_read_roundtrip_indented
	case_write_labels_never_touch_pr
	case_write_labels_on_issue
	case_write_labels_noop
	case_write_foreign_stage
	case_write_subject_mismatch
	case_write_uppercase_fence_dedupe
	case_write_untrusted_collision_ignored

	case_read_head_match
	case_read_at_ancestor
	case_read_at_diverged
	case_read_base_oid_ignored
	case_read_missing_field
	case_read_dead_predecessor
	case_read_no_handoff
	case_read_untrusted_author
	case_read_untrusted_cannot_override
	case_read_contributor_rejected
	case_read_fixture_fence
	case_read_uppercase_fence
	case_read_module_missing

	[ "$FAILURES" = "0" ]
}

run_all_cases "$HANDOFF" real || {
	echo "FAIL: handoff.mjs 케이스 $FAILURES 건 실패" >&2
	exit 1
}
echo "  cases: 모두 통과 (real)"

# ------------------------------------------------------------ mutation 증명

# 케이스가 GREEN 이라는 것은 "돌았다" 이지 "잡는다" 가 아니다. 아래 mutation 은
# 각 수용 기준의 방어선을 하나씩 끊고, 이 파일의 판정이 그때마다 RED 로 뒤집히는지
# 본다. 표적 문자열은 handoff.mjs 에서 그대로 복사한 실제 표기여야 하고, 그걸
# 강제하는 것이 `mutate_step` 의 `cmp -s` 다 — 표적이 파일에 없으면 스위트가 그
# 자리에서 하드 FAIL 한다. 작성자 머릿속 표기로 만들면 작성자의 사각을 물려받는다.
MUTANT_DIR="$TMP_DIR/mutants"
mkdir -p "$MUTANT_DIR/node_modules"

# 모듈은 스크립트 위치에서 해석된다. 저장소 밖 mutant 가 `yaml` 을 못 찾으면 전부
# 같은 이유로 죽어서 mutation 이 아무것도 증명하지 못한다 — 붙여준다.
#
# **대입으로 받는다.** `ln -s "$(node -p …)"` 로 쓰면 안 된다: 명령치환이 실패해도
# 그 상태가 인자 자리에서는 simple command 의 상태로 안 올라가서 `set -euo pipefail`
# 이 안 잡고, 이어지는 `ln -s "" t` 는 rc=0 으로 길이 0짜리 링크를 만든다. 둘 다
# 실측이다. 대입은 반대로 치환의 상태가 곧 대입의 상태라 `set -e` 가 그 자리에서
# 끊는다. 해석 기준도 cwd 가 아니라 $ROOT 다 — 저장소 밖에서 스위트를 돌려도 같은
# 곳을 본다.
YAML_DIR="$(node -p \
	'require("node:path").dirname(require.resolve("yaml/package.json", { paths: [process.argv[1]] }))' \
	"$ROOT")"
[ -d "$YAML_DIR" ] || {
	echo "FAIL: yaml 모듈 위치가 디렉터리가 아니다: '$YAML_DIR' — 저장소에서 npm install 해라" >&2
	exit 1
}
ln -s "$YAML_DIR" "$MUTANT_DIR/node_modules/yaml"

# mutant 가 **방어선 때문에** 죽었는지 **환경 때문에** 죽었는지 가른다. 후자면 mutant
# 전부가 같은 이유로 죽어서 red 가 증명이 아니다. 실측된 방아쇠는 위 심링크지만,
# handoff.mjs 에 의존성이 하나 더 붙어도 같은 일이 난다 — 그래서 심링크가 아니라
# **증상**을 본다: node loader 의 문자열과 handoff.mjs 가 운영 실패로 내는 문자열.
ENV_ERROR='MODULE_NOT_FOUND|Cannot find (module|package)|모듈이 없다'

# 일부러 모듈을 뗀 케이스(read-module-missing)는 그 문자열이 곧 단언이라 건너뛴다.
# 표식이 없으면 정상 실행이 매번 broken 으로 읽힌다 — 필터가 실제로 거르는 것이
# 그거고, 음성 대조가 그 필터 때문에 판별기가 죽지 않았음을 따로 증명한다.
env_broken() { # run-dir
	local dir hits=""
	for dir in "$1"/*/; do
		if [ -e "$dir/expects-module-error" ]; then
			continue
		fi
		if [ -f "$dir/err" ] && grep -qE "$ENV_ERROR" "$dir/err"; then
			hits="$dir"
			break
		fi
	done
	[ -n "$hits" ]
}

verdict_for() { # bin label -> green | red | broken
	local rc=0
	QUIET=1
	run_all_cases "$1" "$2" || rc=1
	QUIET=0
	if env_broken "$TMP_DIR/runs/$2"; then
		printf 'broken\n'
	elif [ "$rc" = "0" ]; then
		printf 'green\n'
	else
		printf 'red\n'
	fi
}

# 한 단계 치환. 적용 안 된 단계는 원본을 그대로 돌려서 GREEN 을 준다 — `\Q` 안에서
# 변수가 보간돼 패턴이 빈 문자열이 된 사고가 이 저장소에 있었다. 단계마다 본다.
#
# 표적/치환값은 `-v` 가 아니라 **환경**으로 넘긴다. `awk -v` 는 값의 escape 를
# 해석해서 `\s` 같은 비표준 escape 를 `s` 로 뭉개고, 그러면 정규식을 표적으로 삼을
# 수가 없다 (여기서 실제로 겪었다). `ENVIRON` 은 그 처리를 안 한다. 줄을 늘릴 때만
# `%%NL%%` 를 개행으로 편다 — `\n` 을 그 표식으로 쓰면 정규식 안의 `\n` 까지 같이
# 깨진다.
mutate_step() { # name step victim replacement in out
	MUT_VICTIM="$3" MUT_BODY="$4" awk '
		BEGIN {
			victim = ENVIRON["MUT_VICTIM"]
			body = ENVIRON["MUT_BODY"]
			gsub(/%%NL%%/, "\n", body)
		}
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
	case "$got" in
	red) ;;
	broken)
		# red 와 갈라 놓는 자리. 여기서 뭉치면 mutant 가 모듈을 못 찾아 죽은 것도
		# "방어선을 잡았다" 로 세어진다 — 그게 이 스위트가 통째로 헛돌던 경로다.
		echo "FAIL: mutation $name 이 환경 오류로 죽었다 (모듈 미해석) — 이 red 는 방어선이 아니다" >&2
		exit 1
		;;
	*)
		echo "FAIL: mutation $name: 스위트가 $got — 이 방어선을 아무 케이스도 안 잡는다" >&2
		exit 1
		;;
	esac
	echo "  mutation $name: red"
}

# 양성 대조 — mutant 와 **같은 자리**에 변조 안 한 사본을 놓고 green 인지 본다.
# 위쪽의 `run_all_cases "$HANDOFF" real` 은 이걸 대신 못 한다: 저장소 안에서 도니까
# node_modules 가 그냥 잡힌다. 여기가 green 이 아니면 아래 mutation 의 red 는 전부
# 같은 이유로 난 것이고, 그때 `PASS` 를 내면 이 스위트의 증거가 통째로 공허해진다.
assert_positive_control() {
	local got
	cp "$HANDOFF" "$MUTANT_DIR/positive-control.mjs"
	got="$(verdict_for "$MUTANT_DIR/positive-control.mjs" positive-control)"
	[ "$got" = "green" ] || {
		echo "FAIL: 양성 대조가 $got — mutant 자리에서 변조 안 한 사본이 통과하지 않는다." >&2
		echo "      아래 mutation 이 red 여도 방어선을 증명하지 못한다. read-head-match 의 stderr:" >&2
		head -n 2 "$TMP_DIR/runs/positive-control/read-head-match/err" 2>/dev/null >&2
		exit 1
	}
	echo "  positive control: green (변조 안 한 사본이 mutant 자리에서 통과한다)"
}

# 음성 대조 — 그 자리에서 `yaml` 만 떼면 판정이 green 도 red 도 아닌 `broken` 이어야
# 한다. 이게 없으면 "양성 대조가 green" 이 무엇을 배제했는지 알 수 없다. 판별기가
# 죽으면 (ENV_ERROR 오타, env_broken 의 표식 필터가 전부를 건너뜀 등) 여기서 걸린다.
assert_negative_control() {
	local dir="$TMP_DIR/no-yaml" got
	mkdir -p "$dir"
	cp "$HANDOFF" "$dir/negative-control.mjs"
	got="$(verdict_for "$dir/negative-control.mjs" negative-control)"
	[ "$got" = "broken" ] || {
		echo "FAIL: 음성 대조가 $got — yaml 을 뗀 자리인데 환경 오류로 안 갈린다. 판별기가 죽었다." >&2
		exit 1
	}
	echo "  negative control: broken (yaml 을 떼면 환경 오류로 갈린다)"
}

# mutant 와 대조 둘은 서로 독립이고(각자 RUN_DIR) 저마다 케이스 전체를 다시 돈다 —
# 하나가 곧 스위트 한 벌이라 직렬로 두면 개수에 그대로 비례한다. 서브셸이라 전역이
# 안 섞인다. 같은 기계에서 3회씩, `s=$(date +%s%N); bash scripts/hooks/policy/
# test-handoff.sh; e=$(date +%s%N)` 의 차 (2026-07-30, 19 job = mutation 17 + 대조 2):
#   (기본, 병렬)                        13837 / 14919 / 14882 ms
#   HANDOFF_TEST_MUTATION_JOBS=serial   58640 / 56594 / 76872 ms
# 직렬 쪽 편차가 큰 건 부하를 타서다. 흔들리면 `serial` 로 돌려 하나씩 본다.
MUT_PIDS=""
MUT_NAMES=""
MUTATION_JOBS="${HANDOFF_TEST_MUTATION_JOBS:-parallel}"

queue_job() { # name cmd...
	local name="$1"
	shift
	if [ "$MUTATION_JOBS" = "serial" ]; then
		"$@"
		return
	fi
	"$@" >"$MUTANT_DIR/$name.log" 2>&1 &
	MUT_PIDS="$MUT_PIDS $!"
	MUT_NAMES="$MUT_NAMES $name"
}

queue_mutation() { # 인자는 assert_mutation 과 같다
	queue_job "$1" assert_mutation "$@"
}

await_mutations() {
	local status=0 pid name
	for pid in $MUT_PIDS; do wait "$pid" || status=1; done
	# 큐에 넣은 순서로 출력해서 병렬이 로그 순서를 흔들지 않게 한다.
	for name in $MUT_NAMES; do cat "$MUTANT_DIR/$name.log"; done
	[ "$status" = "0" ] || exit 1
}

# 대조 둘이 먼저다 — 둘 중 하나라도 어긋나면 아래 red 들이 증명이 아니다.
queue_job positive-control assert_positive_control
queue_job negative-control assert_negative_control

# write 가 wip:<node> 를 해제한다
queue_mutation wip-not-released \
	'  if (wip && labels.has(wip)) gh("issue", "edit", String(options.issue), "--remove-label", wip);' \
	''

# at 이 40자가 아니면 거부한다
queue_mutation short-oid-accepted \
	'const FULL_OID = /^[0-9a-f]{40}$/;' \
	'const FULL_OID = /^[0-9a-f]{7,40}$/;'

# 조상 여부가 재시도와 사용자 report 를 가른다
queue_mutation ancestor-branch-dead \
	'      if (status === "ahead") {' \
	'      if (false) {'

# base_oid 는 무효화 트리거가 아니다
queue_mutation base-oid-as-trigger \
	'    const head = ghJson("pr", "view", prNumber, "--json", "headRefOid").headRefOid;' \
	'    const head = ghJson("pr", "view", prNumber, "--json", "headRefOid").headRefOid;%%NL%%    if (String(handoff.base_oid) !== String(head)) toUser("base drift");'

# 같은 키 같은 내용이면 두 번 안 올린다
queue_mutation run-id-not-idempotent \
	'  const already = sameKey.find((entry) => canonical(entry.doc) === canonical(doc));' \
	'  const already = undefined;'

# 멱등 키는 run_id 단독이 아니라 (from, to, subject, run_id) 다
queue_mutation identity-key-run-id-only \
	'  JSON.stringify([normalizeRole(h.from), normalizeRole(h.to), String(h.subject), String(h.run_id)]);' \
	'  JSON.stringify([String(h.run_id)]);'

# 같은 키 다른 내용은 SKIP 이 아니라 거부다 — 스킵하면 새 판정이 조용히 버려진다
queue_mutation collision-skipped-not-rejected \
	'  if (sameKey.length > 0 && !already) {' \
	'  if (false) {'

# 검증한 문자열과 올리는 문자열이 같아야 한다 (들여쓴 YAML 이 깨지던 자리)
queue_mutation payload-trimmed-again \
	'  const payload = raw.trimEnd();' \
	'  const payload = raw.trim();'

# 되읽기 검사가 없으면 그 깨진 본문이 exit 0 으로 올라간다 — 받는 쪽 진단이 틀린다
queue_mutation readback-check-dropped \
	'  const payload = raw.trimEnd();' \
	'  const payload = raw.trim();' \
	'  if (readBack.length !== 1 || canonical(readBack[0].doc) !== canonical(doc)) {' \
	'  if (false) {'

# 신뢰 밖 작성자의 인계를 거부한다 (저장소 PUBLIC)
queue_mutation author-trust-dropped \
	'    if (!TRUSTED_ASSOCIATIONS.has(association)) {' \
	'    if (false) {'

# 신뢰 **집합**을 넓히는 편집도 잡는다. `CONTRIBUTOR` 는 PR 한 번 머지된 외부인이다
# (#1997 의 WEAK-trust-set-widened).
queue_mutation trust-set-widened \
	'const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);' \
	'const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR"]);'

# `write` 의 중복 스캔도 신뢰 필터를 지난다 — 안 지나면 외부인이 남의 키로 코멘트를
# 심어 write 를 exit 1 로 고착시킨다 (#1997 의 WEAK-write-scan-untrusted).
queue_mutation write-scan-skips-trust \
	'  const sameKey = trustedHandoffs(issue.comments).filter(' \
	'  const sameKey = (issue.comments ?? []).flatMap((c) => handoffsIn(c.body)).filter('

# BF2 — `yaml` 모듈 부재(운영 실패)를 catch 가 삼키면 `read` 는 사망 신호를, `write` 는
# 입력 실패를 준다. Halt 를 다시 던지는 두 줄이 그걸 가른다.
queue_mutation module-error-swallowed-in-scan \
	'      rethrowHalt(error); // 모듈 부재는 운영 실패다. "인계가 아니다" 로 뭉개지 않는다.' \
	''

queue_mutation module-error-as-input-error \
	'    rethrowHalt(error); // 모듈 부재를 exit 1 로 주면 agent 가 멀쩡한 YAML 을 계속 고친다.' \
	''

# BF3 — info string 대소문자. `i` 를 떼면 ```YAML 펜스가 안 잡히고, `write` 의 중복
# 스캔은 fail-open 이라 같은 인계가 두 번 올라간다.
queue_mutation fence-case-sensitive \
	'  /(?:^|\n)[ ]{0,3}(`{3,}|~{3,})[ \t]*yaml\b[^\n]*\r?\n([\s\S]*?)\r?\n[ ]{0,3}\1[ \t]*(?=\r?\n|$)/gi;' \
	'  /(?:^|\n)[ ]{0,3}(`{3,}|~{3,})[ \t]*yaml\b[^\n]*\r?\n([\s\S]*?)\r?\n[ ]{0,3}\1[ \t]*(?=\r?\n|$)/g;'

# label 갱신 블록이 실제로 돈다
queue_mutation label-block-dead \
	'  if (options.addLabel.length > 0 || options.removeLabel.length > 0) {' \
	'  if (false) {'

# label 은 이슈에만 간다 — PR label 이벤트는 review-gate 를 깨워 run 을 죽인다 (#1879)
queue_mutation label-target-pr \
	'    if (add.length > 0) gh("issue", "edit", String(options.issue), "--add-label", add.join(","));' \
	'    if (add.length > 0) gh("pr", "edit", String(options.pr), "--add-label", add.join(","));'

await_mutations

echo "PASS: handoff write / read"
