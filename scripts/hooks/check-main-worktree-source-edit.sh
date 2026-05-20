#!/usr/bin/env bash
# Block source/app edits from the primary worktree; no-op in linked worktrees.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT="${CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT:-$DEFAULT_ROOT}"
ROOT="$(cd "$ROOT" && pwd)"

COMMAND=""
PATH_ARGS=()

usage() {
	cat >&2 <<'EOF'
usage:
  check-main-worktree-source-edit.sh <path> [<path>...]
  check-main-worktree-source-edit.sh --command <bash-command>

In --command mode this is an obvious-write guard, not a shell parser. It looks
for common writes such as redirection, tee, sed/perl in-place edits, cp, and mv.
EOF
}

if [ "${1:-}" = "--help" ]; then
	usage
	exit 0
fi

if [ "${1:-}" = "--command" ]; then
	shift
	COMMAND="${1:-}"
	if [ -z "$COMMAND" ]; then
		exit 0
	fi
else
	PATH_ARGS=("$@")
fi

is_primary_worktree() {
	local git_dir
	git_dir="$(git -C "$ROOT" rev-parse --git-dir 2>/dev/null || true)"
	[ "$git_dir" = ".git" ] || [ "$git_dir" = "$ROOT/.git" ]
}

trim_token() {
	local value="$1"
	value="${value//$'\r'/}"
	value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

	while :; do
		case "$value" in
			\"*) value="${value#\"}" ;;
			\'*) value="${value#\'}" ;;
			*) break ;;
		esac
	done

	while :; do
		case "$value" in
			*\" | *\' | *\; | *, | *\) | *\])
				value="${value%?}"
				;;
			*)
				break
				;;
		esac
	done

	printf '%s\n' "$value"
}

normalize_path() {
	local path="$1"
	local is_absolute=0
	local parts=()
	local normalized=()
	local IFS='/'
	local part last_index joined

	case "$path" in
		/*) is_absolute=1 ;;
	esac

	read -r -a parts <<< "$path"

	for part in "${parts[@]}"; do
		case "$part" in
			"" | ".")
				continue
				;;
			"..")
				if [ "${#normalized[@]}" -gt 0 ]; then
					last_index=$((${#normalized[@]} - 1))
					unset "normalized[$last_index]"
				elif [ "$is_absolute" = "1" ]; then
					continue
				else
					return 1
				fi
				;;
			*)
				normalized+=("$part")
				;;
		esac
	done

	joined=""
	for part in "${normalized[@]}"; do
		if [ -z "$joined" ]; then
			joined="$part"
		else
			joined="$joined/$part"
		fi
	done

	if [ "$is_absolute" = "1" ]; then
		if [ -n "$joined" ]; then
			printf '/%s\n' "$joined"
		else
			printf '/\n'
		fi
	else
		printf '%s\n' "$joined"
	fi
}

relative_path() {
	local raw normalized_raw
	raw="$(trim_token "$1")"

	[ -n "$raw" ] || return 1
	case "$raw" in
		-* | '$'* | http://* | https://*)
			return 1
			;;
	esac

	case "$raw" in
		/*)
			normalized_raw="$(normalize_path "$raw")" || return 1
			;;
		*)
			normalized_raw="$(normalize_path "$ROOT/$raw")" || return 1
			;;
	esac

	case "$normalized_raw" in
		"$ROOT"/*)
			raw="${normalized_raw#$ROOT/}"
			;;
		*)
			return 1
			;;
	esac

	[ -n "$raw" ] || return 1
	printf '%s\n' "$raw"
}

is_orchestration_path() {
	local rel="$1"

	case "$rel" in
		AGENTS.md | *.md | memory/* | docs/* | scripts/* | .codex/*)
			return 0
			;;
		.claude/agents/* | .claude/hooks/* | .claude/rules/* | .claude/commands/* | .claude/settings.json)
			return 0
			;;
	esac

	return 1
}

is_linked_worktree_target_path() {
	local rel="$1"

	case "$rel" in
		worktrees | worktrees/*)
			return 0
			;;
	esac

	return 1
}

is_app_config_or_manifest_path() {
	local rel="$1"

	case "$rel" in
		package.json | */package.json | package-lock.json | */package-lock.json | npm-shrinkwrap.json | */npm-shrinkwrap.json)
			return 0
			;;
		pnpm-lock.yaml | */pnpm-lock.yaml | pnpm-workspace.yaml | yarn.lock | */yarn.lock | bun.lock | */bun.lock | bun.lockb | */bun.lockb)
			return 0
			;;
		components.json | */components.json)
			return 0
			;;
		Cargo.toml | */Cargo.toml | Cargo.lock | */Cargo.lock)
			return 0
			;;
		tsconfig.json | tsconfig.*.json | vite.config.* | vitest.config.* | eslint.config.* | .eslintrc | .eslintrc.*)
			return 0
			;;
		src-tauri/tauri.conf.json | src-tauri/tauri.*.conf.json | src-tauri/deny.toml)
			return 0
			;;
		src-tauri/capabilities/*.json | src-tauri/capabilities/*.toml | src-tauri/permissions/*.json | src-tauri/permissions/*.toml)
			return 0
			;;
	esac

	return 1
}

is_source_or_app_path() {
	local rel="$1"

	case "$rel" in
		src | src/* | src-tauri/src | src-tauri/src/* | e2e | e2e/* | tests | tests/* | test | test/*)
			return 0
			;;
		*.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.rs | *.css | *.scss | *.sass | *.less | *.html)
			return 0
			;;
		*.vue | *.svelte | *.py | *.go | *.java | *.kt | *.kts | *.swift | *.c | *.h | *.cc | *.cpp | *.cxx | *.hpp)
			return 0
			;;
		*.cs | *.rb | *.php)
			return 0
			;;
	esac

	return 1
}

deny_path() {
	local rel="$1"
	cat >&2 <<EOF
BLOCKED: source/app edit in primary worktree: $rel
Primary worktree is orchestration-only. Make implementation/review source edits from a linked worktree instead.
Create one with: bash scripts/worktree-spawn.sh <branch-name>
EOF
	exit 1
}

check_path() {
	local rel
	rel="$(relative_path "$1")" || return 0

	if is_linked_worktree_target_path "$rel"; then
		return 0
	fi

	if is_orchestration_path "$rel"; then
		return 0
	fi

	if is_app_config_or_manifest_path "$rel" || is_source_or_app_path "$rel"; then
		deny_path "$rel"
	fi
}

emit_path() {
	local value="$1"
	value="$(trim_token "$value")"
	[ -n "$value" ] || return 0
	printf '%s\n' "$value"
}

paths_from_patch_markers() {
	printf '%s\n' "$COMMAND" | sed -nE \
		-e 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p' \
		-e 's/^\*\*\* Move to: (.*)$/\1/p'
}

paths_from_command_tokens() {
	local cmd="$1"
	local old_opts
	old_opts="$(set +o)"
	set -f
	# shellcheck disable=SC2206
	local tokens=($cmd)
	eval "$old_opts"

	local word base expect_redir=0 mode="" last_dest="" sed_inplace=0 perl_inplace=0

	flush_last_dest() {
		if [ -n "$last_dest" ]; then
			emit_path "$last_dest"
			last_dest=""
		fi
	}

	reset_mode() {
		flush_last_dest
		mode=""
		sed_inplace=0
		perl_inplace=0
	}

	for word in "${tokens[@]}"; do
		word="$(trim_token "$word")"
		[ -n "$word" ] || continue

		case "$word" in
			"&&" | "||" | "|" | ";")
				reset_mode
				continue
				;;
		esac

		if [ "$expect_redir" = "1" ]; then
			emit_path "$word"
			expect_redir=0
			continue
		fi

		case "$word" in
			">" | ">>" | "1>" | "1>>" | "2>" | "2>>" | "&>")
				expect_redir=1
				continue
				;;
			*">"*)
				local after_redir="${word##*>}"
				if [ -n "$after_redir" ]; then
					emit_path "$after_redir"
				else
					expect_redir=1
				fi
				continue
				;;
		esac

		case "$word" in
			of=*)
				if [ "$mode" = "dd" ]; then
					emit_path "${word#of=}"
					continue
				fi
				;;
		esac

		base="${word##*/}"
		case "$base" in
			tee)
				reset_mode
				mode="tee"
				continue
				;;
			cp | install)
				reset_mode
				mode="last-dest"
				continue
				;;
			mv)
				reset_mode
				mode="all-targets"
				continue
				;;
			rm | touch | mkdir | truncate)
				reset_mode
				mode="all-targets"
				continue
				;;
			dd)
				reset_mode
				mode="dd"
				continue
				;;
			sed)
				reset_mode
				mode="sed"
				continue
				;;
			perl)
				reset_mode
				mode="perl"
				continue
				;;
		esac

		case "$mode" in
			tee)
				case "$word" in
					-*) ;;
					*) emit_path "$word" ;;
				esac
				;;
			last-dest)
				case "$word" in
					-*) ;;
					*) last_dest="$word" ;;
				esac
				;;
			all-targets)
				case "$word" in
					-*) ;;
					*) emit_path "$word" ;;
				esac
				;;
			sed)
				case "$word" in
					-i | -i*)
						sed_inplace=1
						;;
					-*)
						;;
					*)
						if [ "$sed_inplace" = "1" ]; then
							emit_path "$word"
						fi
						;;
				esac
				;;
			perl)
				case "$word" in
					*i*)
						case "$word" in
							-*) perl_inplace=1 ;;
						esac
						;;
				esac
				case "$word" in
					-*)
						;;
					*)
						if [ "$perl_inplace" = "1" ]; then
							emit_path "$word"
						fi
						;;
				esac
				;;
		esac
	done

	reset_mode
}

if ! is_primary_worktree; then
	exit 0
fi

if [ -n "$COMMAND" ]; then
	while IFS= read -r path; do
		[ -n "$path" ] || continue
		check_path "$path"
	done < <({ paths_from_patch_markers; paths_from_command_tokens "$COMMAND"; } | sort -u)
else
	for path in "${PATH_ARGS[@]}"; do
		check_path "$path"
	done
fi

exit 0
