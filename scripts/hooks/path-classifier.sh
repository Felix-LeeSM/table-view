#!/usr/bin/env bash
# Shared repository path classes for hook routing and primary-worktree guards.

is_docs_path() {
	case "$1" in
	docs/* | README.md | CHANGELOG.md | CLAUDE.md | AGENTS.md | *.md)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_hook_path() {
	case "$1" in
	.gitignore | lefthook.yml | .githooks/* | scripts/hooks/* | scripts/setup.sh | scripts/target-cache.sh | scripts/worktree-spawn.sh | scripts/worktree-cleanup.sh | scripts/worktree-bootstrap-deps.sh | scripts/prune-gh-caches.sh | scripts/check-coverage-ratchet.ts | scripts/coverage-ratchet-targets.json | src-tauri/.config/nextest.toml)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_workflow_path() {
	case "$1" in
	.github/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_ci_workflow_path() {
	case "$1" in
	.github/workflows/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

# Vitest-collected test files. Mirrors vitest's default `include`
# (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) in full — all 12 suffixes per prefix,
# including the `?(x)` forms of the `c`/`m` variants that an earlier list
# dropped — because vite.config.ts sets no `test.include`. Used to route the
# doc-contract drift guard: the event that stales the `test:doc-contracts` list
# is a NEW test that reads docs/, not a workflow edit.
#
# Boundary, measured 2026-07-27 against the tracked tree: 665 files match this
# glob, `vitest list --filesOnly` collects 638. The 27-file gap is
# `e2e/smoke/*.spec.ts`, which vite.config.ts drops via `test.exclude`
# (`e2e/**`, plus `node_modules/**`, `.claude/**`, `.codex/**`, `worktrees/**`).
# That over-match is deliberate: mirroring `exclude` here would add a second
# copy of a config list that can change, and routing a guard on 27 extra paths
# only costs a sub-second run — whereas under-matching would miss the very
# change the guard exists to catch. Reproduce:
#   git ls-files | rg -c '\.(test|spec)\.(c|m)?[jt]sx?$'
#   pnpm exec vitest list --filesOnly | rg -c '\.(test|spec)\.'
is_test_path() {
	case "$1" in
	*.test.ts | *.test.tsx | *.test.mts | *.test.mtsx | *.test.cts | *.test.ctsx | \
		*.test.js | *.test.jsx | *.test.mjs | *.test.mjsx | *.test.cjs | *.test.cjsx | \
		*.spec.ts | *.spec.tsx | *.spec.mts | *.spec.mtsx | *.spec.cts | *.spec.ctsx | \
		*.spec.js | *.spec.jsx | *.spec.mjs | *.spec.mjsx | *.spec.cjs | *.spec.cjsx)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

# Inputs the doc-contract drift guard reads besides the tests themselves: the
# list lives in package.json and the collection universe comes from the vitest
# config.
is_doc_contract_input_path() {
	case "$1" in
	package.json | vite.config.* | vitest.config.*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_agent_path() {
	case "$1" in
	.claude/* | .codex/* | .agents/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_memory_path() {
	case "$1" in
	memory/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_fixture_tooling_path() {
	case "$1" in
	scripts/fixtures/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_committed_generated_input_path() {
	case "$1" in
	src/lib/sql/wasm/* | src/lib/mongo/wasm/* | src-tauri/gen/* | src-tauri/icons/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_local_generated_path() {
	case "$1" in
	node_modules/* | dist/* | .vite/* | cargo-target/* | target/* | \
	src-tauri/target/* | src-tauri/sql-parser-core/target/* | \
	src-tauri/mongosh-parser-core/target/* | coverage/* | \
	test-results/* | wdio-report/* | e2e/wdio-report/* | tmp/* | \
	worktrees/* | .claude/worktrees/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_frontend_path() {
	case "$1" in
	src/* | src/**/* | e2e/* | e2e/**/* | tests/* | tests/**/* | public/* | public/**/* | index.html)
		return 0
		;;
	*.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.css)
		return 0
		;;
	package.json | pnpm-lock.yaml | package-lock.json | yarn.lock)
		return 0
		;;
	tsconfig.json | tsconfig.*.json | vite.config.* | vitest.config.* | eslint.config.* | wdio*.ts | tailwind.config.* | postcss.config.*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_rust_path() {
	case "$1" in
	src-tauri/* | src-tauri/**/* | Cargo.toml | Cargo.lock | **/Cargo.toml | **/Cargo.lock | **/deny.toml | *.rs)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_primary_orchestration_path() {
	case "$1" in
	AGENTS.md | memory/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

is_linked_worktree_target_path() {
	case "$1" in
	worktrees | worktrees/* | .claude/worktrees | .claude/worktrees/*)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

path_class_for_message() {
	local rel="$1"

	if is_linked_worktree_target_path "$rel"; then
		printf '%s\n' "linked-worktree"
	elif is_primary_orchestration_path "$rel"; then
		printf '%s\n' "primary-orchestration"
	elif is_hook_path "$rel"; then
		printf '%s\n' "hook"
	elif is_fixture_tooling_path "$rel"; then
		printf '%s\n' "fixture"
	elif is_memory_path "$rel"; then
		printf '%s\n' "memory"
	elif is_agent_path "$rel"; then
		printf '%s\n' "agent"
	elif is_ci_workflow_path "$rel"; then
		printf '%s\n' "ci-workflow"
	elif is_workflow_path "$rel"; then
		printf '%s\n' "workflow"
	elif is_docs_path "$rel"; then
		printf '%s\n' "docs"
	elif is_committed_generated_input_path "$rel"; then
		printf '%s\n' "committed-generated-input"
	elif is_local_generated_path "$rel"; then
		printf '%s\n' "local-generated"
	elif is_frontend_path "$rel" && is_rust_path "$rel"; then
		printf '%s\n' "frontend-rust-source"
	elif is_frontend_path "$rel"; then
		printf '%s\n' "frontend-source"
	elif is_rust_path "$rel"; then
		printf '%s\n' "rust-source"
	else
		printf '%s\n' "unknown"
	fi
}
