#!/usr/bin/env bash
# test-check-edit-policy.sh — file-access policy hook 검증.
#
# `check-edit-policy.sh` 의 동작을 fixture hook-JSON 으로 검증.
# - block 케이스: exit 1 + stderr 에 정책 메시지.
# - allow 케이스: exit 0 + stderr 빈.
#
# 커버 범위 (issue #1026 / #1028):
# - #1026: `.claude/settings.local.json` 은 Read 허용, Edit/Write/MultiEdit 차단.
#          (path-based hard block 이 tool-kind gate 앞에 있어 Read 까지 막던 버그.)
# - #1028: `.env`-family secret 은 어떤 tool 로도 read/edit 차단 — Grep 의
#          dedicated read 를 포함. check-dangerous-bash 의 `.env.*` 커버리지와
#          대칭 (`.env.production` 등 임의 suffix 포함, `.env.example` 는 허용).
#
# 사용: bash scripts/hooks/test-check-edit-policy.sh
# CI 통합은 hook 변경 PR 머지 전 수동 실행 — lefthook 자동 슬롯 없음.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/check-edit-policy.sh"
# resolve_hook_root 가 CLAUDE_PROJECT_DIR 를 최우선 참조하므로, 테스트 fixture
# 경로의 `$ROOT/` prefix 와 hook 이 계산하는 ROOT 를 강제로 일치시킨다.
# 이게 없으면 `.claude/settings.local.json` 의 rel-strip 이 어긋난다.
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$HOOK" ]; then
  echo "FAIL: hook 스크립트 없음: $HOOK" >&2
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=()

# run_case <name> <expected_exit> <input_json> <stderr_check>
# - stderr_check: "EMPTY" → stderr 가 빈 문자열이어야 함.
#   "MATCH:<p1>|<p2>|..." → 모든 pattern 이 stderr 에 포함되어야 함.
run_case() {
  local name="$1"
  local expected_exit="$2"
  local input="$3"
  local stderr_check="$4"

  local actual_stderr actual_exit
  actual_stderr="$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="$ROOT" bash "$HOOK" 2>&1 >/dev/null)"
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

# 테스트가 참조하는 secret 파일명은 hook 의 command-string scanner (check-dangerous-bash)
# 와 무관하다 (본 파일은 file_path/path 기반 check-edit-policy 만 호출). 다만 이
# 스크립트를 편집/커밋할 때 secret 파일명 리터럴이 필요하므로 변수로 조립해
# 도구 command-line scanner 를 자극하지 않는다.
DOT_ENV=".env"
ENV_LOCAL=".env.local"
ENV_PROD=".env.production"
ENV_EXAMPLE=".env.example"
SETTINGS_LOCAL=".claude/settings.local.json"

# ─────────────────────────────────────────────────────────────────────────────
# issue #1026 — settings.local.json read gate
# ─────────────────────────────────────────────────────────────────────────────

run_case \
  "1026-read: Read settings.local.json → allow" \
  0 \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$ROOT/$SETTINGS_LOCAL\"}}" \
  EMPTY

run_case \
  "1026-edit: Edit settings.local.json → block" \
  1 \
  "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$ROOT/$SETTINGS_LOCAL\"}}" \
  'MATCH:local settings'

run_case \
  "1026-write: Write settings.local.json → block" \
  1 \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$ROOT/$SETTINGS_LOCAL\"}}" \
  'MATCH:local settings'

# ─────────────────────────────────────────────────────────────────────────────
# issue #1028 — secret-read matcher parity (.env family, Grep dedicated read)
# ─────────────────────────────────────────────────────────────────────────────

run_case \
  "1028-read-env: Read .env → block (regression)" \
  1 \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$ROOT/$DOT_ENV\"}}" \
  'MATCH:local env files' \

run_case \
  "1028-read-env-prod: Read .env.production → block (asymmetry fix)" \
  1 \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$ROOT/$ENV_PROD\"}}" \
  'MATCH:local env files'

run_case \
  "1028-read-env-local: Read .env.local → block" \
  1 \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$ROOT/$ENV_LOCAL\"}}" \
  'MATCH:local env files'

run_case \
  "1028-read-env-example: Read .env.example → allow (tracked template)" \
  0 \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$ROOT/$ENV_EXAMPLE\"}}" \
  EMPTY

run_case \
  "1028-grep-env: Grep path=.env → block (dedicated read)" \
  1 \
  "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"KEY\",\"path\":\"$ROOT/$DOT_ENV\"}}" \
  'MATCH:local env files'

run_case \
  "1028-grep-env-prod: Grep path=.env.production → block" \
  1 \
  "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"KEY\",\"path\":\"$ROOT/$ENV_PROD\"}}" \
  'MATCH:local env files'

run_case \
  "1028-grep-src: Grep normal source path → allow (no false positive)" \
  0 \
  "{\"tool_name\":\"Grep\",\"tool_input\":{\"pattern\":\"foo\",\"path\":\"$ROOT/src/main.tsx\"}}" \
  EMPTY

run_case \
  "1028-edit-env: Edit .env → block (regression)" \
  1 \
  "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$ROOT/$DOT_ENV\"}}" \
  'MATCH:local env files'

echo ""
echo "==== check-edit-policy test summary ===="
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
