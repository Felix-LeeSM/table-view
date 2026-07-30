#!/usr/bin/env bash
# Mutation proof for scripts/hooks/policy/check-agent-reach.sh.
#
# 이 가드는 "설정이 subagent 에 닿는가" 를 주장한다. 그 주장을 깨는 편집을 실제로
# 만들어서 rc 를 재지 않으면, 초록은 "위반이 없다" 가 아니라 "볼 수 없다" 와
# 구별되지 않는다 — 리뷰 라운드 1 에서 약한 편집 네 종이 전부 rc=0 으로 통과했다.
#
# 각 칸은 fixture 저장소를 하나 새로 짓고 편집 하나만 넣는다. 무편집 대조군이
# 먼저 rc=0 을 내야 나머지 rc=1 이 의미를 갖는다.
#
# 못 막는 것도 여기 적는다 (`ceiling-*` 칸). 가드가 자기 사각을 안 적으면 다음
# 사람이 그걸 방어로 믿는다.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GUARD="$ROOT/scripts/hooks/policy/check-agent-reach.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-reach-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fails=0

# fixture 하나. 가드는 자기 위치에서 ROOT 를 유도하므로 스크립트 본체는 복사하고,
# 판정 SOT (`check-dangerous-bash.sh`) 와 skill 본문은 실물을 심링크해 두 벌이
# 생기지 않게 한다. 편집 대상 (`rules` wrapper 와 agent 정의) 만 복사본이다.
new_fixture() {
	local name="$1"
	local fix="$TMP_DIR/$name"

	mkdir -p "$fix/scripts/hooks/policy" "$fix/.claude/rules" "$fix/.claude/agents" \
		"$fix/.codex/agents" "$fix/.agents"
	cp "$GUARD" "$fix/scripts/hooks/policy/check-agent-reach.sh"
	ln -s "$ROOT/scripts/hooks/policy/check-dangerous-bash.sh" "$fix/scripts/hooks/policy/check-dangerous-bash.sh"
	ln -s "$ROOT/.agents/skills" "$fix/.agents/skills"
	cp "$ROOT/.claude/rules/git-policy.md" "$fix/.claude/rules/git-policy.md"
	cp "$ROOT"/.claude/agents/*.md "$fix/.claude/agents/"
	cp "$ROOT"/.codex/agents/*.md "$fix/.codex/agents/"
	printf '%s\n' "$fix"
}

# 가드를 fixture 에서 돌리고 rc 를 기대와 대조한다.
expect_rc() {
	local label="$1" want="$2" fix="$3"
	local got out

	set +e
	out="$(bash "$fix/scripts/hooks/policy/check-agent-reach.sh" 2>&1)"
	got=$?
	set -e

	if [ "$got" != "$want" ]; then
		echo "FAIL: $label: rc=$got (want $want)" >&2
		printf '%s\n' "$out" >&2
		fails=$((fails + 1))
		return 0
	fi
	echo "  $label: rc=$got"
}

# `skills:` 한 줄 삭제.
drop_skills() {
	local file="$1"
	local tmp="$file.tmp"

	grep -v '^skills:' "$file" >"$tmp"
	! cmp -s "$file" "$tmp" || {
		echo "FAIL: $file 에 skills: 줄이 없어 편집이 적용되지 않았다" >&2
		exit 1
	}
	mv "$tmp" "$file"
}

# 삭제한 배선을 다른 파일에서 되채워 바닥값을 만족시킨다. 그래야 그 칸의 rc 가
# 바닥이 아니라 **검사 2 자체**의 판정이 된다.
rewire_elsewhere() {
	local file="$1"

	awk 'NR == 2 { print; print "skills: [remember]"; next } { print }' "$file" >"$file.tmp"
	mv "$file.tmp" "$file"
}

# --- 대조군 ------------------------------------------------------------------
fix="$(new_fixture control)"
expect_rc "control (무편집)" 0 "$fix"

# --- 검사 0: `paths` 선택자 --------------------------------------------------
# 도달을 정하는 유일한 필드다. 본문은 손대지 않고 선택자만 좁히면 리터럴 대조는
# 21/21 그대로 통과하므로, 이 칸이 red 가 아니면 검사 0 이 존재하지 않는 것이다.
fix="$(new_fixture paths-narrowed)"
sed -e 's#^  - "\*\*"$#  - "docs/**/*.md"#' "$fix/.claude/rules/git-policy.md" >"$fix/w.tmp"
! cmp -s "$fix/.claude/rules/git-policy.md" "$fix/w.tmp" || {
	echo "FAIL: paths-narrowed 편집이 적용되지 않았다 — wrapper 의 paths 표기가 바뀌었다" >&2
	exit 1
}
mv "$fix/w.tmp" "$fix/.claude/rules/git-policy.md"
expect_rc "paths 를 docs/**/*.md 로 좁힘" 1 "$fix"

# frontmatter 를 통째로 지운 상태는 `paths: ["**"]` 와 **같은 상태**다 (#1978).
# 이 칸이 red 가 되면 검사 0 이 도달이 아니라 표기를 재고 있는 것이다.
fix="$(new_fixture no-frontmatter)"
awk 'NR == 1 && $0 == "---" { skip = 1; next } skip && $0 == "---" { skip = 0; next } !skip' \
	"$fix/.claude/rules/git-policy.md" >"$fix/w.tmp"
mv "$fix/w.tmp" "$fix/.claude/rules/git-policy.md"
expect_rc "frontmatter 통째 삭제 (선택자 없음 = 보편)" 0 "$fix"

# --- 검사 1: 차단 목록 파생 --------------------------------------------------
fix="$(new_fixture literal-dropped)"
grep -v '^`git commit --no-verify`' "$fix/.claude/rules/git-policy.md" >"$fix/w.tmp"
! cmp -s "$fix/.claude/rules/git-policy.md" "$fix/w.tmp" || {
	echo "FAIL: literal-dropped 편집이 적용되지 않았다" >&2
	exit 1
}
mv "$fix/w.tmp" "$fix/.claude/rules/git-policy.md"
expect_rc "차단 리터럴 한 줄 삭제" 1 "$fix"

# --- 검사 2: `skills:` 배선 --------------------------------------------------
# 본문이 스킬을 산문으로 부르는 파일. 배선을 되채워 바닥을 만족시켜도 red 여야
# 한다 — 이 칸이 매처를 재는 유일한 칸이다. 라운드 1 에서는 본문의 백틱과
# `skill` 사이에 줄바꿈이 있어 rc=0 이었다.
fix="$(new_fixture skills-dropped-with-prose)"
drop_skills "$fix/.claude/agents/security-handoff.md"
rewire_elsewhere "$fix/.claude/agents/research.md"
expect_rc "산문이 부르는 skill 의 배선 삭제 (바닥은 만족)" 1 "$fix"

# 바닥값. 배선을 되채우지 않으면 4→3 이라 바닥이 잡는다.
fix="$(new_fixture skills-dropped-no-prose)"
drop_skills "$fix/.claude/agents/issue-implement.md"
expect_rc "산문이 안 부르는 skill 의 배선 삭제 (바닥이 잡는다)" 1 "$fix"

# --- 검사 3: codex 포인터 ----------------------------------------------------
# `.claude` 쪽 정의 이름을 바꾸면 codex wrapper 는 그대로 남아 없는 파일을 가리킨다.
# 그 wrapper 의 정책 본문은 그 한 줄이 전부라 도달이 0 이 된다.
fix="$(new_fixture codex-source-dangling)"
mv "$fix/.claude/agents/research.md" "$fix/.claude/agents/research-renamed.md"
expect_rc "codex 포인터가 없는 source 를 가리킴" 1 "$fix"

# 포인터가 실재하지만 **다른** agent 를 가리키는 경우.
fix="$(new_fixture codex-source-crossed)"
sed 's#^source: .claude/agents/research.md$#source: .claude/agents/pr-reviewer.md#' \
	"$fix/.codex/agents/research.md" >"$fix/t"
! cmp -s "$fix/.codex/agents/research.md" "$fix/t" || {
	echo "FAIL: codex-source-crossed 편집이 적용되지 않았다" >&2
	exit 1
}
mv "$fix/t" "$fix/.codex/agents/research.md"
expect_rc "codex 포인터가 다른 agent 를 가리킴" 1 "$fix"

# --- 못 막는 것 --------------------------------------------------------------
# 배선을 지운 자리를 다른 파일이 메우면 총계가 안 변하고, 본문이 그 스킬을 산문으로
# 안 부르므로 검사 2 도 발화하지 않는다. `issue-implement.md` 의 세 스킬이 그
# 상태이고 실측 주입량은 282줄 / 9,523자다. 닫으려면 "이 agent 는 이 스킬을 받아야
# 한다" 는 기대 목록이 필요한데, 그건 지금 없는 SOT 라서 여기서 만들지 않는다.
fix="$(new_fixture ceiling-swap)"
drop_skills "$fix/.claude/agents/issue-implement.md"
rewire_elsewhere "$fix/.claude/agents/research.md"
expect_rc "ceiling: 배선을 다른 파일로 옮기면 총계가 같아 안 잡힌다" 0 "$fix"

# `.claude` 정의의 `tools:` 를 뒤집어도 `source` 는 그대로 실재하므로 검사 3 이
# 안 잡는다. `.codex` 쪽에는 대조할 사본이 없기 때문에 (#1987 이 그 사본을 없앤
# 것이 목적이었다) "두 쪽 비교" 로는 닫히지 않는다. 닫으려면 정의 본문의 의미를
# 판정해야 하고 그건 이 가드의 대상이 아니다.
fix="$(new_fixture ceiling-tools-flipped)"
sed 's#^tools: \[Read, Grep, Glob, WebFetch\]$#tools: [Read, Edit, Write, Bash, Grep, Glob]#' \
	"$fix/.claude/agents/research.md" >"$fix/t"
! cmp -s "$fix/.claude/agents/research.md" "$fix/t" || {
	echo "FAIL: ceiling-tools-flipped 편집이 적용되지 않았다 — research.md 의 tools 표기가 바뀌었다" >&2
	exit 1
}
mv "$fix/t" "$fix/.claude/agents/research.md"
expect_rc "ceiling: read-only agent 에 Bash/Write 를 줘도 안 잡힌다" 0 "$fix"

if [ "$fails" -gt 0 ]; then
	echo "FAIL: check-agent-reach mutation proof — $fails 칸" >&2
	exit 1
fi

echo "PASS: check-agent-reach mutation proof"
