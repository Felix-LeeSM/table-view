#!/bin/bash

# stdin에서 JSON 읽기
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

DANGEROUS_PATTERNS=(
  "rm -rf /"
  "rm -rf ~"
  "rm -rf *"
  "rm -rf ."
  "rm -rf src"
  "rm -rf node_modules"
  "rm -rf target"
  "DROP DATABASE"
  "DROP TABLE"
  "TRUNCATE"
  "git push --force"
  "git reset --hard"
  "--no-verify"
  "LEFTHOOK=0"
  "dd if="
  "mkfs"
  "> /dev/sda"
)

block() {
  echo "BLOCKED: $1" >&2
  echo "If you really need this command, ask the user to approve it."
  exit 1
}

check_dangerous_patterns() {
  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if echo "$COMMAND" | grep -qi -e "$pattern"; then
      block "Dangerous command pattern detected: $pattern"
    fi
  done
}

check_lefthook_binary() {
  if ! command -v lefthook &>/dev/null; then
    block "lefthook is not installed. Run 'pnpm install' first."
  fi
}

check_git_hooks() {
  local hooks_dir
  hooks_dir="$(git rev-parse --git-dir 2>/dev/null)/hooks"

  if echo "$COMMAND" | grep -qi -e "git commit"; then
    check_lefthook_binary
    for hook in pre-commit commit-msg; do
      if [ ! -f "$hooks_dir/$hook" ]; then
        block "git hook '$hook' is not installed. Run 'lefthook install' first."
      fi
    done
  elif echo "$COMMAND" | grep -qi -e "git push"; then
    check_lefthook_binary
    if [ ! -f "$hooks_dir/pre-push" ]; then
      block "git hook 'pre-push' is not installed. Run 'lefthook install' first."
    fi
  fi
}

check_dangerous_patterns
check_git_hooks

exit 0
