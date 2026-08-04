#!/usr/bin/env bash
# check-wasm-size.sh — parser WASM 산출물의 gzip 크기 예산 (issue #2127).
#
# 두 산출물을 잰다:
#   src/lib/sql/wasm/sql_parser_core_bg.wasm        <= 120 KiB gzip
#   src/lib/mongo/wasm/mongosh_parser_core_bg.wasm  <=  62 KiB gzip
#
# 사용:
#   bash scripts/check-wasm-size.sh          # 이 repo 의 src/lib/**/wasm
#   bash scripts/check-wasm-size.sh <ROOT>   # 다른 트리 (테스트가 쓴다)
#
# exit: 0 전부 예산 안 · 1 초과 있음 · 2 검사가 성립하지 않음
#
# ## advisory 다
#
# 이 스크립트를 부르는 `WASM Size Budget (non-blocking)` job 은 `pr_to_main`
# ruleset 의 required context 목록에 없다. 그 목록은 PR 이 못 바꾸는 라이브
# GitHub 상태이고 SOT 는 memory/runbook/pr-merge-gates/memory.md 다 — 이름이
# 거기 오르기 전에는 여기가 red 여도 머지를 안 막는다 (required 전부 pass +
# non-required 만 fail = mergeStateStatus UNSTABLE = 머지 가능). blocking 으로
# 올리는 것은 별도 결정이다.
#
# ## 재는 방법 — `gzip -9`, 파일명이 아니라 stdin 으로
#
# gzip 은 인자로 받은 경로의 basename 을 헤더에 넣는다. `gzip -c "$path"` 는
# 파일 이름 길이만큼 결과가 커져서(실측: sql 이 +24, mongo 가 +28 byte) 파일을
# 옮기기만 해도 숫자가 변한다. stdin 으로 넣으면 바이트만 남는다:
#
#   gzip -9 -c < src/lib/sql/wasm/sql_parser_core_bg.wasm | wc -c
#
# ## 예산 근거 (2026-08-04 실측)
#
# 기준값은 게이트가 도는 환경 — ubuntu-latest 의 GNU gzip — 에서 새로 빌드한
# 산출물이다: SQL 102,131 byte · Mongo 52,735 byte.
#
#   # 빌드 (out-dir 는 체크인된 산출물 자리)
#   pnpm run build:sql-wasm && pnpm run build:mongosh-wasm
#   # 재기
#   gzip -9 -c < src/lib/sql/wasm/sql_parser_core_bg.wasm | wc -c
#   gzip -9 -c < src/lib/mongo/wasm/mongosh_parser_core_bg.wasm | wc -c
#
# 여유 20% = 위 기준값 × 1.2 를 KiB 단위로 올림 (120 KiB / 62 KiB, 실제 여유
# 20.3% / 20.4%). 20% 를 고른 근거는 재 본 변동폭이다:
#
#   - gzip 구현: 같은 바이트가 Apple gzip 479 와 GNU gzip 1.12 에서 다르게
#     나온다 — mongo 52,088 vs 52,735 (+1.24%), sql 102,055 vs 102,131 (+0.07%).
#   - wasm-opt 생략(`wasm-pack build --no-opt`): mongo 가 GNU 에서 52,412,
#     Apple 에서 53,006 — 적용본보다 최대 +1.76%. sql 은 -6.1% (wasm-opt -Oz 가
#     raw 는 줄이면서 압축률은 떨어뜨린다: raw 308,615 → 280,833).
#   - 같은 소스 재빌드: mongo 는 체크인본과 byte 동일, sql 은 34 byte 차 (+0.03%).
#
# 전부 합쳐 3% 안쪽이라 앞 3%p 가 환경 변동을 흡수하고 남는 ~17%p 가 기능
# 증가분이다. 이 게이트는 크기를 동결하는 장치가 아니라 계단식 증가(무거운
# 의존성 추가)를 잡는 장치다. 지웠던 옛 예산(`git show
# 6cced3ab^:scripts/check-wasm-size.sh`)은 양쪽 극단이었다 — SQL 200 KiB 는
# 기준값의 2배라 크기가 두 배가 되기 전엔 안 울리고, Mongo 53 KiB 는 기준값
# 위로 2.9% 뿐이라 위 변동폭 최대치(53,006)와 1.2% 차이였다. 코드가 안 변해도
# 측정 환경이 바뀌면 울릴 수 있는 예산이다.
#
# 숫자를 바꿀 때는 위 명령을 다시 돌려 기준값부터 갱신해라.

set -uo pipefail

GZIP_LEVEL=9
SQL_BUDGET_BYTES=122880   # 120 KiB
MONGO_BUDGET_BYTES=63488  #  62 KiB

ROOT="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"

if [ ! -d "$ROOT" ]; then
	echo "ERROR: 검사할 디렉토리가 없다: $ROOT" >&2
	exit 2
fi

violations=0
unmeasurable=0

# 하나가 초과해도 나머지를 마저 재고 나간다 — 로그 한 번으로 두 산출물의 현재
# 크기가 다 보여야 예산을 다시 잡을 수 있다.
check_wasm() {
	local label="$1" rel="$2" budget="$3"
	local path="$ROOT/$rel"
	local raw gzipped

	if [ ! -f "$path" ]; then
		echo "ERROR: $label WASM 산출물이 없다: $rel" >&2
		echo "       빌드가 안 돌았거나 경로가 바뀌었다 — 검사 불성립이다." >&2
		unmeasurable=$((unmeasurable + 1))
		return
	fi

	# 크기를 못 재면 초과가 아니라 **불성립**이다. `set -e` 가 없어서 실패한
	# 명령 치환은 빈 문자열이 되고 `[ "" -gt 122880 ]` 은 rc 2 로 그냥 지나가
	# 통과가 된다 — 그 fail-open 을 여기서 닫는다. gzip 은 파이프 앞이라
	# `pipefail` 이 있어야 실패가 잡힌다 (파일 위에 set 해 뒀다).
	if ! raw="$(wc -c <"$path" | tr -d '[:space:]')" ||
		! gzipped="$(gzip -"$GZIP_LEVEL" -c <"$path" | wc -c | tr -d '[:space:]')" ||
		[ -z "$raw" ] || [ -z "$gzipped" ]; then
		echo "ERROR: $label WASM 크기를 못 쟀다: $rel" >&2
		unmeasurable=$((unmeasurable + 1))
		return
	fi

	# 0 byte 는 어떤 예산도 통과한다. 빌드가 빈 파일을 남기고 죽은 날 게이트가
	# 조용히 green 이 되는 경로라 초과가 아니라 불성립으로 끊는다.
	if [ "$raw" -eq 0 ]; then
		echo "ERROR: $label WASM 이 0 byte 다: $rel — 빌드 산출물이 아니다." >&2
		unmeasurable=$((unmeasurable + 1))
		return
	fi

	printf '%s wasm: raw=%s bytes gzip=%s bytes budget=%s bytes (%s)\n' \
		"$label" "$raw" "$gzipped" "$budget" "$rel"

	if [ "$gzipped" -gt "$budget" ]; then
		echo "FAIL $rel: gzip $gzipped bytes > budget $budget bytes" >&2
		violations=$((violations + 1))
	fi
}

# 실측 숫자는 gzip 구현마다 1% 넘게 갈리므로(위 「예산 근거」) 어느 구현으로 잰
# 로그인지 남긴다. 이게 없으면 다음 세션이 로그의 숫자를 재현 못 한다.
# stderr 를 접어 넣는 이유: Apple gzip 은 버전을 stderr 로 쓴다 (GNU 는 stdout).
gzip --version 2>&1 | head -1 || true

check_wasm "SQL" "src/lib/sql/wasm/sql_parser_core_bg.wasm" "$SQL_BUDGET_BYTES"
check_wasm "Mongo" "src/lib/mongo/wasm/mongosh_parser_core_bg.wasm" "$MONGO_BUDGET_BYTES"

if [ "$unmeasurable" -gt 0 ]; then
	echo "::error::WASM 산출물 $unmeasurable 개를 못 쟀다 (위 ERROR 줄). 검사 불성립은 통과가 아니다 — 먼저 pnpm run build:sql-wasm / build:mongosh-wasm 로 산출물을 만들어라." >&2
	exit 2
fi

if [ "$violations" -gt 0 ]; then
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 체크
	# 화면 맨 위 annotation 이 되고 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::parser WASM gzip 예산 초과 $violations 건 (위 FAIL 줄). 이 job 은 advisory 라 머지를 막지 않는다 — 크기를 줄이든지, scripts/check-wasm-size.sh 의 예산을 근거와 함께 올려라." >&2
	exit 1
fi

echo "ok: parser WASM 2 개 다 gzip 예산 안 (SQL <= $SQL_BUDGET_BYTES, Mongo <= $MONGO_BUDGET_BYTES bytes)"
