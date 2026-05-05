#!/bin/bash

# stdin에서 JSON 읽기
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Each entry is a POSIX extended regex (ERE) consumed by `grep -qiE`. We
# anchor with token boundaries — `(^|[[:space:]])` and `([[:space:]]|$)` —
# so substrings inside unrelated tokens don't false-match. Example:
# the previous substring "DROP TABLE" matched a comment like `# how to
# DROP TABLE in postgres`; the regex form requires a word-edge.
# Hook-bypass patterns stay aggressive on purpose — git-policy.md
# forbids any escape route.
DANGEROUS_PATTERNS=(
  # Destructive rm against root/home/wildcard/cwd/critical dirs.
  # Matches `rm -rf /`, `rm -fr ~`, `rm -Rf src`, etc.
  '(^|[[:space:]])rm[[:space:]]+-[rRfF]*[rR][rRfF]*[[:space:]]+(/|~|\*|\.|src|node_modules|target)([[:space:]/]|$)'
  # SQL destructive DDL/DML.
  '(^|[[:space:]])DROP[[:space:]]+(DATABASE|TABLE)([[:space:]]|$)'
  '(^|[[:space:]])TRUNCATE([[:space:]]|$)'
  # Git destructive operations.
  '(^|[[:space:]])git[[:space:]]+push[[:space:]]+.*--force'
  '(^|[[:space:]])git[[:space:]]+reset[[:space:]]+--hard'
  # Hook-bypass flags / env (git-policy.md). The form
  # `--no-verify-<x>` is a different flag, so we require a real token
  # edge after the flag name.
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
  echo "If you really need this command, ask the user to approve it."
  exit 1
}

check_dangerous_patterns() {
  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if echo "$COMMAND" | grep -qiE -e "$pattern"; then
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
