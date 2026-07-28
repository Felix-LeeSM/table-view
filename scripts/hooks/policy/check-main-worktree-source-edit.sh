#!/usr/bin/env bash
# Policy: block non-orchestration edits from the primary worktree; no-op in
# linked worktrees.
#
# Layer boundary. Reading a bash command for write targets is NOT done here —
# `analyze/bash-write-targets.sh` answers "which paths does this write?" with no
# knowledge of this repository, and this file answers "may that path be written
# from here?" with no knowledge of shell syntax. Most of the denials this guard
# used to produce were analyzer defects wearing a policy message; of 293 replayed,
# 273 were released by fixing the reader and the remainder include real blocks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ROOT="${CHECK_MAIN_WORKTREE_SOURCE_EDIT_ROOT:-$DEFAULT_ROOT}"
ROOT="$(cd "$ROOT" && pwd)"
source "$SCRIPT_DIR/../analyze/path-classifier.sh"
# A command inspected by this guard starts in the repository root.
BASH_WRITE_TARGETS_CWD="$ROOT"
source "$SCRIPT_DIR/../analyze/bash-write-targets.sh"

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


relative_path() {
	local raw normalized_raw
	raw="$(trim_token "$1")"

	[ -n "$raw" ] || return 1
	case "$raw" in
		-* | '$'* | http://* | https://*)
			return 1
			;;
	esac

	# Tilde expansion, scoped to exactly what a shell would expand.
	#
	# In --command mode the tokenizer sees the token BEFORE the shell expands it,
	# so `~/x` was joined onto $ROOT (`$ROOT/~/x`), landed inside the repo and
	# blocked home-directory maintenance from the primary worktree (issue #1797).
	# Expanding (rather than skipping every `~` token) keeps the repo covered when
	# it lives under $HOME: `~/<repo>/src/App.tsx` still resolves back into the
	# repo and stays blocked.
	#
	# No tilde handling here: this resolves a path, it does not interpret shell
	# syntax. `~` is a SHELL construct, so it is resolved in the shell-token
	# pipeline (paths_from_command_tokens / emit_path) and everything arriving
	# here — Edit/Write tool paths, apply_patch markers — is already literal.
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

# Does this resolved token name a real place in the repository?
#
# `--command` mode is an approximate shell reader, not a parser (see usage()),
# so besides real write targets it emits fragments that are not paths at all:
# `2>&1|tail` yields the token `&1|tail`, `sed 's/a/b/'` yields the substitution
# expression, and heredoc/prose words leak through. relative_path() will happily
# join ANY such string onto $ROOT, after which path_class_for_message() labels it
# from its extension alone — `&1|tail` was denied as `unknown`, `foo.mjs` created
# under some other directory as `frontend-source`.
#
# Measured over 293 recorded denials: 258 named something that exists nowhere in
# the repository, 35 named a tracked file or a new file inside a real repository
# directory. Gating on that distinction is what separates a write from a
# tokenizer artifact — a string that resolves to no repo location cannot be an
# edit to this repository, whatever its extension looks like.
#
# Deliberately NOT a `git ls-files` check: a brand-new file is still a repo edit,
# and the guard must stay usable before the file exists.
is_repo_location() {
	local rel="$1"

	# A literal (shell-unexpanded) `~` token keeps the conservative ceiling from
	# issues #1797 / #1858 — `<repo>/~/...` and `~name/...` stay blocked there by
	# design, and that decision is not re-litigated here. Costs nothing: an
	# UNEXPANDED `~/...` is expanded upstream in emit_path() and lands outside
	# $ROOT, so it never reaches this function.
	case "$rel" in
		'~'*)
			return 0
			;;
	esac

	# Already on disk (tracked file, untracked file, or directory).
	if [ -e "$ROOT/$rel" ]; then
		return 0
	fi

	# A directory the SAME command creates counts as existing. Checking the disk
	# alone let `mkdir -p a/b && echo pwn > a/b/x.ts` through: at hook time `a/b`
	# does not exist yet, so the target read as an artifact — but by the time the
	# redirect runs, `mkdir` has made it real and the file lands in the repo.
	case " $CREATED_DIRS " in
		*" ${rel%/*} "*) return 0 ;;
	esac

	# Not on disk yet. A new file is still a repo edit when the directory that
	# would hold it exists; when it does not, nothing can be written there, so the
	# token is prose or an expression that merely looks like a path —
	# `s/Smoke-Test-Plan:/.../`, a heredoc sentence, a `python -c` body.
	#
	# A bare word (no directory part) stays BLOCKED: with CMD_CWD tracking it is
	# genuinely relative to the command's own directory, and `> realfile.txt` at
	# the repo root creates a repo file. The bare artifacts this used to release
	# (`&1|tail`, `cleaned`) are gone at the source now that the tokenizer splits
	# glued separators, and the ones that were really elsewhere (`cd /tmp && …
	# cllvmcov`) resolve outside $ROOT before reaching here.
	case "$rel" in
		*/*)
			if [ -d "$ROOT/${rel%/*}" ]; then
				return 0
			fi
			return 1
			;;
	esac

	return 0
}

# Directories this command creates before it writes, repo-relative, plus their
# ancestors (`mkdir -p a/b` makes `a` too). Space-delimited for a substring test.
CREATED_DIRS=""
collect_created_dirs() {
	[ -n "$COMMAND" ] || return 0
	local d r
	while IFS= read -r d; do
		[ -n "$d" ] || continue
		r="$(relative_path "$d")" || continue
		while [ -n "$r" ]; do
			CREATED_DIRS="$CREATED_DIRS $r"
			case "$r" in
				*/*) r="${r%/*}" ;;
				*) r="" ;;
			esac
		done
	done < <(
		# Split on command separators, then take the operands of each directory
		# creator. `install -d` makes directories exactly like `mkdir -p`, and
		# leaving it out let `install -d a/b && echo x > a/b/x.ts` through.
		printf '%s' "$COMMAND" | tr ';&|' '\n\n\n' | awk '
			{
				for (i = 1; i <= NF; i++) {
					if ($i == "mkdir") { creator = 1 }
					else if ($i == "install") { creator = 0; for (k = i + 1; k <= NF; k++) if ($k ~ /^-[a-zA-Z]*d/) creator = 1 }
					else { continue }
					if (!creator) continue
					for (j = i + 1; j <= NF; j++) {
						if (substr($j, 1, 1) == "-") continue
						print $j
					}
					break
				}
			}
		'
	)
}

check_path() {
	local raw="$1" unsure=0
	case "$raw" in
		"$UNSURE_PREFIX"*)
			# The analyzer could not establish the command's directory (`cd "$W"`).
			# It anchored the target at the repo root as the conservative guess.
			# Blocking every such guess reproduced 101 of the 293 recorded false
			# denials — the variable held a linked worktree or a scratch dir every
			# recorded time. Blocking none of them released a real repo write when
			# the destination happened to BE the root (`cd "$PWD"`, `cd ""`).
			# Narrow it to a path that already exists: a scratch file has no
			# namesake at the root, a real source file does.
			unsure=1
			raw="${raw#"$UNSURE_PREFIX"}"
			;;
	esac

	local rel
	rel="$(relative_path "$raw")" || return 0

	if [ "$unsure" = "1" ] && [ ! -e "$ROOT/$rel" ]; then
		return 0
	fi

	# Command mode only. Path mode carries structured tool arguments (Edit/Write
	# `file_path`, apply_patch markers) — there is no tokenizer between the agent
	# and this check, so there are no artifacts to filter, and those tools create
	# missing parent directories, which makes "parent does not exist" a fact about
	# the future rather than a reason to allow.
	if [ -n "$COMMAND" ] && ! is_repo_location "$rel"; then
		return 0
	fi

	if is_linked_worktree_target_path "$rel"; then
		return 0
	fi

	if is_primary_orchestration_path "$rel"; then
		return 0
	fi

	deny_path "$rel"
}


if ! is_primary_worktree; then
	exit 0
fi

collect_created_dirs

if [ -n "$COMMAND" ]; then
	if is_patch_payload "$COMMAND"; then
		while IFS= read -r path; do
			[ -n "$path" ] || continue
			check_path "$path"
		done < <(paths_from_patch_markers "$COMMAND" | sort -u)
		exit 0
	fi

	while IFS= read -r path; do
		[ -n "$path" ] || continue
		check_path "$path"
	done < <({
		paths_from_patch_markers "$COMMAND"
		paths_from_command_tokens "$COMMAND"
	} | sort -u)
else
	# Bash 3.2 (macOS) + set -u: an empty "${PATH_ARGS[@]}" (hook run with no path
	# args) is an unbound variable error that crashes the guard (issue #1242).
	for path in ${PATH_ARGS[@]+"${PATH_ARGS[@]}"}; do
		check_path "$path"
	done
fi

exit 0
