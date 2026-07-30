#!/usr/bin/env bash
# check-agent-reach.sh
# agent 설정이 spawn 된 subagent 에 **실제로 닿는지** (#1987). 두 가지를 본다.
#
#   1. `.claude/rules/git-policy.md` 가 차단 목록 본문을 싣고 있는가
#   2. agent wrapper 가 산문으로 이름만 부르는 skill 이 `skills:` 에도 있는가
#
# 두 검사가 한 파일에 있는 이유는 근거가 같기 때문이다 — 아래 문단 하나가 둘
# 다를 설명한다. 나누면 그 문단이 두 벌이 되고, 이 PR 이 없애려는 drift 가
# 가드 자신에게 생긴다.
#
# ## 왜 이 가드가 있나
#
# spawn 된 subagent 에 자동으로 닿는 채널은 넷이고 그중 둘이 여기 대상이다:
# 선택자가 없거나 매치하는 `.claude/rules/*.md`, 그리고 agent frontmatter
# `skills:` 가 주입하는 스킬 본문 전문 (#1978 프로브, claude 2.1.220 / haiku,
# 6칸 + 심링크 2칸, `tool_uses: 0`). **마크다운 링크는 따라가지 않는다.**
#
# 그래서 wrapper 가 "본문은 memory 방에 있다" 는 포인터 세 줄이면
# **`--no-verify` 차단 목록은 subagent 에 안 닿고**, agent 정의가 "작업 시
# `<skill>` 을 read" 라고 적기만 하면 그 절차도 안 닿는다 — 실측 시점에
# `skills:` 사용은 9종 중 **0** 이었다 (#1975).
#
# ## 손복제가 아니라 파생이어야 한다
#
# 목록을 손으로 옮기면 갈린다 — 실측된 사고가 있다: 같은 금지가 claude wrapper
# 에는 리터럴 5종, codex wrapper 에는 클래스 3종으로 적혀 있었다 (#1975).
# 그래서 이 가드는 문구를 비교하지 않고 **동작을 비교한다.**
#
#   1. wrapper 의 각 리터럴을 `check-dangerous-bash.sh` 에 그대로 먹인다.
#      막히지 않으면 wrapper 가 없는 금지를 주장하는 것이다.
#   2. 막은 pattern id 를 모아 `DANGEROUS_BASH` 의 `DANGEROUS_PATTERNS` 배열이
#      정의한 id 집합과 **양방향으로** 대조한다. 스크립트에 패턴이 생기면
#      wrapper 가 모르고, 스크립트에서 빠지면 wrapper 가 유령을 주장한다.
#
# 즉 SOT 는 계속 `check-dangerous-bash.sh` 이고 wrapper 는 그것의 관측 가능한
# 그림자다. 어느 쪽을 고쳐도 다른 쪽이 안 따라오면 exit 1 이다.
#
# ## 검사 2 — 산문으로 부른 skill 은 `skills:` 에도 있어야 한다
#
# agent 정의 본문이 `<name>` skill 이나 `.agents/skills/<name>/SKILL.md` 를
# 부르면 그 `<name>` 이 같은 파일의 `skills:` 목록에 있어야 한다. 읽으라는
# 지시는 도달을 보장하지 않고, 주입은 보장한다. 반대 방향(`skills:` 에만 있고
# 산문에 없음)은 위반이 아니다 — 그게 정상 상태다.
#
# ## 바닥값 — 0 == 0 을 통과로 읽지 않는다
#
# 집합이 다 비면 "같다" 가 되어 통과한다. 이 저장소가 반복해 밟은 함정이라
# (`#1875` 부류) 절대 바닥을 둔다. 바닥은 대상에서 유도하지 않는다 — 유도하면
# 둘이 같이 줄어들어 초록으로 남는다.
#
# ## 덮지 못하는 것
#
#   - `check_sql_client_execution` 의 `sql_drop` / `sql_truncate` 와 `.env`
#     읽기 차단은 `DANGEROUS_PATTERNS` 배열 밖이라 이 대조에 안 들어온다.
#     배열이 판정 단위이기 때문이고, 배열 밖 검사를 넣으려면 그 검사도 id 를
#     내야 한다.
#   - wrapper 가 리터럴 **말고** 더 적은 설명을 갖고 있는지는 안 본다. 이
#     가드는 "금지가 닿는가" 만 재고 산문 품질은 안 잰다.
#   - 검사 2 는 `skills:` 가 **실제로 주입되는지**는 못 본다. 그건 런타임
#     관측이고 #1978 이 프로브로 쟀다. 여기서 재는 것은 배선 존재뿐이다.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WRAPPER="$ROOT/.claude/rules/git-policy.md"
DANGEROUS_BASH="$ROOT/scripts/hooks/policy/check-dangerous-bash.sh"
AGENT_DIR="$ROOT/.claude/agents"
SKILL_DIR="$ROOT/.agents/skills"

# 검사 2 의 바닥. 관측 기준: 2026-07-30 의 정의는 7개고 그중 3개가 `skills:` 를 쓴다.
MIN_AGENT_FILES=5
MIN_WIRED_AGENTS=3

# 두 바닥값. 관측 기준: 2026-07-30 의 배열은 21개다.
MIN_SCRIPT_IDS=15
MIN_WRAPPER_LITERALS=15

BLOCK_START='<!-- blocked-commands:start -->'
BLOCK_END='<!-- blocked-commands:end -->'
SEP=' · '

violations=0
report() {
	echo "⚠️  agent reach: $1" >&2
	violations=$((violations + 1))
}

[ -f "$WRAPPER" ] || {
	echo "⚠️  agent reach: $WRAPPER 가 없다. 선택자 없는 rules wrapper 는 모든 subagent 에 내려가는 채널이다 (#1978)" >&2
	exit 1
}
[ -f "$DANGEROUS_BASH" ] || {
	echo "⚠️  agent reach: $DANGEROUS_BASH 가 없다" >&2
	exit 1
}
[ -d "$AGENT_DIR" ] || {
	echo "⚠️  agent reach: $AGENT_DIR 가 없다" >&2
	exit 1
}

work="$(mktemp -d "${TMPDIR:-/tmp}/agent-reach.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# --- 1. 스크립트가 정의한 id 집합 -------------------------------------------
# 배열 리터럴 안에서만 읽는다. 헤더 주석의 id 나열은 SOT 가 아니다.
awk '
	/^DANGEROUS_PATTERNS=\(/ { inside = 1; next }
	inside && /^\)/ { inside = 0 }
	inside {
		line = $0
		sub(/^[ \t]*/, "", line)
		sub(/^["'"'"']/, "", line)
		if (match(line, /^[a-z0-9_]+::/)) print substr(line, 1, RLENGTH - 2)
	}
' "$DANGEROUS_BASH" | sort -u >"$work/script-ids"

script_id_count="$(grep -c . <"$work/script-ids" || true)"
if [ "$script_id_count" -lt "$MIN_SCRIPT_IDS" ]; then
	report "DANGEROUS_PATTERNS 에서 id 를 ${script_id_count}개만 읽었다 (바닥 ${MIN_SCRIPT_IDS}). 배열 표기가 바뀌었거나 추출이 깨졌다 — 빈 집합을 통과로 읽지 않는다"
fi

# --- 2. wrapper 가 싣고 있는 리터럴 -----------------------------------------
awk -v s="$BLOCK_START" -v e="$BLOCK_END" '
	index($0, s) > 0 { inside = 1; next }
	index($0, e) > 0 { inside = 0 }
	inside { print }
' "$WRAPPER" >"$work/block"

: >"$work/literals"
while IFS= read -r line; do
	rest="$line"
	while [ -n "$rest" ]; do
		case "$rest" in
		*"$SEP"*)
			printf '%s\n' "${rest%%"$SEP"*}" >>"$work/literals"
			rest="${rest#*"$SEP"}"
			;;
		*)
			printf '%s\n' "$rest" >>"$work/literals"
			rest=""
			;;
		esac
	done
done <"$work/block"

# 앞뒤 공백과 인라인 코드 백틱을 걷어낸다. 빈 줄은 버린다.
sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^`//' -e 's/`$//' \
	<"$work/literals" | grep -v '^$' >"$work/literals.clean" || true
mv "$work/literals.clean" "$work/literals"

literal_count="$(grep -c . <"$work/literals" || true)"
if [ "$literal_count" -lt "$MIN_WRAPPER_LITERALS" ]; then
	report "wrapper 가 실은 금지 리터럴이 ${literal_count}개다 (바닥 ${MIN_WRAPPER_LITERALS}). 포인터만 남으면 --no-verify 금지가 subagent 에 안 닿는다 (#1978)"
fi

# --- 3. 각 리터럴을 실제 가드에 먹여 본다 -----------------------------------
: >"$work/covered"
while IFS= read -r literal; do
	[ -n "$literal" ] || continue
	set +e
	out="$(COMMAND="$literal" bash "$DANGEROUS_BASH" 2>&1)"
	rc=$?
	set -e
	if [ "$rc" -eq 0 ]; then
		report "wrapper 가 금지로 적은 '$literal' 을 check-dangerous-bash.sh 가 통과시킨다"
		continue
	fi
	id="$(printf '%s\n' "$out" | sed -n 's/.*detected (\([a-z0-9_]*\)).*/\1/p' | head -1)"
	if [ -z "$id" ]; then
		report "'$literal' 은 막히지만 DANGEROUS_PATTERNS 의 id 를 안 낸다 — 배열 밖 검사에 걸린 것이라 대조에 못 쓴다"
		continue
	fi
	printf '%s\n' "$id" >>"$work/covered"
done <"$work/literals"

sort -u "$work/covered" -o "$work/covered"

# --- 4. 양방향 대조 ----------------------------------------------------------
while IFS= read -r missing; do
	[ -n "$missing" ] || continue
	report "차단 패턴 '$missing' 이 wrapper 본문에 없다 — 그 금지는 subagent 에 안 닿는다"
done < <(comm -23 "$work/script-ids" "$work/covered")

while IFS= read -r extra; do
	[ -n "$extra" ] || continue
	report "wrapper 가 '$extra' 를 주장하는데 DANGEROUS_PATTERNS 에 없다"
done < <(comm -13 "$work/script-ids" "$work/covered")

# --- 5. 산문으로 부른 skill 이 `skills:` 에도 있는가 -------------------------
# 알려진 skill 이름만 찾는다. 임의 백틱 토큰을 skill 로 오인하지 않기 위해서다.
: >"$work/skill-names"
for d in "$SKILL_DIR"/*/; do
	[ -f "$d/SKILL.md" ] || continue
	basename "$d" >>"$work/skill-names"
done
sort -u "$work/skill-names" -o "$work/skill-names"

agent_files=0
wired_agents=0
for agent in "$AGENT_DIR"/*.md; do
	[ -f "$agent" ] || continue
	[ "$(basename "$agent")" = "README.md" ] && continue
	agent_files=$((agent_files + 1))

	# frontmatter 의 `skills:` 한 줄. 인라인 배열 표기만 읽는다 — 이 저장소가
	# 쓰는 유일한 표기이고, 블록 표기를 지원하는 척하면 못 읽고 통과한다.
	declared="$(sed -n 's/^skills:[[:space:]]*\[\(.*\)\].*/\1/p' "$agent" | head -1 |
		tr ',' '\n' | tr -d ' ' | grep -v '^$' | sort -u || true)"
	[ -n "$declared" ] && wired_agents=$((wired_agents + 1))

	# frontmatter 를 뺀 본문에서만 찾는다. `skills:` 줄 자신이 히트하면 안 된다.
	body="$(awk 'BEGIN { c = 0 } /^---$/ { c++; next } c >= 2' "$agent")"

	while IFS= read -r skill; do
		[ -n "$skill" ] || continue
		case "$body" in
		*"\`$skill\` skill"* | *".agents/skills/$skill/"*) ;;
		*) continue ;;
		esac
		case "
$declared" in
		*"
$skill"*) continue ;;
		esac
		report "$(basename "$agent") 본문이 \`$skill\` 을 부르는데 frontmatter \`skills:\` 에 없다 — 읽으라는 지시는 도달을 보장하지 않는다 (#1978)"
	done <"$work/skill-names"
done

if [ "$agent_files" -lt "$MIN_AGENT_FILES" ]; then
	report "agent 정의를 ${agent_files}개만 읽었다 (바닥 ${MIN_AGENT_FILES}). 빈 스윕을 통과로 읽지 않는다"
fi
if [ "$wired_agents" -lt "$MIN_WIRED_AGENTS" ]; then
	report "\`skills:\` 를 쓰는 agent 가 ${wired_agents}개다 (바닥 ${MIN_WIRED_AGENTS}). 배선이 통째로 빠졌다"
fi

if [ "$violations" -gt 0 ]; then
	echo "agent reach: 위반 ${violations}건 (차단 패턴 ${script_id_count}, wrapper 리터럴 ${literal_count}, agent ${agent_files} 중 skills 배선 ${wired_agents})" >&2
	exit 1
fi

echo "PASS: agent reach (차단 패턴 ${script_id_count}종이 전부 wrapper 본문에 실려 subagent 에 닿는다 / agent ${agent_files}개 중 ${wired_agents}개가 skills: 로 절차를 주입한다)"
