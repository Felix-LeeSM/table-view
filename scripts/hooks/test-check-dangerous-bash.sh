#!/usr/bin/env bash
# test-check-dangerous-bash.sh — sprint-389 smoke test
#
# `check-dangerous-bash.sh` 의 동작을 fixture 명령으로 검증.
# - block 케이스: exit 1 + stderr 에 회복 instruction.
# - warn 케이스: exit 0 + stderr 에 WARNING.
# - allow 케이스: exit 0 + stderr 빈.
# - 회귀 가드: 기존 dangerous pattern (rm -rf, --no-verify) 차단 유지.
#
# 사용: bash scripts/hooks/test-check-dangerous-bash.sh
# CI 통합은 hook 변경 PR 머지 전 수동 실행 — lefthook 의 자동 슬롯 없음
# (별 sprint 에서 통합 시 본 파일을 entry-point 로 wiring).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/check-dangerous-bash.sh"

if [ ! -x "$HOOK" ]; then
  echo "FAIL: hook 스크립트가 executable 아님: $HOOK" >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=()

# run_case <name> <expected_exit> <input_cmd_json> <stderr_must_contain_or_empty>
# - stderr_must_contain_or_empty: "EMPTY" 면 stderr 가 빈 문자열이어야 함.
#   "MATCH:<pattern1>|<pattern2>|..." 면 모든 pattern 이 stderr 에 포함되어야 함.
run_case() {
  local name="$1"
  local expected_exit="$2"
  local input="$3"
  local stderr_check="$4"

  local actual_stderr actual_exit
  actual_stderr="$(echo "$input" | "$HOOK" 2>&1 >/dev/null)"
  actual_exit=$?

  local ok=1
  if [ "$actual_exit" != "$expected_exit" ]; then
    ok=0
    FAIL_DETAILS+=("[$name] exit expected=$expected_exit got=$actual_exit")
  fi

  case "$stderr_check" in
    EMPTY)
      if [ -n "$actual_stderr" ]; then
        ok=0
        FAIL_DETAILS+=("[$name] stderr expected empty, got: $actual_stderr")
      fi
      ;;
    MATCH:*)
      local patterns="${stderr_check#MATCH:}"
      local IFS='|'
      # shellcheck disable=SC2206
      local arr=($patterns)
      for p in "${arr[@]}"; do
        if ! echo "$actual_stderr" | grep -qF -- "$p"; then
          ok=0
          FAIL_DETAILS+=("[$name] stderr missing pattern: $p")
          FAIL_DETAILS+=("    got: $actual_stderr")
        fi
      done
      ;;
    *)
      echo "FAIL: 알 수 없는 stderr_check 형식: $stderr_check" >&2
      exit 1
      ;;
  esac

  if [ "$ok" = "1" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "PASS  $name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "FAIL  $name"
  fi
}

# Case 1 — git reset --hard: block + 4-step recovery + memory pointer.
run_case \
  "case1: git reset --hard FETCH_HEAD → block + recovery" \
  1 \
  '{"tool_input":{"command":"git reset --hard FETCH_HEAD"}}' \
  'MATCH:git ls-remote|gh api -X DELETE|git pull --rebase|memory/workflow/git-policy/memory.md'

# Case 2 — gh pr close without --delete-branch: warn only.
run_case \
  "case2: gh pr close 123 → warn (exit 0)" \
  0 \
  '{"tool_input":{"command":"gh pr close 123"}}' \
  'MATCH:WARNING|--delete-branch|memory/workflow/git-policy/memory.md'

# Case 3 — gh pr close with --delete-branch: silent allow.
run_case \
  "case3: gh pr close 123 --delete-branch → allow, no warning" \
  0 \
  '{"tool_input":{"command":"gh pr close 123 --delete-branch --comment \"done\""}}' \
  EMPTY

# Case 4 — safe command: silent allow.
run_case \
  "case4: git log --oneline → allow, no stderr" \
  0 \
  '{"tool_input":{"command":"git log --oneline"}}' \
  EMPTY

# 회귀 가드 1 — --no-verify 차단 + memory pointer.
run_case \
  "regression: git commit --no-verify → block + memory pointer" \
  1 \
  '{"tool_input":{"command":"git commit --no-verify -m foo"}}' \
  'MATCH:memory/workflow/git-policy/memory.md'

# 회귀 가드 2 — rm -rf 위험 경로 차단 (기존 패턴 유지 확인).
# 패턴은 / ~ * . src node_modules target 만 매칭 (sprint-387 의 보수적 규칙).
run_case \
  "regression: rm -rf / → block" \
  1 \
  '{"tool_input":{"command":"rm -rf /"}}' \
  'MATCH:BLOCKED'

# 회귀 가드 3 — LEFTHOOK=0 hook bypass 차단 + memory pointer.
run_case \
  "regression: LEFTHOOK=0 git push → block + memory pointer" \
  1 \
  '{"tool_input":{"command":"LEFTHOOK=0 git push"}}' \
  'MATCH:memory/workflow/git-policy/memory.md'

echo ""
echo "==== smoke test summary ===="
echo "PASS: $PASS_COUNT"
echo "FAIL: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo "Failures:"
  for d in "${FAIL_DETAILS[@]}"; do
    echo "  $d"
  done
  exit 1
fi

exit 0
