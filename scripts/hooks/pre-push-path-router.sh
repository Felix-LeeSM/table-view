#!/usr/bin/env bash
# Path-sensitive pre-push gate router.
#
# The hook reads Git's pre-push refs from stdin, derives the outgoing changed
# paths, and runs only the checks that match those paths. Signed-commit and TDD
# cycle gates always run.

set -euo pipefail

ZERO_OID="0000000000000000000000000000000000000000"
DRY_RUN="${PRE_PUSH_PATH_ROUTER_DRY_RUN:-0}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

REFS_FILE="$(mktemp "${TMPDIR:-/tmp}/pre-push-refs.XXXXXX")"
COMMITS_FILE="$(mktemp "${TMPDIR:-/tmp}/pre-push-commits.XXXXXX")"
PATHS_FILE="$(mktemp "${TMPDIR:-/tmp}/pre-push-paths.XXXXXX")"
trap 'rm -f "$REFS_FILE" "$COMMITS_FILE" "$PATHS_FILE"' EXIT

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

is_workflow_path() {
	case "$1" in
	lefthook.yml | .githooks/* | scripts/hooks/* | .github/* | .claude/* | .codex/* | memory/*)
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

run_step() {
	local label="$1"
	shift

	if [ "$DRY_RUN" = "1" ]; then
		printf 'RUN %s:' "$label"
		printf ' %q' "$@"
		printf '\n'
		return 0
	fi

	echo "[pre-push-route] $label"
	"$@"
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

	echo "[pre-push-route] $label"
	(cd "$dir" && "$@")
}

run_cargo_deny() {
	if [ "$DRY_RUN" = "1" ]; then
		echo "RUN cargo-deny: unset git-local-env && (cd src-tauri && cargo deny check)"
		return 0
	fi

	echo "[pre-push-route] cargo-deny"
	local git_env_vars
	git_env_vars="$(git rev-parse --local-env-vars)"
	(
		# Intentionally split Git's newline-separated env var names for unset.
		# shellcheck disable=SC2086
		unset $git_env_vars
		cd src-tauri && cargo deny check
	)
}

run_rust_coverage() {
	if [ "$DRY_RUN" = "1" ]; then
		echo "RUN rust-test-and-coverage: rustup component check && (cd src-tauri && cargo llvm-cov --lib --test storage_integration --test query_integration --test schema_integration --test fixture_loading --test mongo_integration --test mysql_integration --test duckdb_file_analytics --test mariadb_ddl_preview --summary-only --fail-under-lines 79 --fail-under-functions 74 --fail-under-regions 80)"
		return 0
	fi

	echo "[pre-push-route] rust-test-and-coverage"
	if ! rustup component list --installed 2>/dev/null | grep -q '^llvm-tools'; then
		echo "ERROR: rustup llvm-tools-preview component is missing." >&2
		echo "       Run 'bash scripts/setup.sh' and retry." >&2
		exit 1
	fi
	(
		cd src-tauri
		cargo llvm-cov --lib \
			--test storage_integration \
			--test query_integration \
			--test schema_integration \
			--test fixture_loading \
			--test mongo_integration \
			--test mysql_integration \
			--test duckdb_file_analytics \
			--test mariadb_ddl_preview \
			--summary-only \
			--fail-under-lines 79 \
			--fail-under-functions 74 \
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

run_frontend_and_rust_gates() {
	if [ "$needs_frontend" = "1" ] && [ "$needs_rust" = "1" ]; then
		if [ "$DRY_RUN" = "1" ]; then
			echo "RUN parallel: frontend+rust"
			run_ts_gates
			run_rust_gates
			return 0
		fi

		local ts_log rust_log ts_pid rust_pid ts_status rust_status
		ts_log="$(mktemp "${TMPDIR:-/tmp}/pre-push-ts.XXXXXX")"
		rust_log="$(mktemp "${TMPDIR:-/tmp}/pre-push-rust.XXXXXX")"
		trap 'rm -f "$REFS_FILE" "$COMMITS_FILE" "$PATHS_FILE" "${ts_log:-}" "${rust_log:-}"' EXIT

		echo "[pre-push-route] parallel: frontend+rust"
		(run_ts_gates) >"$ts_log" 2>&1 &
		ts_pid=$!
		(run_rust_gates) >"$rust_log" 2>&1 &
		rust_pid=$!

		set +e
		wait "$ts_pid"
		ts_status=$?
		wait "$rust_pid"
		rust_status=$?
		set -e

		if [ "$ts_status" -ne 0 ]; then
			echo "[pre-push-route] frontend gates failed" >&2
			cat "$ts_log" >&2
		else
			echo "[pre-push-route] frontend gates passed"
		fi
		if [ "$rust_status" -ne 0 ]; then
			echo "[pre-push-route] rust gates failed" >&2
			cat "$rust_log" >&2
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
needs_full=0

while read -r path; do
	[ -n "$path" ] || continue
	has_paths=1

	if ! is_docs_path "$path"; then
		docs_only=0
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
	if ! is_docs_path "$path" && ! is_workflow_path "$path" && ! is_frontend_path "$path" && ! is_rust_path "$path"; then
		needs_full=1
	fi
done <"$PATHS_FILE"

if [ "$has_paths" = "0" ]; then
	docs_only=0
fi

run_step "signed-commits" bash scripts/hooks/check-signed-commits.sh <"$REFS_FILE"

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
		echo "[pre-push-route] route: frontend=$needs_frontend rust=$needs_rust"
	fi

	run_frontend_and_rust_gates
fi

run_step "check-tdd-cycle" bash scripts/hooks/check-tdd-cycle.sh
