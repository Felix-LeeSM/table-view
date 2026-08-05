#!/usr/bin/env bash
# check-round-narrative.sh — 소스 주석의 리뷰 라운드 서사 표기 금지 (issue #2114).
#
# 리뷰 대응 이력의 SOT 는 PR 과 scorecard 다. 소스 주석에 "몇 라운드에 무엇을
# 고쳤나" 를 적으면 그 서사는 코드가 바뀌어도 안 따라가고, PR 을 안 연 사람에게는
# 아무것도 안 알려 준다. 룰의 SOT 는
# memory/engineering/conventions/refactoring/god-file/memory.md 「제거 — rot 빠른
# 메타」와 memory/workflow/review/memory.md 다 — 이 스크립트는 집행 장치일 뿐이다.
#
# ## 무엇을 세는가 — 이 규칙이 판정을 정의한다
#
#   위반 = 아래 명령이 내는 줄
#
#     git grep -nEi "round [0-9]|라운드 [0-9]" -- 'src/' 'src-tauri/' 'e2e/'
#
#   hit 0 이어야 통과한다. 이 명령이 이슈 #2114 오너 결정이 못박은 수용 기준
#   그대로이고, 여기 안 적힌 성질은 판정에 안 들어간다.
#
#   `-i` 와 한국어 대안이 판정에 들어 있는 이유: 오너 경계는 "라운드 번호 표기"
#   라는 개념이고 소문자 영문은 그 부분집합일 뿐이다. 처음 판정은 소문자 `round`
#   만 봤는데, 그때도 같은 세 경로에 대문자 표기와 한국어 표기가 살아 있었다 —
#   그 상태로 머지됐으면 게이트가 "0 줄" 이라고 거짓 green 을 인증한다. #2108 의
#   전수 명령이 클래스의 일부만 걸어 이 이슈가 생긴 것과 같은 형태다.
#
# 유지되는 것: PR 번호 · 이슈 번호. 회귀 앵커라 지우면 테스트의 출처가 0 이 된다
# (PR #2112 가 재작성한 테스트가 그랬다). 지우는 것은 라운드 번호 표기뿐이다.
#
# 예외 목록이 없는 이유: 세 경로가 곧 필터다. `review-gate` 의 스텝 이름
# `Stop at review round 3` 은 그 세 경로 밖에만 있어 자동으로 빠진다 — 범위를
# 넓히면 그 커플링 assertion 이 걸린다.
# 배치 적용 · 재시도 회차처럼 리뷰 라운드가 아닌 뜻으로 쓰던 자리는 예외로 빼지
# 않고 `pass N` 으로 개명해 어휘 충돌 자체를 없앴다.
#
# 사용:
#   bash scripts/check-round-narrative.sh          # 이 repo
#   bash scripts/check-round-narrative.sh <ROOT>   # 다른 트리 (테스트가 쓴다)
#
# exit: 0 통과 · 1 위반 있음 · 2 검사가 성립하지 않음

set -uo pipefail

PATTERN='round [0-9]|라운드 [0-9]'
SCOPE=('src/' 'src-tauri/' 'e2e/')

ROOT="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"

if [ ! -d "$ROOT" ]; then
	echo "ERROR: 검사할 디렉토리가 없다: $ROOT" >&2
	exit 2
fi

# `rg` 가 아니라 `git grep` 인 이유: 루트 `.ignore` 가 제외 목록을 걸어 두므로 기본
# `rg` 결과는 저장소 전수가 아니다 (docs/README.md). git 트리가 아니면 전수가
# 성립하지 않으니 통과시키지 않는다.
if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	echo "ERROR: git 작업 트리가 아니다: $ROOT — git grep 이 성립하지 않는다" >&2
	exit 2
fi

# 0 개를 "위반 0" 으로 통과시키면 트리가 옮겨지거나 경로 이름이 바뀐 날 게이트가
# 아무것도 안 훑으면서 green 이 된다. 검사 불성립은 통과가 아니다.
if ! tracked="$(git -C "$ROOT" ls-files -- "${SCOPE[@]}")"; then
	echo "ERROR: $ROOT 의 추적 파일 목록을 못 읽었다 — 검사 불성립" >&2
	exit 2
fi
tracked_n="$(printf '%s\n' "$tracked" | grep -c '.')"
if [ "$tracked_n" -eq 0 ]; then
	echo "ERROR: ${SCOPE[*]} 아래에 추적 파일이 0 개다 — 트리가 옮겨졌거나 경로가 틀렸다" >&2
	exit 2
fi

# `git grep` 은 0 건일 때 1, 오류일 때 2 이상으로 나간다. 그 둘을 여기서 갈라야
# 오류가 "위반 없음" 으로 강등되지 않는다.
hits="$(git -C "$ROOT" grep -nEi "$PATTERN" -- "${SCOPE[@]}")"
grep_rc=$?
if [ "$grep_rc" -gt 1 ]; then
	echo "ERROR: git grep 이 exit $grep_rc 로 죽었다 (위 stderr) — 검사 불성립" >&2
	exit 2
fi

if [ "$grep_rc" -eq 0 ]; then
	printf '%s\n' "$hits" >&2
	# `::error::` 는 GitHub Actions workflow command 다 — Actions 에서는 PR 체크
	# 화면 맨 위 annotation 이 되고, 로컬에서는 접두어가 그대로 찍히는 한 줄이다.
	echo "::error::리뷰 라운드 서사 주석 $(printf '%s\n' "$hits" | grep -c '.') 줄 (위 목록). 라운드 번호를 빼라 — PR·이슈 번호는 회귀 앵커라 그대로 두고, 리뷰 라운드가 아닌 회차는 \`pass N\` 처럼 다른 낱말로 쓴다 (issue #2114)." >&2
	exit 1
fi

echo "ok: ${SCOPE[*]} 추적 파일 $tracked_n 개에 리뷰 라운드 서사 0 줄"
