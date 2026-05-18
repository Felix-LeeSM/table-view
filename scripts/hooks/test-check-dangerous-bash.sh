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

# ─────────────────────────────────────────────────────────────────────────────
# Sprint 400 — git reset --hard case dispatch (G2)
# ─────────────────────────────────────────────────────────────────────────────
# 본 5 case 는 destructive vs recovery 의 4 분기 + 회귀 분기를 검증.
#   - case-400-1: origin/* ref           → destructive, 4-step recovery 안내
#   - case-400-2: HEAD~N relative ref    → destructive, soft 옵션 안내
#   - case-400-3: 40-hex SHA in reflog   → 복구 case 추정, 사용자 승인 안내
#   - case-400-4: 40-hex SHA not in reflog → 알 수 없는 SHA, destructive 안내
#   - case-400-5: branch name (기존 회귀) → destructive (회귀 유지)

# Reflog 안에 분명 존재하는 SHA: HEAD 자신 (test 가 worktree 안에서 실행됨).
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo 0000000000000000000000000000000000000000)"
# Reflog 에 절대 없는 SHA (deadbeef 40-hex). 본 SHA 가 우연히 reflog 에 있을
# 확률은 0 — git 의 SHA-1 충돌 가정.
ABSENT_SHA="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

# Case 400-1 — git reset --hard origin/main: destructive, 4-step recovery.
run_case \
  "case-400-1: git reset --hard origin/main → block + remote ref 경고" \
  1 \
  '{"tool_input":{"command":"git reset --hard origin/main"}}' \
  'MATCH:origin/|git ls-remote|git pull --rebase|memory/workflow/git-policy/memory.md'

# Case 400-2 — git reset --hard HEAD~1: destructive, soft option 안내.
run_case \
  "case-400-2: git reset --hard HEAD~1 → block + soft 옵션 안내" \
  1 \
  '{"tool_input":{"command":"git reset --hard HEAD~1"}}' \
  'MATCH:HEAD~|--soft|memory/workflow/git-policy/memory.md'

# Case 400-3 — git reset --hard <SHA-in-reflog>: 복구 case 추정 + 승인 안내.
run_case \
  "case-400-3: git reset --hard <SHA in reflog> → block + 복구 case 안내" \
  1 \
  "{\"tool_input\":{\"command\":\"git reset --hard $HEAD_SHA\"}}" \
  'MATCH:복구|사용자 명시 승인|reflog|memory/workflow/git-policy/memory.md'

# Case 400-4 — git reset --hard <SHA-not-in-reflog>: 알 수 없는 SHA.
run_case \
  "case-400-4: git reset --hard <SHA not in reflog> → block + 미지 SHA 안내" \
  1 \
  "{\"tool_input\":{\"command\":\"git reset --hard $ABSENT_SHA\"}}" \
  'MATCH:reflog|memory/workflow/git-policy/memory.md'

# Case 400-5 — git reset --hard <branch-name>: 회귀 가드 (기존 destructive).
run_case \
  "case-400-5: git reset --hard some-branch → block (회귀 유지)" \
  1 \
  '{"tool_input":{"command":"git reset --hard some-branch"}}' \
  'MATCH:BLOCKED|memory/workflow/git-policy/memory.md'

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
