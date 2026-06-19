#!/usr/bin/env bash
# post-tool-use.sh — platform-neutral post-edit formatter/check dispatcher.
#
# Runtime wrappers pass hook JSON on stdin. The script performs silent formatters
# and prints advisory check output only when there is something useful to show.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/root-resolve.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-json.sh"

ROOT="$(resolve_hook_root)"
INPUT="$(hook_read_input)"

command="$(hook_json_field '.tool_input.command // .input.command // .command')"
patch_payload="$(hook_json_field '.tool_input.input // .input.input // .tool_input.patch // .input.patch // .patch')"

paths_file="$(mktemp "${TMPDIR:-/tmp}/agent-hook-paths.XXXXXX")"
output_file="$(mktemp "${TMPDIR:-/tmp}/agent-hook-output.XXXXXX")"
context_file="$(mktemp "${TMPDIR:-/tmp}/agent-hook-context.XXXXXX")"
trap 'rm -f "$paths_file" "$output_file" "$context_file"' EXIT

{ hook_paths_from_json; hook_paths_from_patch; } | sort -u > "$paths_file"
[ -s "$paths_file" ] || exit 0

run_advisory() {
	local label="$1"
	shift
	{
		printf '## %s\n' "$label"
		"$@"
	} >> "$output_file" 2>&1 || true
}

has_rs=0
has_ts=0
has_memory=0
has_adr=0
has_code=0
has_wrapper=0
has_docs=0

while IFS= read -r raw; do
	[ -n "$raw" ] || continue
	rel="${raw#$ROOT/}"
	case "$rel" in
		*.rs) has_rs=1; has_code=1 ;;
		*.ts | *.tsx) has_ts=1; has_code=1 ;;
	esac
	case "$rel" in
		memory/*) has_memory=1 ;;
		docs/archives/decisions/*) has_adr=1 ;;
		docs/sprints/* | docs/archives/* | docs/table_plus/* | docs/explorations/*) ;;
		docs/*) has_docs=1 ;;
		.claude/agents/*.md | .claude/rules/*.md | .claude/commands/*.md | .codex/agents/*.md)
			has_wrapper=1
			;;
	esac
done < "$paths_file"

if [ "$has_rs" = "1" ]; then
	(cd "$ROOT/src-tauri" && cargo fmt >/dev/null 2>/dev/null) || true
fi

if [ "$has_ts" = "1" ]; then
	while IFS= read -r raw; do
		[ -n "$raw" ] || continue
		rel="${raw#$ROOT/}"
		case "$rel" in
			*.ts | *.tsx)
				[ -f "$ROOT/$rel" ] && (cd "$ROOT" && npx prettier --write "$rel" >/dev/null 2>/dev/null) || true
				;;
		esac
	done < "$paths_file"
fi

run_god_file_check() {
	while IFS= read -r raw; do
		[ -n "$raw" ] || continue
		rel="${raw#$ROOT/}"
		case "$rel" in
			*.ts | *.tsx | *.rs)
				[ -f "$ROOT/$rel" ] || continue
				jq -n --arg file "$ROOT/$rel" '{ tool_input: { file_path: $file } }' |
					CLAUDE_PROJECT_DIR="$ROOT" bash "$ROOT/scripts/hooks/check-god-file.sh"
				;;
		esac
	done < "$paths_file"
}

if [ "$has_memory" = "1" ]; then
	run_advisory "memory-size" bash -c "cd \"$ROOT\" && bash scripts/hooks/check-memory-size.sh 2>&1 | head -10"
	run_advisory "memory-structure" bash -c "cd \"$ROOT\" && bash scripts/hooks/check-memory-structure.sh 2>&1 | head -10"
	run_advisory "memory-index" bash -c "cd \"$ROOT\" && bash scripts/regenerate-indexes.sh 2>&1 | tail -5"
fi

if [ "$has_adr" = "1" ]; then
	run_advisory "memory-adr" bash -c "cd \"$ROOT\" && bash scripts/hooks/check-memory-adr.sh 2>&1 | head -30"
fi

if [ "$has_code" = "1" ]; then
	run_advisory "god-file" run_god_file_check
fi

if [ "$has_wrapper" = "1" ]; then
	run_advisory "wrapper-cap" bash -c "cd \"$ROOT\" && bash scripts/hooks/check-wrapper-cap.sh 2>&1 | head -10"
fi

if [ "$has_docs" = "1" ]; then
	run_advisory "doc-size" bash -c "cd \"$ROOT\" && bash scripts/hooks/check-doc-size.sh 2>&1 | head -10"
fi

if [ -s "$output_file" ]; then
	grep -vE '^(## [A-Za-z0-9_-]+)?$' "$output_file" > "$context_file" || true
fi

if [ -s "$context_file" ]; then
	cat "$context_file"
fi

exit 0
