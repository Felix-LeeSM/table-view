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
#   스캔 루트 = `src-tauri/**/Cargo.toml` 바로 옆에 있는 `tests` 디렉토리 전부
#            (`target` 디렉토리 안은 안 본다). 앱 패키지의 `src-tauri/tests` 와
#            workspace member 의 `src-tauri/<member>/tests` 가 그렇게 들어오고,
#            이번 실행이 무엇을 스캔했는지는 아래 집계 줄이 찍는다 (#2336)
#   전수   = 스캔 루트마다 `find <root> -maxdepth 1 -type f -name '*.rs'` 가 낸
#            파일의 확장자 뗀 이름, 그리고 `find <root> -mindepth 2 -maxdepth 2
#            -type f -name 'main.rs'` 가 낸 파일의 부모 디렉토리 이름 (cargo 가
#            자동 인식하는 통합 테스트 target 두 형태. 후자는 `cargo metadata` 로
#            실측 확인 — 빈 디렉토리에 main.rs 하나를 넣으면 target 이 하나 늘고
#            그 이름은 디렉토리 이름이다). 두 루트에 같은 이름이 있으면 한 이름으로
#            센다 — 호출도 이름으로만 세기 때문이다
#   호출   = `.github/workflows/` 아래 모든 파일에서, 첫 비공백이 `#` 가 아닌
#            줄에 있는 `--test<공백><이름>` 의 <이름>
#   미호출 = 전수 − 호출  →  전부 ci-uncalled-tests.txt 에 사유와 함께 있어야 한다
#
# 이 규칙에 안 적힌 성질은 판정에 안 들어간다.
#
# 스캔 루트를 손으로 열거하지 않는 이유: member 가 늘 때마다 목록이 낡는데, 낡은 쪽은
# red 가 아니라 green 이다 — 그 crate 의 통합 테스트를 아무도 안 부르는 상태가 조용히
# 통과한다. `src-tauri/tvw/tests` 가 실제로 그렇게 들어왔다 (#2336). `[workspace]
# members` 를 읽지 않는 이유는 그 목록이 member 전수가 아니어서다 — path dependency 는
# 적지 않아도 member 이고, 그 사실은 `src-tauri/Cargo.toml` 헤더가 적는다. cargo 가
# 통합 target 을 찾는 단위는 manifest 이므로 manifest 옆 `tests` 를 그대로 쓴다.
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
# 집계 줄(전수 · 호출 · allowlist · 스캔 루트)은 **모든 종료 경로에 다 찍는다.**
# 이 게이트의 수치를 인용할 일이 있으면 이 명령의 출력을 쓴다 — 같은 대조를 손으로
# 다시 적으면 게이트가 바뀌는 날 그 사본만 낡는다. 어느 경로가 무엇을 찍는지는
# 아래 「출력 계약」 블록 하나가 정한다 — 여기 옮겨 적지 않으므로 둘이 갈라질 수 없다.
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

set -uo pipefail

# 이 스크립트가 내는 줄의 **순서**는 `sort` 세 곳이 정한다 — 스캔 루트 라벨, target
# 이름(= FAIL 줄 차례), 호출 이름. collation 은 로케일마다 달라서, 고정하지 않으면
# 같은 트리가 환경에 따라 다른 출력을 낸다. 실측: 4-루트 트리의 스캔 루트 라벨과
# 대문자로 시작하는 target 의 FAIL 줄 차례가 `C` 와 `en_US.UTF-8` 에서 둘 다 뒤집혔다
# (#2347). 여기서 한 번 export 해야 `sort` 가 늘어도 새 자리가 안 샌다 — 자리마다
# 앞에 붙이는 형태는 다음에 추가되는 한 곳을 빠뜨린다.
# `tr -d '\r'` 도 이 export 에 기댄다: GNU tr 은 UTF-8 로케일에서 `0xA0` 을 공백으로
# 접어 한글 음절을 깨뜨리고, `LC_ALL=C` 가 그 처방이다 (BSD tr 은 안 그렇다).
export LC_ALL=C

REPO="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
CRATES_DIR="$REPO/src-tauri"
WORKFLOWS_DIR="$REPO/.github/workflows"
ALLOWLIST="$REPO/ci-uncalled-tests.txt"
ALLOWLIST_NAME="ci-uncalled-tests.txt"

# ## 출력 계약 — 한 곳에서 정하고 모든 종료 경로가 여기를 지난다 (#2347)
#
#   rc 0  stdout  `ok: <집계>`
#   rc 1  stderr  `FAIL <이름>: <사유>` (위반마다) → `집계: <집계>` → `::error::…`
#   rc 2  stderr  `FAIL 검사 불성립: <사유>`       → `집계: <집계>` → `::error::…`
#
# 세 경로가 같은 모양이어야 하는 이유: red 를 받은 사람이 가장 먼저 묻는 것이 "내
# crate 가 스캔되긴 했나" 인데 (#2336 이 바로 안 스캔된 루트였다), 그 답이 경로에
# 따라 사라지면 안 된다. 예전에는 rc 2 에만 `FAIL` 도 `집계:` 도 `::error::` 도
# 없었다 — 검사가 아예 성립 못 한 red 가 가장 적게 말하고 있었다.
#
# 아직 못 잰 축은 `?` / `미측정` 으로 찍고 자리는 남긴다. 빼 버리면 그 실행이 어디까지
# 갔는지를 물을 자리 자체가 없어진다. 계약의 SOT 는
# `memory/runbook/pr-merge-gates/memory.md` 의 이 게이트 문단이다.

targets_n="?"
called_n="?"
allowed_n="?"
roots_label="미측정"
violations=0

summary() {
	printf '통합 테스트 target %s 종 — CI 호출 %s 종, 사유 달린 미호출 allowlist %s 종 (스캔 루트: %s)' \
		"$targets_n" "$called_n" "$allowed_n" "$roots_label"
}

# 위반 한 건. 찍는 자리와 세는 자리를 한 함수로 묶는다 — 떨어져 있으면 한쪽만 도는
# 분기가 생기고, 이 파일의 결함 1 이 정확히 그 형태였다.
fail() { # $1 이름, $2 사유
	echo "FAIL $1: $2" >&2
	violations=$((violations + 1))
}

# 검사 불성립. rc 2 로 나가는 자리는 전부 이 함수를 지난다.
die() { # $1 사유
	echo "FAIL 검사 불성립: $1" >&2
	echo "집계: $(summary)" >&2
	echo "::error::CI 미호출 통합 테스트 대조가 성립하지 않았다 (위 FAIL 줄): $1" >&2
	exit 2
}

for dir in "$CRATES_DIR" "$WORKFLOWS_DIR"; do
	if [ ! -d "$dir" ]; then
		die "검사할 디렉토리가 없다: $dir"
	fi
done

if [ ! -f "$ALLOWLIST" ]; then
	die "allowlist 파일이 없다: $ALLOWLIST"
fi

# find 의 종료 상태를 여기서 받는다. `< <(find ...)` 로 넘기면 process substitution
# 이라 bash 가 상태를 안 보고 pipefail 도 안 걸려서, 못 읽는 하위 디렉토리가 있어도
# 게이트는 green 이 된다 (같은 함정이 scripts/check-memory-doc-size.sh 에도 있다).
# `| sort` 는 루트 순서를 고정한다 — pipefail 이 켜져 있어 find 의 실패는 그대로 온다.
# `target` 을 prune 하는 이유는 둘이다: 빌드 산출물 트리를 훑는 비용, 그리고 그 안에
# 딸려 온 남의 manifest 를 스캔 루트로 세지 않기 위해서다.
if ! manifests="$(find "$CRATES_DIR" -name target -prune -o -type f -path '*/Cargo.toml' -print | sort)"; then
	die "find 가 $CRATES_DIR 를 다 훑지 못했다 (위 stderr)"
fi

# 스캔 루트 = manifest 옆 `tests` 디렉토리. `roots_label` 은 사람이 읽는 자리에만
# 쓰므로 $REPO 를 뗀 상대 경로다 — 임시 트리에서 돌려도 같은 모양으로 읽힌다.
# 한 건도 못 모으면 대입을 안 해 초기값 `미측정` 을 남긴다 — 빈 문자열을 넣으면
# 아래 die 의 집계 줄이 `(스캔 루트: )` 가 돼서 못 쟀다는 사실이 안 보인다.
tests_dirs=()
roots_acc=""
while IFS= read -r manifest; do
	[ -n "$manifest" ] || continue
	dir="${manifest%/Cargo.toml}/tests"
	[ -d "$dir" ] || continue
	tests_dirs+=("$dir")
	roots_acc="${roots_acc:+$roots_acc, }${dir#"$REPO/"}"
done <<<"$manifests"
[ -n "$roots_acc" ] && roots_label="$roots_acc"

# 루트가 0 개면 아무것도 안 재고 통과할 판이다 — 검사 불성립으로 끊는다.
if [ "${#tests_dirs[@]}" -eq 0 ]; then
	die "$CRATES_DIR 아래 manifest 옆에 tests 디렉토리가 하나도 없다 — 트리가 옮겨졌거나 경로가 틀렸다"
fi

# 이 가드는 위 `$CRATES_DIR` find 가 못 잡는 경우만 받는다. 실사용에서 그런 경우는
# 관측되지 않는다 — 위 find 는 스캔 루트를 **포함하는** 트리를 깊이 제한 없이 훑으므로
# 못 읽는 디렉토리가 있으면 항상 먼저 실패한다 (`chmod 000` 실측: 두 번 다 위 가드가
# 잡았다, #2347). 그래도 남겨 둔다: 도달 불가는 이 가드의 성질이 아니라 위 find 의
# 범위가 만드는 성질이라, 위쪽에 `-maxdepth` 를 붙이거나 manifest 목록을
# `cargo metadata` 로 바꾸는 순간 이 자리가 되살아난다. 지우면 그 편집이 게이트를
# 조용한 fail-open 으로 만든다 — 이 파일이 애초에 막으려는 상태다.
if ! flat_files="$(find "${tests_dirs[@]}" -maxdepth 1 -type f -name '*.rs')" ||
	! dir_files="$(find "${tests_dirs[@]}" -mindepth 2 -maxdepth 2 -type f -name 'main.rs')"; then
	die "find 가 스캔 루트($roots_label)를 다 훑지 못했다 (위 stderr)"
fi

targets="$( {
	printf '%s\n' "$flat_files" | sed -n 's#.*/\([^/]*\)\.rs$#\1#p'
	printf '%s\n' "$dir_files" | sed -n 's#.*/\([^/]*\)/main\.rs$#\1#p'
} | sort -u)"
targets_n="$(printf '%s\n' "$targets" | grep -c '.')"

# 0 개를 "위반 0" 으로 통과시키면 트리가 옮겨진 날 게이트가 아무것도 안 재면서
# green 이 된다. 검사 불성립은 통과가 아니다.
if [ "$targets_n" -eq 0 ]; then
	die "스캔 루트($roots_label) 아래에 통합 테스트 target 이 0 개다 — 트리가 옮겨졌거나 경로가 틀렸다"
fi

# grep 은 0 건일 때 1, 오류일 때 2 로 나간다. 여기서 그 둘을 갈라야 workflow 를 못
# 읽었다는 원인이 메시지로 나온다 — 안 가르면 아래 `called_n -eq 0` 가드가 대신
# 잡아 exit 2 는 나지만 원인은 안 알려 준다. 이름 추출을 같은 파이프라인에 붙이면
# pipefail 이 오른쪽의 rc 1 을 왼쪽의 rc 2 위에 덮어써서 그 구분이 사라지므로 두
# 단계로 쪼갠다. 주석 줄을 빼는 사유는 이 파일 헤더에 있다.
workflow_lines="$(grep -rhvE '^[[:space:]]*#' "$WORKFLOWS_DIR")"
strip_rc=$?
if [ "$strip_rc" -gt 1 ]; then
	die "$WORKFLOWS_DIR 를 못 읽었다 (grep exit $strip_rc)"
fi

# 아래 grep 은 위에서 읽어 둔 문자열만 보므로 디렉토리 읽기 실패가 여기 rc 로는
# 안 온다. 0 건은 `called_n -eq 0` 가드가 받는다.
called="$(printf '%s\n' "$workflow_lines" |
	grep -oE -e '--test[[:space:]]+[A-Za-z0-9_]+' |
	awk 'NF {print $2}' | sort -u)"
called_n="$(printf '%s\n' "$called" | grep -c '.')"

# 위와 같은 이유. `--test` 표기가 통째로 바뀌거나 workflow 경로가 틀리면 전수가
# 미호출로 보이는데, 그때 나가야 하는 답은 allowlist 대조가 아니라 이 검사 불성립이다.
if [ "$called_n" -eq 0 ]; then
	die "$WORKFLOWS_DIR 에 \`--test <이름>\` 호출이 0 건이다 — 표기가 바뀌었거나 경로가 틀렸다"
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
	die "allowlist 를 못 읽었다: $ALLOWLIST"
fi

allowed_n=0

# `IFS=` 없이 읽으면 read 가 첫 필드를 이름, 나머지 줄을 사유로 갈라 준다 (앞뒤
# 공백은 read 가 떼고, 사유가 없는 줄은 reason 이 빈 문자열이 된다). 주석과 빈
# 줄은 그렇게 갈린 이름으로 걸러진다.
while read -r name reason; do
	case "$name" in '' | '#'*) continue ;; esac

	if [ -z "$reason" ]; then
		fail "$name" "$ALLOWLIST_NAME 항목에 사유가 없다 — 이름 뒤 같은 줄에 사유를 적어라"
	fi
	if has "$name" "$allowed_set"; then
		fail "$name" "$ALLOWLIST_NAME 에 두 번 있다"
		continue
	fi
	if ! has "$name" "$targets_set"; then
		fail "$name" "$ALLOWLIST_NAME 에 있는데 스캔 루트($roots_label)에 그런 테스트가 없다 — 줄을 지워라"
		continue
	fi
	if has "$name" "$called_set"; then
		fail "$name" "이제 CI 가 부르는데 $ALLOWLIST_NAME 에 남아 있다 — 줄을 지워라"
		continue
	fi

	# 두 줄이 서로 다른 질문에 답한다. `allowed_set` 은 "allowlist 가 이 이름을
	# 덮는가" — 아래 2 차 루프의 `없다` 판정이 읽는다. `allowed_n` 은 집계 줄의
	# 라벨이 약속한 "사유가 달린 것이 몇 종인가" 다. 사유 없는 항목은 앞엔 들고
	# 뒤엔 안 든다.
	#
	# 붙여 두면 사유 없는 항목이 「사유 달린」 수로 세어졌다 (#2347 결함 1). 반대로
	# 사유 없을 때 `continue` 로 통째로 빼면 이번엔 2 차 루프가 `allowlist 에 없다`
	# 를 더 찍어, 파일에 버젓이 있는 이름을 없다고 말하면서 위반을 2 건으로 센다
	# (실측). 갈라야 그 항목이 정확히 한 번, 맞는 문장으로 말해진다.
	allowed_set="$allowed_set$name$NL"
	if [ -n "$reason" ]; then
		allowed_n=$((allowed_n + 1))
	fi
done <<<"$allowlist_body"

while IFS= read -r name; do
	[ -n "$name" ] || continue
	if ! has "$name" "$called_set" && ! has "$name" "$allowed_set"; then
		fail "$name" ".github/workflows 의 어떤 \`--test\` 도 안 부르는데 $ALLOWLIST_NAME 에 없다"
	fi
done <<<"$targets"

if [ "$violations" -gt 0 ]; then
	echo "집계: $(summary)" >&2
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::CI 미호출 통합 테스트 대조 위반 $violations 건 (위 FAIL 줄). 새 테스트는 .github/workflows 의 \`--test\` 로 부르거나, 못 부르는 사유를 $ALLOWLIST_NAME 에 적어라 (issue #2113)." >&2
	exit 1
fi

echo "ok: $(summary)"
