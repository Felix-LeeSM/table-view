#!/usr/bin/env bash
# Path-sensitive pre-push gate router.
#
# The hook reads Git's pre-push refs from stdin, derives the outgoing changed
# paths, and runs only the checks that match those paths. Signed-commit and TDD
# cycle gates always run. Root-local generated/cache/tmp/worktree paths are
# explicit non-source surfaces and do not trigger frontend/Rust gates.

set -euo pipefail

ZERO_OID="0000000000000000000000000000000000000000"
DRY_RUN="${PRE_PUSH_PATH_ROUTER_DRY_RUN:-0}"
HEARTBEAT_SECONDS="${PRE_PUSH_PATH_ROUTER_HEARTBEAT_SECONDS:-15}"
LOG_TAIL_LINES="${PRE_PUSH_PATH_ROUTER_LOG_TAIL_LINES:-80}"
PARALLEL_GATES="${PRE_PUSH_PATH_ROUTER_PARALLEL_GATES:-1}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/path-classifier.sh"

REFS_FILE="$(mktemp "${TMPDIR:-/tmp}/pre-push-refs.XXXXXX")"
COMMITS_FILE="$(mktemp "${TMPDIR:-/tmp}/pre-push-commits.XXXXXX")"
PATHS_FILE="$(mktemp "${TMPDIR:-/tmp}/pre-push-paths.XXXXXX")"
trap 'rm -f "$REFS_FILE" "$COMMITS_FILE" "$PATHS_FILE"' EXIT

duration_since() {
	local start="$1"
	local now
	now="$(date +%s)"
	printf '%s\n' "$((now - start))"
}

run_with_heartbeat() {
	local label="$1"
	shift
	local log_file pid status start elapsed next_heartbeat

	log_file="$(mktemp "${TMPDIR:-/tmp}/pre-push-${label}.XXXXXX")"
	start="$(date +%s)"
	next_heartbeat="$HEARTBEAT_SECONDS"
	echo "[pre-push-route] $label start"

	("$@") >"$log_file" 2>&1 &
	pid=$!
	while kill -0 "$pid" 2>/dev/null; do
		sleep 0.2
		elapsed="$(duration_since "$start")"
		if [ "$elapsed" -ge "$next_heartbeat" ]; then
			echo "[pre-push-route] $label running elapsed=${elapsed}s"
			next_heartbeat="$((next_heartbeat + HEARTBEAT_SECONDS))"
		fi
	done

	set +e
	wait "$pid"
	status=$?
	set -e
	elapsed="$(duration_since "$start")"

	if [ "$status" -eq 0 ]; then
		echo "[pre-push-route] $label pass duration=${elapsed}s"
		rm -f "$log_file"
		return 0
	fi

	echo "[pre-push-route] $label fail duration=${elapsed}s log=$log_file" >&2
	tail -n "$LOG_TAIL_LINES" "$log_file" >&2 || true
	rm -f "$log_file"
	return "$status"
}

if [ -t 0 ]; then
	: >"$REFS_FILE"
else
	cat >"$REFS_FILE"
fi
: >"$COMMITS_FILE"
: >"$PATHS_FILE"

append_commits_for_range() {
	local local_oid="$1"
	local remote_oid="$2"

	if [ "$local_oid" = "$ZERO_OID" ]; then
		return 0
	fi
	if ! git cat-file -e "${local_oid}^{commit}" 2>/dev/null; then
		return 0
	fi

	if [ "$remote_oid" = "$ZERO_OID" ]; then
		git rev-list "$local_oid" --not --remotes=origin >>"$COMMITS_FILE"
	else
		git rev-list "${remote_oid}..${local_oid}" >>"$COMMITS_FILE"
	fi
}

fallback_current_branch() {
	local upstream

	upstream="$(git rev-parse --verify --quiet '@{u}' 2>/dev/null || true)"
	if [ -n "$upstream" ]; then
		git rev-list "${upstream}..HEAD" >>"$COMMITS_FILE"
	else
		git rev-list HEAD --not --remotes=origin >>"$COMMITS_FILE"
	fi
}

collect_commits() {
	local saw_input=0
	local local_ref local_oid remote_ref remote_oid

	while read -r local_ref local_oid remote_ref remote_oid; do
		[ -n "${local_ref:-}" ] || continue
		saw_input=1
		append_commits_for_range "$local_oid" "$remote_oid"
	done <"$REFS_FILE"

	if [ "$saw_input" = "0" ]; then
		fallback_current_branch
	fi

	if [ -s "$COMMITS_FILE" ]; then
		sort -u "$COMMITS_FILE" -o "$COMMITS_FILE"
	fi
}

collect_paths() {
	local commit

	while read -r commit; do
		[ -n "$commit" ] || continue
		git diff-tree --root -m --no-commit-id --name-status -M -r "$commit"
	done <"$COMMITS_FILE" | while IFS=$'\t' read -r status path_a path_b; do
		[ -n "${status:-}" ] || continue
		case "$status" in
		R* | C*)
			[ -n "${path_a:-}" ] && printf '%s\n' "$path_a"
			[ -n "${path_b:-}" ] && printf '%s\n' "$path_b"
			;;
		*)
			[ -n "${path_a:-}" ] && printf '%s\n' "$path_a"
			;;
		esac
	done | sort -u >"$PATHS_FILE"
}

run_step() {
	local label="$1"
	shift

	if [ "$DRY_RUN" = "1" ]; then
		printf 'RUN %s:' "$label"
		printf ' %q' "$@"
		printf '\n'
		return 0
	fi

	run_with_heartbeat "$label" "$@"
}

run_step_in() {
	local label="$1"
	local dir="$2"
	shift 2

	if [ "$DRY_RUN" = "1" ]; then
		printf 'RUN %s: (cd %q &&' "$label" "$dir"
		printf ' %q' "$@"
		printf ')\n'
		return 0
	fi

	(cd "$dir" && run_with_heartbeat "$label" "$@")
}

run_cargo_deny() {
	if [ "$DRY_RUN" = "1" ]; then
		echo "RUN cargo-deny: unset git-local-env && (cd src-tauri && cargo deny check)"
		return 0
	fi

	local git_env_vars
	git_env_vars="$(git rev-parse --local-env-vars)"
	(
		# Intentionally split Git's newline-separated env var names for unset.
		# shellcheck disable=SC2086
		unset $git_env_vars
		cd src-tauri && run_with_heartbeat "cargo-deny" cargo deny check
	)
}

run_rust_coverage() {
	if [ "$DRY_RUN" = "1" ]; then
		echo "RUN rust-test-and-coverage: rustup component check && (cd src-tauri && cargo llvm-cov nextest --profile push --lib --test storage_integration --test query_integration --test schema_integration --test fixture_loading --test mongo_integration --test mysql_integration --test duckdb_file_analytics --test mariadb_ddl_preview --test mssql_connection_routing --summary-only --fail-under-lines 80 --fail-under-functions 75 --fail-under-regions 80)"
		return 0
	fi

	if ! rustup component list --installed 2>/dev/null | grep -q '^llvm-tools'; then
		echo "ERROR: rustup llvm-tools-preview component is missing." >&2
		echo "       Run 'bash scripts/setup.sh' and retry." >&2
		exit 1
	fi
	if ! command -v cargo-nextest >/dev/null 2>&1; then
		echo "ERROR: cargo-nextest is missing." >&2
		echo "       Run 'bash scripts/setup.sh' and retry." >&2
		exit 1
	fi
	(
		cd src-tauri
		run_with_heartbeat "rust-test-and-coverage" cargo llvm-cov nextest --profile push --lib \
			--test storage_integration \
			--test query_integration \
			--test schema_integration \
			--test fixture_loading \
			--test mongo_integration \
			--test mysql_integration \
			--test duckdb_file_analytics \
			--test mariadb_ddl_preview \
			--test mssql_connection_routing \
			--summary-only \
			--fail-under-lines 80 \
			--fail-under-functions 75 \
			--fail-under-regions 80
	)
}

run_ts_gates() {
	run_step "ts-typecheck" npx tsc --noEmit
	run_step "ts-lint" npm run lint
	run_step "ts-test" npm run test -- --run --coverage
}

run_rust_gates() {
	run_step_in "tauri-check" src-tauri cargo check
	run_cargo_deny
	run_step_in "cargo-machete" src-tauri cargo machete
	run_rust_coverage
}

run_hook_gates() {
	run_step "hook-shell-syntax" bash -n .githooks/pre-push scripts/hooks/*.sh scripts/hooks/lib/*.sh scripts/setup.sh scripts/target-cache.sh scripts/worktree-spawn.sh scripts/worktree-cleanup.sh scripts/worktree-bootstrap-deps.sh
	run_step "lefthook-validate" lefthook validate
	run_step_in "nextest-push-profile-config" src-tauri cargo nextest --no-pager show-config version --profile push
	run_step "coverage-ratchet-tests" bash scripts/hooks/test-coverage-ratchet.sh
	run_step "target-cache-tests" bash scripts/hooks/test-target-cache.sh
	run_step "generated-fence-tests" bash scripts/hooks/test-generated-fences.sh
	run_step "pr-body-contract-tests" bash scripts/hooks/test-check-pr-body.sh
	run_step "cargo-deny-summary-tests" bash scripts/hooks/test-cargo-deny-summary.sh
	run_step "pre-push-router-tests" bash scripts/hooks/test-pre-push-path-router.sh
	run_step "memory-size-tests" bash scripts/hooks/test-check-memory-size.sh
	run_step "doc-size-tests" bash scripts/hooks/test-check-doc-size.sh
}

run_ci_workflow_gates() {
	run_step "ci-workflow-cache" bash scripts/hooks/test-ci-workflow-cache.sh
	run_step "e2e-smoke-workflow-cache" bash scripts/hooks/test-e2e-smoke-workflow.sh
	run_step "platform-smoke-canary-workflow-cache" bash scripts/hooks/test-platform-smoke-canary-workflow.sh
	run_step "homebrew-cask-workflow" bash scripts/hooks/test-homebrew-cask-workflow.sh
}

run_memory_gates() {
	run_step "memory-structure" bash scripts/hooks/check-memory-structure.sh --strict
	run_step "memory-size" bash scripts/hooks/check-memory-size.sh --strict
}

run_frontend_and_rust_gates() {
	if [ "$needs_frontend" = "1" ] && [ "$needs_rust" = "1" ]; then
		if [ "$PARALLEL_GATES" != "1" ]; then
			if [ "$DRY_RUN" = "1" ]; then
				echo "RUN sequential: frontend then rust"
			else
				echo "[pre-push-route] sequential: frontend then rust"
			fi
			run_ts_gates
			run_rust_gates
			return 0
		fi

		if [ "$DRY_RUN" = "1" ]; then
			echo "RUN parallel: frontend+rust"
			run_ts_gates
			run_rust_gates
			return 0
		fi

		local ts_pid rust_pid ts_status rust_status
		echo "[pre-push-route] parallel: frontend+rust"
		(run_ts_gates) &
		ts_pid=$!
		(run_rust_gates) &
		rust_pid=$!

		set +e
		wait "$ts_pid"
		ts_status=$?
		wait "$rust_pid"
		rust_status=$?
		set -e

		if [ "$ts_status" -ne 0 ]; then
			echo "[pre-push-route] frontend gates failed" >&2
		else
			echo "[pre-push-route] frontend gates passed"
		fi
		if [ "$rust_status" -ne 0 ]; then
			echo "[pre-push-route] rust gates failed" >&2
		else
			echo "[pre-push-route] rust gates passed"
		fi
		if [ "$ts_status" -ne 0 ] || [ "$rust_status" -ne 0 ]; then
			exit 1
		fi
		return 0
	fi

	if [ "$needs_frontend" = "1" ]; then
		run_ts_gates
	fi
	if [ "$needs_rust" = "1" ]; then
		run_rust_gates
	fi
}

collect_commits
collect_paths

has_paths=0
docs_only=1
needs_frontend=0
needs_rust=0
needs_hook=0
needs_memory=0
needs_agent=0
needs_ci_workflow=0
needs_generated=0
needs_fixture=0
needs_committed_generated=0
needs_full=0

while read -r path; do
	[ -n "$path" ] || continue
	has_paths=1

	if ! is_docs_path "$path"; then
		docs_only=0
	fi
	if is_hook_path "$path"; then
		docs_only=0
		needs_hook=1
		continue
	fi
	if is_memory_path "$path"; then
		docs_only=0
		needs_memory=1
		continue
	fi
	if is_local_generated_path "$path"; then
		docs_only=0
		needs_generated=1
		continue
	fi
	if is_fixture_tooling_path "$path"; then
		docs_only=0
		needs_fixture=1
	fi
	if is_committed_generated_input_path "$path"; then
		docs_only=0
		needs_committed_generated=1
	fi
	if is_agent_path "$path"; then
		docs_only=0
		needs_agent=1
		continue
	fi
	if is_ci_workflow_path "$path"; then
		docs_only=0
		needs_ci_workflow=1
		continue
	fi
	if is_workflow_path "$path"; then
		docs_only=0
		needs_full=1
	fi
	if is_frontend_path "$path"; then
		needs_frontend=1
	fi
	if is_rust_path "$path"; then
		needs_rust=1
	fi
	if ! is_docs_path "$path" && ! is_hook_path "$path" && ! is_agent_path "$path" && ! is_memory_path "$path" && ! is_workflow_path "$path" && ! is_fixture_tooling_path "$path" && ! is_committed_generated_input_path "$path" && ! is_frontend_path "$path" && ! is_rust_path "$path"; then
		needs_full=1
	fi
done <"$PATHS_FILE"

if [ "$has_paths" = "0" ]; then
	docs_only=0
fi

run_step "signed-commits" bash scripts/hooks/check-signed-commits.sh <"$REFS_FILE"
run_step "coverage-ratchet" npx tsx scripts/check-coverage-ratchet.ts

if [ "$has_paths" = "0" ]; then
	echo "[pre-push-route] route: no outgoing path changes; skipping TS/Rust gates"
elif [ "$docs_only" = "1" ]; then
	echo "[pre-push-route] route: docs-only; skipping TS/Rust gates"
else
	if [ "$needs_full" = "1" ]; then
		needs_frontend=1
		needs_rust=1
		echo "[pre-push-route] route: full (workflow or unknown path)"
	else
		echo "[pre-push-route] route: frontend=$needs_frontend rust=$needs_rust hook=$needs_hook memory=$needs_memory agent=$needs_agent generated=$needs_generated ci_workflow=$needs_ci_workflow fixture=$needs_fixture committed_generated=$needs_committed_generated"
	fi

	if [ "$needs_hook" = "1" ]; then
		run_hook_gates
	fi
	if [ "$needs_memory" = "1" ]; then
		run_memory_gates
	fi
	if [ "$needs_ci_workflow" = "1" ]; then
		run_ci_workflow_gates
	fi
	run_frontend_and_rust_gates
fi

run_step "check-tdd-cycle" bash scripts/hooks/check-tdd-cycle.sh
