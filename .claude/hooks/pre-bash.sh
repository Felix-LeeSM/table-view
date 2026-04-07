#!/bin/bash
# stdin에서 JSON 읽기
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# 위험 명령 패턴 차단
PATTERNS=(
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
  "dd if="
  "mkfs"
  "> /dev/sda"
)

for pattern in "${PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qi "$pattern"; then
    echo "BLOCKED: Dangerous command pattern detected: $pattern" >&2
    echo "If you really need this command, ask the user to approve it."
    exit 1
  fi
done

exit 0
