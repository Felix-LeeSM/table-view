#!/usr/bin/env bash
# Smoke tests for primary-worktree source/app edit enforcement.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/check-main-worktree-source-edit.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEX_HOOK="$REPO_ROOT/scripts/hooks/pre-tool-use.sh"  # neutral wrapper (Claude/codex 공유)
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

run_case_stderr_contains() {
	local name="$1"
	local expected_exit="$2"
	local expected_stderr="$3"
	local mode="$4"
	shift 4

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

	if [ "$actual_exit" != "$expected_exit" ]; then
		record_fail "$name expected exit $expected_exit, got $actual_exit; stderr=$actual_stderr"
	elif ! grep -Fq "$expected_stderr" <<<"$actual_stderr"; then
		record_fail "$name expected stderr to contain '$expected_stderr'; stderr=$actual_stderr"
	else
		record_pass "$name"
	fi
}

run_codex_hook_case() {
	local name="$1"
	local tool_name="$2"
	local payload="$3"
	local expected_decision="$4"

	local output actual_decision
	output="$(printf '%s' "$payload" | CLAUDE_PROJECT_DIR="$MAIN_ROOT" bash "$CODEX_HOOK" 2>&1)"

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
run_case "main: .claude/worktrees source path allowed" 0 main-path ".claude/worktrees/hook-parity/src/foo.rs"
run_case "main: .claude/worktrees traversal to src blocked" 1 main-path ".claude/worktrees/../src/App.tsx"
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

run_case "main: scripts edit blocked" 1 main-path "scripts/hooks/example.sh"
run_case "main: memory orchestration allowed" 0 main-path "memory/runbook/worktree/memory.md"
run_case "main: docs edit blocked" 1 main-path "docs/PLAN.md"
run_case "main: Codex config blocked" 1 main-path ".codex/config.toml"
run_case "main: Claude settings blocked" 1 main-path ".claude/settings.json"
run_case "main: AGENTS allowed" 0 main-path "AGENTS.md"
run_case "main: markdown note blocked" 1 main-path "notes/review.md"
run_case "main: agent skills blocked" 1 main-path ".agents/skills/tdd/SKILL.md"
run_case "main: Tauri asset blocked" 1 main-path "src-tauri/icons/icon.png"

run_case_stderr_contains "main: docs edit reports docs class" 1 "class: docs" main-path "docs/PLAN.md"
run_case_stderr_contains "main: fixture tooling reports fixture class" 1 "class: fixture" main-path "scripts/fixtures/dbms-seeds.test.ts"
run_case_stderr_contains "main: agent skill reports agent class" 1 "class: agent" main-path ".agents/skills/tdd/SKILL.md"
run_case_stderr_contains "main: GitHub policy reports workflow class" 1 "class: workflow" main-path ".github/dependabot.yml"
run_case_stderr_contains "main: committed generated WASM reports generated class" 1 "class: committed-generated-input" main-path "src/lib/sql/wasm/sql_parser_core_bg.wasm"

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
run_case "main command: stdout-to-stderr fd dup allowed" 0 main-command "ls src 2>&1"
run_case "main command: redirect stdout onto stderr fd allowed" 0 main-command "echo x >&2"
run_case "main command: fd dup piped allowed" 0 main-command "cat src/App.tsx 2>&1 | head"
run_case "main command: genuine file write still blocked" 1 main-command "cat src/App.tsx > realfile.txt"
run_case "main command: >&<digit>file genuine write blocked" 1 main-command "echo x >&2foo"
run_case "main command: >&<digit>file to source blocked" 1 main-command "cat src/App.tsx >&1x.sh"
run_case "main command: bare >& next-token source write blocked" 1 main-command "echo x >& src/App.tsx"
run_case "main command: fd close allowed" 0 main-command "exec 2>&-"

# Glued multi-redirect: a leading `>PATH` truncates/creates the file before the
# trailing FD dup/close, so the write must still be blocked (regression #1150).
run_case "main command: glued redirect leading write to src blocked" 1 main-command "printf x >src/App.tsx>&1"
run_case "main command: glued redirect fd-prefixed leading write blocked" 1 main-command "printf x 1>src/App.tsx>&2"
run_case "main command: glued redirect fd-close leading write blocked" 1 main-command "printf x 2>src/App.tsx>&-"
run_case "main command: glued redirect multi-digit fd leading write blocked" 1 main-command "printf x >src/App.tsx>&10"
run_case "main command: glued append redirect leading write blocked" 1 main-command "printf x >>src/App.tsx>&1"
# Lateral regression (#1164 re-review): only the LEADING glued target was
# checked, so a glued redirect whose leading target is allowed (memory/*) but
# whose trailing/middle target is source slipped past. Every write target must
# be checked, while FD dup/close segments stay skipped.
run_case "main command: glued redirect allowed-leading source-trailing blocked" 1 main-command "printf x >memory/x.md>src/App.tsx"
run_case "main command: glued redirect three targets trailing source blocked" 1 main-command "printf x >memory/a.md>memory/b.md>src/App.tsx"
run_case "main command: glued redirect middle source blocked" 1 main-command "printf x >memory/a.md>src/App.tsx>memory/b.md"
run_case "main command: glued redirect allowed-only targets allowed" 0 main-command "printf x >memory/a.md>memory/b.md"
# 3rd re-review (#1164): the glued split's index-0 segment is the text BEFORE the
# first `>` (an fd number like `1`/`2`, never a write target). Emitting it as a
# path resolved to `<root>/1` and over-blocked an allowed-only fd-prefixed
# redirect. Index-0 is skipped so this stays allowed, while a trailing source
# target (below) is still denied.
run_case "main command: glued redirect fd-prefixed allowed-only allowed" 0 main-command "printf x 1>memory/a.md>&2"
run_case "main command: glued redirect allowed-leading external-temp source-trailing blocked" 1 main-command "printf x >/tmp/ok>src/App.tsx"

# issue #1156: quoting / placeholder / separator false positives.
# These benign commands must NOT be blocked while real writes below still are.
run_case "main command: fd-dup 2>&1 pipeline with ; chain allowed" 0 main-command 'gh api /repos/o/r 2>&1 | head -30; echo ---; gh label list foo'
run_case "main command: commit trailer <email> then push allowed" 0 main-command 'git commit -m "msg Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push'
run_case "main command: commit trailer <email> then pipe allowed" 0 main-command 'git commit -m "msg <noreply@anthropic.com>" | tail -3'
run_case "main command: arrow in single quotes allowed" 0 main-command "printf '%s -> %s' old new"
run_case "main command: arrow and <placeholder> in commit message allowed" 0 main-command 'git commit -m "rename old -> new and drop <name>"'
run_case "main command: dangling redirect resets at separator" 0 main-command 'echo foo > ; git status'
# real writes must stay blocked (guards against over-neutralizing quotes).
run_case "main command: quoted redirect target still blocked" 1 main-command 'echo x > "src/foo.ts"'
run_case "main command: rm source file blocked" 1 main-command "rm src/gone.ts"
run_case "main command: rm memory doc allowed" 0 main-command "rm memory/x.md"

# Ported from superseded PR #1168 (quoted-literal redirect regressions): #1168
# was closed as fully covered by #1159's mask_quoted_specials fix (10/10
# verified), but its regression cases were never merged. This guard is a
# hot spot with repeated parallel fixes, so keep the cases as an insurance
# policy against the same false-positive/regression shapes recurring.
run_case "main command: quoted redirect-literal grep single-quoted allowed" 0 main-command "grep '>&' src/App.tsx"
run_case "main command: quoted redirect-literal grep double-quoted fd-dup allowed" 0 main-command 'grep -n "2>&1" src/App.tsx'
run_case "main command: quoted segment glued unquoted redirect to source blocked" 1 main-command 'echo "x">src/App.tsx'
run_case "main command: empty quoted segment glued unquoted redirect to source blocked" 1 main-command "echo ''>src/App.tsx"
run_case "main command: quoted variable glued unquoted redirect to source blocked" 1 main-command 'echo "$v">src/App.tsx'

# ─────────────────────────────────────────────────────────────────────────────
# Issue #1251 — natural-language file-op verbs in gh comment/issue bodies and
# heredoc bodies were mis-parsed as write commands and blocked whole
# orchestration commands. The fix keeps quoted spans as one opaque token
# (quote-aware tokenizer) and strips heredoc BODIES before tokenizing, while
# every real write (redirect / rm / mv / tee / sed -i / heredoc-fed redirect)
# stays blocked.
# ALLOW: file-op verbs living in body TEXT are data, not commands.
run_case "main command: gh pr comment inline body with file-op verbs allowed (#1251)" 0 main-command "gh pr comment 1245 --body 'we truncate old rows, mv files, and rm stale entries'"
run_case "main command: gh pr comment --body-file path allowed (#1251)" 0 main-command "gh pr comment 1245 --body-file /tmp/scorecard.md"
issue_heredoc_input="$(printf 'cat > /tmp/body.md <<EOF\ntruncate move and rm the old data\nEOF\ngh issue create --title t --body-file /tmp/body.md\n')"
run_case "main command: heredoc temp-file write + gh issue create allowed (#1251)" 0 main-command "$issue_heredoc_input"
# BLOCK (protection preserved): a real write must still be caught even next to
# a text body flag or a stripped heredoc body.
run_case "main command: body flag then real redirect to source still blocked (#1251)" 1 main-command "gh pr comment 1245 --body 'note' > src/App.tsx"
heredoc_src_redirect_input="$(printf 'cat > src/App.tsx <<EOF\nsome body data\nEOF\n')"
run_case "main command: heredoc opener redirect to source still blocked (#1251)" 1 main-command "$heredoc_src_redirect_input"

# #1251 review blocker B1 — a `<<` INSIDE a quoted body value must not be
# mistaken for a heredoc opener. It used to drop every following line as "body",
# so a real write on the next line slipped past the guard unchecked.
b1_quoted_heredoc_rm="$(printf 'gh pr comment 1 --body "a << b"\nrm src/App.tsx')"
run_case "main command: quoted << in body then next-line rm still blocked (#1251 B1)" 1 main-command "$b1_quoted_heredoc_rm"
b1_quoted_heredoc_redir="$(printf 'gh issue create --body "see << below"\necho x > src/App.tsx')"
run_case "main command: quoted << in body then next-line redirect still blocked (#1251 B1)" 1 main-command "$b1_quoted_heredoc_redir"
# A single-line review comment/body carrying `<<`, `>` and file-op verbs as prose
# must pass (the everyday scorecard-posting case the guard was breaking).
run_case "main command: single-line review body with << and > glyphs allowed (#1251 B1)" 0 main-command "gh pr comment 1 --body 'see foo << bar and x > y, truncate/mv/rm mentioned'"
# An unbalanced quote inside a real heredoc body must not carry into and mask a
# later command line's redirect (regression guard for the quote-parity carry).
b1_body_apostrophe="$(printf "cat > /tmp/x.md <<EOF\nit's data\nEOF\necho x > src/App.tsx")"
run_case "main command: heredoc body apostrophe does not mask next-line write (#1251 B1)" 1 main-command "$b1_body_apostrophe"
# `<<<` is a here-string, not a heredoc; it must not swallow following lines.
b1_herestring="$(printf 'grep foo <<<BAR\nrm src/App.tsx')"
run_case "main command: here-string <<< does not swallow next-line write (#1251 B1)" 1 main-command "$b1_herestring"

# Issue #1242 — Bash 3.2 (macOS) + set -u empty-array crash. Running the hook in
# path mode with NO path args expanded an empty "${PATH_ARGS[@]}" (unbound
# variable), crashing the guard (exit 1). It must now no-op cleanly (exit 0).
run_case "main path: no path args does not crash (#1242)" 0 main-path

doc_patch_input="$(printf '*** Begin Patch\n*** Update File: memory/foo/memory.md\n@@\n-- git mv old path\n+- test/reset/helper wording in docs\n*** End Patch\n')"
run_case "main command: apply_patch checks patch markers only" 0 main-command "$doc_patch_input"
mixed_patch_shell_input="$(printf 'printf patch_marker <<EOF\n*** Update File: memory/foo/memory.md\nEOF\nprintf hi > src/App.tsx\n')"
run_case "main command: patch marker plus source write blocked" 1 main-command "$mixed_patch_shell_input"

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
	"Codex hook: .agents skills denied" \
	"Edit" \
	'{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":".agents/skills/tdd/SKILL.md"}}' \
	deny
run_codex_hook_case \
	"Codex hook: memory edit allowed" \
	"Edit" \
	'{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"memory/runbook/worktree/memory.md"}}' \
	allow
run_codex_hook_case \
	"Codex hook: Bash source write denied" \
	"Bash" \
	'{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"printf hi > src/App.tsx"}}' \
	deny

apply_patch_target="src/"'App.tsx'
apply_patch_input="$(printf '*** Begin Patch\n*** Update File: %s\n@@\n-old\n+new\n*** End Patch\n' "$apply_patch_target")"
apply_patch_payload="$(jq -n --arg input "$apply_patch_input" '{
  hook_event_name: "PreToolUse",
  tool_name: "apply_patch",
  tool_input: { input: $input }
}')"
run_codex_hook_case \
	"Codex hook: apply_patch source write denied" \
	"apply_patch" \
	"$apply_patch_payload" \
	deny

run_jq_case "Claude settings: PreToolUse wrapper routes edit policy + Bash (via pre-tool-use.sh)" '
  .hooks.PreToolUse[]
  | select(any(.hooks[]?; (.command // "") | contains("pre-tool-use.sh")))
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
