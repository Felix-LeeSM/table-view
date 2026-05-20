#!/usr/bin/env bash
# Codex PostToolUse policy wrapper. Delegates repo checks to scripts/hooks.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
context_file="$(mktemp "${TMPDIR:-/tmp}/codex-hook-context.XXXXXX")"
trap 'rm -f "$context_file"' EXIT

INPUT="$(cat || true)"
printf '%s' "$INPUT" | bash "$ROOT/scripts/hooks/post-tool-use.sh" > "$context_file" 2>&1 || true

if [ -s "$context_file" ]; then
  jq -n --rawfile context "$context_file" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("Codex post-edit policy output:\n" + $context)
    }
  }'
fi

exit 0
