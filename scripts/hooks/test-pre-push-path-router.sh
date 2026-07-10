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
		if [ "$path" = ".gitignore" ]; then
			printf '# generated fence fixture\n' >>"$repo/$path"
		else
			printf '%s\n' "$path" >>"$repo/$path"
		fi
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

fixture_tooling_output="$(run_case fixture-tooling normal scripts/fixtures/dbms-seeds.test.ts)"
assert_contains "$fixture_tooling_output" "route: frontend=1 rust=0" "fixture tooling"
assert_contains "$fixture_tooling_output" "fixture=1" "fixture tooling"
assert_contains "$fixture_tooling_output" "RUN ts-test:" "fixture tooling"
assert_not_contains "$fixture_tooling_output" "RUN rust-test-and-coverage:" "fixture tooling"

rust_output="$(run_case rust-only normal src-tauri/src/lib.rs)"
assert_contains "$rust_output" "route: frontend=0 rust=1" "rust-only"
assert_contains "$rust_output" "RUN tauri-check:" "rust-only"
assert_contains "$rust_output" "RUN cargo-deny:" "rust-only"
assert_contains "$rust_output" "RUN cargo-machete:" "rust-only"
# The heavy integration coverage gate moved to CI (2026-07-03); the rust route
# must run only the fast gates now.
assert_not_contains "$rust_output" "rust-test-and-coverage" "rust-only no promoted integration coverage"
assert_not_contains "$rust_output" "cargo llvm-cov nextest" "rust-only no promoted integration coverage"
assert_not_contains "$rust_output" "RUN ts-test:" "rust-only"

mixed_output="$(run_case mixed normal src/App.tsx src-tauri/src/lib.rs)"
assert_contains "$mixed_output" "route: frontend=1 rust=1" "mixed"
assert_contains "$mixed_output" "RUN parallel: frontend+rust" "mixed"
assert_contains "$mixed_output" "RUN ts-test:" "mixed"
assert_contains "$mixed_output" "RUN cargo-machete:" "mixed"

mixed_sequential_output="$(
	PRE_PUSH_PATH_ROUTER_PARALLEL_GATES=0 run_case mixed-sequential normal src/App.tsx src-tauri/src/lib.rs
)"
assert_contains "$mixed_sequential_output" "route: frontend=1 rust=1" "mixed sequential"
assert_contains "$mixed_sequential_output" "RUN sequential: frontend then rust" "mixed sequential"
assert_contains "$mixed_sequential_output" "RUN ts-test:" "mixed sequential"
assert_contains "$mixed_sequential_output" "RUN cargo-machete:" "mixed sequential"

mixed_parallel_output="$(
	PRE_PUSH_PATH_ROUTER_PARALLEL_GATES=1 run_case mixed-parallel normal src/App.tsx src-tauri/src/lib.rs
)"
assert_contains "$mixed_parallel_output" "route: frontend=1 rust=1" "mixed parallel"
assert_contains "$mixed_parallel_output" "RUN parallel: frontend+rust" "mixed parallel"
assert_contains "$mixed_parallel_output" "RUN ts-test:" "mixed parallel"
assert_contains "$mixed_parallel_output" "RUN cargo-machete:" "mixed parallel"

hook_output="$(run_case hook normal lefthook.yml)"
assert_contains "$hook_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "hook"
assert_contains "$hook_output" "RUN hook-shell-syntax:" "hook"
assert_contains "$hook_output" "RUN detect-change-scope:" "hook"
assert_contains "$hook_output" "RUN lefthook-validate:" "hook"
assert_contains "$hook_output" "RUN nextest-push-profile-config:" "hook"
assert_contains "$hook_output" "RUN pre-push-router-tests:" "hook"
assert_contains "$hook_output" "RUN target-cache-tests:" "hook"
assert_contains "$hook_output" "RUN generated-fence-tests:" "hook"
assert_contains "$hook_output" "RUN cargo-deny-summary-tests:" "hook"
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

prune_gh_caches_output="$(run_case prune-gh-caches normal scripts/prune-gh-caches.sh)"
assert_contains "$prune_gh_caches_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "prune-gh-caches"
assert_contains "$prune_gh_caches_output" "RUN hook-shell-syntax:" "prune-gh-caches"
assert_not_contains "$prune_gh_caches_output" "RUN ts-test:" "prune-gh-caches"
assert_not_contains "$prune_gh_caches_output" "RUN rust-test-and-coverage:" "prune-gh-caches"

target_cache_output="$(run_case target-cache normal scripts/target-cache.sh)"
assert_contains "$target_cache_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "target cache"
assert_contains "$target_cache_output" "RUN hook-shell-syntax:" "target cache"
assert_contains "$target_cache_output" "RUN target-cache-tests:" "target cache"
assert_not_contains "$target_cache_output" "RUN ts-test:" "target cache"
assert_not_contains "$target_cache_output" "RUN rust-test-and-coverage:" "target cache"

gitignore_output="$(run_case gitignore-fence normal .gitignore)"
assert_contains "$gitignore_output" "route: frontend=0 rust=0 hook=1 memory=0 agent=0" "gitignore fence"
assert_contains "$gitignore_output" "RUN generated-fence-tests:" "gitignore fence"
assert_not_contains "$gitignore_output" "RUN ts-test:" "gitignore fence"
assert_not_contains "$gitignore_output" "RUN rust-test-and-coverage:" "gitignore fence"

generated_output="$(
	run_case generated-cache-output normal \
		node_modules/.cache/package.ts \
		dist/assets/app.ts \
		.vite/deps/chunk.ts \
		cargo-target/debug/build.rs \
		target/debug/build.rs \
		src-tauri/target/debug/build.rs \
		src-tauri/sql-parser-core/target/debug/build.rs \
		src-tauri/mongosh-parser-core/target/debug/build.rs \
		coverage/summary.json \
		test-results/results.json \
		wdio-report/index.html \
		e2e/wdio-report/run/index.html \
		tmp/scratch/App.tsx \
		worktrees/agent/src/App.tsx \
		.claude/worktrees/agent/src-tauri/src/lib.rs
)"
assert_contains "$generated_output" "route: frontend=0 rust=0 hook=0 memory=0 agent=0 generated=1" "generated/cache output"
assert_not_contains "$generated_output" "RUN ts-test:" "generated/cache output"
assert_not_contains "$generated_output" "RUN rust-test-and-coverage:" "generated/cache output"

committed_generated_output="$(
	run_case committed-generated normal \
		src/lib/sql/wasm/sql_parser_core.js \
		src/lib/mongo/wasm/mongosh_parser_core.d.ts \
		src-tauri/gen/schemas/generated-cache-fence-check.json \
		src-tauri/icons/generated-cache-fence-check.png
)"
assert_contains "$committed_generated_output" "route: frontend=1 rust=1" "committed generated inputs"
assert_contains "$committed_generated_output" "committed_generated=1" "committed generated inputs"
assert_contains "$committed_generated_output" "RUN ts-test:" "committed generated inputs"
assert_contains "$committed_generated_output" "RUN cargo-machete:" "committed generated inputs"

committed_generated_wasm_output="$(run_case committed-generated-wasm normal src/lib/sql/wasm/sql_parser_core_bg.wasm)"
assert_contains "$committed_generated_wasm_output" "route: frontend=1 rust=0" "committed generated wasm"
assert_contains "$committed_generated_wasm_output" "committed_generated=1" "committed generated wasm"
assert_contains "$committed_generated_wasm_output" "RUN ts-test:" "committed generated wasm"
assert_not_contains "$committed_generated_wasm_output" "RUN rust-test-and-coverage:" "committed generated wasm"

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
assert_contains "$ci_workflow_output" "route: frontend=0 rust=0" "ci workflow"
assert_contains "$ci_workflow_output" "ci_workflow=1" "ci workflow"
assert_contains "$ci_workflow_output" "RUN ci-workflow-cache:" "ci workflow"
assert_contains "$ci_workflow_output" "RUN e2e-smoke-workflow-cache:" "ci workflow"
assert_contains "$ci_workflow_output" "RUN platform-smoke-canary-workflow-cache:" "ci workflow"
assert_contains "$ci_workflow_output" "RUN updater-sig-verify-tests:" "ci workflow"
assert_contains "$ci_workflow_output" "RUN auto-tag-release-workflow:" "ci workflow"
assert_not_contains "$ci_workflow_output" "RUN ts-test:" "ci workflow"
assert_not_contains "$ci_workflow_output" "RUN rust-test-and-coverage:" "ci workflow"

github_meta_output="$(run_case github-meta normal .github/dependabot.yml)"
assert_contains "$github_meta_output" "route: full" "github meta"
assert_contains "$github_meta_output" "RUN ts-test:" "github meta"
assert_contains "$github_meta_output" "RUN cargo-machete:" "github meta"

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
assert_contains "$unknown_output" "RUN cargo-machete:" "unknown"

mixed_unknown_source_output="$(run_case mixed-unknown-source normal src/App.tsx .prettierrc)"
assert_contains "$mixed_unknown_source_output" "route: full" "mixed unknown source"
assert_contains "$mixed_unknown_source_output" "RUN ts-test:" "mixed unknown source"
assert_contains "$mixed_unknown_source_output" "RUN cargo-machete:" "mixed unknown source"

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
