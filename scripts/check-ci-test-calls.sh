#!/usr/bin/env bash
# check-ci-test-calls.sh — src-tauri 통합 테스트 binary 가 CI 에서 도는지 대조 (issue #2113).
#
# cargo 의 `--test <이름>` 은 allowlist 다. workflow 의 어떤 줄도 이름을 부르지 않는
# 통합 테스트 binary 는 CI 에서 한 번도 안 돈다 — CI 를 red 로 만들려고 쓴 가드
# 테스트가 아무것도 안 지키면서 green 일 수 있다는 뜻이다. keyring 3종(#1815)이
# 그랬고, 이 스크립트가 들어온 base(2b7deab4)에서는 76종 중 59종이 그 상태였다.
#
# 대조:
#   전수   = src-tauri/tests/*.rs + src-tauri/tests/*/main.rs  (cargo 가 자동
#            인식하는 통합 테스트 target 두 형태. 후자는 `cargo metadata` 로
#            실측 확인 — 빈 디렉토리에 main.rs 하나를 넣으면 target 이 76→77 이
#            되고 이름은 디렉토리 이름이다)
#   호출   = .github/workflows/** 의 `--test <이름>` 합집합
#   미호출 = 전수 − 호출  →  전부 ci-uncalled-tests.txt 에 사유와 함께 있어야 한다
#
# 반대 방향도 본다. allowlist 는 줄어들기만 해야 하므로, 파일이 사라졌거나 이제
# 호출되는 이름이 allowlist 에 남아 있으면 그것도 위반이다 — 안 그러면 이 파일이
# 죽은 줄이 쌓이는 자리가 된다.
#
# 사용:
#   bash scripts/check-ci-test-calls.sh          # 이 repo
#   bash scripts/check-ci-test-calls.sh <ROOT>   # 다른 트리 (테스트가 쓴다)
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음
#
# ## 이 게이트가 안 보는 것 (둘 다 막히는 쪽으로 틀린다)
#
# ① `--test=<이름>` 표기는 호출로 안 친다. 이 저장소 workflow 는 전부 공백 표기이고
#    (`git grep -c -e '--test=' -- .github/workflows` 가 0), 누가 `=` 로 바꾸면 그
#    이름이 미호출로 잡혀 red 가 된다. 통과 쪽으로 새지 않으니 그대로 둔다.
# ② `--test` 다음 이름이 줄바꿈 뒤에 오면 못 본다. 지금 workflow 는 이어붙임(`\`)
#    을 써도 이름은 항상 `--test` 와 같은 줄에 있다.
#
# 반대로 새는 구멍 하나: `--test` 를 다른 crate 의 manifest 에 붙여도 이름만 보고
# 호출로 센다. 지금은 호출 17종이 전부 src-tauri/tests 에 있어 차이가 없고, 새려면
# 다른 crate 의 테스트가 src-tauri/tests 의 파일과 이름이 같아야 한다.

set -uo pipefail

REPO="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
TESTS_DIR="$REPO/src-tauri/tests"
WORKFLOWS_DIR="$REPO/.github/workflows"
ALLOWLIST="$REPO/ci-uncalled-tests.txt"
ALLOWLIST_NAME="ci-uncalled-tests.txt"

for dir in "$TESTS_DIR" "$WORKFLOWS_DIR"; do
	if [ ! -d "$dir" ]; then
		echo "ERROR: 검사할 디렉토리가 없다: $dir" >&2
		exit 2
	fi
done

if [ ! -f "$ALLOWLIST" ]; then
	echo "ERROR: allowlist 파일이 없다: $ALLOWLIST" >&2
	exit 2
fi

# find 의 종료 상태를 여기서 받는다. `< <(find ...)` 로 넘기면 process substitution
# 이라 bash 가 상태를 안 보고 pipefail 도 안 걸려서, 못 읽는 하위 디렉토리가 있어도
# 게이트는 green 이 된다 (같은 함정이 scripts/check-memory-doc-size.sh 에도 있다).
if ! flat_files="$(find "$TESTS_DIR" -maxdepth 1 -type f -name '*.rs')" ||
	! dir_files="$(find "$TESTS_DIR" -mindepth 2 -maxdepth 2 -type f -name 'main.rs')"; then
	echo "ERROR: find 가 $TESTS_DIR 를 다 훑지 못했다 (위 stderr) — 검사 불성립" >&2
	exit 2
fi

targets="$( {
	printf '%s\n' "$flat_files" | sed -n 's#.*/\([^/]*\)\.rs$#\1#p'
	printf '%s\n' "$dir_files" | sed -n 's#.*/\([^/]*\)/main\.rs$#\1#p'
} | sort -u)"
targets_n="$(printf '%s\n' "$targets" | grep -c '.')"

# 0 개를 "위반 0" 으로 통과시키면 트리가 옮겨진 날 게이트가 아무것도 안 재면서
# green 이 된다. 검사 불성립은 통과가 아니다.
if [ "$targets_n" -eq 0 ]; then
	echo "ERROR: $TESTS_DIR 아래에 통합 테스트 target 이 0 개다 — 트리가 옮겨졌거나 경로가 틀렸다" >&2
	exit 2
fi

# grep 은 0 건일 때 1, 오류일 때 2 로 나간다. 둘을 안 가르면 workflow 를 못 읽은
# 것이 "호출 0 건" 으로 둔갑한다.
called_raw="$(grep -rhoE -e '--test[[:space:]]+[A-Za-z0-9_]+' "$WORKFLOWS_DIR")"
grep_rc=$?
if [ "$grep_rc" -gt 1 ]; then
	echo "ERROR: $WORKFLOWS_DIR 를 못 읽었다 (grep exit $grep_rc) — 검사 불성립" >&2
	exit 2
fi

called="$(printf '%s\n' "$called_raw" | awk 'NF {print $2}' | sort -u)"
called_n="$(printf '%s\n' "$called" | grep -c '.')"

# 위와 같은 이유. `--test` 표기가 통째로 바뀌거나 workflow 경로가 틀리면 전수가
# 미호출로 보이는데, 그때 나가야 하는 답은 allowlist 대조가 아니라 이 ERROR 다.
if [ "$called_n" -eq 0 ]; then
	echo "ERROR: $WORKFLOWS_DIR 에 \`--test <이름>\` 호출이 0 건이다 — 표기가 바뀌었거나 경로가 틀렸다" >&2
	exit 2
fi

# 집합 판정은 subprocess 없이 한다. `printf | grep -Fxq` 로 짜면 조회 하나가
# fork 하나여서 (76+59)×2~3 = 300 번을 넘고, 로컬 vitest 를 병렬로 돌리는 동안
# 이 게이트가 13초까지 늘어 테스트가 10초 timeout 으로 죽었다. 아래 형태는 fork
# 가 0 이고 같은 트리에서 0.15초다 (`/usr/bin/time -p` 9회 median). 양쪽 끝의
# 개행이 부분 일치를 막는다 — `case` 의 인용된 확장은 glob 이 아니라 리터럴이다.
NL=$'\n'
has() {
	case "$2" in
	*"$NL$1$NL"*) return 0 ;;
	esac
	return 1
}
targets_set="$NL$targets$NL"
called_set="$NL$called$NL"
allowed_set="$NL"

# CR 은 미리 지운다 — 안 그러면 이름 끝에 붙어 조용히 전부 어긋난다. 읽기 실패를
# "빈 allowlist" 로 흘리지 않으려고 종료 상태를 여기서 받는다.
if ! allowlist_body="$(tr -d '\r' <"$ALLOWLIST")"; then
	echo "ERROR: allowlist 를 못 읽었다: $ALLOWLIST" >&2
	exit 2
fi

violations=0
allowed_n=0

# `IFS=` 없이 읽으면 read 가 첫 필드를 이름, 나머지 줄을 사유로 갈라 준다 (앞뒤
# 공백은 read 가 떼고, 사유가 없는 줄은 reason 이 빈 문자열이 된다). 주석과 빈
# 줄은 그렇게 갈린 이름으로 걸러진다.
while read -r name reason; do
	case "$name" in '' | '#'*) continue ;; esac

	if [ -z "$reason" ]; then
		echo "FAIL $name: $ALLOWLIST_NAME 항목에 사유가 없다 — 이름 뒤 같은 줄에 사유를 적어라" >&2
		violations=$((violations + 1))
	fi
	if has "$name" "$allowed_set"; then
		echo "FAIL $name: $ALLOWLIST_NAME 에 두 번 있다" >&2
		violations=$((violations + 1))
		continue
	fi
	if ! has "$name" "$targets_set"; then
		echo "FAIL $name: $ALLOWLIST_NAME 에 있는데 src-tauri/tests 에 그런 테스트가 없다 — 줄을 지워라" >&2
		violations=$((violations + 1))
		continue
	fi
	if has "$name" "$called_set"; then
		echo "FAIL $name: 이제 CI 가 부르는데 $ALLOWLIST_NAME 에 남아 있다 — 줄을 지워라" >&2
		violations=$((violations + 1))
		continue
	fi

	allowed_set="$allowed_set$name$NL"
	allowed_n=$((allowed_n + 1))
done <<<"$allowlist_body"

while IFS= read -r name; do
	[ -n "$name" ] || continue
	if ! has "$name" "$called_set" && ! has "$name" "$allowed_set"; then
		echo "FAIL $name: .github/workflows 의 어떤 \`--test\` 도 안 부르는데 $ALLOWLIST_NAME 에 없다" >&2
		violations=$((violations + 1))
	fi
done <<<"$targets"

if [ "$violations" -gt 0 ]; then
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::CI 미호출 통합 테스트 대조 위반 $violations 건 (위 FAIL 줄). 새 테스트는 .github/workflows 의 \`--test\` 로 부르거나, 못 부르는 사유를 $ALLOWLIST_NAME 에 적어라 (issue #2113)." >&2
	exit 1
fi

echo "ok: 통합 테스트 target $targets_n 종 — CI 호출 $called_n 종, 사유 달린 미호출 allowlist $allowed_n 종"
