#!/usr/bin/env bash
# Analyzer: repo-relative path -> the active rules registered for that surface.
#
# Reads `memory/index/by-surface.md`, which is generated from the `surface:`
# frontmatter of every memory room. Emits facts only — whether a rule should be
# shown to anyone is the caller's decision.
#
# Why this exists as a hook input at all: measured over this project's
# transcripts, the `nested_memory` channel (the one that auto-loads a CLAUDE.md
# found next to an edited file) reached a subagent 0 times out of 512, while
# hooks delivered 557 times. A rule that only lives in an index a subagent never
# opens is not routed anywhere. This makes the index reachable at the moment a
# file is touched.
#
# Contract:
#   surface_rules_for_path <repo-relative-path> [index-file]  -> "title\tlink"
#
# Sourced, not executed: no `set -e` here, the caller owns its shell options.

# `case` glob semantics, not pathname expansion: `*` matches `/` too, so the
# index's `**` patterns (`src/lib/**`, `**/*.ts`) work without a globstar shell.
# A pattern is matched against the path as written — the index stores
# repo-relative patterns and the caller passes a repo-relative path.
surface_rules_for_path() {
	local rel="$1"
	local index="${2:-memory/index/by-surface.md}"
	[ -n "$rel" ] || return 0
	[ -f "$index" ] || return 0

	awk -v target="$rel" '
		# `### `pattern`` opens a surface section.
		/^### `/ {
			pattern = $0
			sub(/^### `/, "", pattern)
			sub(/`.*$/, "", pattern)
			active = match_glob(pattern, target)
			next
		}
		/^#/ { active = 0; next }
		# `- [title](link)` inside an active section is a rule for this path.
		active && /^- \[/ {
			line = $0
			title = line; sub(/^- \[/, "", title); sub(/\].*$/, "", title)
			link  = line; sub(/^.*\]\(/, "", link);  sub(/\).*$/, "", link)
			# The index links are relative to memory/index/; normalise to repo root
			# so the caller can print a path an agent can open directly.
			gsub(/^\.\.\/\.\.\//, "", link)
			key = title "\t" link
			if (!(key in seen)) { seen[key] = 1; print key }
		}
		function match_glob(pat, s) {
			# awk has no glob operator. Translate the subset the index uses
			# (`*`, `**`, `?`) into a regex, anchored on both ends.
			gsub(/[.^$+(){}|\[\]\\]/, "\\\\&", pat)
			gsub(/\*\*/, "\001", pat)     # `**` and `*` are identical here: both
			gsub(/\*/, "\001", pat)       # may span `/`, matching case-glob rules
			gsub(/\?/, ".", pat)
			gsub(/\001/, ".*", pat)
			return (s ~ ("^" pat "$"))
		}
	' "$index"
}
