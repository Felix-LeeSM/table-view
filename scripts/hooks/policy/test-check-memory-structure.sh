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
# Derive this from the sweep and the check eats itself: drop a case and both
# sides fall together.
#
# A table of verdict + name rather than a count, for two things a count misses.
# Flipping a case's `expect:` from reject to accept does not move a case count,
# and it fails here. And a deletion has to take a NAME out, so the diff reads
# `-reject stray-non-markdown` instead of `-7 +6`.
#
# Ceiling, stated because the previous round's version claimed more than it did:
# an author who means to delete a case and its row still gets green. Nothing
# here prevents that, and nothing can. What it buys is that the loss is named in
# the diff instead of hiding inside a lowered integer. The floors below are the
# part that does not move with a fixture edit.
# Every row on its own line, including the first and last: a row that shares a
# line with the quote is a different edit from the rest, which is how a row
# removal half-lands.
EXPECTED_CASES="
accept generated-index-exempt
accept index-parent-exempt
accept parent-with-index-and-child
accept plain-room
reject parent-without-index
reject stray-filename
reject stray-non-markdown
"

# Every distinct violation message the guard can print, read out of the guard
# rather than declared here. Each one has to be produced by some reject case, so
# adding a rejection path to the guard demands a case for it.
#
# This is "one case per rejection path" stated so it can tell WHICH path a case
# covers. A count cannot, and that is not theoretical: two cases on the filename
# path and none on the missing-index path satisfies `rejects >= 2` while the
# second path sits unguarded — measured on the previous version of this file.
guard_messages="$(grep -oE 'memory structure: .* — [^"]*' "$CHECK" | sed 's/^.* — //' | sort -u)"

# Accept cases per carve-out. Still a count: a carve-out is a `continue`, it
# prints nothing, so there is no output to map a case onto the way the messages
# above map the reject cases. Ceiling: two accept cases satisfy this whichever
# carve-outs they exercise.
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

[ -n "$guard_messages" ] ||
	fail "read 0 violation messages out of the guard — the floor below would be vacuous"
[ "$guard_carveouts" -gt 0 ] ||
	fail "read 0 carve-outs out of the guard — the floor below would be vacuous"

cases=0
rejects=0
swept=""
reject_output=""

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
			reject_output="$reject_output$strict_out
"
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

	swept="$swept$expect $case_name
"
	cases=$((cases + 1))
done

accepts=$((cases - rejects))

drift="$(diff <(sed '/^$/d' <<<"$EXPECTED_CASES" | sort) <(sed '/^$/d' <<<"$swept" | sort) || true)"
[ -z "$drift" ] || fail "case table drift (< declared, > on disk):
$drift"
while IFS= read -r msg; do
	[ -n "$msg" ] || continue
	grep -Fq "$msg" <<<"$reject_output" ||
		fail "no reject case makes the guard print this, so that rejection path has no case:
  $msg"
done <<<"$guard_messages"

[ "$accepts" -ge 1 ] ||
	fail "no accept case — the sweep is then satisfied by a guard that rejects everything"
[ "$accepts" -ge "$guard_carveouts" ] ||
	fail "$accepts accept cases for $guard_carveouts carve-outs in the guard — one each"

echo "PASS: memory structure guard, $cases cases ($rejects reject / $accepts accept)"
