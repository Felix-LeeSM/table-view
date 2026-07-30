#!/usr/bin/env bash
# Fixture sweep for scripts/hooks/policy/check-verdict-label-contract.sh.
#
# A case is a directory under fixtures/check-verdict-label-contract/:
# `_case.fixture` holds the verdict, everything beside it is the input tree,
# mirrored literally. See `scripts/hooks/README.md` ("Guard fixtures").
#
# One thing this guard needs that `check-memory-structure` does not: the guard
# enumerates with `git ls-files`, so a case is materialized into a throwaway
# REPOSITORY, not a bare directory. That is also what makes the enumeration's
# own failure modes expressible as cases — `repo: none` and `repo: untracked`
# below are the two shapes that used to slip through as a silent pass.
#
# Every case here is an input a review round got past the guard on #1905, which
# was closed unmerged. The list and the round that found each one:
#
#   folded-inline-span            round 2 (B1)      — the round-1 version caught
#                                                     it, the round-2 rewrite lost
#                                                     it, no check noticed
#   fenced-backslash-continuation round 2 (B1 표)
#   bare-flags-no-command         round 1 (NEW-5)
#   enumeration-not-a-repo        round 1 (NEW-6)
#   enumeration-empty             round 1 (NEW-6)
#   wait-outside-procedure        round 2 (B2)
#   wait-below-minimum            round 1 (CHECK2-A)
#   red-adds-before-removing      round 2 (B3)
#
# `wait-in-green-only` is the one case here no review round produced. It is the
# only input that dies when the `green` / `red` split is removed, and without it
# that construct is untested — the shape of finding this repository keeps
# getting: an assertion that exists and catches nothing.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHECK="$ROOT/scripts/hooks/policy/check-verdict-label-contract.sh"
FIXTURE_ROOT="scripts/hooks/policy/fixtures"
FIXTURES="$ROOT/$FIXTURE_ROOT/check-verdict-label-contract"

# shellcheck source=scripts/hooks/lib/git-fixture.sh
source "$ROOT/scripts/hooks/lib/git-fixture.sh"

# This suite runs git against $ROOT, so GIT_DIR injected by an outer hook would
# aim the enumeration below at the wrong repository.
scrub_git_env

# Hand-maintained against the fixture directory ON PURPOSE. A sweep alone
# reports green over an empty directory, so deleting the case a previous review
# round paid for is invisible. A table of verdict + name rather than a count:
# flipping a case's `expect:` does not move a count, and a deletion has to take
# a NAME out, so the diff reads `-reject wait-below-minimum` instead of `-9 +8`.
#
# Ceiling: an author who means to delete a case and its row still gets green.
# What the table buys is that the loss is named in the diff instead of hiding
# inside a lowered integer.
EXPECTED_CASES="
accept split-procedure
reject bare-flags-no-command
reject enumeration-empty
reject enumeration-not-a-repo
reject fenced-backslash-continuation
reject folded-inline-span
reject red-adds-before-removing
reject sot-without-red-branch
reject wait-below-minimum
reject wait-in-green-only
reject wait-outside-procedure
"

# Every distinct violation message the guard can print, read out of the guard
# rather than declared here. Each one has to be produced by some reject case, so
# adding a rejection path to the guard demands a case for it. A count cannot say
# WHICH path a case covers; this can.
guard_messages="$(grep -oE 'verdict label: .* — [^"]*' "$CHECK" | sed 's/^.* — //' | sort -u)"

# The guard's floor list, read out of the guard for the same reason. An accept
# case has to build all of them, otherwise it accepts only because the guard's
# second check never had a subject — which is how an accept case goes vacuous
# here (the trees are small, so it is one deletion away).
required_sots="$(awk '/^REQUIRED_SOTS=\(/, /^\)/' "$CHECK" | grep -oE '"[^"]+"' | tr -d '"')"

WORK="$(fixture_mktemp verdict-label-sweep)"
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
# (#1942). This guard is exactly such an enumeration — it sweeps tracked `*.md`
# — so without the suffix every reject case here would also be a real violation
# of the repository's own contract.
unsuffixed="$(git -C "$ROOT" ls-files -- "$FIXTURE_ROOT" | grep -v '\.fixture$' || true)"
[ -z "$unsuffixed" ] || fail "tracked fixture files without the .fixture suffix:
$unsuffixed"

[ -n "$guard_messages" ] ||
	fail "read 0 violation messages out of the guard — the floor below would be vacuous"
[ "$(printf '%s\n' "$required_sots" | grep -c .)" -ge 1 ] ||
	fail "read 0 required SOT paths out of the guard — the accept floor would be vacuous"

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
	repo="$(field "$meta" repo)"
	[ -n "$repo" ] || repo=tracked

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

	case "$repo" in
		tracked)
			fixture_init_repo "$tree" || fail "$case_name: fixture_init_repo failed"
			git -C "$tree" add -A || fail "$case_name: git add failed"
			;;
		untracked)
			# The guard's list comes back empty with exit 0. Fail-open here means
			# reporting "0 combined forms" over a repository it never read.
			fixture_init_repo "$tree" || fail "$case_name: fixture_init_repo failed"
			;;
		none)
			# `git ls-files` exits 128. If $TMPDIR ever sits inside a repository
			# this case would silently enumerate THAT one and stop testing the
			# failure path, so refuse rather than pass.
			! git -C "$tree" rev-parse --show-toplevel >/dev/null 2>&1 ||
				fail "$case_name: repo=none but git resolves a repository at the fixture — \$TMPDIR is inside one"
			;;
		*) fail "$case_name: 'repo:' must be tracked, untracked or none, got '$repo'" ;;
	esac

	out="$(cd "$tree" && bash "$CHECK" 2>&1)" && rc=0 || rc=$?

	case "$expect" in
		reject)
			mentions="$(field "$meta" mentions)"
			[ -n "$mentions" ] || fail "$case_name: a reject case needs 'mentions:'"

			# `mentions` must not be a prefix of a longer path the case builds.
			# That shape anchors nothing: a guard blaming a different file
			# underneath the same prefix satisfies it too. Carry enough of the
			# message to end the path.
			while IFS= read -r p; do
				[ -n "$p" ] || continue
				[ "$p" != "$mentions" ] || continue
				[ "${p#"$mentions"}" = "$p" ] ||
					fail "$case_name: 'mentions' is a prefix of $p, so it anchors nothing"
			done <<<"$tree_paths"

			[ "$rc" = "1" ] ||
				fail "$case_name: exit $rc, expected 1
$out"
			grep -Fq "$mentions" <<<"$out" ||
				fail "$case_name: rejected, but not for '$mentions'
$out"
			reject_output="$reject_output$out
"
			rejects=$((rejects + 1))
			;;
		accept)
			[ -z "$(field "$meta" mentions)" ] ||
				fail "$case_name: an accept case must not carry 'mentions:'"
			[ "$rc" = "0" ] ||
				fail "$case_name: exit $rc, expected 0
$out"
			# The guard's second check only runs on files that carry the verdict
			# instruction. An accept case missing one accepts without ever
			# reaching the ordering and wait rules.
			while IFS= read -r sot; do
				[ -n "$sot" ] || continue
				[ -f "$tree/$sot" ] ||
					fail "$case_name: accept case does not build $sot, so the guard's second check has no subject"
			done <<<"$required_sots"
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

echo "PASS: verdict label contract guard, $cases cases ($rejects reject / $accepts accept)"
