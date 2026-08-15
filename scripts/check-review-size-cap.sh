#!/usr/bin/env bash
# check-review-size-cap.sh — 리뷰 산출물 한 벌의 분량 cap 집행 (issue #2321).
#
# PR body 한 벌 · scorecard 코멘트 한 장을 받아 문자수 상한을 넘는지 본다:
#   문자수 <= 12,000    ← 문자다. byte 가 아니다 (아래 로케일 절)
#
# ## 무엇을 세는가 — 이 주석이 판정을 정의한다
#
#   「문서」 = 호출자가 stdin 또는 파일로 넘긴 입력 전부. 개행도 한 글자로 센다.
#   위반 = 문자수가 상한을 **넘는** 것. 「이하」라 정각은 통과다.
#   여기 안 적힌 성질은 판정에 안 들어간다 — 문서의 구조도 내용도 안 본다.
#
#   **호출자는 문서에 없던 문자를 얹지 않는다.** 개행을 한 글자로 세므로
#   `printf '%s\n' "$DOC"` 은 이 스크립트가 실제보다 1 을 더 세게 만들고, 그러면
#   같은 「12,000」이 호출 자리마다 다른 수가 된다 — ci.yml 의 PR body cap 이
#   5,516 자 body 를 5,517 로 읽어 실효 상한이 11,999 였다. 두 자리 다
#   `printf '%s'` 로 넘긴다. 이 계약은 위 판정 정의의 따름 문장이라 여기 둔다.
#
#   **한 벌씩 재고 합치지 않는다.** scorecard 를 라운드 합으로 재면 상한이
#   라운드 수에 반비례해 좁아지고, 걸렸을 때 줄여야 하는 것은 이번 라운드
#   리뷰어가 못 건드리는 지난 라운드 코멘트다. 여러 장을 재려면 호출자가
#   장마다 이 스크립트를 부른다 (.github/workflows/review-gate.yml).
#
# ## 상한 12,000 의 출처
#
#   AGENTS.md 「강제 룰」이 `memory/**/memory.md` 에 건 것과 같은 수다 — 이
#   저장소가 이미 "산문 한 벌을 쪼갤 때" 로 정해 둔 값이고, 그쪽 집행은
#   scripts/check-memory-doc-size.sh 다. 두 게이트는 서로를 안 부르고 룰도
#   따로다: 저 방들의 cap 을 바꿔도 이 값은 안 따라 움직인다. 이 수가 리뷰
#   산출물의 실측 분포 어디에 서는지는 issue #2321 과 그 PR body 가 재현
#   명령과 함께 기록한다.
#
# ## 빈 입력은 통과다
#
#   이 게이트가 막는 해악은 「너무 길다」 하나뿐이라, 0 문자는 못 잰 것이
#   아니라 실제로 상한 아래다. 빈 body 자체를 문제로 볼지는 호출자가 정한다
#   (.github/workflows/ci.yml 의 스텝이 `-z "$BODY"` 로 먼저 거른다).
#
# ## red 가 풀리는 법은 부르는 자리마다 다르다
#
#   ci.yml 의 PR body cap 은 payload 의 body 를 읽는다 — 그 workflow 가
#   `edited` 를 안 들으므로 body 를 고쳐도 **다음 commit** 까지는 안 풀리고,
#   job re-run 은 옛 payload 를 다시 읽어 같은 자리에서 또 실패한다.
#   review-gate.yml 의 scorecard cap 은 코멘트를 API 로 다시 읽으므로 코멘트를
#   고치고 re-run 하면 풀린다. 그 문장은 각 workflow 스텝이 낸다.
#
# 사용:
#   bash scripts/check-review-size-cap.sh <LABEL>          # stdin 으로 문서
#   bash scripts/check-review-size-cap.sh <LABEL> <FILE>   # 파일로 문서
#
# exit: 0 통과 · 1 상한 초과 · 2 검사가 성립하지 않음

set -uo pipefail

MAX_CHARS=12000

label="${1-}"
if [ -z "$label" ]; then
	echo "ERROR: 문서 이름(LABEL)이 없다 — 어느 문서가 넘었는지 못 적는다" >&2
	echo "       사용: bash scripts/check-review-size-cap.sh <LABEL> [FILE]" >&2
	exit 2
fi

src="${2-}"
if [ -n "$src" ]; then
	if [ ! -f "$src" ]; then
		echo "ERROR: 검사할 문서 파일이 없다: $src" >&2
		exit 2
	fi
	exec <"$src"
fi

# `wc -m` 은 "문자"를 로케일의 인코딩으로 센다 — LC_ALL=C 면 디코딩을 안 해서
# byte 수가 나온다. 이 저장소의 리뷰 산출물은 한국어 산문이라 UTF-8 에서 문자당
# 3 byte 이고, byte 로 재면 상한이 실질 4,000 자로 좁아져 평범한 scorecard 가
# 거짓 red 를 맞는다. 그래서 UTF-8 로케일을 고르되, 골랐다고 믿지 않고 3 글자를
# 실제로 재서 확인한다. 같은 기법을 scripts/check-memory-doc-size.sh 가 쓴다 —
# 두 게이트가 서로를 안 부르므로(위 「상한」절) 공유 파일로 묶지 않았다: 묶으면
# 한쪽의 실패가 다른 쪽 required 게이트로 번진다.
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

# 못 잰 입력을 「상한 아래」로 강등하지 않는다. `set -e` 가 없어서 실패한 치환은
# 빈 문자열이 되고 `[ "" -gt 12000 ]` 은 rc 2 로 그냥 지나가 통과가 된다 — 숫자
# 판정을 비교 앞에 둬야 그 경로가 안 열린다.
chars="$(wc -m | tr -d '[:space:]')"
case "$chars" in
'' | *[!0-9]*)
	echo "ERROR: $label 의 문자수를 못 쟀다 (읽은 값: '$chars') — 검사 불성립" >&2
	exit 2
	;;
esac

if [ "$chars" -gt "$MAX_CHARS" ]; then
	echo "FAIL $label: $chars chars > $MAX_CHARS" >&2
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::$label 이 분량 cap 을 넘었다 ($chars > $MAX_CHARS 문자). 근거를 빼지 말고 되풀이를 빼라 — 판정 정의와 상한의 출처는 scripts/check-review-size-cap.sh 헤더 (issue #2321). red 를 푸는 법은 이 스텝이 이어서 낸다." >&2
	exit 1
fi

echo "ok: $label $chars chars <= $MAX_CHARS (LC_ALL=$LC_ALL)"
