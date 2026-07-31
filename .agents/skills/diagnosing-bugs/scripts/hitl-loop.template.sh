#!/usr/bin/env bash
# Human-in-the-loop 재현 루프.
# 이 파일을 복사하고 아래 단계를 고쳐서 돌린다.
# agent 가 스크립트를 돌리고, 사용자는 터미널에서 프롬프트를 따라간다.
#
# 사용법:
#   bash hitl-loop.template.sh
#
# 헬퍼 둘:
#   step "<지시>"            → 지시를 보여주고 Enter 를 기다린다
#   capture VAR "<질문>"     → 질문을 보여주고 응답을 VAR 로 읽는다
#
# 끝에 캡처된 값이 KEY=VALUE 로 출력된다 — agent 가 그걸 파싱한다.
#
# 이건 Phase 1 의 **최후 수단**이다. 사람이 클릭해야만 재현되는 경우에만 쓴다.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [끝나면 Enter] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- 아래를 고친다 -------------------------------------------------------

step "pnpm fixtures:start 로 DB 를 올리고 pnpm tauri dev 로 앱을 띄운다."

step "PostgreSQL 연결을 하나 열고 아무 테이블이나 연다."

capture REPRODUCED "그 테이블에서 행을 편집하고 저장했을 때 증상이 났나? (y/n)"

capture SYMPTOM "화면에 나온 것을 그대로 붙여넣어라 (없으면 'none'):"

# --- 위를 고친다 ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'REPRODUCED=%s\n' "$REPRODUCED"
printf 'SYMPTOM=%s\n' "$SYMPTOM"
