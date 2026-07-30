#!/usr/bin/env bash
# Mutation proof for scripts/hooks/policy/check-raw-promotion-gate.sh.
#
# 이 가드는 "raw/task 분리의 두 계약이 agent 에게 닿는 자리에 살아 있다" 를
# 주장한다. 그 주장을 깨는 편집을 실제로 만들어 rc 를 재지 않으면 초록은 "위반이
# 없다" 가 아니라 "볼 수 없다" 와 구별되지 않는다 — 이 저장소에서 가장 자주
# 재발하는 리뷰 지적이 정확히 그 자리다.
#
# 각 칸은 fixture 트리를 새로 짓고 편집 하나만 넣는다. 무편집 대조군이 먼저
# rc=0 을 내야 나머지 rc=1 이 의미를 갖는다.
#
# 못 막는 것도 여기 칸으로 남긴다 (`ceiling-*`). 가드가 자기 사각을 안 적으면
# 다음 사람이 그걸 방어로 믿는다.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GUARD="$ROOT/scripts/hooks/policy/check-raw-promotion-gate.sh"
ROUTER="$ROOT/scripts/hooks/apply/pre-push-path-router.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/raw-promotion-gate-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fails=0

# fixture 하나. 가드는 자기 위치에서 ROOT 를 유도하므로 스크립트 본체를 복사하고,
# 편집 대상(agent 정의 + 리뷰어 memory 방)도 복사본으로 둔다.
new_fixture() {
	local name="$1"
	local fix="$TMP_DIR/$name"

	mkdir -p "$fix/scripts/hooks/policy" "$fix/.claude/agents" "$fix/memory/workflow/review"
	cp "$GUARD" "$fix/scripts/hooks/policy/check-raw-promotion-gate.sh"
	cp "$ROOT"/.claude/agents/*.md "$fix/.claude/agents/"
	cp "$ROOT/memory/workflow/review/memory.md" "$fix/memory/workflow/review/memory.md"
	printf '%s\n' "$fix"
}

# rc 만 대조하면 "다른 이유로 red" 를 정답으로 읽는다 — 대상 파일을 지운 칸이
# 엉뚱한 검사에 걸려도 rc=1 이라 통과한다. 그래서 네 번째 인자로 그 칸이 재려던
# 위반 문구의 일부를 같이 요구한다.
expect_rc() {
	local label="$1" want="$2" fix="$3" want_msg="${4:-}"
	local got out

	set +e
	out="$(bash "$fix/scripts/hooks/policy/check-raw-promotion-gate.sh" 2>&1)"
	got=$?
	set -e

	if [ "$got" != "$want" ]; then
		echo "FAIL: $label: rc=$got (want $want)" >&2
		printf '%s\n' "$out" >&2
		fails=$((fails + 1))
		return 0
	fi
	if [ -n "$want_msg" ]; then
		case "$out" in
		*"$want_msg"*) ;;
		*)
			echo "FAIL: $label: rc 는 맞지만 '$want_msg' 를 안 낸다 — 다른 검사에 걸린 것이다" >&2
			printf '%s\n' "$out" >&2
			fails=$((fails + 1))
			return 0
			;;
		esac
	fi
	echo "  $label: rc=$got"
}

# 리터럴 하나를 파일에서 지운다. 편집이 실제로 적용됐는지 확인한다 — 표기가
# 바뀌어 sed 가 0건을 고치고도 조용히 지나가면 그 칸은 아무것도 안 재게 된다.
drop_literal() {
	local file="$1" lit="$2"

	awk -v lit="$lit" '
		{
			out = ""
			line = $0
			while ((p = index(line, lit)) > 0) {
				out = out substr(line, 1, p - 1)
				line = substr(line, p + length(lit))
			}
			print out line
		}
	' "$file" >"$file.tmp"
	! cmp -s "$file" "$file.tmp" || {
		echo "FAIL: '$lit' 삭제가 적용되지 않았다 ($file)" >&2
		exit 1
	}
	mv "$file.tmp" "$file"
}

# 지정 리터럴을 담은 줄 전체를 지운다.
drop_line_with() {
	local file="$1" lit="$2"

	awk -v lit="$lit" 'index($0, lit) == 0' "$file" >"$file.tmp"
	! cmp -s "$file" "$file.tmp" || {
		echo "FAIL: '$lit' 줄 삭제가 적용되지 않았다 ($file)" >&2
		exit 1
	}
	mv "$file.tmp" "$file"
}

# 한 문단을 지정 지점에서 두 블록으로 쪼갠다. 토큰은 파일에 그대로 남으므로
# **파일 전체 grep 이면 통과한다** — 이 칸이 블록 판정을 재는 유일한 칸이다.
split_at() {
	local file="$1" marker="$2"

	awk -v m="$marker" '
		!done { p = index($0, m); if (p > 0) { printf "%s\n\n%s\n", substr($0, 1, p - 1), substr($0, p); done = 1; next } }
		{ print }
	' "$file" >"$file.tmp"
	! cmp -s "$file" "$file.tmp" || {
		echo "FAIL: '$marker' 지점 분할이 적용되지 않았다 ($file)" >&2
		exit 1
	}
	mv "$file.tmp" "$file"
}

# 조항 줄을 다른 문장으로 갈아 끼운다.
replace_line_with() {
	local file="$1" lit="$2" repl="$3"

	awk -v lit="$lit" -v repl="$repl" 'index($0, lit) > 0 { print repl; next } { print }' \
		"$file" >"$file.tmp"
	! cmp -s "$file" "$file.tmp" || {
		echo "FAIL: '$lit' 교체가 적용되지 않았다 ($file)" >&2
		exit 1
	}
	mv "$file.tmp" "$file"
}

GATE_MARK='승격 금지.'
EMIT_MARK='gh issue create'

# --- 대조군 ------------------------------------------------------------------
fix="$(new_fixture control)"
expect_rc "control (무편집)" 0 "$fix"

# --- 검사 1: 승격 문지기 조항 -------------------------------------------------
fix="$(new_fixture gate-clause-deleted)"
drop_line_with "$fix/.claude/agents/issue-refine.md" "$GATE_MARK"
expect_rc "issue-refine 의 승격 문지기 조항 삭제" 1 "$fix" "승격 문지기 조항"

# 토큰은 전부 파일에 남는데 서로 다른 블록에 흩어진다. 파일 전체 grep 이었다면
# 이 칸이 rc=0 이다.
fix="$(new_fixture gate-clause-split)"
split_at "$fix/.claude/agents/issue-refine.md" "$GATE_MARK"
expect_rc "조항을 두 블록으로 쪼갬 (토큰은 파일에 그대로)" 1 "$fix" "승격 문지기 조항"

# 본문에서 빼고 frontmatter `description:` 으로 옮긴다. spawn 선택용 한 줄이지
# node 가 읽는 절차가 아니다.
fix="$(new_fixture gate-clause-frontmatter-only)"
drop_line_with "$fix/.claude/agents/issue-refine.md" "$GATE_MARK"
awk '/^description: / { print $0 " 사용자 지목 없이 `raw` → `task` 승격 금지."; next } { print }' \
	"$fix/.claude/agents/issue-refine.md" >"$fix/t"
! cmp -s "$fix/.claude/agents/issue-refine.md" "$fix/t" || {
	echo "FAIL: frontmatter 이관 편집이 적용되지 않았다" >&2
	exit 1
}
mv "$fix/t" "$fix/.claude/agents/issue-refine.md"
expect_rc "조항을 frontmatter description 으로만 옮김" 1 "$fix" "승격 문지기 조항"

# --- 검사 2: 리뷰어 배출 계약 -------------------------------------------------
fix="$(new_fixture emit-raw-dropped)"
drop_literal "$fix/.claude/agents/pr-reviewer.md" '`raw`'
expect_rc "pr-reviewer 에서 \`raw\` 토큰 삭제" 1 "$fix" "[\`raw\`] 가 없다"

fix="$(new_fixture emit-origin-dropped)"
drop_literal "$fix/memory/workflow/review/memory.md" '출처'
expect_rc "review memory 방에서 출처 토큰 삭제" 1 "$fix" "[출처] 가 없다"

# 배출 지시 자체를 지워 검사를 우회하는 경로. 바닥이 잡는다 — 안 그러면 "대상이
# 없어서 초록" 이 "계약이 지켜져서 초록" 과 구별되지 않는다.
fix="$(new_fixture emit-trigger-dropped)"
drop_literal "$fix/.claude/agents/pr-reviewer.md" "$EMIT_MARK"
expect_rc "pr-reviewer 에서 배출 지시(gh issue create) 자체를 삭제" 1 "$fix" "지시가 하나도 없다"

fix="$(new_fixture emit-target-missing)"
rm -f "$fix/memory/workflow/review/memory.md"
expect_rc "리뷰어 memory 방 자체가 사라짐" 1 "$fix" "memory/workflow/review/memory.md 이 없다"

fix="$(new_fixture gate-target-missing)"
rm -f "$fix/.claude/agents/issue-refine.md"
expect_rc "issue-refine 정의 자체가 사라짐" 1 "$fix" "issue-refine.md 가 없다"

# --- 못 막는 것 --------------------------------------------------------------
# 리터럴 존재 검사의 천장. 토큰 여섯이 다 있는 채로 뜻만 뒤집으면 rc=0 이다.
# 닫으려면 문장의 의미를 판정해야 하고 그건 이 가드의 대상이 아니다 — 뜻이
# 뒤집히는 편집은 diff 에 문장으로 남으므로 리뷰가 잡는다.
fix="$(new_fixture ceiling-negated)"
replace_line_with "$fix/.claude/agents/issue-refine.md" "$GATE_MARK" \
	'사용자 지목 없이도 `raw` → `task` 승격을 한다. 금지 아님.'
expect_rc "ceiling: 토큰을 다 남긴 채 뜻만 뒤집으면 안 잡힌다" 0 "$fix"

# --- 라우터 배선 --------------------------------------------------------------
# `test-pre-push-path-router.sh` 는 추적 `test-*.sh` 가 DRY_RUN 출력에 있는지만
# 본다. `check-*.sh` 스텝은 그 대조에 안 들어와서 한 줄 지워도 두 스위트가 다
# 초록이다 — 라우터 자신이 헤더에 적어 둔 천장이고 #1989 가 일반형을 소유한다.
# 여기서는 이 가드의 두 스텝만 닫는다.
assert_router_wires() {
	local router="$1"
	local missing=""

	grep -qF 'bash scripts/hooks/policy/check-raw-promotion-gate.sh' "$router" ||
		missing="$missing check-raw-promotion-gate.sh"
	grep -qF 'bash scripts/hooks/policy/test-check-raw-promotion-gate.sh' "$router" ||
		missing="$missing test-check-raw-promotion-gate.sh"

	[ -z "$missing" ] || {
		echo "router 미배선:$missing" >&2
		return 1
	}
}

if assert_router_wires "$ROUTER"; then
	echo "  라우터가 두 스텝을 배선한다: rc=0"
else
	echo "FAIL: 라우터가 check/test 스텝을 배선하지 않는다" >&2
	fails=$((fails + 1))
fi

# 그 단언이 no-op 이 아님을 같은 파일에서 증명한다. 스텝 줄을 뺀 사본에 물리면
# 실패해야 한다.
drop_line_with_copy="$TMP_DIR/router-unwired.sh"
awk 'index($0, "raw-promotion-gate") == 0' "$ROUTER" >"$drop_line_with_copy"
! cmp -s "$ROUTER" "$drop_line_with_copy" || {
	echo "FAIL: 라우터에서 raw-promotion-gate 줄을 못 찾았다 — 위 단언이 무엇을 재는지 불명" >&2
	exit 1
}
if assert_router_wires "$drop_line_with_copy" 2>/dev/null; then
	echo "FAIL: 배선 줄을 뺀 사본에서도 단언이 통과한다 — 그 단언은 no-op 이다" >&2
	fails=$((fails + 1))
else
	echo "  배선 줄을 뺀 사본: 단언 실패 (기대대로)"
fi

if [ "$fails" -gt 0 ]; then
	echo "FAIL: check-raw-promotion-gate mutation proof — $fails 칸" >&2
	exit 1
fi

echo "PASS: check-raw-promotion-gate mutation proof"
