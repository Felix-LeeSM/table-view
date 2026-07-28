#!/usr/bin/env bash
# PostToolUse routing (Claude Code + codex 공유). 방금 건드린 파일의 surface 에
# 걸린 active rule 을 additionalContext 로 주입한다. block 하지 않는다.
#
# 왜 훅인가 — 이 프로젝트 트랜스크립트 실측:
#   - `nested_memory` (편집 대상 옆 CLAUDE.md 자동 로드) subagent 도달 0/512
#   - hook 도달 557
#   - `AGENTS.md` / `memory/index/by-surface.md` 는 "찾아보기로 결정한 agent" 만
#     닿는다. top-level orchestrator 는 찾지만 spawn 된 subagent 는 안 찾는다.
# 즉 룰을 인덱스에 두는 것만으로는 라우팅이 아니다. 훅은 양쪽 모두에 닿는다.
#
# 왜 PostToolUse 인가 — additionalContext 도달을 실측한 이벤트가 PostToolUse
# 뿐이다 (19/19). PreToolUse 로 내면 편집 *전에* 닿아 타이밍이 낫지만, 그 채널이
# 실제로 전달되는지 확인할 방법이 이 레포에 없었다. 검증 못 한 채널을 주 경로로
# 쓰지 않는다. 첫 편집 직후 도달하므로 이어지는 작업에는 그대로 유효하다.
#
# 호출: `.claude/settings.json` + `.codex/hooks.json` PostToolUse.

set -euo pipefail

INPUT="$(cat || true)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/root-resolve.sh"
source "$SCRIPT_DIR/../lib/hook-json.sh"
source "$SCRIPT_DIR/../analyze/surface-rules.sh"
source "$SCRIPT_DIR/../analyze/recent-writes.sh"

command -v jq >/dev/null 2>&1 || exit 0

ROOT="$(resolve_hook_root)"
INDEX="$ROOT/memory/index/by-surface.md"
[ -f "$INDEX" ] || exit 0

command="$(hook_json_field '.tool_input.command // .input.command // .command')"
patch_payload="$(hook_json_field '.tool_input.input // .input.input // .tool_input.patch // .input.patch // .patch')"

rules_file="$(mktemp "${TMPDIR:-/tmp}/hook-routing.XXXXXX")"
trap 'rm -f "$rules_file"' EXIT

paths_file="$(mktemp "${TMPDIR:-/tmp}/hook-routing-paths.XXXXXX")"
trap 'rm -f "$rules_file" "$paths_file"' EXIT

{ hook_paths_from_json; hook_paths_from_patch; } | sort -u > "$paths_file"
# Bash payload: no file_path, so ask git what the command actually wrote.
if [ ! -s "$paths_file" ] && [ -n "$command" ]; then
	recent_writes "$ROOT" | sort -u > "$paths_file"
fi

while IFS= read -r raw; do
	[ -n "$raw" ] || continue
	rel="${raw#"$ROOT/"}"
	rel="${rel#./}"
	surface_rules_for_path "$rel" "$INDEX" >> "$rules_file"
done < "$paths_file"

[ -s "$rules_file" ] || exit 0

body="$(sort -u "$rules_file" | awk -F'\t' '{ printf "- %s — `%s`\n", $1, $2 }')"

# Whether a routed rule is ever acted on is the open question this whole line of
# work exists to answer, and it cannot be read off the transcript after the
# fact. Count the delivery here; the read that should follow shows up in Claude
# Code's own `claude_code.tool_decision` for Read. Off unless a local collector
# endpoint is configured.
source "$SCRIPT_DIR/otel-emit.sh"
otel_count "routing.rule.delivered" "$(printf '%s\n' "$body" | grep -c '^- ')" \
	"first_path=$(head -1 "$paths_file" | sed "s|^$ROOT/||")" || :

jq -n --arg body "$body" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("방금 편집한 surface 의 active rule (memory/index/by-surface.md 기준). 아직 안 읽었다면 지금 읽어라 — 이 파일 계열을 계속 수정할 거라면 적용 대상이다.\n" + $body)
  }
}'
