#!/usr/bin/env bash
# check-memory-doc-size.sh — memory/ 트리의 `memory.md` 크기 cap 집행 (issue #2128).
#
# `memory/` 아래 `memory.md` 전수를 보고 두 상한을 둘 다 검사한다:
#   줄수   <= 200
#   문자수 <= 12,000    ← 문자다. byte 가 아니다 (아래 로케일 주석)
#
# 상한의 SOT 는 AGENTS.md 「강제 룰」과 memory/memory.md 「팔레스 규칙」이다. 이
# 스크립트는 그 룰의 집행 장치일 뿐 룰을 소유하지 않는다 — 숫자를 바꾸려면 저 둘을
# 먼저 고쳐라.
#
# 이 게이트가 안 보는 것: 같은 룰의 "`memory.md` 만 허용" 절반. `memory/index/` 의
# 두 cross-link 파일이 명문 예외라(memory/memory.md 「팔레스 규칙」) 파일명 검사는
# 여기 없다. 그쪽은 여전히 규율뿐이다.
#
# 사용:
#   bash scripts/check-memory-doc-size.sh          # 이 repo 의 memory/
#   bash scripts/check-memory-doc-size.sh <DIR>    # 다른 트리 (테스트가 쓴다)
#
# exit: 0 전부 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

set -uo pipefail

MAX_LINES=200
MAX_CHARS=12000

ROOT="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/memory"}"

if [ ! -d "$ROOT" ]; then
	echo "ERROR: 검사할 디렉토리가 없다: $ROOT" >&2
	exit 2
fi

# `wc -m` 은 "문자"를 로케일의 인코딩으로 센다 — LC_ALL=C 면 디코딩을 안 해서
# byte 수가 나온다. 이 트리는 한글 본문이라 UTF-8 에서 문자당 3 byte 이고, 그
# 차이가 cap 을 통째로 뒤흔든다 (memory/workflow/delivery/memory.md 는 4,798 문자
# / 7,642 byte). 그래서 UTF-8 로케일을 고르되, 골랐다고 믿지 않고 3 글자를 실제로
# 재서 확인한다. 확인 없이 지나가면 게이트가 조용히 다른 단위를 재게 된다.
pick_utf8_locale() {
	local cand
	for cand in "${LC_ALL:-}" "${LANG:-}" C.UTF-8 en_US.UTF-8; do
		[ -n "$cand" ] || continue
		if [ "$(printf '가나다' | LC_ALL="$cand" wc -m 2>/dev/null | tr -d '[:space:]')" = "3" ]; then
			printf '%s' "$cand"
			return 0
		fi
	done
	return 1
}

if ! LC_ALL="$(pick_utf8_locale)"; then
	echo "ERROR: wc -m 이 문자를 못 센다 — UTF-8 로케일이 없다 (LC_ALL / LANG / C.UTF-8 / en_US.UTF-8 전부 실패)" >&2
	echo "       이 상태로 재면 문자 대신 byte 가 나와 cap 이 다른 뜻이 된다." >&2
	exit 2
fi
export LC_ALL

checked=0
violations=0

# 파이프 대신 process substitution 인 이유: 파이프면 while 이 서브셸에서 돌아
# 카운터가 통째로 사라진다.
while IFS= read -r file; do
	checked=$((checked + 1))
	lines="$(wc -l <"$file" | tr -d '[:space:]')"
	chars="$(wc -m <"$file" | tr -d '[:space:]')"

	if [ "$lines" -gt "$MAX_LINES" ]; then
		echo "FAIL $file: $lines lines > $MAX_LINES" >&2
		violations=$((violations + 1))
	fi
	if [ "$chars" -gt "$MAX_CHARS" ]; then
		echo "FAIL $file: $chars chars > $MAX_CHARS" >&2
		violations=$((violations + 1))
	fi
done < <(find "$ROOT" -type f -name memory.md | sort)

# 0 개를 "위반 0" 으로 통과시키면 트리가 옮겨지거나 이름이 바뀐 날 게이트가 조용히
# 아무것도 안 재면서 green 이 된다. 검사 불성립은 통과가 아니다.
if [ "$checked" -eq 0 ]; then
	echo "ERROR: $ROOT 아래에 memory.md 가 0 개다 — 트리가 옮겨졌거나 경로가 틀렸다" >&2
	exit 2
fi

if [ "$violations" -gt 0 ]; then
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 평범한 한
	# 줄이다. 게이트가 blocking 이라 "어느 파일이 얼마나 넘었나" 가 로그를 열지
	# 않고도 보여야 해서 넣었다.
	echo "::error::memory doc-size cap 위반 $violations 건 (위 FAIL 줄). cap 은 $MAX_LINES 줄 / $MAX_CHARS 문자이고, 넘으면 방을 하위 주제로 쪼갠다 — memory/memory.md 「팔레스 규칙」." >&2
	exit 1
fi

echo "ok: memory.md $checked 개 전부 $MAX_LINES 줄 / $MAX_CHARS 문자 이하 (LC_ALL=$LC_ALL)"
