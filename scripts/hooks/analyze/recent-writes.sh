#!/usr/bin/env bash
# Analyzer: which files did the command that just ran write?
#
# A Bash payload carries no `file_path`, so path-shaped extraction returns
# nothing and every post-edit consumer used to see an empty list. Reading the
# command instead is possible (`analyze/bash-write-targets.sh`) but that reader
# has documented blind spots — a target held in a variable, a write inside a
# heredoc fed to `bash` — and a consumer that silently skips those is worse than
# one driven by what is actually on disk. So: ask git.
#
# `git status` reports the whole dirty tree, including files that were already
# dirty. Scoped by mtime to the last RECENT_WRITES_WINDOW seconds — wide enough
# for a slow command, narrow enough to leave unrelated work in progress alone.
#
# Contract:
#   recent_writes <repo-root> [window-seconds]  -> absolute paths, one per line
#
# Sourced, not executed: no `set -e` here, the caller owns its shell options.

recent_writes() {
	local root="$1"
	local window="${2:-${RECENT_WRITES_WINDOW:-120}}"
	[ -n "$root" ] || return 0
	command -v git >/dev/null 2>&1 || return 0

	local ref
	ref="$(mktemp "${TMPDIR:-/tmp}/recent-writes-ref.XXXXXX")" || return 0
	# BSD `date -v` and GNU `date -d` spell relative time differently, and
	# `find -newermt` is not portable for it either; stamp a reference file.
	touch -t "$(date -v-"${window}"S '+%Y%m%d%H%M.%S' 2>/dev/null ||
		date -d "-${window} seconds" '+%Y%m%d%H%M.%S')" "$ref" 2>/dev/null || :

	# `--untracked-files=all`, not the default `normal`: normal collapses a wholly
	# untracked directory to `docs/`, which is not a file, so the first file
	# written into a new directory was dropped.
	#
	# `--no-optional-locks` because this runs after EVERY Bash tool call. Plain
	# `git status` takes index.lock to write back refreshed stat info, which
	# collides with the agent's own next git command — observed as
	# "Unable to create index.lock: File exists" on a `git add` issued
	# immediately after the previous command's hook. A read-only observer must
	# not contend for the index of the repository it is observing.
	git -C "$root" --no-optional-locks status --porcelain --untracked-files=all 2>/dev/null |
		while IFS= read -r line; do
			local rel abs
			rel="${line:3}"
			# `XY old -> new` (rename): the write landed on the right side.
			case "$rel" in
				*' -> '*) rel="${rel##* -> }" ;;
			esac
			# Porcelain quotes a path containing specials; rare, and not worth a
			# dequoter here, so skip rather than mis-parse.
			case "$rel" in
				'"'*) continue ;;
			esac
			abs="$root/$rel"
			[ -f "$abs" ] || continue
			# Written as an `if`, not `[ ] && printf`: this loop runs in a pipeline
			# subshell, and under the caller's `set -e` a failing AND-list as the
			# last command aborts it — the first not-recent file would truncate
			# everything after it.
			if [ "$abs" -nt "$ref" ]; then
				printf '%s\n' "$abs"
			fi
		done

	rm -f "$ref"
}
