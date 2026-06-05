#!/usr/bin/env bash
# Smoke check for scripts/hooks/pre-push-path-router.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROUTER="$ROOT/scripts/hooks/pre-push-path-router.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pre-push-router-check.XXXXXX")"
ZERO_OID="0000000000000000000000000000000000000000"
trap 'rm -rf "$TMP_DIR"' EXIT

while read -r git_env_var; do
	[ -n "$git_env_var" ] && unset "$git_env_var"
done < <(git -C "$ROOT" rev-parse --local-env-vars)

assert_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if ! grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: missing '$needle'" >&2
		echo "$text" >&2
		exit 1
	fi
}

assert_not_contains() {
	local text="$1"
	local needle="$2"
	local label="$3"

	if grep -Fq "$needle" <<<"$text"; then
		echo "FAIL: $label: unexpected '$needle'" >&2
		echo "$text" >&2
		exit 1
	fi
}

init_repo() {
	local repo="$1"

	rm -rf "$repo"
	mkdir -p "$repo"
	git -C "$repo" init --quiet
	git -C "$repo" config user.name "Test User"
	git -C "$repo" config user.email "test@example.invalid"
	git -C "$repo" config commit.gpgsign false
	mkdir -p "$repo/.no-hooks"
	git -C "$repo" config core.hooksPath .no-hooks

	mkdir -p "$repo/docs"
	printf 'base\n' >"$repo/docs/base.md"
	mkdir -p "$repo/public"
	printf 'base\n' >"$repo/public/fixture.txt"
	git -C "$repo" add docs/base.md public/fixture.txt
	git -C "$repo" commit --quiet -m "test: base"
	git -C "$repo" update-ref refs/remotes/origin/main "$(git -C "$repo" rev-parse HEAD)"
}

commit_paths() {
	local repo="$1"
	shift
	local path

	for path in "$@"; do
		mkdir -p "$(dirname "$repo/$path")"
		printf '%s\n' "$path" >>"$repo/$path"
		git -C "$repo" add "$path"
	done
	git -C "$repo" commit --quiet -m "test: change paths"
}

rename_path() {
	local repo="$1"
	local from_path="$2"
	local to_path="$3"

	mkdir -p "$(dirname "$repo/$to_path")"
	git -C "$repo" mv "$from_path" "$to_path"
	git -C "$repo" commit --quiet -m "test: rename path"
}

delete_path() {
	local repo="$1"
	local path="$2"

	git -C "$repo" rm --quiet "$path"
	git -C "$repo" commit --quiet -m "test: delete path"
}

run_router() {
	local repo="$1"
	local remote_oid="$2"
	local local_oid

	local_oid="$(git -C "$repo" rev-parse HEAD)"
	(
		cd "$repo"
		printf 'refs/heads/main %s refs/heads/main %s\n' "$local_oid" "$remote_oid" |
			PRE_PUSH_PATH_ROUTER_DRY_RUN=1 "$ROUTER"
	)
}

run_case() {
	local name="$1"
	local remote_mode="$2"
	shift 2
	local repo="$TMP_DIR/$name"
	local remote_oid output

	init_repo "$repo"
	remote_oid="$(git -C "$repo" rev-parse HEAD)"
	commit_paths "$repo" "$@"
	if [ "$remote_mode" = "zero" ]; then
		remote_oid="$ZERO_OID"
	fi
	output="$(run_router "$repo" "$remote_oid")"
	printf '%s\n' "$output"
}

run_rename_case() {
	local name="$1"
	local from_path="$2"
	local to_path="$3"
	local repo="$TMP_DIR/$name"
	local remote_oid output

	init_repo "$repo"
	remote_oid="$(git -C "$repo" rev-parse HEAD)"
	rename_path "$repo" "$from_path" "$to_path"
	output="$(run_router "$repo" "$remote_oid")"
	printf '%s\n' "$output"
}

run_delete_case() {
	local name="$1"
	local path="$2"
	local repo="$TMP_DIR/$name"
	local remote_oid output

	init_repo "$repo"
	remote_oid="$(git -C "$repo" rev-parse HEAD)"
	delete_path "$repo" "$path"
	output="$(run_router "$repo" "$remote_oid")"
	printf '%s\n' "$output"
}

docs_output="$(run_case docs-only normal docs/notes.md README.md)"
assert_contains "$docs_output" "RUN signed-commits:" "docs-only"
assert_contains "$docs_output" "RUN coverage-ratchet:" "docs-only"
assert_contains "$docs_output" "route: docs-only" "docs-only"
assert_contains "$docs_output" "RUN check-tdd-cycle:" "docs-only"
assert_not_contains "$docs_output" "ts-typecheck" "docs-only"
assert_not_contains "$docs_output" "cargo-deny" "docs-only"

frontend_output="$(run_case frontend-only normal src/App.tsx)"
assert_contains "$frontend_output" "route: frontend=1 rust=0" "frontend-only"
assert_contains "$frontend_output" "RUN ts-typecheck:" "frontend-only"
assert_contains "$frontend_output" "RUN ts-lint:" "frontend-only"
assert_contains "$frontend_output" "RUN ts-test:" "frontend-only"
assert_not_contains "$frontend_output" "rust-test-and-coverage" "frontend-only"

rust_output="$(run_case rust-only normal src-tauri/src/lib.rs)"
assert_contains "$rust_output" "route: frontend=0 rust=1" "rust-only"
assert_contains "$rust_output" "RUN tauri-check:" "rust-only"
assert_contains "$rust_output" "RUN cargo-deny:" "rust-only"
assert_contains "$rust_output" "RUN rust-test-and-coverage:" "rust-only"
assert_contains "$rust_output" "cargo llvm-cov nextest --profile push" "rust-only"
assert_not_contains "$rust_output" "RUN ts-test:" "rust-only"

mixed_output="$(run_case mixed normal src/App.tsx src-tauri/src/lib.rs)"
assert_contains "$mixed_output" "route: frontend=1 rust=1" "mixed"
assert_contains "$mixed_output" "RUN sequential: frontend then rust" "mixed"
assert_contains "$mixed_output" "RUN ts-test:" "mixed"
assert_contains "$mixed_output" "RUN rust-test-and-coverage:" "mixed"

mixed_parallel_output="$(
	PRE_PUSH_PATH_ROUTER_PARALLEL_GATES=1 run_case mixed-parallel normal src/App.tsx src-tauri/src/lib.rs
)"
assert_contains "$mixed_parallel_output" "route: frontend=1 rust=1" "mixed parallel"
assert_contains "$mixed_parallel_output" "RUN parallel: frontend+rust" "mixed parallel"
assert_contains "$mixed_parallel_output" "RUN ts-test:" "mixed parallel"
assert_contains "$mixed_parallel_output" "RUN rust-test-and-coverage:" "mixed parallel"

hook_output="$(run_case hook normal lefthook.yml)"
assert_contains "$hook_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "hook"
assert_contains "$hook_output" "RUN hook-shell-syntax:" "hook"
assert_contains "$hook_output" "RUN lefthook-validate:" "hook"
assert_contains "$hook_output" "RUN nextest-push-profile-config:" "hook"
assert_contains "$hook_output" "RUN pre-push-router-tests:" "hook"
assert_contains "$hook_output" "RUN target-cache-tests:" "hook"
assert_not_contains "$hook_output" "RUN ts-typecheck:" "hook"
assert_not_contains "$hook_output" "RUN rust-test-and-coverage:" "hook"

hook_doc_output="$(run_case hook-doc normal scripts/hooks/README.md)"
assert_contains "$hook_doc_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "hook doc"
assert_contains "$hook_doc_output" "RUN pre-push-router-tests:" "hook doc"
assert_not_contains "$hook_doc_output" "RUN ts-test:" "hook doc"
assert_not_contains "$hook_doc_output" "RUN rust-test-and-coverage:" "hook doc"

setup_output="$(run_case setup normal scripts/setup.sh)"
assert_contains "$setup_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "setup"
assert_contains "$setup_output" "RUN hook-shell-syntax:" "setup"
assert_not_contains "$setup_output" "RUN ts-test:" "setup"
assert_not_contains "$setup_output" "RUN rust-test-and-coverage:" "setup"

worktree_spawn_output="$(run_case worktree-spawn normal scripts/worktree-spawn.sh)"
assert_contains "$worktree_spawn_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "worktree spawn"
assert_contains "$worktree_spawn_output" "RUN hook-shell-syntax:" "worktree spawn"
assert_not_contains "$worktree_spawn_output" "RUN ts-test:" "worktree spawn"
assert_not_contains "$worktree_spawn_output" "RUN rust-test-and-coverage:" "worktree spawn"

target_cache_output="$(run_case target-cache normal scripts/target-cache.sh)"
assert_contains "$target_cache_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "target cache"
assert_contains "$target_cache_output" "RUN hook-shell-syntax:" "target cache"
assert_contains "$target_cache_output" "RUN target-cache-tests:" "target cache"
assert_not_contains "$target_cache_output" "RUN ts-test:" "target cache"
assert_not_contains "$target_cache_output" "RUN rust-test-and-coverage:" "target cache"

nextest_config_output="$(run_case nextest-config normal src-tauri/.config/nextest.toml)"
assert_contains "$nextest_config_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "nextest config"
assert_contains "$nextest_config_output" "RUN nextest-push-profile-config:" "nextest config"
assert_not_contains "$nextest_config_output" "RUN ts-test:" "nextest config"
assert_not_contains "$nextest_config_output" "RUN rust-test-and-coverage:" "nextest config"

ratchet_script_output="$(run_case ratchet-script normal scripts/check-coverage-ratchet.ts scripts/coverage-ratchet-targets.json)"
assert_contains "$ratchet_script_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "ratchet script"
assert_contains "$ratchet_script_output" "RUN coverage-ratchet:" "ratchet script"
assert_not_contains "$ratchet_script_output" "RUN ts-test:" "ratchet script"
assert_not_contains "$ratchet_script_output" "RUN rust-test-and-coverage:" "ratchet script"

ci_workflow_output="$(run_case ci-workflow normal .github/workflows/e2e-smoke.yml)"
assert_contains "$ci_workflow_output" "route: full" "ci workflow"
assert_contains "$ci_workflow_output" "RUN e2e-smoke-workflow-cache:" "ci workflow"
assert_contains "$ci_workflow_output" "RUN ts-test:" "ci workflow"
assert_contains "$ci_workflow_output" "RUN rust-test-and-coverage:" "ci workflow"

claude_agent_output="$(run_case claude-agent normal .claude/settings.json)"
assert_contains "$claude_agent_output" "route: frontend=0 rust=0 hook=0 memory=0 agent=1" "claude agent"
assert_not_contains "$claude_agent_output" "RUN ts-test:" "claude agent"
assert_not_contains "$claude_agent_output" "RUN rust-test-and-coverage:" "claude agent"

codex_agent_output="$(run_case codex-agent normal .codex/hooks.json)"
assert_contains "$codex_agent_output" "route: frontend=0 rust=0 hook=0 memory=0 agent=1" "codex agent"
assert_not_contains "$codex_agent_output" "RUN e2e-smoke-workflow-cache:" "codex agent"
assert_not_contains "$codex_agent_output" "RUN ts-test:" "codex agent"
assert_not_contains "$codex_agent_output" "RUN rust-test-and-coverage:" "codex agent"

agents_skill_output="$(run_case agents-skill normal .agents/skills/example/SKILL.md)"
assert_contains "$agents_skill_output" "route: frontend=0 rust=0 hook=0 memory=0 agent=1" "agents skill"
assert_not_contains "$agents_skill_output" "RUN ts-test:" "agents skill"
assert_not_contains "$agents_skill_output" "RUN rust-test-and-coverage:" "agents skill"

memory_output="$(run_case memory normal memory/workflow/example/memory.md)"
assert_contains "$memory_output" "route: frontend=0 rust=0 hook=0 memory=1 agent=0" "memory"
assert_contains "$memory_output" "RUN memory-structure:" "memory"
assert_contains "$memory_output" "RUN memory-size:" "memory"
assert_not_contains "$memory_output" "RUN ts-test:" "memory"
assert_not_contains "$memory_output" "RUN rust-test-and-coverage:" "memory"

unknown_output="$(run_case unknown normal .prettierrc)"
assert_contains "$unknown_output" "route: full" "unknown"
assert_contains "$unknown_output" "RUN ts-test:" "unknown"
assert_contains "$unknown_output" "RUN rust-test-and-coverage:" "unknown"

new_branch_output="$(run_case new-branch zero src/App.tsx)"
assert_contains "$new_branch_output" "route: frontend=1 rust=0" "new branch"
assert_contains "$new_branch_output" "RUN ts-test:" "new branch"
assert_not_contains "$new_branch_output" "rust-test-and-coverage" "new branch"

rename_output="$(run_rename_case rename-frontend-to-docs public/fixture.txt docs/fixture.txt)"
assert_contains "$rename_output" "route: frontend=1 rust=0" "rename frontend to docs"
assert_contains "$rename_output" "RUN ts-test:" "rename frontend to docs"

delete_output="$(run_delete_case delete-frontend public/fixture.txt)"
assert_contains "$delete_output" "route: frontend=1 rust=0" "delete frontend"
assert_contains "$delete_output" "RUN ts-test:" "delete frontend"

echo "PASS: pre-push path router smoke check"
