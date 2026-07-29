#!/usr/bin/env bash
# test-verdict-label-contract.sh
# Verdict label 절차의 계약 검사 (#1879, #1884).
#
# 두 가지를 지킨다.
#
#   1. `gh pr edit` 한 명령에 `--add-label` 과 `--remove-label` 을 같이 쓰라고
#      지시하는 곳이 하나도 없어야 한다. 같은 초에 label 이벤트가 둘 나면
#      `review-gate` 의 `cancel-in-progress` 가 run 하나를 죽이고, 죽은 run 이
#      rollup 에 non-success 로 남아 BLOCKED 가 고착된다 (#1879 실측).
#
#   2. verdict 절차를 서술하는 세 SOT 이 (a) 나눠 치라는 요구와 (b) red 에서
#      `review:approved` 를 떼라는 요구를 모두 명시해야 한다. (b) 가 없으면 push
#      없이 green 이 red 로 뒤집힐 때 label 이 남아 게이트가 통과한다 — `Dismiss
#      stale approval` 은 `synchronize` 전용이라 그 경로를 못 잡는다 (#1884).
#
# 매칭은 **줄바꿈에 깨지지 않아야 한다.** 산문 SOT 은 명령을 여러 줄로 접어
# 쓰므로, 줄 단위 grep 은 위험한 형태를 놓친다 (실제로 놓쳤다 — 이 검사를 만든
# 계기다).
#
# 알려진 한계: 아래 `SOTS` 배열에서 항목을 지우면 그 파일이 검사 밖으로 나가면서
# 조용히 통과한다 (mutation 으로 확인). 검사 1(결합 형태 스윕)은 `git ls-files`
# 기반이라 전 저장소를 덮으므로 이 구멍이 없고, 배열은 검사 2(서술 요구)에만
# 쓰인다. 즉 배열을 지워도 위험한 명령 형태는 여전히 잡힌다. 자기 목록을 스스로
# 지키지 못하는 것은 #1875 와 같은 부류다.

set -euo pipefail

cd "$(cd "$(dirname "$0")/../../.." && pwd)"

SOTS=(
	"memory/workflow/review/memory.md"
	".claude/agents/pr-reviewer.md"
	".codex/agents/pr-reviewer.md"
)

fail() {
	echo "FAIL: $1" >&2
	exit 1
}

# --- 1. 위험한 결합 형태가 없는가 (줄바꿈 무시) ---------------------------------

# SOT 존재 확인이 먼저다. 스윕 루프가 먼저 돌면 사라진 파일에서 `set -e` 로 죽어
# 진단 없이 non-zero 만 남는다 (fail-closed 지만 원인을 못 알려준다).
for sot in "${SOTS[@]}"; do
	[ -f "$sot" ] || fail "$sot 가 없다 — verdict 절차를 소유한 SOT 다"
done

# 개행을 접되 **명령 경계로 잘라서** 본다. 접기만 하면 나란히 놓인 별개 명령
# 둘이 하나로 보여 안전한 형태를 오탐한다.
combined_hits=0
while IFS= read -r path; do
	[ -n "$path" ] || continue
	# staged 삭제 등으로 인덱스에는 있고 디스크에 없는 경우.
	[ -f "$path" ] || continue
	hits="$(awk 'BEGIN { RS = "\0" } {
		gsub(/\n/, " ")
		n = split($0, cmd, /gh pr edit/)
		for (i = 2; i <= n; i++) {
			if (cmd[i] ~ /--add-label[^`]*--remove-label/ ||
			    cmd[i] ~ /--remove-label[^`]*--add-label/) print "hit"
		}
	}' "$path" | wc -l | tr -d ' ')"
	if [ "$hits" -gt 0 ]; then
		echo "  결합 형태 ${hits}건: $path" >&2
		combined_hits=$((combined_hits + hits))
	fi
done < <(git ls-files -- '*.md' ':(exclude)docs/sprints' ':(exclude)docs/archives')

[ "$combined_hits" -eq 0 ] ||
	fail "$combined_hits 곳이 한 명령에 --add-label 과 --remove-label 을 같이 쓴다 (#1879)"

# --- 2. 세 SOT 이 두 요구를 명시하는가 ------------------------------------------

for sot in "${SOTS[@]}"; do
	folded="$(tr '\n' ' ' <"$sot")"

	grep -qE '나눠 치|나눠서 치|30초' <<<"$folded" ||
		fail "$sot 가 명령을 나눠 치라는 요구를 적지 않는다 (#1879)"

	grep -qE 'red[^.]*remove-label review:approved|red 에서 approved 를 먼저' <<<"$folded" ||
		fail "$sot 가 red 에서 review:approved 를 떼라는 요구를 적지 않는다 (#1884)"
done

echo "PASS: verdict label contract (SOT ${#SOTS[@]}개, 결합 형태 0)"
