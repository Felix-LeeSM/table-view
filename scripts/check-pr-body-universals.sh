#!/usr/bin/env bash
# check-pr-body-universals.sh — PR body 의 전칭 서술에 반증 명령을 요구한다 (issue #2228).
#
# PR body 는 다음 노드가 읽는 입력이다. 노드는 죽고 산출물만 남으니, 실측을 넘어선
# 전칭 서술은 미래 세션의 거짓 전제가 된다. 룰의 SOT 는
# memory/workflow/implementation/memory.md §5 「새로 쓴 전칭 서술이 실측을 넘어섬」과
# memory/workflow/delivery/memory.md 「PR body」다 — 이 스크립트는 집행 장치일 뿐이다.
#
# ## 무엇을 세는가 — 이 주석이 판정을 정의한다
#
#   트리거 낱말 — 이 목록이 판정이다 (실행되는 형태는 아래 `TRIGGERS` 변수):
#
#     전부 · 유일 · 항상 · 뿐이다 · 빠짐없이 · 하나도
#
#   낱말 경계는 안 본다 — 부분 문자열로 걸린다.
#
#   「명령 줄」 = 아래 셋 중 하나에 맞는 줄
#     (a) 코드 펜스 마커 — 줄 앞(공백 허용)이 ``` 또는 ~~~ 로 시작하는 줄
#     (b) 펜스 안의 줄 — (a) 가 연 블록이 (a) 로 닫히기 전까지의 줄
#     (c) 백틱 한 쌍 안에 공백이 든 줄 — `pnpm test` 처럼 인자를 가진 것은 명령으로
#         세고, `sourceGates` 같은 한 낱말 식별자는 안 센다. 쌍은 줄 앞에서부터
#         차례로 묶는다: `a` 와 `b` 는 두 쌍이고 어느 쪽에도 공백이 없어 명령이
#         아니다. 닫는 백틱이 그 줄에 없으면 줄 끝까지를 한 조각으로 본다 —
#         인라인 코드가 다음 줄로 넘어간 자리다
#
#   「±6 줄」 = body 를 줄로 세어(첫 줄 = 1) 트리거 줄이 N 번이면 [N-6, N+6]
#   닫힌 구간. 자기 줄을 포함해 최대 13 줄이고, body 밖으로 나가는 쪽은 짧아진다.
#
#   위반 = 트리거 낱말이 든 줄인데 그 구간 안에 명령 줄이 없는 것.
#   위반 0 이어야 통과한다. 여기 안 적힌 성질은 판정에 안 들어간다.
#
# ## 상한 — 이 게이트는 body 의 진위를 안 본다
#
#   도는 판정은 「위 낱말이 든 줄 옆에 명령이 있는가」 하나다. 명령이 그
#   문장을 실제로 반증하는지, 그 문장이 참인지는 검사하지 않는다. 트리거 낱말이
#   없는 거짓 — 기전을 잘못 귀속한 문장(「<도구> 가 이 crate 를 검사한다」)이
#   대표 — 은 원리적으로 안 걸린다. 영문 전칭(all / only / always)도 판정 밖이다:
#   이슈 #2228 이 머지된 body 에서 센 모집단이 위 여섯 낱말이었고, 겨냥하는 몫도
#   그 이슈가 숫자로 못박아 뒀다.
#
# 사용:
#   bash scripts/check-pr-body-universals.sh          # stdin 으로 body
#   bash scripts/check-pr-body-universals.sh <FILE>   # 파일로 body
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

set -uo pipefail

TRIGGERS='전부 유일 항상 뿐이다 빠짐없이 하나도'
WINDOW=6

FENCE_RE='^[[:space:]]*(```|~~~)'
BT='`'

# 판정 (c). 백틱을 줄 앞에서부터 쌍으로 묶고, 어느 한 쌍 안에 공백이 있으면 명령
# 줄이다. 정규식 한 방으로 쓰면 (백틱 · 비백틱 · 공백 · 비백틱 · 백틱) 서로 다른
# 두 쌍 **사이**의 공백까지 맞아, 코드 조각 둘을 나열한 산문 줄이 명령으로 세어진다.
has_inline_cmd() {
	local rest="$1" span
	while :; do
		case "$rest" in
		*"$BT"*) rest="${rest#*"$BT"}" ;;
		*) return 1 ;;
		esac
		case "$rest" in
		*"$BT"*)
			span="${rest%%"$BT"*}"
			rest="${rest#*"$BT"}"
			;;
		*)
			# 닫는 백틱이 이 줄에 없다 = 인라인 코드가 다음 줄로 넘어갔다. 줄
			# 끝까지를 조각으로 본다 — 안 그러면 wrap 된 명령 인용이 통째로 안
			# 세어진다.
			span="$rest"
			rest=""
			;;
		esac
		case "$span" in
		*[[:space:]]*) return 0 ;;
		esac
	done
}

src="${1-}"
if [ -n "$src" ]; then
	if [ ! -f "$src" ]; then
		echo "ERROR: 검사할 body 파일이 없다: $src" >&2
		exit 2
	fi
	exec <"$src"
fi

lines=()
# `|| [ -n "$line" ]` 가 없으면 개행으로 안 끝나는 마지막 줄이 통째로 사라진다 —
# 그 줄의 위반은 검사되지 않은 채 green 이 된다.
while IFS= read -r line || [ -n "$line" ]; do
	lines+=("$line")
done

n=${#lines[@]}
# 0 줄을 "위반 0" 으로 통과시키면 파이프가 끊긴 날 게이트가 아무것도 안 보면서
# green 이 된다. 검사 불성립은 통과가 아니다. 빈 body 를 통과로 볼지는 호출자가
# 정한다 (.github/workflows/ci.yml 의 스텝이 `-z "$BODY"` 로 먼저 거른다).
if [ "$n" -eq 0 ]; then
	echo "ERROR: body 가 0 줄이다 — 검사 불성립" >&2
	exit 2
fi

# 1) 줄마다 「명령 줄」인지 먼저 표시한다. 펜스 상태는 앞에서 뒤로 한 번만 흐른다.
in_fence=0
is_cmd=()
for ((i = 0; i < n; i++)); do
	l="${lines[$i]}"
	if [[ $l =~ $FENCE_RE ]]; then
		is_cmd[$i]=1
		in_fence=$((1 - in_fence))
	elif [ "$in_fence" -eq 1 ]; then
		is_cmd[$i]=1
	elif has_inline_cmd "$l"; then
		is_cmd[$i]=1
	else
		is_cmd[$i]=0
	fi
done

# 2) 트리거 줄마다 ±6 줄 안에 명령 줄이 있는지 본다.
violations=0
for ((i = 0; i < n; i++)); do
	l="${lines[$i]}"
	hit=0
	for t in $TRIGGERS; do
		case "$l" in
		*"$t"*)
			hit=1
			break
			;;
		esac
	done
	[ "$hit" -eq 1 ] || continue

	lo=$((i - WINDOW))
	[ "$lo" -lt 0 ] && lo=0
	hi=$((i + WINDOW))
	[ "$hi" -gt $((n - 1)) ] && hi=$((n - 1))

	near=0
	for ((j = lo; j <= hi; j++)); do
		if [ "${is_cmd[$j]}" -eq 1 ]; then
			near=1
			break
		fi
	done
	if [ "$near" -eq 0 ]; then
		violations=$((violations + 1))
		printf '%s:%s\n' "$((i + 1))" "$l" >&2
	fi
done

if [ "$violations" -gt 0 ]; then
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::PR body 에 반증 명령이 붙지 않은 전칭 서술 $violations 줄 (위 목록, body 첫 줄부터 센 줄 번호). 그 줄 ±6 줄 안에 문장을 반증할 명령을 붙이거나 전칭 낱말을 빼라 — 규칙 SOT 는 memory/workflow/implementation/memory.md §5, 판정 정의는 scripts/check-pr-body-universals.sh 헤더 (issue #2228). 이 검사는 body 편집이 아니라 다음 commit 에 다시 돈다." >&2
	exit 1
fi

echo "ok: body $n 줄에 반증 명령 없는 전칭 서술 0 줄"
