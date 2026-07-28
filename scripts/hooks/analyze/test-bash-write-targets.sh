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

# A verb that is a SUBCOMMAND of a known host is not a write. That host list is
# the only exception to "recognise verbs anywhere" — see the blacklist rationale
# in bash-write-targets.sh. It is deliberately short and its failure mode is a
# false allow for container tooling, which does not write repo files.
expect "host: docker rm is a subcommand, not a write" "" "docker rm -f tv-probe-mssql"
expect "host: podman rm is a subcommand" "" "podman rm -f probe"
expect "host: kubectl rm-shaped argument is not a write" "" "kubectl delete pod rm"

# Everything that can precede a verb without being one. Recognising verbs in
# command position only made each of these hide the verb and release a real
# deletion — two review rounds enumerated 29 more each time the previous list was
# patched, which is why the polarity was inverted instead.
expect "wrapper: env assignment" "./a.ts" "env FOO=1 rm a.ts"
expect "wrapper: env -i" "./a.ts" "env -i rm a.ts"
expect "wrapper: env -u" "./a.ts" "env -u FOO rm a.ts"
expect "wrapper: bare assignment" "./a.ts" "FOO=1 rm a.ts"
expect "wrapper: time" "./a.ts" "time rm a.ts"
expect "wrapper: nohup" "./a.ts" "nohup rm a.ts"
expect "wrapper: nice" "./a.ts" "nice rm a.ts"
expect "wrapper: ionice" "./a.ts" "ionice -c3 rm a.ts"
expect "wrapper: sudo" "./a.ts" "sudo rm a.ts"
expect "wrapper: timeout" "./a.ts" "timeout 5 rm a.ts"
expect "wrapper: setsid" "./a.ts" "setsid rm a.ts"
expect "wrapper: stdbuf" "./a.ts" "stdbuf -oL rm a.ts"
expect "wrapper: command -p" "./a.ts" "command -p rm a.ts"
expect "wrapper: exec -a" "./a.ts" "exec -a x rm a.ts"
expect "wrapper: xargs" "./a.ts" "xargs rm a.ts"
# find's `\;` terminator is emitted alongside the real target, like a sed
# expression: this reader cannot tell it from a filename, and the caller's
# existence gate removes it (`./\` names no directory).
expect "wrapper: find -exec" './\,./a.ts' 'find . -name x -exec rm a.ts \;'
expect "keyword: brace group" "./a.ts" "{ rm a.ts; }"
expect "keyword: subshell" "./a.ts" "( rm a.ts )"
expect "keyword: if condition" "./a.ts" "if rm a.ts; then echo y; fi"
expect "keyword: then branch" "./a.ts" "if true; then rm a.ts; fi"
expect "keyword: while condition" "./a.ts" "while rm a.ts; do break; done"
expect "keyword: until condition" "./a.ts" "until rm a.ts; do break; done"
expect "keyword: for body" "./a.ts" "for f in x; do rm a.ts; done"
expect "keyword: case body" "./a.ts" "case x in x) rm a.ts;; esac"
expect "background: trailing ampersand" "./a.ts" "echo a && rm a.ts &"
# A lone `&` must reset the same state `;` does. Resetting only part of it left
# `cd`/`git -C` waiting for an operand that never arrived, and the write after it
# was released (review #1860 round 3).
expect "background: & resets a pending cd" "./a.ts" "cd & rm a.ts"
expect "background: & resets a pending git -C" "./a.ts" "git -C & rm a.ts"
# The subcommand-host exemption applies to a host in COMMAND position only. As a
# bare previous token it disarmed the next word, so a host NAME used as an
# operand released the destination after it.
expect "host: a host name as an operand is not an exemption" "./dst.ts" "cp docker dst.ts"
expect "host: the exemption is one word wide" "./a.ts" "docker foo rm a.ts"
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
