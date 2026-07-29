#!/usr/bin/env bash
# Fixture sweep for scripts/hooks/policy/check-memory-structure.sh.
#
# A case is a directory under fixtures/check-memory-structure/: `_case.fixture`
# holds the verdict, everything beside it is the input tree, mirrored literally.
# See `scripts/hooks/README.md` ("Guard fixtures") for the convention and how to
# apply it to another guard.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHECK="$ROOT/scripts/hooks/policy/check-memory-structure.sh"
FIXTURE_ROOT="scripts/hooks/policy/fixtures"
FIXTURES="$ROOT/$FIXTURE_ROOT/check-memory-structure"

# shellcheck source=scripts/hooks/lib/git-fixture.sh
source "$ROOT/scripts/hooks/lib/git-fixture.sh"

# This suite runs git against $ROOT, so GIT_DIR injected by an outer hook would
# aim the enumeration below at the wrong repository.
scrub_git_env

# Hand-maintained against the fixture directory ON PURPOSE. A sweep alone
# reports green over an empty directory, so deleting the case a previous review
# round paid for is invisible — the regression this convention exists to stop.
# Derive these from the sweep and the check eats itself: drop a case and both
# sides fall together.
#
# They are not the whole floor. Lowering a constant to match a deleted case is a
# three-line edit, so the counts are ALSO checked against the guard source
# below, which a fixture edit does not touch.
EXPECTED_CASES=7
EXPECTED_REJECTS=3

# One reject case per rejection path the guard has, one accept case per carve-out
# it grants. Both numbers are read out of the guard rather than declared here, so
# adding a decision to the guard demands a case for it, and trimming cases to fit
# a lowered constant fails.
#
# Ceiling: this greps for how the guard spells those two things today —
# `violations=$((violations + 1))` and a `) continue ;;` arm. A rewrite that
# increments or exempts some other way lowers the floor silently, so both are
# asserted non-zero before use.
guard_rejections="$(grep -cF 'violations=$((violations + 1))' "$CHECK" || true)"
guard_carveouts="$(grep -cE '\) continue ;;' "$CHECK" || true)"

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

# Nothing under the fixture root may carry a real source extension. A fixture is
# a deliberate violation held verbatim, so a repo-wide guard that enumerates
# tracked files by extension reads it as a real one and fails on test data
# (#1942). The `.fixture` suffix is stripped when a case is materialized, so the
# bytes and the destination path stay exact.
unsuffixed="$(git -C "$ROOT" ls-files -- "$FIXTURE_ROOT" | grep -v '\.fixture$' || true)"
[ -z "$unsuffixed" ] || fail "tracked fixture files without the .fixture suffix:
$unsuffixed"

[ "$guard_rejections" -gt 0 ] ||
	fail "read 0 rejection paths out of the guard — the floor below would be vacuous"
[ "$guard_carveouts" -gt 0 ] ||
	fail "read 0 carve-outs out of the guard — the floor below would be vacuous"

cases=0
rejects=0

for case_dir in "$FIXTURES"/*/; do
	[ -d "$case_dir" ] || break
	case_name="$(basename "$case_dir")"
	meta="$case_dir/_case.fixture"

	[ -f "$meta" ] || fail "$case_name: no _case.fixture"
	expect="$(field "$meta" expect)" ||
		fail "$case_name: _case.fixture must open with '---'"

	tree="$WORK/$case_name"
	payloads=0
	tree_paths=""
	while IFS= read -r rel; do
		[ -n "$rel" ] || continue
		case "$rel" in
			*.fixture) ;;
			*) fail "$case_name: payload '$rel' must end in .fixture" ;;
		esac
		dest="${rel%.fixture}"
		mkdir -p "$tree/$(dirname "$dest")"
		cp "$case_dir/$rel" "$tree/$dest"
		tree_paths="$tree_paths$dest
"
		payloads=$((payloads + 1))
	done < <(cd "$case_dir" && find . -type f ! -name '_case.fixture' | sed 's|^\./||' | sort)

	[ "$payloads" -gt 0 ] || fail "$case_name: no payload files beside _case.fixture"
	# Without this the guard early-exits 0 and an `accept` case passes having
	# exercised nothing.
	[ -d "$tree/memory" ] ||
		fail "$case_name: the tree has no memory/ — the guard exits 0 before looking"

	strict_out="$(cd "$tree" && bash "$CHECK" --strict 2>&1)" && strict_rc=0 || strict_rc=$?
	warn_out="$(cd "$tree" && bash "$CHECK" 2>&1)" && warn_rc=0 || warn_rc=$?

	case "$expect" in
		reject)
			mentions="$(field "$meta" mentions)"
			[ -n "$mentions" ] || fail "$case_name: a reject case needs 'mentions:'"

			# `mentions` must not be a prefix of a longer path the case builds.
			# That shape anchors nothing, and it is not hypothetical: the first
			# version of `parent-without-index` said `mentions: memory/parent`
			# while building memory/parent/child/memory.md, so a guard blaming
			# the wrong directory satisfied it too. Carry enough of the message
			# to end the path — `memory/parent — 자식 디렉토리는`.
			while IFS= read -r p; do
				[ -n "$p" ] || continue
				[ "$p" != "$mentions" ] || continue
				[ "${p#"$mentions"}" = "$p" ] ||
					fail "$case_name: 'mentions' is a prefix of $p, so it anchors nothing"
			done <<<"$tree_paths"

			[ "$strict_rc" = "1" ] ||
				fail "$case_name: --strict exit $strict_rc, expected 1
$strict_out"
			grep -Fq "$mentions" <<<"$strict_out" ||
				fail "$case_name: rejected, but not for '$mentions'
$strict_out"
			# Without --strict the guard warns and lets the push through. A
			# reject case that stops proving that turns the default mode into a
			# silent block.
			[ "$warn_rc" = "0" ] ||
				fail "$case_name: warn-only mode exit $warn_rc, expected 0
$warn_out"
			grep -Fq "$mentions" <<<"$warn_out" ||
				fail "$case_name: warn-only mode said nothing about '$mentions'"
			rejects=$((rejects + 1))
			;;
		accept)
			[ -z "$(field "$meta" mentions)" ] ||
				fail "$case_name: an accept case must not carry 'mentions:'"
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

accepts=$((cases - rejects))

[ "$cases" -eq "$EXPECTED_CASES" ] ||
	fail "swept $cases cases, expected $EXPECTED_CASES — a case was deleted, or a new one needs the count raised"
[ "$rejects" -eq "$EXPECTED_REJECTS" ] ||
	fail "$rejects reject cases, expected $EXPECTED_REJECTS — a case was flipped to accept, or a new one needs the count raised"
[ "$rejects" -ge "$guard_rejections" ] ||
	fail "$rejects reject cases for $guard_rejections rejection paths in the guard — one each"
[ "$accepts" -ge 1 ] ||
	fail "no accept case — the sweep is then satisfied by a guard that rejects everything"
[ "$accepts" -ge "$guard_carveouts" ] ||
	fail "$accepts accept cases for $guard_carveouts carve-outs in the guard — one each"

echo "PASS: memory structure guard, $cases cases ($rejects reject / $accepts accept)"
