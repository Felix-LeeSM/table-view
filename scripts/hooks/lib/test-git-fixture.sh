#!/usr/bin/env bash
# Tests for the fixture helpers themselves.
#
# The scrub is the reason this file exists. It is the one helper whose failure
# is silent: with git's hook environment inherited, every fixture operation
# lands in the real repository and the calling suite still reports green. So it
# is not enough to assert that the variables are gone — the tests below inject
# GIT_DIR, point it at a decoy repository, and check which repository a
# `git -C "$fixture"` actually reaches, before and after.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./git-fixture.sh
source "$SCRIPT_DIR/git-fixture.sh" || exit 1

# This file is not exempt from the rule it tests. Run from a git hook — which is
# where the pre-push step below puts it — GIT_DIR is inherited, and the fixture
# commit at the bottom lands in the REAL repository: measured, an unsigned
# `fixture` commit on the branch being pushed. Scrub before touching anything.
scrub_git_env

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n  %s\n' "$1" "${2:-}"; }

check() { # <name> <expected> <actual>
	if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "want [$2] got [$3]"; fi
}

TMP="$(fixture_mktemp git-fixture-selftest)"
trap 'rm -rf "$TMP"' EXIT

# ── fixture_mktemp ───────────────────────────────────────────────────────────
# `pwd -P` on both sides: on macOS $TMPDIR is under /var, which is a symlink to
# /private/var, and git reports the resolved form. Comparing the raw strings
# fails everywhere the temp directory is reached through a link.
#
# The failure branch answers a sentinel rather than the empty string. A missing
# directory used to produce "" on both sides of a `check`, which passes — the
# scrub assertions below were measured passing under a mutant that disabled the
# scrub entirely, because the decoy they compare never got created.
real() {
	(cd "$1" 2>/dev/null && pwd -P) || printf '<no-such-dir:%s>' "$1"
}

check "mktemp: creates a directory" "yes" "$([ -d "$TMP" ] && echo yes || echo no)"
tmp_real="$(real "$TMP")"
root_real="$(real "${TMPDIR:-/tmp}")"
check "mktemp: lands under TMPDIR" "yes" \
	"$([ "${tmp_real#"$root_real"}" != "$tmp_real" ] && echo yes || echo no)"
# The check above passes either way, because unoverridden $TMPDIR already IS the
# directory a template-less `mktemp -d` answers from. Overriding it is what
# separates the two.
probe_root="$TMP/tmpdir-probe"
mkdir -p "$probe_root"
redirected="$(TMPDIR="$probe_root" fixture_mktemp tmpdir-probe)"
check "mktemp: an overridden TMPDIR is honoured" "$(real "$probe_root")" \
	"$(real "$(dirname "$redirected")")"
# The label is the other thing a bare `mktemp -d` does not give: without it a
# leaked fixture cannot be traced back to the suite that made it.
labelled="$(fixture_mktemp git-fixture-label-probe)"
label_base="${labelled##*/}"
check "mktemp: the label is in the name" "yes" \
	"$([ "${label_base#git-fixture-label-probe.}" != "$label_base" ] && echo yes || echo no)"
rm -rf "$labelled"
second="$(fixture_mktemp git-fixture-selftest)"
check "mktemp: two calls do not collide" "no" "$([ "$TMP" = "$second" ] && echo yes || echo no)"
rm -rf "$second"

# ── scrub_git_env ────────────────────────────────────────────────────────────
# A decoy standing in for the real repository, and a fixture standing in for the
# throwaway one a suite would build.
DECOY="$TMP/decoy"
FIX="$TMP/fixture"
fixture_init_repo "$DECOY" >/dev/null 2>&1
fixture_init_repo "$FIX" >/dev/null 2>&1

# Unscrubbed: GIT_DIR wins over -C, so the fixture operation reaches the DECOY.
# This is the failure being guarded against, asserted directly so the guard
# below cannot pass vacuously.
leaked="$(GIT_DIR="$DECOY/.git" git -C "$FIX" rev-parse --absolute-git-dir 2>/dev/null)"
check "scrub: the leak probe reached a repository at all" "yes" \
	"$([ -n "$leaked" ] && echo yes || echo no)"
check "scrub: without it, GIT_DIR beats -C" "$(real "$DECOY/.git")" "$leaked"

# Scrubbed inside a shell that has the variable set: the same command reaches
# the fixture. Run in a subshell so the export cannot escape into the rest of
# this file.
scrubbed="$(
	export GIT_DIR="$DECOY/.git"
	scrub_git_env
	git -C "$FIX" rev-parse --absolute-git-dir 2>/dev/null
)"
check "scrub: with it, -C decides" "$(real "$FIX/.git")" "$scrubbed"

check "scrub: is safe to call with nothing set" "0" \
	"$(scrub_git_env >/dev/null 2>&1; echo $?)"

# ── fixture_init_repo ────────────────────────────────────────────────────────
check "init: is a repository" "true" "$(git -C "$FIX" rev-parse --is-inside-work-tree 2>/dev/null)"
check "init: identity cannot resolve" "hook-test@example.invalid" \
	"$(git -C "$FIX" config user.email)"
check "init: the name is set too" "Hook Test" "$(git -C "$FIX" config user.name)"
check "init: signing is off" "false" "$(git -C "$FIX" config commit.gpgsign)"
check "init: default branch is main" "main" "$(git -C "$FIX" symbolic-ref --short HEAD)"

branched="$TMP/branched"
fixture_init_repo "$branched" other >/dev/null 2>&1
check "init: branch is overridable" "other" "$(git -C "$branched" symbolic-ref --short HEAD)"

# ── the caller that forgets ──────────────────────────────────────────────────
# Why the scrub is taken inside fixture_init_repo instead of asked for. A suite
# invoked from a git hook, that never calls scrub_git_env itself: the identity
# writes must still land in the fixture, and the decoy — standing in for the
# developer's repository — must come out untouched.
git -C "$DECOY" config user.email "real-dev@example.com"
git -C "$DECOY" config commit.gpgsign true
FORGOT="$TMP/forgot"
(
	export GIT_DIR="$DECOY/.git" GIT_WORK_TREE="$DECOY"
	fixture_init_repo "$FORGOT" >/dev/null 2>&1
)
check "forgot: the fixture is still its own repository" "$(real "$FORGOT/.git")" \
	"$(git -C "$FORGOT" rev-parse --absolute-git-dir 2>/dev/null)"
check "forgot: the decoy identity survives" "real-dev@example.com" \
	"$(git -C "$DECOY" config user.email)"
check "forgot: the decoy signing config survives" "true" \
	"$(git -C "$DECOY" config commit.gpgsign)"

# The refusal inside fixture_init_repo is the second layer, so it is invisible
# while the first one works — removing it leaves this suite green. Simulate the
# only situation it is for: the scrub regressed, the hook environment is still
# there. The helper has to decline rather than aim at whatever GIT_DIR names.
refused="$(
	export GIT_DIR="$DECOY/.git" GIT_WORK_TREE="$DECOY"
	scrub_git_env() { :; }
	fixture_init_repo "$TMP/refused" >/dev/null 2>&1
	echo $?
)"
check "refusal: a scrub that stopped working makes init decline" "1" "$refused"
check "refusal: and it declines before writing identity" "real-dev@example.com" \
	"$(git -C "$DECOY" config user.email)"

# A commit must go through without a signing prompt or a key lookup — that is
# the whole point of forcing the identity and gpgsign.
#
# Refuse to run it unless the target really is the fixture. This is the only
# write in the suite and the scrub above is what aims it; if that ever regresses
# the commit would land in the real repository, which is precisely the accident
# this file exists to catch rather than to cause. Belt and braces on purpose.
if [ "$(git -C "$FIX" rev-parse --absolute-git-dir 2>/dev/null)" != "$(real "$FIX/.git")" ]; then
	no "init: refusing to commit — the fixture does not resolve to itself" \
		"got [$(git -C "$FIX" rev-parse --absolute-git-dir 2>/dev/null)]"
	printf '\n==== git fixture helper summary ====\nPASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
	exit 1
fi
printf 'x\n' > "$FIX/f.txt"
git -C "$FIX" add f.txt >/dev/null 2>&1
git -C "$FIX" commit -q -m fixture >/dev/null 2>&1
check "init: a commit succeeds unsigned" "fixture" "$(git -C "$FIX" log -1 --format=%s 2>/dev/null)"

# The commit landed in the fixture, not anywhere else.
check "init: the commit stayed in the fixture" "1" "$(git -C "$FIX" rev-list --count HEAD 2>/dev/null)"

printf '\n==== git fixture helper summary ====\nPASS: %s\nFAIL: %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
