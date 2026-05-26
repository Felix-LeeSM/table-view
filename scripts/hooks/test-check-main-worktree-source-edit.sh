#!/usr/bin/env bash
# Smoke tests for primary-worktree source/app edit enforcement.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/check-main-worktree-source-edit.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEX_HOOK="$REPO_ROOT/.codex/hooks/pre-tool-use.sh"
CLAUDE_SETTINGS="$REPO_ROOT/.claude/settings.json"

PASS_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=()

TMP_ROOT=""
MAIN_ROOT=""
LINKED_ROOT=""
cleanup() {
	if [ -n "$TMP_ROOT" ] && [ -d "$TMP_ROOT" ]; then
		rm -rf "$TMP_ROOT"
	fi
}
trap cleanup EXIT

must() {
	"$@" || {
		echo "FAIL: command failed: $*" >&2
		exit 1
	}
}

setup_git_fixture() {
	TMP_ROOT="$(mktemp -d)"
	MAIN_ROOT="$TMP_ROOT/main"
	LINKED_ROOT="$MAIN_ROOT/worktrees/linked-fixture"

	must git init -q "$MAIN_ROOT"
	must git -C "$MAIN_ROOT" config user.email "hook-test@example.invalid"
	must git -C "$MAIN_ROOT" config user.name "Hook Test"
	must git -C "$MAIN_ROOT" config commit.gpgsign false
	printf '%s\n' "fixture" > "$MAIN_ROOT/README.md"
	must git -C "$MAIN_ROOT" add README.md
	must git -C "$MAIN_ROOT" commit -q -m "fixture"
	must mkdir -p "$MAIN_ROOT/worktrees"
	must git -C "$MAIN_ROOT" worktree add -q -b linked-fixture "$LINKED_ROOT"
}

record_pass() {
	PASS_COUNT=$((PASS_COUNT + 1))
	echo "PASS  $1"
}

record_fail() {
	FAIL_COUNT=$((FAIL_COUNT + 1))
	FAIL_DETAILS+=("$1")
	echo "FAIL  $1"
}

run_case() {
	local name="$1"
	local expected_exit="$2"
	local mode="$3"
	shift 3

	local actual_stderr actual_exit
	case "$mode" in
		main-path)
			actual_stderr="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$MAIN_ROOT" bash "$HOOK" "$@" 2>&1 >/dev/null)"
			actual_exit=$?
			;;
		main-command)
			actual_stderr="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$MAIN_ROOT" bash "$HOOK" --command "$1" 2>&1 >/dev/null)"
			actual_exit=$?
			;;
		linked-path)
			actual_stderr="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$LINKED_ROOT" bash "$HOOK" "$@" 2>&1 >/dev/null)"
			actual_exit=$?
			;;
		*)
			echo "FAIL: unknown mode: $mode" >&2
			exit 1
			;;
	esac

	if [ "$actual_exit" = "$expected_exit" ]; then
		record_pass "$name"
	else
		record_fail "$name expected exit $expected_exit, got $actual_exit; stderr=$actual_stderr"
	fi
}

run_codex_hook_case() {
	local name="$1"
	local tool_name="$2"
	local payload="$3"
	local expected_decision="$4"

	local output actual_decision
	output="$(printf '%s' "$payload" | bash "$CODEX_HOOK" 2>&1)"

	if printf '%s' "$output" | grep -q '"permissionDecision": "deny"'; then
		actual_decision="deny"
	else
		actual_decision="allow"
	fi

	if [ "$actual_decision" = "$expected_decision" ]; then
		record_pass "$name"
	else
		record_fail "$name expected $expected_decision for $tool_name, got $actual_decision; output=$output"
	fi
}

run_jq_case() {
	local name="$1"
	local query="$2"

	if jq -e "$query" "$CLAUDE_SETTINGS" >/dev/null; then
		record_pass "$name"
	else
		record_fail "$name"
	fi
}

if [ ! -f "$HOOK" ]; then
	echo "FAIL: missing hook script: $HOOK" >&2
	exit 1
fi

setup_git_fixture

run_case "linked worktree: src path allowed" 0 linked-path "src/App.tsx"

run_case "main: src path blocked" 1 main-path "src/App.tsx"
run_case "main: src directory blocked" 1 main-path "src"
run_case "main: docs traversal to src blocked" 1 main-path "docs/../src/App.tsx"
run_case "main: worktrees traversal to src blocked" 1 main-path "worktrees/../src/App.tsx"
run_case "main: absolute docs traversal to src blocked" 1 main-path "$MAIN_ROOT/docs/../src/App.tsx"
run_case "main: parent traversal back to src blocked" 1 main-path "../${MAIN_ROOT##*/}/src/App.tsx"
run_case "main: absolute linked worktree source path allowed" 0 main-path "$LINKED_ROOT/src/App.tsx"
run_case "main: relative linked worktree source path allowed" 0 main-path "worktrees/linked-fixture/src/App.tsx"
run_case "main: relative linked worktree normalized source path allowed" 0 main-path "worktrees/linked-fixture/./src/../src/App.tsx"
run_case "main: package manifest blocked" 1 main-path "package.json"
run_case "main: components manifest blocked" 1 main-path "components.json"
run_case "main: tsconfig blocked" 1 main-path "tsconfig.node.json"
run_case "main: vite config blocked" 1 main-path "vite.config.ts"
run_case "main: vitest config blocked" 1 main-path "vitest.config.ts"
run_case "main: eslint config blocked" 1 main-path "eslint.config.js"
run_case "main: Cargo manifest blocked" 1 main-path "src-tauri/Cargo.toml"
run_case "main: Tauri config blocked" 1 main-path "src-tauri/tauri.conf.json"
run_case "main: Tauri env config blocked" 1 main-path "src-tauri/tauri.dev.conf.json"
run_case "main: Tauri deny config blocked" 1 main-path "src-tauri/deny.toml"
run_case "main: Tauri capability blocked" 1 main-path "src-tauri/capabilities/default.json"
run_case "main: Tauri permission blocked" 1 main-path "src-tauri/permissions/fs.json"

run_case "main: scripts orchestration allowed" 0 main-path "scripts/hooks/example.sh"
run_case "main: memory orchestration allowed" 0 main-path "memory/runbook/worktree/memory.md"
run_case "main: docs orchestration allowed" 0 main-path "docs/PLAN.md"
run_case "main: Claude settings allowed" 0 main-path ".claude/settings.json"
run_case "main: AGENTS allowed" 0 main-path "AGENTS.md"
run_case "main: markdown allowed" 0 main-path "notes/review.md"
run_case "main: agent skills source allowed" 0 main-path ".agents/skills/tdd/SKILL.md"
run_case "main: Codex agent orchestration allowed" 0 main-path ".codex/agents/tdd-generator.md"
run_case "main: non-source Tauri asset allowed" 0 main-path "src-tauri/icons/icon.png"

run_case "main command: redirection to src blocked" 1 main-command "cat > src/App.tsx <<'EOF'"
run_case "main command: redirection traversal to src blocked" 1 main-command "cat > docs/../src/App.tsx <<'EOF'"
run_case "main command: tee to source blocked" 1 main-command "printf hi | tee src/App.tsx"
run_case "main command: tee traversal to source blocked" 1 main-command "printf hi | tee worktrees/../src/App.tsx"
run_case "main command: cp to manifest blocked" 1 main-command "cp /tmp/package.json package.json"
run_case "main command: mv source file out of main blocked" 1 main-command "mv src/App.tsx /tmp/App.tsx"
run_case "main command: mv to source directory blocked" 1 main-command "mv /tmp/App.tsx src"
run_case "main command: sed -i source blocked" 1 main-command "sed -i '' 's/a/b/' src/App.tsx"
run_case "main command: perl -pi source blocked" 1 main-command "perl -pi -e 's/a/b/' src/App.tsx"
run_case "main command: dd of source blocked" 1 main-command "dd if=/tmp/a of=src/App.tsx"
run_case "main command: read-only source mention allowed" 0 main-command "rg App src/App.tsx"
run_case "main command: external temp source-like path allowed" 0 main-command "printf hi > /tmp/App.tsx"

run_codex_hook_case \
	"Codex hook: Edit src denied" \
	"Edit" \
	'{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/App.tsx"}}' \
	deny
run_codex_hook_case \
	"Codex hook: Read src allowed" \
	"Read" \
	'{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"src/App.tsx"}}' \
	allow
run_codex_hook_case \
	"Codex hook: .codex agent wrapper allowed" \
	"Edit" \
	'{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":".codex/agents/tdd-generator.md"}}' \
	allow
run_codex_hook_case \
	"Codex hook: .agents skills source allowed" \
	"Edit" \
	'{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":".agents/skills/tdd/SKILL.md"}}' \
	allow
run_codex_hook_case \
	"Codex hook: Bash source write denied" \
	"Bash" \
	'{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"printf hi > src/App.tsx"}}' \
	deny

run_jq_case "Claude settings: edit policy also runs for Bash" '
  .hooks.PreToolUse[]
  | select(any(.hooks[]?; (.command // "") | contains("check-edit-policy.sh")))
  | .matcher
  | split("|")
  | (index("Read") and index("Edit") and index("Write") and index("MultiEdit") and index("Bash"))
'

echo ""
echo "==== main-worktree source edit hook summary ===="
echo "PASS: $PASS_COUNT"
echo "FAIL: $FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
	echo ""
	echo "Failures:"
	for detail in "${FAIL_DETAILS[@]}"; do
		echo "  $detail"
	done
	exit 1
fi

exit 0
