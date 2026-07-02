#!/usr/bin/env bash
# Block non-orchestration edits from the primary worktree; no-op in linked worktrees.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT="${CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT:-$DEFAULT_ROOT}"
ROOT="$(cd "$ROOT" && pwd)"
source "$SCRIPT_DIR/path-classifier.sh"

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
	for part in "${normalized[@]-}"; do
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

deny_path() {
	local rel="$1"
	local path_class
	path_class="$(path_class_for_message "$rel")"
	cat >&2 <<EOF
BLOCKED: non-orchestration edit in primary worktree: $rel (class: $path_class)
Primary worktree is orchestration-only. Make repo edits from a linked worktree instead.
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

	if is_primary_orchestration_path "$rel"; then
		return 0
	fi

	deny_path "$rel"
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

is_patch_payload() {
	awk '
		/^[[:space:]]*$/ { next }
		{
			if (first == "") first = $0
			last = $0
			if ($0 ~ /^\*\*\* (Add|Update|Delete) File: /) file_marker = 1
		}
		END {
			exit !(first == "*** Begin Patch" && last == "*** End Patch" && file_marker)
		}
	' <<< "$COMMAND"
}

paths_from_command_tokens() {
	local cmd="$1"
	local old_opts
	old_opts="$(set +o)"
	set -f
	# shellcheck disable=SC2206
	local tokens=($cmd)
	eval "$old_opts"

	local word raw_word base expect_redir=0 mode="" last_dest="" sed_inplace=0 perl_inplace=0

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

	for raw_word in "${tokens[@]}"; do
		word="$(trim_token "$raw_word")"
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

		# A raw token that begins with a quote is a literal string argument (e.g. a
		# grep pattern like '>&' or "2>&1"), never a shell redirect operator.
		# trim_token strips the quotes, so classify redirects only for unquoted raw
		# tokens; otherwise a quoted `>&`/`>` would wrongly consume the next token
		# as a write target. Quoted redirect TARGETS are still caught via the
		# expect_redir branch above (the operator token there is unquoted).
		case "$raw_word" in
			\"* | \'*) ;;
			*)
				case "$word" in
					">" | ">>" | "1>" | "1>>" | "2>" | "2>>" | "&>")
						expect_redir=1
						continue
						;;
					*">"*)
						local after_redir="${word##*>}"
						case "$after_redir" in
							# FD close (2>&-, >&-): not a file path.
							\&-)
								continue
								;;
							# Bare `>&` — the write target is the next token (`>& file`).
							\&)
								expect_redir=1
								continue
								;;
							# `>&N` / `N>&M`: FD duplication only when the word after `&`
							# is ALL digits. `>&word` with any non-digit char is a real
							# stdout+stderr file write (bash: `>&word` == `>word 2>&1`),
							# so fall through to emit_path and keep it blocked (fail-safe).
							\&*)
								local fd_dup_target="${after_redir#&}"
								case "$fd_dup_target" in
									'' | *[!0-9]*) : ;;
									*) continue ;;
								esac
								;;
						esac
						if [ -n "$after_redir" ]; then
							emit_path "$after_redir"
						else
							expect_redir=1
						fi
						continue
						;;
				esac
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
			mv | rm | touch | mkdir | truncate)
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
	if is_patch_payload; then
		while IFS= read -r path; do
			[ -n "$path" ] || continue
			check_path "$path"
		done < <(paths_from_patch_markers | sort -u)
		exit 0
	fi

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
