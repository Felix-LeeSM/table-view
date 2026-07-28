#!/usr/bin/env bash
# Direct tests for the write-target analyzer.
#
# These exist because the analyzer was untestable while it lived inside the
# primary-worktree guard: every assertion had to be phrased as "is this command
# denied?", which conflates a reader defect with a policy decision and is exactly
# how a mangled path (`\'./~/src/App.tsx`) stayed green under a blanket deny.
# Here the question is only "which paths does this command write?".

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURE="$(mktemp -d)"
trap 'rm -rf "$FIXTURE"' EXIT

BASH_WRITE_TARGETS_CWD="$FIXTURE"
# shellcheck source=./bash-write-targets.sh
source "$SCRIPT_DIR/bash-write-targets.sh"

PASS=0
FAIL=0

# targets <command> -> newline-separated, sorted, $FIXTURE collapsed to `.`
# $FIXTURE collapses to `.`; the unsure marker (a control byte) is spelled
# `unsure` so a failure message is readable.
targets() {
	paths_from_command_tokens "$1" |
		sed -e "s|$UNSURE_PREFIX|unsure|" -e "s|$FIXTURE|.|" |
		sort -u | paste -sd, -
}

expect() { # <name> <expected-csv> <command>
	local name="$1" want="$2" cmd="$3" got
	got="$(targets "$cmd")"
	if [ "$got" = "$want" ]; then
		PASS=$((PASS + 1))
		printf 'PASS  %s\n' "$name"
	else
		FAIL=$((FAIL + 1))
		printf 'FAIL  %s\n  want: [%s]\n  got : [%s]\n' "$name" "$want" "$got"
	fi
}

# ── redirection ──────────────────────────────────────────────────────────────
expect "redirect: spaced" "./out.txt" "echo hi > out.txt"
expect "redirect: glued" "./out.txt" "echo hi >out.txt"
expect "redirect: append" "./out.txt" "echo hi >>out.txt"
expect "redirect: fd dup is not a path" "" "cmd 2>&1 | tail -3"
expect "redirect: fd close is not a path" "" "cmd 2>&-"
expect "redirect: glued multi keeps the real target" "./out.txt" "cmd >out.txt>&1"

# ── verbs ────────────────────────────────────────────────────────────────────
expect "verb: rm operands" "./a.ts,./b.ts" "rm -f a.ts b.ts"
expect "verb: cp takes the last operand only" "./dst.ts" "cp src.ts dst.ts"
expect "verb: tee" "./log.txt" "cmd | tee log.txt"
expect "verb: dd of=" "./disk.img" "dd if=/dev/zero of=disk.img"
# The substitution expression is emitted alongside the real target: this reader
# cannot tell a sed script from a filename. Documented here rather than filtered,
# because the caller's existence gate is what removes it — `./s/x/y/` names no
# directory, so it is not a location anything can be written to.
expect "verb: sed -i emits the target and its expression" "./a.md,./s/x/y/" \
	"sed -i '' 's/x/y/' a.md"
expect "verb: sed without -i writes nothing" "" "sed 's/x/y/' a.md"
expect "verb: perl -i emits the target and its expression" "./a.md,./s/x/y/" \
	"perl -0pi -e 's/x/y/' a.md"
expect "verb: git rm" "./a.ts" "git rm a.ts"
expect "verb: git mv takes both operands" "./a.ts,./b.ts" "git mv a.ts b.ts"
expect "verb: git status is not a write" "" "git status --short"

# A verb out of command position is a subcommand, not a write.
expect "position: docker rm is not a write" "" "docker rm -f tv-probe-mssql"
# …but a wrapper or keyword does not consume the command position. Each of these
# hid a verb and released a real write until #1860 review caught them.
expect "position: env assignment prefix is transparent" "./a.ts" "env FOO=1 rm a.ts"
expect "position: bare assignment prefix is transparent" "./a.ts" "FOO=1 rm a.ts"
expect "position: time is transparent" "./a.ts" "time rm a.ts"
expect "position: nohup is transparent" "./a.ts" "nohup rm a.ts"
expect "position: brace group does not consume it" "./a.ts" "{ rm a.ts; }"
expect "position: then does not consume it" "./a.ts" "if true; then rm a.ts; fi"
expect "position: do does not consume it" "./a.ts" "for f in x; do rm a.ts; done"
expect "position: verb after a separator is a verb" "./a.ts" "echo x; rm a.ts"
expect "position: verb on the next line is a verb" "./a.ts" "$(printf 'echo x\nrm a.ts\n')"

# ── cwd tracking ─────────────────────────────────────────────────────────────
expect "cwd: cd moves the anchor" "/elsewhere/a.ts" "cd /elsewhere && rm a.ts"
expect "cwd: cd as an argument does not move it" "./a.ts" "grep cd file && rm a.ts"
expect "cwd: a separator does not restore the anchor" "/elsewhere/a.ts" \
	"cd /elsewhere; rm a.ts"
# An unexpandable destination is reported, not dropped: `cd "$PWD"`, `cd $(pwd)`
# and `cd ""` all stay put, so dropping the target released real repo writes
# (review #1860). The target is anchored at the starting cwd and tagged `unsure`;
# how much doubt to tolerate is the caller's policy, not this reader's.
expect "cwd: unexpandable destination is tagged unsure, not dropped" "unsure./a.ts" \
	'W=/x; cd "$W" && rm a.ts'
expect "cwd: unexpandable destination keeps absolute targets" "/abs/a.ts" \
	'W=/x; cd "$W" && rm /abs/a.ts'
expect "cwd: git -C re-roots git operands only" "./out.md" \
	"cd /elsewhere && cd $FIXTURE && git -C /other show HEAD:f > out.md"

# ── quoting and literal data ─────────────────────────────────────────────────
expect "quote: prose in a quoted argument is not a verb" "" \
	"gh pr comment --body 'we truncate the old table and move on'"
# A quoted `~` is literal for the shell, so it stays a `./~` directory under the
# cwd instead of expanding to $HOME. The `./` marker survives into the output —
# collapsing it is path normalisation, which belongs to the caller.
expect "quote: a quoted tilde is literal" "././~/src/App.tsx" "rm '~/src/App.tsx'"
expect "quote: a double-quoted tilde is literal" "././~/src/App.tsx" 'rm "~/src/App.tsx"'
expect "heredoc: body words are data" "" "$(printf 'gh pr create --body "$(cat <<%s\ntruncate the table\nEOF\n)"\n' "'EOF'")"
expect "heredoc: a redirect on the opener line still counts" "./f.txt" \
	"$(printf 'cat > f.txt <<EOF\nbody\nEOF\n')"

# ── things that are not paths ────────────────────────────────────────────────
expect "non-path: a flag" "" "rm --force"
expect "non-path: an unexpanded variable" "" 'rm "$DST"'
# The URL is a source, not a target; `.` is where the copy lands and IS a write.
expect "non-path: a URL source is not a target" "./." "cp https://example.com/x ."

# ── apply_patch markers ──────────────────────────────────────────────────────
patch_payload="$(printf '*** Begin Patch\n*** Update File: src/App.tsx\n*** End Patch\n')"
if is_patch_payload "$patch_payload"; then
	PASS=$((PASS + 1))
	printf 'PASS  %s\n' "patch: payload recognised"
else
	FAIL=$((FAIL + 1))
	printf 'FAIL  %s\n' "patch: payload recognised"
fi
if is_patch_payload "echo not a patch"; then
	FAIL=$((FAIL + 1))
	printf 'FAIL  %s\n' "patch: a plain command is not a payload"
else
	PASS=$((PASS + 1))
	printf 'PASS  %s\n' "patch: a plain command is not a payload"
fi
got="$(paths_from_patch_markers "$patch_payload")"
if [ "$got" = "src/App.tsx" ]; then
	PASS=$((PASS + 1))
	printf 'PASS  %s\n' "patch: marker target extracted"
else
	FAIL=$((FAIL + 1))
	printf 'FAIL  %s\n  want: [src/App.tsx]\n  got : [%s]\n' "patch: marker target extracted" "$got"
fi

printf '\n==== bash write-target analyzer summary ====\nPASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
