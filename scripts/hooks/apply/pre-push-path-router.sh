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
source "$SCRIPT_DIR/../analyze/path-classifier.sh"

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

detect_deletions() {
	# Any deletion (D) or rename (R) removes an old path, which can leave a
	# memory citation pointing at a path that no longer exists (issue #1032).
	local commit
	has_deletion=0
	while read -r commit; do
		[ -n "$commit" ] || continue
		if git diff-tree --root -m --no-commit-id --name-status -M -r "$commit" |
			grep -qE '^(D|R)'; then
			has_deletion=1
			return 0
		fi
	done <"$COMMITS_FILE"
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

run_ts_gates() {
	run_step "ts-typecheck" npx tsc --noEmit
	run_step "ts-lint" npm run lint
	run_step "ts-test" npm run test -- --run --coverage
}

run_rust_gates() {
	# Fast local Rust gates only. The heavy integration coverage gate
	# (`cargo llvm-cov nextest --profile push`, thresholds 80/75/80 + the
	# instrumented build and MySQL/MSSQL/Redis testcontainers) was promoted to
	# CI `Integration Tests (Docker)` on 2026-07-03 (audit #6) so a required
	# remote check owns the floor instead of the dev machine's hook. pre-commit
	# still runs the fast lib-only Tier1 coverage for immediate local feedback.
	run_step_in "tauri-check" src-tauri cargo check
	run_cargo_deny
	run_step_in "cargo-machete" src-tauri cargo machete
}

run_hook_gates() {
	# Every layer, not a hand-kept list. The flat glob `scripts/hooks/*.sh` stopped
	# reaching the checks once they moved into subdirectories — it matched only the
	# 10 compatibility shims, leaving 47 of 68 hook scripts unparsed. A per-layer
	# glob would rot the same way the next time a directory is added, so the file
	# list comes from git.
	# One `bash -n` per file, in a loop. `bash -n a.sh b.sh` parses ONLY a.sh and
	# passes the rest as positional parameters, so this step had been checking
	# `.githooks/pre-push` alone and reporting green for every other file for as
	# long as it existed — proven by appending `if [ 1` to a check script and
	# watching the multi-argument form still exit 0.
	#
	# The file list comes from git rather than a glob: `scripts/hooks/*.sh` stopped
	# reaching the checks when they moved into subdirectories (it matched only the
	# 10 compatibility shims), and a hand-kept per-layer glob would rot the same
	# way the next time a directory is added.
	run_step "hook-shell-syntax" bash -c '
		set -u
		status=0
		count=0
		while IFS= read -r f; do
			[ -n "$f" ] || continue
			count=$((count + 1))
			bash -n "$f" || status=1
		done <<EOF
$(git ls-files "scripts/hooks/*.sh" "scripts/hooks/**/*.sh")
.githooks/pre-push
.githooks/pre-commit
.githooks/commit-msg
scripts/setup.sh
scripts/target-cache.sh
scripts/worktree-spawn.sh
scripts/worktree-cleanup.sh
scripts/worktree-bootstrap-deps.sh
scripts/prune-gh-caches.sh
EOF
		# A silently shrinking list would report green forever. A fixed floor left
		# slack — 60 against 77 actual meant a whole layer could vanish unnoticed —
		# so compare against the live count instead: the tracked hook scripts plus
		# the 9 fixed entries listed above.
		expected=$(( $(git ls-files "scripts/hooks/*.sh" "scripts/hooks/**/*.sh" | wc -l) + 9 ))
		[ "$count" -eq "$expected" ] || {
			echo "hook-shell-syntax: checked $count files, expected $expected" >&2
			status=1
		}
		exit $status
	'
	run_step "detect-change-scope" bash scripts/hooks/analyze/test-detect-change-scope.sh
	# The PreToolUse guard suites ran nowhere before this: not here, not in CI.
	# `bash -n` above proved they parse, which is why 161 assertions could sit
	# green against a guard that denied 95% of the orchestration it inspected.
	# ~13s total, and only when a hook path is in the push.
	run_step "write-target-analyzer-tests" bash scripts/hooks/analyze/test-bash-write-targets.sh
	run_step "main-worktree-guard-tests" bash scripts/hooks/policy/test-check-main-worktree-source-edit.sh
	run_step "edit-policy-tests" bash scripts/hooks/apply/test-check-edit-policy.sh
	run_step "dangerous-bash-tests" bash scripts/hooks/policy/test-check-dangerous-bash.sh
	run_step "pre-tool-use-wrapper-tests" bash scripts/hooks/apply/test-pre-tool-use-wrapper.sh
	run_step "post-tool-use-dispatcher-tests" bash scripts/hooks/apply/test-post-tool-use.sh
	run_step "surface-rules-analyzer-tests" bash scripts/hooks/analyze/test-surface-rules.sh
	run_step "worktree-bootstrap-tests" bash scripts/hooks/policy/test-check-worktree-bootstrap.sh
	run_step "lefthook-validate" lefthook validate
	run_step_in "nextest-push-profile-config" src-tauri cargo nextest --no-pager show-config version --profile push
	run_step "coverage-ratchet-tests" bash scripts/hooks/policy/test-coverage-ratchet.sh
	run_step "target-cache-tests" bash scripts/hooks/policy/test-target-cache.sh
	run_step "generated-fence-tests" bash scripts/hooks/policy/test-generated-fences.sh
	run_step "pr-body-contract-tests" bash scripts/hooks/policy/test-check-pr-body.sh
	run_step "cargo-deny-summary-tests" bash scripts/hooks/apply/test-cargo-deny-summary.sh
	run_step "pre-push-router-tests" bash scripts/hooks/apply/test-pre-push-path-router.sh
	run_step "memory-size-tests" bash scripts/hooks/policy/test-check-memory-size.sh
	run_step "doc-size-tests" bash scripts/hooks/policy/test-check-doc-size.sh
}

run_ci_workflow_gates() {
	run_step "ci-workflow-cache" bash scripts/hooks/policy/test-ci-workflow-cache.sh
	run_step "e2e-smoke-workflow-cache" bash scripts/hooks/policy/test-e2e-smoke-workflow.sh
	run_step "platform-smoke-canary-workflow-cache" bash scripts/hooks/policy/test-platform-smoke-canary-workflow.sh
	run_step "homebrew-cask-workflow" bash scripts/hooks/policy/test-homebrew-cask-workflow.sh
	run_step "release-workflow" bash scripts/hooks/policy/test-release-workflow.sh
	run_step "updater-sig-verify-tests" bash scripts/hooks/policy/test-verify-updater-sigs.sh
	run_step "latest-json-verify-tests" bash scripts/hooks/policy/test-verify-latest-json.sh
	run_step "tag-version-verify-tests" bash scripts/hooks/policy/test-verify-tag-version.sh
	run_step "auto-tag-release-workflow" bash scripts/hooks/policy/test-auto-tag-release-workflow.sh
}

run_memory_gates() {
	run_step "memory-structure" bash scripts/hooks/policy/check-memory-structure.sh --strict
	run_step "memory-size" bash scripts/hooks/policy/check-memory-size.sh --strict
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
detect_deletions

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

run_step "signed-commits" bash scripts/hooks/policy/check-signed-commits.sh <"$REFS_FILE"
run_step "coverage-ratchet" npx tsx scripts/check-coverage-ratchet.ts

# Reverse code->memory gate: run when memory changed or any path was removed,
# since a deletion/rename can stale a memory path citation (issue #1032).
if [ "$needs_memory" = "1" ] || [ "$has_deletion" = "1" ]; then
	run_step "memory-paths" npx tsx scripts/check-memory-paths.ts
fi

# AGENTS.md matrix coverage gate (issue #1755): a memory change can push a room
# over the high-reference threshold, and an AGENTS.md edit can drop a matrix row.
# Run on either trigger. AGENTS.md classifies as a docs path (not agent), so key
# off the outgoing path set directly rather than a route flag.
if [ "$needs_memory" = "1" ] || grep -qxF "AGENTS.md" "$PATHS_FILE"; then
	run_step "agents-matrix" npx tsx scripts/check-agents-matrix-coverage.ts
fi

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

run_step "check-tdd-cycle" bash scripts/hooks/policy/check-tdd-cycle.sh
