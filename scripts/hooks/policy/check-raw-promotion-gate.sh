#!/usr/bin/env bash
# check-raw-promotion-gate.sh
# raw / task 분리의 두 계약이 **닿는 자리에 살아 있는지** (#1921, 설계 SOT #1918 §5).
#
#   1. 승격 문지기 — `issue-refine` 정의가 "사용자 지목 없이 raw → task 승격
#      금지" 를 적고 있는가.
#   2. 리뷰어 배출 — 리뷰어가 `gh issue create` 를 지시하는 자리마다 그 이슈가
#      `raw` 이고 출처를 단다고 같이 적혀 있는가.
#
# ## 왜 문서 검사가 유일한 집행 지점인가
#
# 승격의 관측 가능한 형태는 **GitHub 이슈에 `task` label 이 붙는 것**이고, 그
# 사건은 저장소 밖에서 일어난다. pre-push 훅은 label 이벤트를 볼 수 없고, 볼 수
# 있다 해도 "사용자가 지목했는가" 는 대화에만 있는 사실이라 label 만으로는 판정이
# 안 된다. 그래서 기계가 지킬 수 있는 것은 **규칙이 agent 에게 도달하는 자리에서
# 사라지지 않는 것** 하나다. 이 가드는 그 하나만 한다 — 승격 자체는 못 막는다.
#
# ## 대상은 왜 이 네 파일인가
#
# spawn 된 subagent 에 자동으로 닿는 채널은 넷이고 (`AGENTS.md` 「강제 룰」),
# agent 정의 본문은 그중 시스템 프롬프트로 통째로 들어가는 자리다. 그래서 두
# 계약의 1차 자리는 `.claude/agents/` 의 정의다. 거기에 memory 방을 하나 더
# 붙인다 — `memory/workflow/review/memory.md` 가 리뷰어 write 경계의 SOT 라,
# 정의만 고치면 SOT 가 낡은 채 남고 그게 이 저장소가 반복해 온 drift 다 (#1975).
#
# 대상을 스윕으로 유도하지 않는다. 실측: `gh issue create` 를 적는 추적 파일은
# `.claude` / `.codex` / `.agents` / `memory` 안에 5개인데
# (`git grep -lF 'gh issue create' -- .claude .codex .agents memory`), 그중
# `issue-refine.md` 는 **티켓**을 만들고 `handoff/SKILL.md` 는 멱등 키가 붙는
# 자리를 열거할 뿐이다. 유도하면 그 둘에 리뷰어 규칙을 요구하는 오탐이 된다.
# 손 배열이 조용히 줄어드는 위험은 아래 `test-check-raw-promotion-gate.sh` 의
# 칸별 mutation 이 받는다 — 배열에서 경로를 빼면 그 칸이 rc=0 으로 뒤집힌다.
#
# ## 판정 단위는 줄이 아니라 블록이다
#
# 파일 전체 grep 이면 토큰이 서로 다른 문단에 흩어져 있어도 통과한다. 문서를
# 재배치하는 편집 하나로 규칙이 두 동강 나는 게 정확히 그 실패다. 그래서 본문을
# 블록(빈 줄 / 목록 항목 / heading 이 경계)으로 접고 **한 블록 안에서** 토큰
# 전부를 요구한다.
#
# frontmatter 는 빼고 본다. `description:` 은 spawn 선택용 한 줄이고, 규칙은
# node 가 읽는 본문에 있어야 한다.
#
# ## 덮지 못하는 것 — 방어로 믿기 전에 읽어라
#
#   - **뜻이 뒤집혀도 토큰이 다 있으면 통과한다.** "사용자 지목 없이도 `raw` →
#     `task` 승격. 금지 아님" 이 rc=0 이다. 리터럴 존재 검사의 천장이고,
#     `test-check-raw-promotion-gate.sh` 의 `ceiling-negated` 칸이 그 사실을
#     실행 가능한 형태로 고정한다.
#   - **같은 뜻의 다른 표기는 오탐이다.** "사용자가 지목하지 않으면 올리지
#     않는다" 는 `금지` 토큰이 없어 rc=1 이다. 표기를 바꿀 거면 이 배열도 같이
#     바꾼다.
#   - **`.codex/agents/*.md` 의 `description` 은 안 본다.** 포인터의 한 줄
#     요약이 `.claude` 쪽과 갈려도 rc=0 이다 (`check-agent-reach.sh` 도 같은
#     자리를 비워 둔다).
#   - **`.agents/skills/pr-review/SKILL.md` 는 대상이 아니다.** 그 파일의
#     `gh issue create` 문장은 "무엇이 non-blocking 인가" 를 말하지 배출 절차를
#     소유하지 않는다. 세 번째 사본을 만드는 쪽이 drift 비용이 크다.
#   - **실제 승격을 못 막는다.** 위 「왜 문서 검사가 유일한 집행 지점인가」.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# 검사 1. 승격 문지기 조항이 있어야 하는 정의와, 그 조항을 이루는 토큰.
GATE_FILE=".claude/agents/issue-refine.md"
GATE_TOKENS=('`raw`' '`task`' '사용자' '지목' '승격' '금지')

# 검사 2. 리뷰어의 배출 지시가 있는 파일과, 그 지시와 같은 블록에 있어야 하는 것.
EMIT_FILES=(
	".claude/agents/pr-reviewer.md"
	"memory/workflow/review/memory.md"
)
EMIT_TRIGGER='gh issue create'
EMIT_TOKENS=('`raw`' '출처')

violations=0
report() {
	echo "⚠️  raw promotion gate: $1" >&2
	violations=$((violations + 1))
}

# frontmatter 를 뺀 본문을 블록으로 접어 `<시작줄><TAB><접힌 본문>` 으로 낸다.
# 공백 접기는 ASCII space/tab 만 건드린다 — UTF-8 연속 바이트는 0x80 이상이라
# 한국어 본문이 깨지지 않고, locale 설정에 의존하지도 않는다.
blocks_of() {
	awk '
		function flush() {
			if (block != "") printf "%d\t%s\n", bline, block
			block = ""
			bline = 0
		}
		NR == 1 && $0 == "---" { infm = 1; next }
		infm { if ($0 == "---") infm = 0; next }
		/^[ \t]*$/ { flush(); next }
		/^[ \t]*(#|([-*+]|[0-9]+[.)])[ \t])/ { flush() }
		{
			line = $0
			gsub(/^[ \t]+|[ \t]+$/, "", line)
			gsub(/[ \t]+/, " ", line)
			block = (block == "" ? line : block " " line)
			if (bline == 0) bline = NR
		}
		END { flush() }
	' "$1"
}

has_all_tokens() {
	local text="$1"
	shift
	local token
	for token in "$@"; do
		case "$text" in
		*"$token"*) ;;
		*) return 1 ;;
		esac
	done
	return 0
}

missing_tokens() {
	local text="$1"
	shift
	local token out=""
	for token in "$@"; do
		case "$text" in
		*"$token"*) ;;
		*) out="$out $token" ;;
		esac
	done
	printf '%s\n' "${out# }"
}

# --- 검사 1: 승격 문지기 조항 -------------------------------------------------
gate_blocks=0
gate_hits=0
if [ ! -f "$ROOT/$GATE_FILE" ]; then
	report "$GATE_FILE 가 없다 — 승격 문지기 조항이 앉을 자리가 사라졌다"
else
	while IFS=$'\t' read -r _line text; do
		[ -n "$text" ] || continue
		gate_blocks=$((gate_blocks + 1))
		if has_all_tokens "$text" "${GATE_TOKENS[@]}"; then
			gate_hits=$((gate_hits + 1))
		fi
	done < <(blocks_of "$ROOT/$GATE_FILE")

	if [ "$gate_hits" -eq 0 ]; then
		report "$GATE_FILE 본문의 어느 한 블록도 승격 문지기 조항(${GATE_TOKENS[*]})을 다 담지 않는다 (블록 ${gate_blocks}개). 사용자 지목 없는 raw → task 승격 금지가 이 node 에 안 닿는다 (#1918 §5)"
	fi
fi

# --- 검사 2: 리뷰어 배출 이슈는 raw + 출처 -----------------------------------
emit_files_seen=0
emit_blocks_seen=0
for rel in "${EMIT_FILES[@]}"; do
	if [ ! -f "$ROOT/$rel" ]; then
		report "$rel 이 없다 — 리뷰어 배출 계약이 앉을 자리가 사라졌다"
		continue
	fi
	emit_files_seen=$((emit_files_seen + 1))

	triggered=0
	while IFS=$'\t' read -r line text; do
		[ -n "$text" ] || continue
		case "$text" in
		*"$EMIT_TRIGGER"*) ;;
		*) continue ;;
		esac
		triggered=$((triggered + 1))
		emit_blocks_seen=$((emit_blocks_seen + 1))

		if ! has_all_tokens "$text" "${EMIT_TOKENS[@]}"; then
			report "$rel:$line 이 \`$EMIT_TRIGGER\` 를 지시하면서 같은 블록에 [$(missing_tokens "$text" "${EMIT_TOKENS[@]}")] 가 없다 — 배출된 이슈가 raw 인지, 어디서 나왔는지가 안 적힌다 (#1918 §5)"
		fi
	done < <(blocks_of "$ROOT/$rel")

	if [ "$triggered" -eq 0 ]; then
		report "$rel 에 \`$EMIT_TRIGGER\` 지시가 하나도 없다 — 검사할 대상이 사라졌다. 빈 스윕을 통과로 읽지 않는다"
	fi
done

if [ "$emit_files_seen" -ne "${#EMIT_FILES[@]}" ]; then
	report "리뷰어 배출 대상 ${#EMIT_FILES[@]}개 중 ${emit_files_seen}개만 읽었다"
fi

if [ "$violations" -gt 0 ]; then
	echo "raw promotion gate: 위반 ${violations}건 (승격 조항 블록 ${gate_hits}/${gate_blocks}, 배출 지시 블록 ${emit_blocks_seen})" >&2
	exit 1
fi

# 문구는 잰 것만 말한다. 두 계약이 지정된 파일의 한 블록 안에 리터럴로 있다는
# 것까지다. 안 잰 것은 헤더 「덮지 못하는 것」에 있다.
echo "PASS: raw promotion gate (승격 문지기 조항 ${gate_hits}블록 / 리뷰어 배출 지시 ${emit_blocks_seen}블록이 raw + 출처를 같이 적는다)"
