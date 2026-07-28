#!/usr/bin/env bash
# Smoke tests for primary-worktree source/app edit enforcement.

set -uo pipefail

# shellcheck source=../lib/git-fixture.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/git-fixture.sh"
scrub_git_env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/check-main-worktree-source-edit.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CODEX_HOOK="$REPO_ROOT/scripts/hooks/apply/pre-tool-use.sh"  # neutral wrapper (Claude/codex 공유)
CLAUDE_SETTINGS="$REPO_ROOT/.claude/settings.json"

PASS_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=()

TMP_ROOT=""
MAIN_ROOT=""
LINKED_ROOT=""
HOME_FIXTURE=""
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
	TMP_ROOT="$(fixture_mktemp)"
	MAIN_ROOT="$TMP_ROOT/main"
	LINKED_ROOT="$MAIN_ROOT/worktrees/linked-fixture"
	# Home fixture OUTSIDE the repo root, so `~`-prefixed cases are deterministic
	# regardless of where the developer's real $HOME sits (issue #1797).
	HOME_FIXTURE="$TMP_ROOT/home"
	must mkdir -p "$HOME_FIXTURE"

	fixture_init_repo "$MAIN_ROOT"
	printf '%s\n' "fixture" > "$MAIN_ROOT/README.md"
	must git -C "$MAIN_ROOT" add README.md
	must git -C "$MAIN_ROOT" commit -q -m "fixture"

	# Repository skeleton. The guard now asks whether a resolved token names a
	# real place in the repo (is_repo_location), so a fixture with nothing but
	# README.md would make every "blocked" assertion below pass vacuously — the
	# paths would be released as tokenizer artifacts rather than judged by
	# policy. Mirror the real tree: the directories the assertions write INTO,
	# and the repo-root config files they name directly (a bare word with no
	# directory part is only a repo path when the file itself exists).
	must mkdir -p \
		"$MAIN_ROOT/src/lib/sql/wasm" \
		"$MAIN_ROOT/src-tauri/src" \
		"$MAIN_ROOT/src-tauri/capabilities" \
		"$MAIN_ROOT/src-tauri/permissions" \
		"$MAIN_ROOT/src-tauri/icons" \
		"$MAIN_ROOT/docs" \
		"$MAIN_ROOT/notes" \
		"$MAIN_ROOT/memory/runbook/worktree" \
		"$MAIN_ROOT/scripts/hooks" \
		"$MAIN_ROOT/scripts/fixtures" \
		"$MAIN_ROOT/.agents/skills/tdd" \
		"$MAIN_ROOT/.claude" \
		"$MAIN_ROOT/.codex" \
		"$MAIN_ROOT/.github"
	for f in package.json components.json tsconfig.node.json vite.config.ts \
		vitest.config.ts eslint.config.js; do
		printf '%s\n' "fixture" > "$MAIN_ROOT/$f"
	done

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

# Runs one hook invocation and publishes ACTUAL_STDERR / ACTUAL_EXIT. Shared by
# every assertion helper so a mode is defined once and is usable from ALL of
# them — the `*-home` modes were previously reachable from run_case only, which
# made the `$HOME` guard's stderr unassertable (PR #1858 review).
#
# `*-home` modes take HOME as the first argument, then the path/command.
ACTUAL_STDERR=""
ACTUAL_EXIT=0
exec_case() {
	local mode="$1"
	shift

	case "$mode" in
		main-path)
			ACTUAL_STDERR="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$MAIN_ROOT" bash "$HOOK" "$@" 2>&1 >/dev/null)"
			ACTUAL_EXIT=$?
			;;
		main-path-home)
			ACTUAL_STDERR="$(HOME="$1" CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$MAIN_ROOT" bash "$HOOK" "${@:2}" 2>&1 >/dev/null)"
			ACTUAL_EXIT=$?
			;;
		main-command)
			ACTUAL_STDERR="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$MAIN_ROOT" bash "$HOOK" --command "$1" 2>&1 >/dev/null)"
			ACTUAL_EXIT=$?
			;;
		main-command-home)
			ACTUAL_STDERR="$(HOME="$1" CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$MAIN_ROOT" bash "$HOOK" --command "$2" 2>&1 >/dev/null)"
			ACTUAL_EXIT=$?
			;;
		# HOME removed from the environment entirely (not just empty).
		main-command-no-home)
			ACTUAL_STDERR="$(env -u HOME CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$MAIN_ROOT" bash "$HOOK" --command "$1" 2>&1 >/dev/null)"
			ACTUAL_EXIT=$?
			;;
		linked-path)
			ACTUAL_STDERR="$(CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT="$LINKED_ROOT" bash "$HOOK" "$@" 2>&1 >/dev/null)"
			ACTUAL_EXIT=$?
			;;
		*)
			echo "FAIL: unknown mode: $mode" >&2
			exit 1
			;;
	esac
}

run_case() {
	local name="$1"
	local expected_exit="$2"
	local mode="$3"
	shift 3

	exec_case "$mode" "$@"

	if [ "$ACTUAL_EXIT" = "$expected_exit" ]; then
		record_pass "$name"
	else
		record_fail "$name expected exit $expected_exit, got $ACTUAL_EXIT; stderr=$ACTUAL_STDERR"
	fi
}

run_case_stderr_contains() {
	local name="$1"
	local expected_exit="$2"
	local expected_stderr="$3"
	local mode="$4"
	shift 4

	exec_case "$mode" "$@"

	if [ "$ACTUAL_EXIT" != "$expected_exit" ]; then
		record_fail "$name expected exit $expected_exit, got $ACTUAL_EXIT; stderr=$ACTUAL_STDERR"
	elif ! grep -Fq "$expected_stderr" <<<"$ACTUAL_STDERR"; then
		record_fail "$name expected stderr to contain '$expected_stderr'; stderr=$ACTUAL_STDERR"
	else
		record_pass "$name"
	fi
}

# Same shape as run_case_stderr_contains, negated: the run must finish with the
# expected exit code AND must not have leaked the given text (e.g. a `set -u`
# "unbound variable" abort, which fails open with the same exit code as a clean
# allow — exit code alone cannot tell the two apart).
run_case_stderr_lacks() {
	local name="$1"
	local expected_exit="$2"
	local forbidden_stderr="$3"
	local mode="$4"
	shift 4

	exec_case "$mode" "$@"

	if [ "$ACTUAL_EXIT" != "$expected_exit" ]; then
		record_fail "$name expected exit $expected_exit, got $ACTUAL_EXIT; stderr=$ACTUAL_STDERR"
	elif grep -Fq "$forbidden_stderr" <<<"$ACTUAL_STDERR"; then
		record_fail "$name expected stderr NOT to contain '$forbidden_stderr'; stderr=$ACTUAL_STDERR"
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

# ─────────────────────────────────────────────────────────────────────────────
# Issue #1797 — a `~` token is not expanded by the approximate tokenizer, so it
# was joined onto $ROOT (`$ROOT/~/...`), landed inside the repo and blocked home
# directory maintenance from the primary worktree. The token must be expanded
# the way the shell would: home OUTSIDE the repo passes, and — because the repo
# can live UNDER $HOME — a `~` path that resolves back INTO the repo stays
# blocked (a blanket "skip anything starting with ~" would under-block there).
run_case "main command: tilde home file removal allowed (#1797)" 0 main-command-home "$HOME_FIXTURE" "rm ~/.claude/skills/x"
run_case "main command: tilde home redirect allowed (#1797)" 0 main-command-home "$HOME_FIXTURE" "cat > ~/.zshrc"
run_case "main command: tilde home path is not repo-relative (#1797)" 0 main-command-home "$HOME_FIXTURE" "rm ~/src/App.tsx"
run_case "main command: absolute home file removal allowed (#1797)" 0 main-command-home "$HOME_FIXTURE" "rm $HOME_FIXTURE/.claude/settings.json"
run_case "main command: absolute home redirect allowed (#1797)" 0 main-command-home "$HOME_FIXTURE" "cat > $HOME_FIXTURE/.claude/settings.json"
run_case "main command: unexpanded \$HOME token allowed (#1797)" 0 main-command-home "$HOME_FIXTURE" 'cat > $HOME/.claude/settings.json'
# Bare `~` is a home reference too (`cp x ~`, `mv f ~`): without its own branch
# the token is joined onto $ROOT and blocked as a repo edit.
run_case "main command: bare tilde cp destination allowed (#1797)" 0 main-command-home "$HOME_FIXTURE" "cp notes.txt ~"
run_case "main command: bare tilde mv destination allowed (#1797)" 0 main-command-home "$HOME_FIXTURE" "mv /tmp/notes.txt ~"
# Under-block guards: repo source must stay blocked, including when $HOME IS the
# repo root so `~/...` expands back into it.
run_case "main command: rust source removal still blocked (#1797)" 1 main-command-home "$HOME_FIXTURE" "rm src-tauri/src/main.rs"
run_case "main command: tilde expanding into repo source blocked (#1797)" 1 main-command-home "$MAIN_ROOT" "rm ~/src/App.tsx"
run_case "main command: tilde expanding into repo rust source blocked (#1797)" 1 main-command-home "$MAIN_ROOT" "cat > ~/src-tauri/src/main.rs"
# Literal `~`-prefixed repo file (no slash after `~`): not a home reference, so
# it stays a repo-relative path and stays blocked.
run_case "main command: literal tilde-prefixed repo file blocked (#1797)" 1 main-command-home "$HOME_FIXTURE" "rm ~backup.ts"
# Ceiling: `~name/...` (another user's home) is NOT expanded, so it keeps the
# conservative pre-#1797 treatment of a repo-relative path and stays blocked.
run_case "main command: ~name token stays conservatively blocked (#1797)" 1 main-command-home "$HOME_FIXTURE" "rm ~otheruser/src/App.tsx"
# A quoted token is never tilde-expanded by the shell — `rm "~/src/App.tsx"`
# targets the literal `<repo>/~/src/App.tsx`, so it must stay blocked
# (under-block regression found in PR #1858 review).
run_case "main command: double-quoted tilde token stays repo-relative (#1858)" 1 main-command-home "$HOME_FIXTURE" 'rm "~/src/App.tsx"'
run_case "main command: single-quoted tilde token stays repo-relative (#1858)" 1 main-command-home "$HOME_FIXTURE" "rm '~/src/App.tsx'"
# PATH mode carries no shell: Edit/Write tool paths (Node fs) never expand `~`,
# so `~/src/App.tsx` lands on the literal `<repo>/~/src/App.tsx` and must stay
# blocked (under-block regression found in PR #1858 review).
run_case "main path: tilde frontend source stays blocked (#1858)" 1 main-path-home "$HOME_FIXTURE" "~/src/App.tsx"
run_case "main path: tilde rust source stays blocked (#1858)" 1 main-path-home "$HOME_FIXTURE" "~/src-tauri/src/main.rs"
run_case "main path: tilde agent settings stays blocked (#1858)" 1 main-path-home "$HOME_FIXTURE" "~/.claude/settings.local.json"
# An unset HOME must not abort the guard mid-run: under `set -u` an unguarded
# `${HOME}` kills the subshell and fails open with the SAME exit code as a clean
# allow, so the stderr leak is the only observable difference.
run_case_stderr_lacks "main command: unset HOME does not abort the guard (#1858)" 0 "unbound variable" main-command-no-home "rm ~/.claude/skills/x"

# A quoted `~` is literal NO MATTER WHERE the quote sits in the token, so every
# route into emit_path has to see it: a redirect glued to its target keeps the
# quote in the middle of the token (`>"~/x"`), and so do the glued multi-redirect
# segments and `dd of=`. Anchoring the rule at the token's first character
# covered only the space-separated spelling (#1858 round 2 under-block).
# One case per emit route, quoted (blocked) next to its unquoted twin (allowed).
run_case "main command: glued redirect quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'cat >"~/src/App.tsx"'
run_case "main command: glued append redirect quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'cat >>"~/src/App.tsx"'
run_case "main command: glued stderr redirect quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'cat 2>"~/src/App.tsx"'
run_case "main command: glued fd1 redirect quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'cat 1>"~/src/App.tsx"'
run_case "main command: glued redirect single-quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" "cat >'~/src/App.tsx'"
run_case "main command: glued multi-redirect quoted tilde segment blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'printf x >memory/a.md>"~/src/App.tsx"'
run_case "main command: dd of= quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'dd if=/dev/zero of="~/src/App.tsx"'
run_case "main command: spaced redirect quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'cat > "~/src/App.tsx"'
run_case "main command: tee quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'printf x | tee "~/src/App.tsx"'
run_case "main command: cp destination quoted tilde blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'cp /tmp/a "~/src/App.tsx"'
# Unquoted twins: the shell DOES expand these, so they stay allowed.
run_case "main command: glued redirect unquoted tilde allowed (#1858)" 0 main-command-home "$HOME_FIXTURE" "cat >~/.zshrc"
run_case "main command: glued append redirect unquoted tilde allowed (#1858)" 0 main-command-home "$HOME_FIXTURE" "cat >>~/.zshrc"
run_case "main command: dd of= unquoted tilde allowed (#1858)" 0 main-command-home "$HOME_FIXTURE" "dd if=/dev/zero of=~/.zshrc"
run_case "main command: tee unquoted tilde allowed (#1858)" 0 main-command-home "$HOME_FIXTURE" "printf x | tee ~/.zshrc"
# Control: a quoted literal repo path stays blocked through the same route.
run_case "main command: glued redirect quoted repo path blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" 'cat >"src/App.tsx"'
# apply_patch markers are literal file paths, not shell words — nothing expands
# `~` there either.
tilde_patch_input="$(printf '*** Begin Patch\n*** Update File: ~/src/App.tsx\n@@\n-old\n+new\n*** End Patch\n')"
run_case "main command: patch marker tilde path blocked (#1858)" 1 main-command-home "$HOME_FIXTURE" "$tilde_patch_input"

# Issue #1242 — Bash 3.2 (macOS) + set -u empty-array crash. Running the hook in
# path mode with NO path args expanded an empty "${PATH_ARGS[@]}" (unbound
# variable), crashing the guard (exit 1). It must now no-op cleanly (exit 0).
run_case "main path: no path args does not crash (#1242)" 0 main-path

doc_patch_input="$(printf '*** Begin Patch\n*** Update File: memory/foo/memory.md\n@@\n-- git mv old path\n+- test/reset/helper wording in docs\n*** End Patch\n')"
run_case "main command: apply_patch checks patch markers only" 0 main-command "$doc_patch_input"
mixed_patch_shell_input="$(printf 'printf patch_marker <<EOF\n*** Update File: memory/foo/memory.md\nEOF\nprintf hi > src/App.tsx\n')"
run_case "main command: patch marker plus source write blocked" 1 main-command "$mixed_patch_shell_input"

# --- Orchestration false positives, drawn from 293 recorded denials -----------
# Replaying those 293 through the current guard releases 273 and still denies 20;
# the denied remainder is a mix of real blocks and residual reader artifacts. The
# cases below are the shapes that mattered, pinned so they cannot come back.
#
# Three independent causes, each with its own layer. Every case below was an
# ACTUAL blocked orchestration command taken from session transcripts.

# (1) Separators glued to a word. `2>&1|tail` was one token, so the `>` branch
# emitted `&1|tail`; `…; echo cleaned` never reset `rm` operand mode.
run_case "orchestration: fd dup piped to tail allowed" 0 main-command \
	"git fetch origin main -q 2>&1|tail -2"
run_case "orchestration: echo after semicolon-glued redirect allowed" 0 main-command \
	"rm -f /tmp/pr_body.md 2>/dev/null; echo cleaned"
run_case "orchestration: source write after glued separator still blocked" 1 main-command \
	"echo hi 2>/dev/null; printf x > src/App.tsx"

# (2) The command runs somewhere else. A relative target was re-rooted at $ROOT.
run_case "orchestration: scratch file under cd to /tmp allowed" 0 main-command \
	"cd /tmp && rm -rf cllvmcov && mkdir cllvmcov"
run_case "orchestration: PR body inside a linked worktree allowed" 0 main-command \
	"cd worktrees/linked-fixture && rm -f .pr-body-1705.md"
run_case "orchestration: cd out then back into repo source still blocked" 1 main-command \
	"cd /tmp && cd $MAIN_ROOT && printf x > src/App.tsx"
run_case "orchestration: cd as a grep argument does not move cwd" 1 main-command \
	"grep cd notes/review.md; printf x > src/App.tsx"

# (3) The token is not a path. relative_path() joins any string to $ROOT, after
# which path_class_for_message() labels it from its extension alone.
run_case "orchestration: sed substitution expression allowed" 0 main-command \
	"gh pr edit 1 --body \"\$(sed -E 's/Smoke-Test-Plan:/Not required:/' /tmp/b.md)\""
run_case "orchestration: python -c body allowed" 0 main-command \
	"python3 -c \"import re; t=open('/tmp/erd.html').read(); print(t[:200])\""
# …but a real in-place edit of a real repo file is still an edit.
run_case "orchestration: sed -i on a repo doc still blocked" 1 main-command \
	"sed -i '' 's/a/b/' docs/PLAN.md"
run_case "orchestration: new file in an existing repo dir still blocked" 1 main-command \
	"printf x > src/NewThing.tsx"

# (4) `git rm` deletes tracked files but `rm` is not in command position there,
# so the command-position verb table alone released a real primary-worktree
# deletion (`cd <root> && git rm src/lib/completion/*.ts`, one recorded denial).
run_case "git: rm of repo source blocked" 1 main-command \
	"git rm src/lib/sql/wasm/loader.ts"
run_case "git: rm after cd back to the root blocked" 1 main-command \
	"cd /tmp && cd $MAIN_ROOT && git rm src/lib/sql/wasm/loader.ts"
run_case "git: -C into the root blocked" 1 main-command \
	"git -C $MAIN_ROOT rm src/lib/sql/wasm/loader.ts"
run_case "git: -C into a linked worktree allowed" 0 main-command \
	"git -C $LINKED_ROOT rm src/lib/sql/wasm/loader.ts"
# `-C` re-roots git, not the shell: the redirect below lands in /tmp/scratch.
# Treating it as a `cd` denied four scratch-dir captures of committed files.
run_case "git: -C does not move the shell for a redirect" 0 main-command \
	"mkdir -p /tmp/scratch && cd /tmp/scratch && git -C $MAIN_ROOT show HEAD:README.md > base.md"
# A ref is not a path: `git checkout -b <branch>` used to emit the branch name.
run_case "git: checkout of a branch is not a write" 0 main-command \
	"git checkout -b test/1629-remove-dead-completion-sources"
run_case "git: status is not a write" 0 main-command \
	"git status --short | head"

# (5) A cwd this reader cannot expand has no anchor for a relative target.
# Every recorded instance held a linked worktree or a scratch dir, so anchoring
# at $ROOT denied writes that never touched the primary worktree.
run_case "unknown cwd: cd to a variable releases relative targets" 0 main-command \
	'W=/somewhere/else; cd "$W" && rm src/lib/sql/wasm/loader.ts'
run_case "unknown cwd: git -C a variable releases relative targets" 0 main-command \
	'W=/somewhere/else; git -C "$W" rm src/lib/sql/wasm/loader.ts'
run_case "unknown cwd: bare cd releases relative targets" 0 main-command \
	"cd && rm src/lib/sql/wasm/loader.ts"
# …but an absolute target still names the primary worktree wherever cwd went.
run_case "unknown cwd: absolute repo target still blocked" 1 main-command \
	"W=/somewhere/else; cd \"\$W\" && rm $MAIN_ROOT/src/lib/sql/wasm/loader.ts"
# (5b) The existence gate itself. Neutering `is_repo_location` to `return 0` left
# the whole suite green (review #1860), which meant the headline fix of this
# series had no assertion of its own. These three are the witnesses: each names a
# directory that does not exist in the repo, so the token cannot be a write to
# it — with the gate removed each is denied instead.
run_case "existence gate: cp into a directory that does not exist" 0 main-command \
	"cp a/b/c/d.txt e/f/g/h.txt"
run_case "existence gate: mv within a directory that does not exist" 0 main-command \
	"mv notes-absent/old.md notes-absent/new.md"
run_case "existence gate: touch under a directory that does not exist" 0 main-command \
	"touch build/artifacts/out.bin"
# …and the gate must not release a write into a directory that DOES exist.
run_case "existence gate: new file in a real directory is still blocked" 1 main-command \
	"touch src/lib/sql/wasm/brand-new.ts"

# (6) Review #1860 B2 — command position was lost in six ways, each releasing a
# real repo write. Base blocked all ten of these; the command-position narrowing
# released them until the wrappers and keywords below were made transparent.
run_case "position: env assignment prefix keeps the verb" 1 main-command \
	"env FOO=1 rm src/lib/sql/wasm/loader.ts"
run_case "position: bare assignment prefix keeps the verb" 1 main-command \
	"FOO=1 rm src/lib/sql/wasm/loader.ts"
run_case "position: time keeps the verb" 1 main-command \
	"time rm src/lib/sql/wasm/loader.ts"
run_case "position: nohup keeps the verb" 1 main-command \
	"nohup rm src/lib/sql/wasm/loader.ts"
run_case "position: brace group keeps the verb" 1 main-command \
	"{ rm src/lib/sql/wasm/loader.ts; }"
run_case "position: then keeps the verb" 1 main-command \
	"if true; then rm src/lib/sql/wasm/loader.ts; fi"
run_case "position: do keeps the verb" 1 main-command \
	"for f in a; do rm src/lib/sql/wasm/loader.ts; done"
# …and a wrapper that is NOT transparent must not swallow its own operands.
run_case "position: docker rm still not a repo write" 0 main-command \
	"docker rm -f tv-probe-mssql"

# (7) A cwd that cannot be expanded may still BE the repo root — `cd "$PWD"`,
# `cd $(pwd)` and `cd ""` all stay put. Releasing every unsure target let those
# through. Now an unsure target is blocked only when it already exists, so a
# scratch file under an unknown directory stays released.
run_case "unsure cwd: cd \$(pwd) then remove a repo file" 1 main-command \
	"cd \$(pwd) && rm vite.config.ts"
run_case "unsure cwd: cd \"\$PWD\" then write a repo file" 1 main-command \
	'cd "$PWD" && echo x > vite.config.ts'
run_case "unsure cwd: cd empty string then write a repo file" 1 main-command \
	'cd "" && echo x > vite.config.ts'
run_case "unsure cwd: a file that does not exist at the root stays released" 0 main-command \
	'W=/somewhere/else; cd "$W" && rm .pr-body-scratch.md'

# (8) A directory the same command creates is a real directory by the time the
# write runs. Checking only the disk let a new file into the repo.
run_case "mkdir then write into the new directory is blocked" 1 main-command \
	"mkdir -p src/newdir/deeper && echo x > src/newdir/deeper/thing.ts"
run_case "mkdir outside the repo then write there is allowed" 0 main-command \
	"mkdir -p /tmp/scratchdir && echo x > /tmp/scratchdir/thing.ts"
# `install` creates directories too — `-d`, `-D` and `--directory` all do.
run_case "install -d then write into the new directory is blocked" 1 main-command \
	"install -d src/newdir2 && echo x > src/newdir2/thing.ts"
run_case "install -D then write into the new directory is blocked" 1 main-command \
	"install -D src/newdir3/thing.ts src/newdir3/other.ts && echo x > src/newdir3/z.ts"

run_case "unknown cwd: reset by a separator" 1 main-command \
	'W=/somewhere/else; cd "$W"; rm x.txt; cd '"$MAIN_ROOT"'; rm src/lib/sql/wasm/loader.ts'

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
