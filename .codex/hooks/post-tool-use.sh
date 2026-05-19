#!/usr/bin/env bash
# Codex PostToolUse policy wrapper. Mirrors Claude post-edit hooks for repo
# formatters and lightweight structural checks.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT="$(cat || true)"

json_field() {
  local expr="$1"
  if ! command -v jq >/dev/null 2>&1 || [ -z "$INPUT" ]; then
    return 0
  fi
  printf '%s' "$INPUT" | jq -r "$expr // empty" 2>/dev/null || true
}

command="$(json_field '.tool_input.command // .input.command // .command')"

paths_from_json() {
  if ! command -v jq >/dev/null 2>&1 || [ -z "$INPUT" ]; then
    return 0
  fi
  printf '%s' "$INPUT" | jq -r '
    [
      .tool_input.file_path?, .input.file_path?, .file_path?,
      .tool_input.path?, .input.path?, .path?,
      (.tool_input.files?[]? | .file_path? // .path?),
      (.input.files?[]? | .file_path? // .path?)
    ] | .[]? | select(type == "string" and length > 0)
  ' 2>/dev/null || true
}

paths_from_patch() {
  [ -n "$command" ] || return 0
  printf '%s\n' "$command" | sed -nE \
    -e 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p' \
    -e 's/^\*\*\* Move to: (.*)$/\1/p'
}

mapfile -t paths < <({ paths_from_json; paths_from_patch; } | sort -u)
[ "${#paths[@]}" -gt 0 ] || exit 0

has_rs=0
has_ts=0
has_memory=0
has_adr=0
has_code=0
has_wrapper=0

for raw in "${paths[@]}"; do
  rel="${raw#$ROOT/}"
  case "$rel" in
    *.rs) has_rs=1; has_code=1 ;;
    *.ts | *.tsx) has_ts=1; has_code=1 ;;
  esac
  case "$rel" in
    memory/*) has_memory=1 ;;
    memory/decisions/*) has_adr=1 ;;
    .claude/agents/*.md | .claude/rules/*.md | .claude/commands/*.md | .codex/agents/*.md)
      has_wrapper=1
      ;;
  esac
done

if [ "$has_rs" = "1" ]; then
  (cd "$ROOT/src-tauri" && cargo fmt 2>/dev/null) || true
fi

if [ "$has_ts" = "1" ]; then
  for raw in "${paths[@]}"; do
    rel="${raw#$ROOT/}"
    case "$rel" in
      *.ts | *.tsx)
        [ -f "$ROOT/$rel" ] && (cd "$ROOT" && npx prettier --write "$rel" 2>/dev/null) || true
        ;;
    esac
  done
fi

if [ "$has_memory" = "1" ]; then
  (cd "$ROOT" && bash scripts/check-memory-size.sh 2>&1 | head -10) || true
  (cd "$ROOT" && bash scripts/check-memory-structure.sh 2>&1 | head -10) || true
  (cd "$ROOT" && bash scripts/regenerate-indexes.sh 2>&1 | tail -5) || true
fi

if [ "$has_adr" = "1" ]; then
  (cd "$ROOT" && bash scripts/check-memory-adr.sh 2>&1 | head -30) || true
fi

if [ "$has_code" = "1" ]; then
  bash "$ROOT/scripts/check-god-file.sh" 2>&1 | head -10 || true
fi

if [ "$has_wrapper" = "1" ]; then
  (cd "$ROOT" && bash scripts/check-wrapper-cap.sh 2>&1 | head -10) || true
fi

exit 0
