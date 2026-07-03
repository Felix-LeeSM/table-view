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

	# Bash 3.2 (macOS) + set -u: expanding an empty "${parts[@]}" is an unbound
	# variable error (issue #1242). Same guard idiom as the normalized[@] loop
	# below.
	for part in ${parts[@]+"${parts[@]}"}; do
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

# Neutralize shell-special chars (<>;&|) that appear INSIDE single/double quotes
# so the approximate tokenizer never treats quoted human text as operators:
# commit trailers like "<x@y>", arrows "old -> new", printf formats. Quote chars
# themselves are preserved (trim_token strips them) and an UNQUOTED redirect
# target keeps its path (path chars are never masked), so real writes such as
# `> "src/foo.ts"` stay blocked. Not a full shell parser: backslash escapes are
# not interpreted and an unbalanced quote masks conservatively to end of input.
mask_quoted_specials() {
	# \047 = single quote, \042 = double quote (kept out of the awk program so the
	# bash single-quoted wrapper stays clean). sq/dq persist across input lines to
	# track multi-line quoting.
	awk '
	{
		n = length($0); out = ""
		for (i = 1; i <= n; i++) {
			c = substr($0, i, 1)
			if (c == "\047" && dq == 0) { sq = 1 - sq; out = out c; continue }
			if (c == "\042" && sq == 0) { dq = 1 - dq; out = out c; continue }
			if ((sq || dq) && index("<>;&|", c) > 0) { out = out "_"; continue }
			out = out c
		}
		print out
	}
	' <<< "$1"
}

# Strip heredoc BODIES (the data between an opener line and its closing
# delimiter) before tokenizing. Heredoc bodies are literal data — SQL, markdown,
# gh issue/PR text — not commands, and their words (e.g. "truncate", "move")
# otherwise trip the write-verb tokenizer and block whole orchestration commands
# (issue #1251, case 2). The opener LINE is kept so a real redirect on it
# (`cat > src/x <<EOF`) is still checked.
#
# Opener detection is QUOTE-AWARE: a `<<` that sits inside a single/double quote
# (e.g. the text of `--body "a << b"`) is NOT an opener. Without this the
# quoted `<<` was mistaken for a heredoc start and every following line up to
# EOF was dropped as "body", so a real write on the next line slipped past the
# guard unchecked (issue #1251 review, blocker B1). Quote parity is carried
# across command lines but NOT across heredoc bodies (bodies are data), so a
# body's unbalanced quote can never mask a later command line either.
#
# KNOWN LIMITATION: a heredoc body fed to an interpreter (`bash <<EOF ... EOF`,
# `sh <<'EOF' ... EOF`) is stripped like any other body, so a non-recursive
# write inside it (plain rm/rm -f/mv/cp/tee/sed -i/redirect) is not inspected by
# this hook. This is a best-effort careless-write layer, not a security boundary;
# `rm -rf`/dd/force-push/SQL DROP remain covered by check-dangerous-bash.sh.
# Tracking: issue #1260.
#
# Not a full parser: one heredoc per opener line; delimiter must be a bare word
# (optionally quoted, `<<-` dashed); backslash escapes are not interpreted.
strip_heredoc_bodies() {
	local out="" line delim="" in_h=0 dash=0 probe
	local q="[\"']?" # optional single/double quote around the delimiter word
	local hd_after="^(-?)[[:space:]]*${q}([A-Za-z_][A-Za-z0-9_]*)"
	local sq=0 dq=0 n i c rest
	while IFS= read -r line || [ -n "$line" ]; do
		if [ "$in_h" -eq 1 ]; then
			probe="$line"
			# `<<-` permits a tab-indented closing delimiter.
			[ "$dash" -eq 1 ] && probe="${probe#"${probe%%[!$'\t']*}"}"
			[ "$probe" = "$delim" ] && in_h=0
			continue # drop body lines and the closing delimiter line
		fi
		out+="$line"$'\n'
		# Walk the command line tracking quote parity; treat only an UNQUOTED
		# `<<WORD` as a heredoc opener.
		n=${#line}
		i=0
		while [ "$i" -lt "$n" ]; do
			c=${line:i:1}
			if [ "$sq" -eq 1 ]; then
				[ "$c" = "'" ] && sq=0
				i=$((i + 1))
				continue
			fi
			if [ "$dq" -eq 1 ]; then
				[ "$c" = '"' ] && dq=0
				i=$((i + 1))
				continue
			fi
			case $c in
				"'") sq=1 ;;
				'"') dq=1 ;;
				'<')
					if [ "${line:i+1:1}" = "<" ]; then
						rest=${line:i+2}
						if [[ $rest =~ $hd_after ]]; then
							dash=0
							[ -n "${BASH_REMATCH[1]}" ] && dash=1
							delim="${BASH_REMATCH[2]}"
							in_h=1
							break # first opener on the line wins
						fi
						i=$((i + 2)) # `<<` but no delimiter word (e.g. `<<<`)
						continue
					fi
					;;
			esac
			i=$((i + 1))
		done
	done <<<"$1"
	printf '%s' "$out"
}

# Split a (heredoc-stripped, quote-masked) command into tokens on UNQUOTED
# whitespace, keeping a quoted span as a SINGLE token. Plain word splitting
# shatters `--body 'we truncate the old table'` into verb-shaped fragments
# ("truncate") that flip write-mode and block the command (issue #1251, case 1).
# Quote chars are preserved (trim_token strips them downstream); operators inside
# quotes were already neutralized by mask_quoted_specials, so an UNQUOTED redirect
# operator still splits normally and a quoted redirect target (`> "src/x"`) stays
# one checkable token — real writes remain blocked.
tokenize_quote_aware() {
	awk '
	{
		n = length($0)
		for (i = 1; i <= n; i++) {
			c = substr($0, i, 1)
			if (c == "\047" && dq == 0) { sq = 1 - sq; tok = tok c; has = 1; continue }
			if (c == "\042" && sq == 0) { dq = 1 - dq; tok = tok c; has = 1; continue }
			if (sq == 0 && dq == 0 && (c == " " || c == "\t")) {
				if (has) { print tok; tok = ""; has = 0 }
				continue
			}
			tok = tok c; has = 1
		}
		if (sq == 0 && dq == 0) {
			if (has) { print tok; tok = ""; has = 0 }
		} else {
			tok = tok " " # unclosed quote spans the newline: join with a space
		}
	}
	END { if (has) print tok }
	' <<<"$1"
}

paths_from_command_tokens() {
	local cmd
	cmd="$(mask_quoted_specials "$(strip_heredoc_bodies "$1")")"

	local tokens=() tok
	while IFS= read -r tok; do
		tokens+=("$tok")
	done < <(tokenize_quote_aware "$cmd")

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

	# Bash 3.2 (macOS) + set -u: empty "${tokens[@]}" (whitespace-only command)
	# is an unbound variable error that silently aborts the tokenizer inside the
	# process-substitution subshell, letting writes through unchecked (issue
	# #1242). Guard the expansion.
	for word in ${tokens[@]+"${tokens[@]}"}; do
		# Detect command separators on the RAW token: trim_token strips a trailing
		# ';'/',', which would otherwise erase a standalone separator before it can
		# reset state and leak expect_redir into the next command's first word.
		case "$word" in
			"&&" | "||" | "|" | ";" | ";;")
				reset_mode
				expect_redir=0
				continue
				;;
		esac

		word="$(trim_token "$word")"
		[ -n "$word" ] || continue

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
				# Count '>' so the FD dup/close skip below only fires for a
				# single redirect operator. A glued multi-redirect like
				# `>PATH>&1` has more than one '>', and its leading `>PATH`
				# truncates/creates a real file before the trailing dup/close —
				# skipping it (issue #1150) leaks source writes past the guard.
				local gt_stripped="${word//>/}"
				local gt_count=$((${#word} - ${#gt_stripped}))
				if [ "$gt_count" -eq 1 ]; then
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
				fi
				# gt_count >= 2: glued multi-redirect. Split the whole word on
				# '>' and emit EVERY non-empty write target so leading, middle,
				# and trailing targets are each policy-checked. Emitting only the
				# leading write let a source trailing/middle target slip past when
				# the leading target was allowed (#1164 lateral regression).
				# Index 0 is the text BEFORE the first '>' — an fd number
				# (`1>`, `2>`) or command residue, never a write target — so it
				# is skipped (`[@]:1`); emitting it resolved fd `1` to `<root>/1`
				# and over-blocked an allowed-only fd-prefixed redirect (#1164
				# 3rd re-review). Empty segments (the extra one from `>>PATH`
				# append) are skipped. FD dup (`&N`) / close (`&-`) segments are
				# skipped; a `&word` with a non-digit char is a real
				# stdout+stderr file write, so emit it (fail-safe).
				local glued_seg glued_segs=()
				IFS='>' read -r -a glued_segs <<<"$word"
				for glued_seg in "${glued_segs[@]:1}"; do
					[ -n "$glued_seg" ] || continue
					case "$glued_seg" in
						\&- | \&)
							continue
							;;
						\&*)
							case "${glued_seg#&}" in
								*[!0-9]*) emit_path "$glued_seg" ;;
								*) continue ;;
							esac
							;;
						*)
							emit_path "$glued_seg"
							;;
					esac
				done
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
	# Bash 3.2 (macOS) + set -u: an empty "${PATH_ARGS[@]}" (hook run with no path
	# args) is an unbound variable error that crashes the guard (issue #1242).
	for path in ${PATH_ARGS[@]+"${PATH_ARGS[@]}"}; do
		check_path "$path"
	done
fi

exit 0
