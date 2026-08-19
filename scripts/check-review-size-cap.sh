#!/usr/bin/env bash
# check-review-size-cap.sh — 리뷰 산출물 한 벌의 분량 cap 집행 (issue #2321).
#
# PR body 한 벌 · scorecard 코멘트 한 장을 받아 문자수 상한을 넘는지 본다:
#   문자수 <= 8,000    ← 문자다. byte 가 아니다 (아래 로케일 절)
#
# ## 무엇을 세는가 — 이 주석이 판정을 정의한다
#
#   「문서」 = 호출자가 stdin 또는 파일로 넘긴 입력 전부. 개행도 한 글자로 센다.
#   위반 = 문자수가 상한을 **넘는** 것. 「이하」라 정각은 통과다.
#   여기 안 적힌 성질은 판정에 안 들어간다 — 문서의 구조도 내용도 안 본다.
#
#   **호출자는 문서에 없던 문자를 얹지 않는다.** 개행을 한 글자로 세므로
#   `printf '%s\n' "$DOC"` 은 이 스크립트가 실제보다 1 을 더 세게 만들고, 그러면
#   같은 상한이 호출 자리마다 다른 수가 된다 — ci.yml 의 PR body cap 이
#   5,516 자 body 를 5,517 로 읽어, 상한이 12,000 이던 시절 그 자리의 실효 상한이
#   11,999 였다. 두 자리 다
#   `printf '%s'` 로 넘긴다. 이 계약은 위 판정 정의의 따름 문장이라 여기 둔다.
#
#   **한 벌씩 재고 합치지 않는다.** scorecard 를 라운드 합으로 재면 상한이
#   라운드 수에 반비례해 좁아지고, 걸렸을 때 줄여야 하는 것은 이번 라운드
#   리뷰어가 못 건드리는 지난 라운드 코멘트다. 여러 장을 재려면 호출자가
#   장마다 이 스크립트를 부른다 (.github/workflows/review-gate.yml).
#
# ## 상한 8,000 의 출처 — 재작성 하한 위에 세운 값이다 (issue #2507)
#
#   **12,000 을 물려받지 않는다.** 그 값은 도입 당시(issue #2321) scorecard 한
#   장의 중앙값이 약 15,300 자이던 분포에서 골랐고, AGENTS.md 「강제 룰」이
#   `memory/**/memory.md` 에 건 수와 같다는 것이 근거였다. 내용 규약(#2320)이
#   먹으면서 분포가 내려앉았는데 값이 안 따라와, 2026-08-19 에 머지된 PR 다섯의
#   산출물 열넷 중 걸리는 것이 0 이 됐다.
#
#   새 값은 **처방이 못 줄이는 고정분(하한) 위**에 세웠다. 그날 가장 긴
#   scorecard 둘과 가장 긴 PR body 하나를
#   memory/workflow/documentation/memory.md 「결정만 적는다」대로 다시 써서 재니
#   2,995 · 4,689 · 4,467 자였다. 재작성 최댓값은 4,689 이고 8,000 은 그 위로 약
#   70% 여유다. **4,689 는 고정분의 하한이지 고정분이 아니다** — 그 재작성 셋이
#   결론인 수치에 붙어야 하는 명령까지 같이 뺐으니 진짜 고정분은 그보다 위다
#   (얼마나 위인지는 안 쟀다). 동시에 8,000 은 그날 최댓값(PR body 7,618 ·
#   scorecard 6,060) 바로 위라 — 오늘 형태의 산출물은 안 죽이고 그보다 늘어나는
#   순간 문다. 재작성 원문과 실측 명령은 issue #2507 이 갖는다.
#
#   **표면이 둘인데 값은 하나다.** 하나로 두면 그날 최댓값 위 여유가 PR body 약
#   5% · scorecard 약 32% 로 갈린다 — red 를 푸는 값이 비싼 쪽이 여유가 더 적다
#   (아래 「red 가 풀리는 법」: PR body 는 새 commit 이 있어야 풀리고 scorecard 는
#   re-run 이면 풀린다). 그래도 안 나눈 이유는 비용이다 — 나누면 이 스크립트의
#   인자 계약과 호출자 둘과 그 테스트가 같이 는다. 하한 순서는 근거가 아니다:
#   재작성 하한은 PR body 4,467 < scorecard 4,689 로 오히려 반대 방향이다.
#
#   **scripts/check-memory-doc-size.sh 와는 무관하다.** 그쪽은
#   `memory/**/memory.md` 의 cap 이고 소유자는 AGENTS.md 「강제 룰」이다. 두
#   게이트는 서로를 안 부르고 룰도 따로다 — 어느 쪽을 바꿔도 다른 쪽은 안 따라
#   움직인다.
#
#   **cap 을 지키는 것이 계약을 지키는 것은 아니다** — cap 은 잘라내기로도
#   만족되고 잘리는 것은 대개 결론이 아니라 근거다. 무엇만 남기는지는 위
#   「결정만 적는다」와 .agents/prompts/pr-review.md 「반환 형식 — scorecard」 ·
#   .agents/prompts/issue-implement.md 「PR body 틀」의 닫힌 목록이 정하고, 이
#   게이트는 그것이 지켜졌는지 못 본다.
#
# ## 빈 입력은 검사 불성립이다 (issue #2374)
#
#   0 문자를 「상한 아래」로 읽으면 **아무 크기의 문서도 통과한다.** 0 이 나오는
#   흔한 원인은 문서가 비어서가 아니라 문서를 안 넘겨서다 — stdin 을 파이프로
#   안 주거나, 아래 「사용」의 두 자리를 헷갈려 파일 경로를 LABEL 에 넣거나
#   (그러면 FILE 이 없어 stdin 을 읽는다). 20,000 자 문서가
#   `ok: <경로> 0 chars <= <상한>` 으로 통과하던 자리가 그것이다. 이 스크립트는
#   「내 문서가 넘나」를 push 전에 손으로 재는 용도로도 쓰이고, 거기서 나온 거짓
#   green 은 required 게이트가 red 가 되고서야 드러난다 — 그때 ci.yml 쪽은
#   `edited` 를 안 들어서 새 commit 없이는 안 풀린다 (아래 「red 가 풀리는 법」).
#   그래서 0 문자는 위반(exit 1)이 아니라 **검사 불성립(exit 2)** 으로 끊는다.
#
#   대가: 진짜로 빈 문서를 재는 호출자가 생기면 그쪽이 red 가 된다. 그 호출자는
#   부르기 전에 빈 것을 스스로 걸러야 한다 — 커밋된 호출자 둘이 이미 그 모양이다.
#   .github/workflows/ci.yml 의 PR body 스텝은 `-z "$BODY"` 로 먼저 빠져나가고
#   (이 판정이 그 줄을 하중 부재로 만든다 — 지우면 body 없는 이벤트가 red 다),
#   .github/workflows/review-gate.yml 은 `## Scorecard` 로 시작하는 코멘트만
#   골라 넘기므로 빈 입력이 안 나온다.
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

MAX_CHARS=8000

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
# 빈 문자열이 되고 `[ "" -gt 8000 ]` 은 rc 2 로 그냥 지나가 통과가 된다 — 숫자
# 판정을 비교 앞에 둬야 그 경로가 안 열린다.
chars="$(wc -m | tr -d '[:space:]')"
case "$chars" in
'' | *[!0-9]*)
	echo "ERROR: $label 의 문자수를 못 쟀다 (읽은 값: '$chars') — 검사 불성립" >&2
	exit 2
	;;
esac

# 0 은 「상한 아래」가 아니라 「잴 것을 못 받았다」다 — 위 헤더 「빈 입력은 검사
# 불성립이다」. FILE 을 줬든 stdin 을 읽었든 같은 자리에서 끊는다.
if [ "$chars" -eq 0 ]; then
	echo "ERROR: $label: 잰 문서가 0 문자다 — 넘어온 문서가 없다. 통과로 강등하지 않는다" >&2
	echo "       사용: bash scripts/check-review-size-cap.sh <LABEL> [FILE]" >&2
	echo "       FILE 을 안 주면 stdin 을 읽는다 — 파일을 재려면 경로는 LABEL 이 아니라 두 번째 자리다" >&2
	exit 2
fi

if [ "$chars" -gt "$MAX_CHARS" ]; then
	echo "FAIL $label: $chars chars > $MAX_CHARS" >&2
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::$label 이 분량 cap 을 넘었다 ($chars > $MAX_CHARS 문자). 근거를 빼지 말고 되풀이를 빼라 — 판정 정의와 상한의 출처는 scripts/check-review-size-cap.sh 헤더 (issue #2321). red 를 푸는 법은 이 스텝이 이어서 낸다." >&2
	exit 1
fi

echo "ok: $label $chars chars <= $MAX_CHARS (LC_ALL=$LC_ALL)"
