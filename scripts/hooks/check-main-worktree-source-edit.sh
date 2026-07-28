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
# CMD_CWD value meaning "the command moved somewhere this reader cannot expand"
# (`cd "$WT"`). A control character keeps it distinct from every real path: the
# tokenizer never produces one, so no token can collide with the sentinel.
readonly CWD_UNKNOWN=$'\001unknown-cwd'

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

check_path() {
	local rel
	rel="$(relative_path "$1")" || return 0

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

# Single funnel for every write target the command tokenizer finds. Tilde
# EXPANSION lives here, downstream of every route (plain token, glued redirect
# target, glued multi-redirect segment, `of=` operand, tee/cp/mv/rm/sed/perl
# argument), so no route can be added later that silently skips it. Callers that
# are not shell words — path-mode arguments and apply_patch markers — never come
# through here, and are left literal on purpose.
emit_path() {
	local value="$1"
	value="$(trim_token "$value")"
	[ -n "$value" ] || return 0
	# A leading `~` the shell would have expanded (issue #1797). A QUOTED `~` is
	# literal instead; it was rewritten to `./~` upstream, while the quotes were
	# still visible, so it no longer matches here. `~name/...` (another user's
	# home) is not resolvable, so it stays literal too — a conservative ceiling
	# that over-blocks rather than under-blocks. An unset HOME leaves nothing to
	# resolve against, so the token is not a repo path.
	case "$value" in
		'~' | '~/'*)
			[ -n "${HOME:-}" ] || return 0
			value="${HOME}${value#\~}"
			;;
	esac
	# Tokens that are not paths at all. relative_path() rejects these by looking at
	# the raw string's first character, which the CMD_CWD join below would hide
	# behind a leading `/` — an unexpanded `$DST` became `<repo>/$DST` and was
	# denied as a repo edit.
	case "$value" in
		-* | '$'* | http://* | https://*)
			return 0
			;;
	esac
	# Resolve a relative target against the directory the command is actually
	# running in, not against $ROOT. `cd /tmp && ... cllvmcov` and
	# `cd worktrees/<wt> && rm .pr-body.md` were both re-rooted at $ROOT and denied
	# as repo edits; 101 of 293 recorded denials were this. CMD_CWD is tracked in
	# paths_from_command_tokens; path mode leaves it unset and keeps $ROOT.
	case "$value" in
		/*) ;;
		*)
			local base_cwd="${MODE_CWD:-${CMD_CWD:-$ROOT}}"
			# `cd "$W"` / `git -C "$WT"`: the destination is a variable this static
			# reader cannot expand, so a relative target has no anchor. Placing it at
			# $ROOT is a guess that was wrong in every recorded instance — the
			# variable always held a linked worktree or a scratch dir.
			[ "$base_cwd" = "$CWD_UNKNOWN" ] && return 0
			value="$base_cwd/$value"
			;;
	esac
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
			# Command separators GLUED to a word. Splitting only on whitespace left
			# `2>&1|tail` as one token, whose `>`-branch emitted `&1|tail` as a write
			# target, and left `x 2>/dev/null; echo cleaned` in a single token run so
			# `rm`/`mv` operand mode never reset and swallowed `cleaned`. Both were
			# denied as repo paths. `|` and `;` cannot appear unquoted in a filename,
			# so they are always separators; `&` is only one as `&&`, because a lone
			# `&` belongs to the redirect forms (`2>&1`, `>&-`) handled downstream.
			if (sq == 0 && dq == 0 && (c == "|" || c == ";")) {
				if (has) { print tok; tok = ""; has = 0 }
				print c
				continue
			}
			if (sq == 0 && dq == 0 && c == "&" && substr($0, i + 1, 1) == "&") {
				if (has) { print tok; tok = ""; has = 0 }
				print "&&"
				i++
				continue
			}
			tok = tok c; has = 1
		}
		if (sq == 0 && dq == 0) {
			if (has) { print tok; tok = ""; has = 0 }
			# An unquoted newline terminates the command, exactly like `;`. Emitting
			# the separator resets operand mode AND command position, so a verb on
			# the next line is seen as a verb (issue #1251 B1) and a word on the next
			# line is not swallowed as an operand of the command above it.
			print ";"
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
	# A literal single quote, held in a variable because it cannot be written as
	# `\'` inside the double-quoted parameter expansion that consumes it below.
	local SQ="'"

	# Working directory the command is running in, as `cd` moves it. Read by
	# emit_path to resolve a relative write target. Command-position only: a `cd`
	# that is not the first word of a segment (`grep cd file`) must not move it.
	# Not a shell: a `cd` inside a subshell/`$(...)` leaks to the rest of the
	# command here, which over-scopes toward the cwd rather than toward $ROOT.
	CMD_CWD="$ROOT"
	local at_cmd_start=1 expect_cd=0 expect_git=0 expect_git_c=0 git_c=""
	# Overrides CMD_CWD for the operands of the current verb only (`git -C <dir>
	# rm <paths>`). Cleared by reset_mode with the verb it belongs to.
	MODE_CWD=""

	flush_last_dest() {
		if [ -n "$last_dest" ]; then
			emit_path "$last_dest"
			last_dest=""
		fi
	}

	reset_mode() {
		flush_last_dest
		mode=""
		MODE_CWD=""
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
				at_cmd_start=1
				# `cd && …`: the separator arrives before any operand, so this is a
				# bare `cd` — it lands on $HOME, outside the repo.
				[ "$expect_cd" = "1" ] && CMD_CWD="$CWD_UNKNOWN"
				expect_cd=0
				expect_git=0
				expect_git_c=0
				git_c=""
				continue
				;;
		esac

		# `cd <dir>` in command position moves CMD_CWD for everything after it.
		if [ "$expect_cd" = "1" ]; then
			expect_cd=0
			case "$word" in
				-*) ;; # `cd -P`, `cd --`: keep looking for the operand
				*)
					local target
					target="$(trim_token "$word")"
					case "$target" in
						'' | -) CMD_CWD="$CWD_UNKNOWN" ;;           # `cd` / `cd -`
						*'$'* | *'`'*) CMD_CWD="$CWD_UNKNOWN" ;;    # `cd "$WT"`
						'~' | '~/'*) [ -n "${HOME:-}" ] && CMD_CWD="${HOME}${target#\~}" ;;
						/*) CMD_CWD="$target" ;;
						*)
							[ "$CMD_CWD" = "$CWD_UNKNOWN" ] || CMD_CWD="$CMD_CWD/$target"
							;;
					esac
					;;
			esac
			at_cmd_start=0
			continue
		fi
		if [ "$at_cmd_start" = "1" ] && [ "$word" = "cd" ]; then
			expect_cd=1
			continue
		fi

		# `git rm <paths>` deletes tracked files exactly like `rm`, but `rm` is not
		# in command position there so the verb table below never sees it. One
		# recorded denial was `cd <primary root> && git rm src/lib/completion/*.ts`
		# — a real primary-worktree deletion that the command-position narrowing
		# would otherwise release. `-C <dir>` re-roots GIT's operands only; the
		# shell's cwd is untouched, so a redirect on the same line still lands in
		# the shell's directory. Applying it as a `cd` denied four scratch-dir
		# captures of the form `cd /tmp/x && git -C <root> show REF:f > out.md`.
		#
		# Ceiling: only `rm` and `mv`. `git checkout <ref>` / `git restore` also
		# overwrite the tree but their operands are usually refs, and emitting a
		# branch name as a write target is the false-positive class this commit
		# exists to remove.
		if [ "$expect_git_c" = "1" ]; then
			expect_git_c=0
			local gtarget
			gtarget="$(trim_token "$word")"
			case "$gtarget" in
				'' | *'$'* | *'`'*) git_c="$CWD_UNKNOWN" ;;
				/*) git_c="$gtarget" ;;
				*) git_c="${CMD_CWD}/$gtarget" ;;
			esac
			at_cmd_start=0
			continue
		fi
		if [ "$expect_git" = "1" ]; then
			case "$(trim_token "$word")" in
				-C) expect_git_c=1; at_cmd_start=0; continue ;;
				-*) at_cmd_start=0; continue ;;
				rm | mv)
					expect_git=0
					reset_mode
					mode="all-targets"
					MODE_CWD="$git_c"
					at_cmd_start=0
					continue
					;;
				*) expect_git=0 ;;
			esac
		fi
		if [ "$at_cmd_start" = "1" ] && [ "${word##*/}" = "git" ]; then
			expect_git=1
			at_cmd_start=0
			continue
		fi

		local was_cmd_start="$at_cmd_start"
		at_cmd_start=0

		# A `~` sitting immediately inside a quote is literal for the shell:
		# `rm "~/src/App.tsx"` and `cat >"~/src/App.tsx"` both write
		# <repo>/~/src/App.tsx. This is the last point where the quotes are still
		# visible — trim_token drops the outer ones on the next line, and the
		# redirect/segment/operand slices below are cut from the trimmed word — so
		# every quoted `~` is rewritten to an explicit `./~` HERE, wherever in the
		# token it sits. Anchoring this at the token's first character covered
		# only the space-separated spelling (#1858 round 2 under-block).
		#
		# The single-quote spelling goes through variables. Inside a double-quoted
		# `${var//pat/rep}`, `\"` is a real escape but `\'` is NOT — bash keeps the
		# backslash, so the replacement inserted `\'./~` and trim_token then failed
		# to strip a leading quote that was no longer leading. The rel became
		# `\'./~/src/App.tsx`, and only a blanket deny made the assertion look green.
		word="${word//\"~/\"./~}"
		word="${word//${SQ}~/${SQ}./~}"

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

		# Write verbs are recognised in COMMAND POSITION only. Matching them
		# anywhere made a subcommand of the same name switch on operand mode:
		# `docker rm -f tv-probe-mssql` put the container name into all-targets mode
		# and denied it as a repo path. `git rm` is a real deletion and is handled
		# explicitly above, before this table.
		#
		# Ceiling: an indirected verb (`xargs rm`, `sudo rm`, `find -exec rm`) is no
		# longer in command position and is not inspected. That is a deliberate
		# narrowing of a best-effort careless-write layer — `rm -rf`, dd and
		# force-push stay covered by check-dangerous-bash.sh.
		base="${word##*/}"
		if [ "$was_cmd_start" != "1" ]; then
			base=""
		fi
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
