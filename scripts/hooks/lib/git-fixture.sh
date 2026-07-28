#!/usr/bin/env bash
# Throwaway-repository helpers for the hook test suites. Sourced, not executed.
#
# Every suite that builds a fixture repository needs the same three steps, and
# each one used to spell them itself. That produced four different test
# identities, two spellings of the environment scrub, and three copies of an
# `init_repo` helper. The reasoning for the scrub was pasted into ten files,
# which is where a rule goes to rot: it is long, it is not obviously load
# bearing, and the next suite has to know it exists to copy it.
#
#   scrub_git_env       cut git's injected hook environment. Call it FIRST.
#   fixture_mktemp      a throwaway directory.
#   fixture_init_repo   a repository whose identity cannot sign or prompt.
#
# Cleanup is deliberately NOT owned here. Every caller already installs its own
# `trap ... EXIT`, and a second `trap ... EXIT` silently replaces the first
# rather than chaining — taking ownership here would disarm the cleanup the
# suites already have.

# Cut git's hook environment out of this process.
#
# git injects GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE into every hook it runs,
# and GIT_DIR beats `git -C`. With them set, a fixture operation lands in the
# OUTER repository instead: `git -C "$fixture" add .` stages the real tree and
# `git -C "$fixture" commit` writes a real commit. That is not hypothetical —
# it produced five stray commits and a rewritten local identity in this
# repository, and it is invisible from inside the suite, which reports every
# assertion as passing because the fixture now reads as a linked worktree.
#
# Call this before creating any fixture, so the suite is correct however it is
# invoked rather than depending on the caller to scrub.
scrub_git_env() {
	# shellcheck disable=SC2046
	unset $(git rev-parse --local-env-vars) 2>/dev/null || true
}

# fixture_mktemp [label] -> path on stdout
#
# The label is the point. `mktemp -d` alone already randomises the name and
# already honours $TMPDIR, so neither of those is what this adds — it names the
# directory after the suite that made it, which is the difference between
# finding the owner of a leaked fixture and guessing. `${TMPDIR:-/tmp}` is
# spelled out only because the template form requires a full path.
fixture_mktemp() {
	mktemp -d "${TMPDIR:-/tmp}/${1:-hook-fixture}.XXXXXX"
}

# fixture_init_repo <dir> [branch]
#
# `commit.gpgsign false` is not cosmetic. Without it the fixture inherits the
# developer's real signing config, and a fixture commit either blocks on a key
# prompt or fails outright in CI — a test run has no business touching a signing
# key. The identity is `.invalid` (RFC 2606) so it can never resolve.
fixture_init_repo() {
	local repo="$1" branch="${2:-main}"

	mkdir -p "$repo" || return 1
	git -C "$repo" init --quiet -b "$branch" || return 1
	git -C "$repo" config user.name "Hook Test" || return 1
	git -C "$repo" config user.email "hook-test@example.invalid" || return 1
	git -C "$repo" config commit.gpgsign false || return 1
}
