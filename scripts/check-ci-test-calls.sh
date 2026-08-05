#!/usr/bin/env bash
# check-ci-test-calls.sh — src-tauri 통합 테스트 binary 가 CI 에서 도는지 대조 (issue #2113).
#
# cargo 의 `--test <이름>` 은 allowlist 다. workflow 의 어떤 줄도 이름을 부르지 않는
# 통합 테스트 binary 는 CI 에서 한 번도 안 돈다 — CI 를 red 로 만들려고 쓴 가드
# 테스트가 아무것도 안 지키면서 green 일 수 있다는 뜻이다. keyring 테스트(#1815)가
# 그랬다.
#
# ## 무엇을 세는가 — 이 규칙이 판정의 전부다
#
#   전수   = `find <tests> -maxdepth 1 -type f -name '*.rs'` 가 낸 파일의 확장자
#            뗀 이름, 그리고 `find <tests> -mindepth 2 -maxdepth 2 -type f -name
#            'main.rs'` 가 낸 파일의 부모 디렉토리 이름 (cargo 가 자동 인식하는
#            통합 테스트 target 두 형태. 후자는 `cargo metadata` 로 실측 확인 —
#            빈 디렉토리에 main.rs 하나를 넣으면 target 이 하나 늘고 그 이름은
#            디렉토리 이름이다)
#   호출   = `.github/workflows/` 아래 모든 파일에서, 첫 비공백이 `#` 가 아닌
#            줄에 있는 `--test<공백><이름>` 의 <이름>
#   미호출 = 전수 − 호출  →  전부 ci-uncalled-tests.txt 에 사유와 함께 있어야 한다
#
# 이 규칙에 안 적힌 성질은 판정에 안 들어간다.
#
# 주석 줄을 호출에서 빼는 이유: 이 저장소 `ci.yml` 은 「예전 줄은 `--test X` 였다」는
# 이력 주석을 관례로 남긴다. 주석을 세면 진짜 호출을 지우고 이력 주석만 남긴 커밋이
# 게이트를 green 으로 통과하면서 그 binary 를 호출로 세고 allowlist 에도 안 넣는다 —
# 이 게이트가 막으려던 상태 그대로다.
#
# 반대 방향도 본다. allowlist 는 줄어들기만 해야 하므로, 파일이 사라졌거나 이제
# 호출되는 이름이 allowlist 에 남아 있으면 그것도 위반이다 — 안 그러면 이 파일이
# 죽은 줄이 쌓이는 자리가 된다.
#
# 사용:
#   bash scripts/check-ci-test-calls.sh          # 이 repo
#   bash scripts/check-ci-test-calls.sh <ROOT>   # 다른 트리 (테스트가 쓴다)
#
# 마지막 줄에 전수 · 호출 · allowlist 를 찍는다. 이 게이트의 수치를 인용할 일이
# 있으면 이 명령의 출력을 쓴다 — 같은 대조를 손으로 다시 적으면 게이트가 바뀌는
# 날 그 사본만 낡는다.
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

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

# grep 은 0 건일 때 1, 오류일 때 2 로 나간다. 여기서 그 둘을 갈라야 workflow 를 못
# 읽었다는 원인이 메시지로 나온다 — 안 가르면 아래 `called_n -eq 0` 가드가 대신
# 잡아 exit 2 는 나지만 원인은 안 알려 준다. 이름 추출을 같은 파이프라인에 붙이면
# pipefail 이 오른쪽의 rc 1 을 왼쪽의 rc 2 위에 덮어써서 그 구분이 사라지므로 두
# 단계로 쪼갠다. 주석 줄을 빼는 사유는 이 파일 헤더에 있다.
workflow_lines="$(grep -rhvE '^[[:space:]]*#' "$WORKFLOWS_DIR")"
strip_rc=$?
if [ "$strip_rc" -gt 1 ]; then
	echo "ERROR: $WORKFLOWS_DIR 를 못 읽었다 (grep exit $strip_rc) — 검사 불성립" >&2
	exit 2
fi

# 아래 grep 은 위에서 읽어 둔 문자열만 보므로 디렉토리 읽기 실패가 여기 rc 로는
# 안 온다. 0 건은 `called_n -eq 0` 가드가 받는다.
called="$(printf '%s\n' "$workflow_lines" |
	grep -oE -e '--test[[:space:]]+[A-Za-z0-9_]+' |
	awk 'NF {print $2}' | sort -u)"
called_n="$(printf '%s\n' "$called" | grep -c '.')"

# 위와 같은 이유. `--test` 표기가 통째로 바뀌거나 workflow 경로가 틀리면 전수가
# 미호출로 보이는데, 그때 나가야 하는 답은 allowlist 대조가 아니라 이 ERROR 다.
if [ "$called_n" -eq 0 ]; then
	echo "ERROR: $WORKFLOWS_DIR 에 \`--test <이름>\` 호출이 0 건이다 — 표기가 바뀌었거나 경로가 틀렸다" >&2
	exit 2
fi

# 집합 판정은 subprocess 없이 한다. `printf | grep -Fxq` 로 짜면 조회마다 fork 를
# 떠서, 로컬 vitest 를 병렬로 돌리는 동안 이 게이트가 13초까지 늘어 테스트가 10초
# timeout 으로 죽었다. 아래 형태는 fork 가 0 이다
# (`/usr/bin/time -p bash scripts/check-ci-test-calls.sh` 9회 median 이 이 브랜치
# 트리에서 0.18초). 양쪽 끝의 개행이 부분 일치를 막는다 — `case` 의 인용된 확장은
# glob 이 아니라 리터럴이다.
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
