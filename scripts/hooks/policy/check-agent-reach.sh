#!/usr/bin/env bash
# check-agent-reach.sh
# agent 설정이 spawn 된 subagent 에 **실제로 닿는지** (#1987). 세 가지를 본다.
#
#   0. `.claude/rules/git-policy.md` 의 `paths` 선택자가 보편인가
#   1. 그 wrapper 가 차단 목록 본문을 싣고 있는가
#   2. agent wrapper 가 산문으로 이름만 부르는 skill 이 `skills:` 에도 있는가
#
# 세 검사가 한 파일에 있는 이유는 근거가 같기 때문이다 — 아래 문단 하나가 셋
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
# ## 검사 0 — 본문보다 선택자가 먼저다
#
# `paths` 는 그 wrapper 가 붙을지 말지를 정하는 **유일한** 필드다. 본문이 아무리
# 정확해도 선택자가 좁으면 매치 안 하는 subagent 에는 안 붙는다. 유효한 상태는
# 둘뿐이고 둘은 같은 상태의 두 표기다: frontmatter 가 없거나, `paths` 가 `**` 를
# 포함하거나 (#1978). 그래서 리터럴 대조보다 이 검사가 앞에 온다 — 본문 검사만
# 있으면 `paths` 를 `docs/**/*.md` 로 좁히는 한 줄이 도달을 통째로 끊는데도
# PASS 문구가 "subagent 에 닿는다" 라고 계속 말한다.
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
# 그리고 선언한 이름은 실재해야 한다. 스킬을 지우거나 이름을 바꾸면 `skills:`
# 줄은 남고 주입만 0 이 된다 — 배선 총계도 안 변하므로 바닥값이 못 잡는다.
#
# ## 검사 3 — codex 포인터가 실재하는 source 를 가리켜야 한다
#
# `.codex/agents/*.md` 의 본문은 `source:` 한 줄이 사실상 전부다. 그 한 줄이
# 깨지면 그 agent 에 정책이 **하나도** 안 닿는다. `.claude` 쪽 정의 이름을
# 바꾸거나 지우면 조용히 그 상태가 되고, 같은 실패가 이 PR 안에서 실제로 났다 —
# 두 SOT 가 없는 스크립트 이름을 불렀다.
#
# ## 바닥값 — 0 == 0 을 통과로 읽지 않는다
#
# 집합이 다 비면 "같다" 가 되어 통과한다. 이 저장소가 반복해 밟은 함정이라
# (`#1875` 부류) 절대 바닥을 둔다. 바닥은 대상에서 유도하지 않는다 — 유도하면
# 둘이 같이 줄어들어 초록으로 남는다.
#
# ## 덮지 못하는 것 — 이 가드를 방어로 믿기 전에 읽어라
#
#   - `check_sql_client_execution` 의 `sql_drop` / `sql_truncate` 와 `.env`
#     읽기 차단은 `DANGEROUS_PATTERNS` 배열 밖이라 이 대조에 안 들어온다.
#     배열이 판정 단위이기 때문이고, 배열 밖 검사를 넣으려면 그 검사도 id 를
#     내야 한다.
#   - wrapper 가 리터럴 **말고** 더 적은 설명을 갖고 있는지는 안 본다. 이
#     가드는 "금지가 닿는가" 만 재고 산문 품질은 안 잰다.
#   - 검사 2 는 `skills:` 가 **실제로 주입되는지**는 못 본다. 그건 런타임
#     관측이고 #1978 이 프로브로 쟀다. 여기서 재는 것은 배선 존재뿐이다.
#   - **배선을 옮기는 편집은 못 잡는다.** 한 정의에서 `skills:` 를 지우고 다른
#     정의에 넣으면 총계가 그대로다. 산문이 그 스킬을 안 부르면 검사 2 도 조용하다
#     (`issue-implement.md` 의 세 스킬이 그 상태 — 282줄 / 9,523자). 닫으려면
#     "이 agent 는 이 스킬을 받아야 한다" 는 기대 목록이 필요한데 그런 SOT 가
#     아직 없다. `test-check-agent-reach.sh` 의 `ceiling-swap` 칸이 이 구멍을
#     실행 가능한 형태로 고정해 둔다.
#   - **`.codex` wrapper 의 `description` 은 안 본다.** `source` 가 실재하는지만
#     본다. 두 쪽 `description` 이 서로 다른 것은 지금 상태이고 (#1975 의 9쌍 중
#     8쌍이 그 유형이었다) 이 가드는 그걸 판정하지 않는다.
#   - **`.claude` 정의 본문의 `tools:` / 금지 문구는 안 본다.** 그 값이 뒤집혀도
#     `source` 는 그대로 실재하므로 이 가드도 `check-wrapper-cap.sh` 도 rc=0 이다.
#     `research.md` 에 `Bash` / `Write` 를 넣는 편집이 실측 rc=0 이었다.
#   - **`model:` 을 정의에 다시 못 박아도 안 잡는다.** 그건 도달이 아니라
#     `.claude/agents/README.md` 가 적은 정책이고, 집행 장치가 없다.
#   - **memory 산문이 부르는 agent 이름이 실재하는지 안 본다.** `layer:` 필드에
#     죽은 agent 이름을 되살려도 rc=0 이다. 기계 판정이 어려운 이유는 방 이름과
#     agent 이름이 같은 토큰이기 때문이다 (`bug-fix`). 손 스윕:
#     `git grep -nP '^\s+layer:' -- memory` 로 뽑아 `.claude/agents/` 와 대조.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WRAPPER="$ROOT/.claude/rules/git-policy.md"
DANGEROUS_BASH="$ROOT/scripts/hooks/policy/check-dangerous-bash.sh"
AGENT_DIR="$ROOT/.claude/agents"
CODEX_AGENT_DIR="$ROOT/.codex/agents"
SKILL_DIR="$ROOT/.agents/skills"

# 검사 2 의 바닥. 관측 기준: 2026-07-30 의 정의는 7개고 그중 **4개**가 `skills:`
# 를 쓴다 (`issue-implement` / `pr-reviewer` / `pr-subreviewer` /
# `security-handoff`). 재현: `git grep -cP '^skills:' -- .claude/agents`.
#
# 바닥이 관측치와 같아야 한다. 3 이면 `skills:` 한 줄 삭제가 4→3 이라 통과했고,
# 검사 2 는 본문이 그 스킬을 산문으로 안 부르는 파일(`issue-implement.md`)에서는
# 애초에 발화하지 않는다 — 그 한 줄이 282줄 / 9,523자 주입이었다. 바닥을 대상에서
# 유도하지 않는 것과 관측치보다 낮게 두는 것은 다른 이야기다.
MIN_AGENT_FILES=5
MIN_WIRED_AGENTS=4

# 두 바닥값. 관측 기준: 2026-07-30 의 배열은 21개다.
MIN_SCRIPT_IDS=15
MIN_WRAPPER_LITERALS=15

# 검사 3 의 바닥. 관측 기준: 2026-07-30 의 codex wrapper 는 README 를 뺀 7개다.
# 재현: `ls .codex/agents/*.md | grep -vc README`.
MIN_CODEX_FILES=5

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

# --- 0. wrapper 의 `paths` 선택자가 보편인가 ---------------------------------
# frontmatter 없음 = 선택자 없음 = 무조건 붙음. `paths` 를 선언했다면 그 목록에
# `**` 가 있어야 같은 상태다. 인라인 배열과 블록 목록 둘 다 읽는다.
awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside' \
	"$WRAPPER" >"$work/frontmatter"

if grep -q '^paths:' "$work/frontmatter"; then
	sed -n '/^paths:/,$p' "$work/frontmatter" |
		tr -d "\"'[]," |
		sed -e 's/^paths://' -e 's/^[[:space:]]*-\{0,1\}[[:space:]]*//' -e 's/[[:space:]]*$//' |
		grep -qx -- '\*\*' ||
		report "$(basename "$WRAPPER") 의 paths 가 '**' 를 안 갖는다: $(tr '\n' ' ' <"$work/frontmatter"). 선택자가 좁으면 매치 안 하는 subagent 에 이 본문이 안 붙는다 — 차단 목록이 아무리 정확해도 도달이 0 이다 (#1978)"
fi

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

	# 선언한 스킬이 실재해야 주입할 본문이 있다. 이름을 바꾸거나 스킬을 지우면
	# 이 줄은 남고 주입만 0 이 된다 — 조용한 실패라 여기서 잡는다.
	while IFS= read -r want; do
		[ -n "$want" ] || continue
		[ -f "$SKILL_DIR/$want/SKILL.md" ] ||
			report "$(basename "$agent") 의 skills: 가 '$want' 를 선언하는데 $SKILL_DIR/$want/SKILL.md 가 없다 — 주입할 본문이 없다"
	done <<<"$declared"

	# frontmatter 를 뺀 본문에서만 찾는다. `skills:` 줄 자신이 히트하면 안 된다.
	# 공백은 한 칸으로 접는다 — 산문은 줄바꿈에서 접히므로 `security-handoff.md`
	# 의 "`grill-with-memory`\nskill 의" 가 접기 전에는 매처를 통과했다. 문단을
	# 다시 흘리는 편집 하나가 검사를 끄면 안 된다.
	body="$(awk 'BEGIN { c = 0 } /^---$/ { c++; next } c >= 2' "$agent" | tr -s '[:space:]' ' ')"

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

# --- 6. codex 포인터가 실재하는 source 를 가리키는가 -------------------------
codex_files=0
for codex in "$CODEX_AGENT_DIR"/*.md; do
	[ -f "$codex" ] || continue
	[ "$(basename "$codex")" = "README.md" ] && continue
	codex_files=$((codex_files + 1))

	src="$(sed -n 's/^source:[[:space:]]*//p' "$codex" | head -1)"
	if [ -z "$src" ]; then
		report "$(basename "$codex") 에 source: 가 없다 — 이 wrapper 의 정책 본문은 그 한 줄이 전부다"
		continue
	fi
	if [ ! -f "$ROOT/$src" ]; then
		report "$(basename "$codex") 의 source '$src' 가 없다 — 그 agent 에 정책이 하나도 안 닿는다"
		continue
	fi
	if [ "$(sed -n 's/^name:[[:space:]]*//p' "$codex" | head -1)" != \
		"$(sed -n 's/^name:[[:space:]]*//p' "$ROOT/$src" | head -1)" ]; then
		report "$(basename "$codex") 의 name 이 source '$src' 의 name 과 다르다 — 다른 agent 의 정책을 가리키고 있다"
	fi
done

if [ "$codex_files" -lt "$MIN_CODEX_FILES" ]; then
	report "codex wrapper 를 ${codex_files}개만 읽었다 (바닥 ${MIN_CODEX_FILES}). 빈 스윕을 통과로 읽지 않는다"
fi
if [ "$agent_files" -lt "$MIN_AGENT_FILES" ]; then
	report "agent 정의를 ${agent_files}개만 읽었다 (바닥 ${MIN_AGENT_FILES}). 빈 스윕을 통과로 읽지 않는다"
fi
if [ "$wired_agents" -lt "$MIN_WIRED_AGENTS" ]; then
	report "\`skills:\` 를 쓰는 agent 가 ${wired_agents}개다 (바닥 ${MIN_WIRED_AGENTS}). 배선이 통째로 빠졌다"
fi

if [ "$violations" -gt 0 ]; then
	echo "agent reach: 위반 ${violations}건 (차단 패턴 ${script_id_count}, wrapper 리터럴 ${literal_count}, agent ${agent_files} 중 skills 배선 ${wired_agents}, codex 포인터 ${codex_files})" >&2
	exit 1
fi

# 문구는 잰 것만 말한다. `paths` 선택자 + 리터럴 대조 + `skills:` 배선 존재 +
# 포인터 실재까지다. 안 잰 것은 헤더 "덮지 못하는 것" 에 있다.
echo "PASS: agent reach (선택자 보편 / 차단 패턴 ${script_id_count}종이 전부 wrapper 본문에 실려 subagent 에 닿는다 / agent ${agent_files}개 중 ${wired_agents}개가 skills: 로 절차를 주입한다 / codex 포인터 ${codex_files}개가 실재하는 source 를 가리킨다)"
