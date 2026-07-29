#!/usr/bin/env bash
# test-verdict-label-contract.sh
# Verdict label 절차의 계약 검사 (#1879, #1884).
#
# 두 가지를 지킨다.
#
#   1. label 을 **한 명령에서 두 번 갱신하라는 지시가 하나도 없어야 한다.** 같은
#      초에 label 이벤트가 둘 나면 `review-gate` 의 `cancel-in-progress` 가 run
#      하나를 죽이고, 죽은 run 이 rollup 에 non-success 로 남아 BLOCKED 가
#      고착된다 (#1879 실측).
#
#   2. verdict 절차를 서술하는 세 SOT 이 (a) 나눠 치기와 대기, (b) red 에서
#      `review:approved` 를 **먼저** 떼기를 모두 명시해야 한다. (b) 가 없거나
#      순서가 반대면 push 없이 green 이 red 로 뒤집힐 때 label 이 남아 게이트가
#      통과한다 — `Dismiss stale approval` 은 `synchronize` 전용이다 (#1884).
#
# ## 판정 단위가 핵심이다
#
# 위험/안전을 가르는 것은 두 플래그가 **한 명령 안에 있는지**다. 그래서 파일을
# "명령 후보" 로 쪼개 각각을 본다:
#
#   - fenced code block 안: 줄 단위
#   - 그 밖: 인라인 코드 span 단위 + span 을 걷어낸 나머지 산문의 줄 단위
#
# 안전:   `--add-label X` 뒤 `--remove-label Y`   ← 서로 다른 span 두 개
# 위험:   `--add-label X --remove-label Y`        ← 한 span 안에 둘
#
# 초판은 `gh pr edit` 리터럴을 요구했다. 그런데 이 검사의 1차 표적인 두
# pr-reviewer wrapper 는 그 접두사 없이 플래그만 적는 표기를 쓴다 — 즉 가장
# 일어나기 쉬운 회귀를 구조적으로 못 잡았다 (리뷰 mutation NEW-5). 명령 후보
# 단위 판정은 접두사에 의존하지 않는다.
#
# ## 덮는 범위와 덮지 못하는 것
#
# 스윕 대상은 `docs/sprints` / `docs/archives` 를 뺀 추적 `.md` 154개다 (추적 `.md`
# 전체는 1,600개). 비-md 추적 파일 1,947개는 보지 않는다 — label 지시는 산문
# 문서에만 있고, 스크립트가 실제로 label 을 치는 곳은 `review-gate.yml` 하나뿐이며
# 그건 워크플로 자체 동작이라 이 계약의 대상이 아니다.
#
# `gh api repos/.../labels` 로 같은 지시를 쓰면 잡지 못한다 (#1906). 플래그 표기가
# 아니라 REST 경로라서 같은 판정 단위에 안 들어온다. 저장소에 그 형태로 리뷰어에게
# label 을 지시하는 곳은 현재 없다.
#
# `SOTS` 배열에서 항목을 지우면 그 파일이 **검사 2** 밖으로 나간다. 다만 검사 1 은
# 배열과 무관하게 154파일을 훑으므로 위험한 형태는 계속 잡힌다. 자기 목록을 스스로
# 지키지 못하는 것은 #1875 와 같은 부류다.

set -euo pipefail

cd "$(cd "$(dirname "$0")/../../.." && pwd)"

SOTS=(
	"memory/workflow/review/memory.md"
	".claude/agents/pr-reviewer.md"
	".codex/agents/pr-reviewer.md"
)

MIN_WAIT_SECONDS=30

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

# SOT 존재 확인이 먼저다. 스윕 루프가 먼저 돌면 사라진 파일에서 `set -e` 로 죽어
# 진단 없이 non-zero 만 남는다 (fail-closed 지만 원인을 못 알려준다).
for sot in "${SOTS[@]}"; do
	[ -f "$sot" ] || fail "$sot 가 없다 — verdict 절차를 소유한 SOT 다"
done

# --- 1. 한 명령에서 label 을 두 번 갱신하라는 지시가 없는가 ----------------------

# 파일 목록을 먼저 받아 **실패를 감지한다.** 파이프로 바로 넘기면 `git` 이 죽어도
# 빈 목록이 흘러 "결합 형태 0" 이라고 통과한다 (리뷰 mutation NEW-6, fail-open).
file_list="$(mktemp "${TMPDIR:-/tmp}/verdict-label-files.XXXXXX")"
trap 'rm -f "$file_list"' EXIT

git ls-files -- '*.md' ':(exclude)docs/sprints' ':(exclude)docs/archives' >"$file_list" ||
	fail "git ls-files 실패 — 검사할 파일 목록을 못 얻었다 (fail-closed)"

[ -s "$file_list" ] ||
	fail "검사 대상 .md 가 0개다 — pathspec 이나 저장소 상태가 예상과 다르다"

combined_hits=0
while IFS= read -r path; do
	[ -n "$path" ] || continue
	# staged 삭제 등으로 인덱스에는 있고 디스크에 없는 경우.
	[ -f "$path" ] || continue

	hits="$(awk '
		function both(s) { return (s ~ /--add-label/ && s ~ /--remove-label/) }
		/^[ \t]*```/ { fenced = !fenced; next }
		{
			if (fenced) {
				# 코드 블록 안에서는 한 줄이 한 명령이다.
				if (both($0)) print "hit:" FNR ":" $0
				next
			}
			# 산문 줄: 인라인 코드 span 을 하나씩 떼어 각각 판정하고,
			# 남은 산문도 줄 단위로 본다 (백틱 없이 적힌 명령 대비).
			line = $0
			rest = ""
			while (match(line, /`[^`]*`/)) {
				span = substr(line, RSTART + 1, RLENGTH - 2)
				if (both(span)) print "hit:" FNR ":" span
				rest = rest substr(line, 1, RSTART - 1)
				line = substr(line, RSTART + RLENGTH)
			}
			rest = rest line
			if (both(rest)) print "hit:" FNR ":" rest
		}
	' "$path")"

	if [ -n "$hits" ]; then
		count="$(printf '%s\n' "$hits" | wc -l | tr -d ' ')"
		echo "  결합 형태 ${count}건: $path" >&2
		printf '%s\n' "$hits" | sed 's/^hit:/    :/' >&2
		combined_hits=$((combined_hits + count))
	fi
done <"$file_list"

[ "$combined_hits" -eq 0 ] ||
	fail "$combined_hits 곳이 한 명령에서 label 을 두 번 갱신하라고 지시한다 (#1879)"

# --- 2. 세 SOT 이 절차를 옳게 명시하는가 ----------------------------------------

for sot in "${SOTS[@]}"; do
	folded="$(tr '\n' ' ' <"$sot")"

	# (a) 나눠 치기 + 최소 대기. 키워드만 보면 대기 시간을 줄여도 통과한다
	#     (리뷰 mutation CHECK2-A). 숫자를 직접 요구한다.
	grep -qE '나눠 치|나눠서 치' <<<"$folded" ||
		fail "$sot 가 명령을 나눠 치라는 요구를 적지 않는다 (#1879)"
	grep -qF "${MIN_WAIT_SECONDS}초" <<<"$folded" ||
		fail "$sot 가 최소 대기 ${MIN_WAIT_SECONDS}초를 적지 않는다 (#1879)"

	# (b) red 는 approved 를 **먼저** 뗀다. 존재만 보면 순서를 뒤집어도 통과하고,
	#     뒤집힌 순서는 #1884 의 창을 다시 연다 (리뷰 mutation CHECK2-B).
	red_tail="${folded#*red}"
	remove_at="$(awk -v s="$red_tail" 'BEGIN { print index(s, "--remove-label review:approved") }')"
	add_at="$(awk -v s="$red_tail" 'BEGIN { print index(s, "--add-label review:changes-requested") }')"

	[ "$remove_at" -gt 0 ] ||
		fail "$sot 가 red 에서 review:approved 를 떼라는 요구를 적지 않는다 (#1884)"
	[ "$add_at" -gt 0 ] ||
		fail "$sot 의 red 절차에 --add-label review:changes-requested 가 없다"
	[ "$remove_at" -lt "$add_at" ] ||
		fail "$sot 의 red 절차가 approved 를 나중에 뗀다 (위치 remove=$remove_at add=$add_at) — 그 사이 게이트가 통과한다 (#1884)"
done

echo "PASS: verdict label contract (SOT ${#SOTS[@]}개, 명령 후보 스윕 $(wc -l <"$file_list" | tr -d ' ')파일, 결합 형태 0)"
