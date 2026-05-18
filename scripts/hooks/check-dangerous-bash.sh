#!/usr/bin/env bash
# check-dangerous-bash.sh — platform-neutral PreToolUse Bash hook
#
# 입력 (어떤 brain 든):
#   - env var `$COMMAND` (lefthook / CI 호환)
#   - argv `$1` (직접 호출)
#   - stdin JSON `.tool_input.command` (Claude Code 기본)
#
# 첫 번째 비어있지 않은 입력을 사용. jq 없으면 stdin JSON 입력은 무시.
#
# 동작:
#   - dangerous pattern 감지 시 exit 1 + stderr 메시지
#   - git commit / git push 시 lefthook 설치 + hook 파일 존재 확인
#   - 통과 시 exit 0
#
# 룰 source: `.claude/rules/git-policy.md` + `memory/workflow/delivery/memory.md`

set -euo pipefail

resolve_command() {
  if [ -n "${COMMAND:-}" ]; then
    echo "$COMMAND"
    return
  fi
  if [ -n "${1:-}" ]; then
    echo "$1"
    return
  fi
  if [ -t 0 ]; then
    echo ""
    return
  fi
  local stdin_buf
  stdin_buf="$(cat)"
  if [ -z "$stdin_buf" ]; then
    echo ""
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    echo "$stdin_buf" | jq -r '.tool_input.command // .command // empty' 2>/dev/null || echo ""
  else
    # jq 없으면 raw stdin 을 그대로 (lefthook 같이 raw 명령 전달하는 caller 호환)
    echo "$stdin_buf"
  fi
}

CMD="$(resolve_command "$@")"

if [ -z "$CMD" ]; then
  exit 0
fi

# ERE 패턴. 토큰 경계 — substring inside unrelated tokens 차단.
DANGEROUS_PATTERNS=(
  # Destructive rm against root/home/wildcard/cwd/critical dirs.
  '(^|[[:space:]])rm[[:space:]]+-[rRfF]*[rR][rRfF]*[[:space:]]+(/|~|\*|\.|src|node_modules|target)([[:space:]/]|$)'
  # SQL destructive DDL/DML.
  '(^|[[:space:]])DROP[[:space:]]+(DATABASE|TABLE)([[:space:]]|$)'
  '(^|[[:space:]])TRUNCATE([[:space:]]|$)'
  # Git destructive ops.
  '(^|[[:space:]])git[[:space:]]+push[[:space:]]+.*--force'
  '(^|[[:space:]])git[[:space:]]+reset[[:space:]]+--hard'
  # Hook-bypass flags / env (git-policy.md).
  '--no-verify([[:space:]=]|$)'
  '(^|[[:space:]])LEFTHOOK=0([[:space:]]|$)'
  '(^|[[:space:]])LEFTHOOK_SKIP='
  '(^|[[:space:]])HUSKY=0([[:space:]]|$)'
  # Disk wipe / raw device write.
  '(^|[[:space:]])dd[[:space:]]+if='
  '(^|[[:space:]])mkfs(\.|[[:space:]])'
  '>[[:space:]]*/dev/(sd[a-z]|nvme[0-9]|disk[0-9])'
)

block() {
  echo "BLOCKED: $1" >&2
  echo "If you really need this command, ask the user to approve it." >&2
  exit 1
}

check_dangerous_patterns() {
  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if echo "$CMD" | grep -qiE -e "$pattern"; then
      block "Dangerous command pattern detected: $pattern"
    fi
  done
}

check_lefthook_binary() {
  if ! command -v lefthook >/dev/null 2>&1; then
    block "lefthook is not installed. Run 'pnpm install' first."
  fi
}

check_git_hooks() {
  local hooks_dir
  hooks_dir="$(git rev-parse --git-dir 2>/dev/null)/hooks"

  if echo "$CMD" | grep -qi -e "git commit"; then
    check_lefthook_binary
    for hook in pre-commit commit-msg; do
      if [ ! -f "$hooks_dir/$hook" ]; then
        block "git hook '$hook' is not installed. Run 'lefthook install' first."
      fi
    done
  elif echo "$CMD" | grep -qi -e "git push"; then
    check_lefthook_binary
    if [ ! -f "$hooks_dir/pre-push" ]; then
      block "git hook 'pre-push' is not installed. Run 'lefthook install' first."
    fi
  fi
}

check_dangerous_patterns
check_git_hooks

exit 0
