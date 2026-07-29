#!/usr/bin/env bash
# Fixture sweep for scripts/hooks/policy/check-memory-structure.sh.
#
# Every case is one file in fixtures/check-memory-structure/. See
# `scripts/hooks/README.md` ("Guard fixtures") for the convention and how to
# apply it to another guard.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHECK="$ROOT/scripts/hooks/policy/check-memory-structure.sh"
FIXTURES="$ROOT/scripts/hooks/policy/fixtures/check-memory-structure"

# shellcheck source=scripts/hooks/lib/git-fixture.sh
source "$ROOT/scripts/hooks/lib/git-fixture.sh"

# Hand-maintained against the fixture directory ON PURPOSE, and this is the
# whole point of the file. A sweep alone reports green over an empty directory,
# so deleting the case a previous review round paid for is invisible — the
# regression this convention exists to stop. Derive these from the sweep and the
# check eats itself: drop a fixture and both sides fall together.
EXPECTED_CASES=1
EXPECTED_REJECTS=1

WORK="$(fixture_mktemp memory-structure-sweep)"
trap 'rm -rf "$WORK"' EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

# Read one frontmatter key. Stops at the closing `---` so a body line that looks
# like a key cannot answer.
field() {
	awk -v key="$2" '
		NR == 1 && $0 != "---" { exit 3 }
		NR > 1 && $0 == "---" { exit }
		NR > 1 && index($0, key ": ") == 1 { print substr($0, length(key) + 3); exit }
	' "$1"
}

cases=0
rejects=0

for fixture in "$FIXTURES"/*.md; do
	[ -e "$fixture" ] || break
	case_name="$(basename "$fixture" .md)"

	dest="$(field "$fixture" fixture)" ||
		fail "$case_name: no frontmatter — a fixture must open with '---'"
	expect="$(field "$fixture" expect)"

	# The destination is read out of a file and fed to mkdir/cp. Keep it inside
	# the throwaway tree.
	case "$dest" in
		memory/*) ;;
		*) fail "$case_name: 'fixture:' must be a memory/ path, got '$dest'" ;;
	esac
	case "$dest" in
		*..*) fail "$case_name: 'fixture:' must not escape the tree, got '$dest'" ;;
	esac

	tree="$WORK/$case_name"
	mkdir -p "$tree/$(dirname "$dest")"
	cp "$fixture" "$tree/$dest"

	strict_out="$(cd "$tree" && bash "$CHECK" --strict 2>&1)" && strict_rc=0 || strict_rc=$?
	warn_out="$(cd "$tree" && bash "$CHECK" 2>&1)" && warn_rc=0 || warn_rc=$?

	case "$expect" in
		reject)
			mentions="$(field "$fixture" mentions)"
			[ -n "$mentions" ] || fail "$case_name: a reject case needs 'mentions:'"
			[ "$strict_rc" = "1" ] ||
				fail "$case_name: --strict exit $strict_rc, expected 1
$strict_out"
			grep -Fq "$mentions" <<<"$strict_out" ||
				fail "$case_name: rejected, but not for '$mentions'
$strict_out"
			# Without --strict the guard warns and lets the push through. A
			# reject fixture that stops proving that turns the default mode
			# into a silent block.
			[ "$warn_rc" = "0" ] ||
				fail "$case_name: warn-only mode exit $warn_rc, expected 0
$warn_out"
			grep -Fq "$mentions" <<<"$warn_out" ||
				fail "$case_name: warn-only mode said nothing about '$mentions'"
			rejects=$((rejects + 1))
			;;
		accept)
			[ "$strict_rc" = "0" ] ||
				fail "$case_name: --strict exit $strict_rc, expected 0
$strict_out"
			[ -z "$strict_out" ] || fail "$case_name: accepted but warned
$strict_out"
			;;
		*) fail "$case_name: 'expect:' must be reject or accept, got '$expect'" ;;
	esac

	cases=$((cases + 1))
done

[ "$cases" -eq "$EXPECTED_CASES" ] ||
	fail "swept $cases fixtures, expected $EXPECTED_CASES — a case was deleted, or a new one needs the count raised"
[ "$rejects" -eq "$EXPECTED_REJECTS" ] ||
	fail "$rejects reject fixtures, expected $EXPECTED_REJECTS — a case was flipped to accept, or a new one needs the count raised"

echo "PASS: memory structure guard, $cases fixtures ($rejects reject)"
