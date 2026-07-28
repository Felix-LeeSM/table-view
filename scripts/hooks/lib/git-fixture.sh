#!/usr/bin/env bash
# Throwaway-repository helpers for the hook test suites. Sourced, not executed.
#
# Every suite that builds a fixture repository needs the same three steps, and
# each one used to spell them itself. Measured at 7c974ec2^:
#
#   git grep -h 'user\.email' 7c974ec2^ -- scripts/hooks \
#     | sed 's/.*user\.email //;s/ .*//' | sort -u                     -> 4 identities
#     (not all of them quoted: apply/test-post-tool-use.sh:35 spelled it `t@e.x`,
#     which is why matching only `"..."` undercounts)
#   git grep -l 'unset $(git rev-parse --local-env-vars)' 7c974ec2^ -- scripts/hooks
#                                                                     -> 7 suites
#   git grep -l '^init_repo()' 7c974ec2^ -- scripts/hooks             -> 2 copies
#
# The reasoning for the scrub was pasted into seven of those, four to six
# comment lines each, which is where a rule goes to rot: it is long, it is not
# obviously load bearing, and the next suite has to know it exists to copy it.
#
#   scrub_git_env       cut git's injected hook environment.
#   fixture_mktemp      a throwaway directory, named after its owner.
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
# `git -C "$fixture" commit` writes a real commit. That is not hypothetical, and
# it is not rare:
#
#   git fsck --unreachable | awk '$2=="commit"{print $3}' \
#     | xargs -I{} git log -1 --format='%ae' {} | grep -c 'example\.invalid'
#
# answers 12 in this repository, all from 2026-06-01. Six more reached a real
# branch tip on 2026-07-28 alone — d6dca587 `init`, b42aee65 `fixture`,
# 6c8d6a78 `two`, b6a47d8d `seed`, 3068c94f `fixture`, 98ec364d `fixture` — every
# one unsigned, wearing three of the identities above (3 hook-test@example.invalid,
# 2 t@e.x, 1 test@example.com). It is invisible from inside the suite, which
# reports every assertion as passing because the fixture now reads as a linked
# worktree.
#
# `fixture_init_repo` calls this itself, so a suite cannot lose the protection
# by forgetting. Suites still call it at the top as well, for two reasons the
# helper cannot cover: a suite that runs git BEFORE building a fixture, and a
# suite that builds no fixture at all.
scrub_git_env() {
	# shellcheck disable=SC2046
	unset $(git rev-parse --local-env-vars) 2>/dev/null || true
}

# fixture_mktemp [label] -> path on stdout
#
# Two things a bare `mktemp -d` does not give. The label, so a leaked fixture
# names the suite that made it instead of being one more `tmp.XXXXXX`. And
# $TMPDIR: on macOS — the only platform these suites run on, since CI runs only
# `policy/test-check-pr-body.sh` — a template-less `mktemp -d` ignores $TMPDIR
# entirely and always answers from the per-user Darwin temp dir. Measured:
#
#   env TMPDIR=/tmp/probe sh -c 'mktemp -d'
#     -> /var/folders/ty/.../T/tmp.RMUkJEkteU
#   env TMPDIR=/tmp/probe sh -c 'mktemp -d "$TMPDIR/l.XXXXXX"'
#     -> /tmp/probe/l.XWTqFI
#
# so spelling the template out is what lets a caller redirect fixtures at all.
fixture_mktemp() {
	mktemp -d "${TMPDIR:-/tmp}/${1:-hook-fixture}.XXXXXX"
}

# fixture_init_repo <dir> [branch]
#
# `commit.gpgsign false` is not cosmetic. Without it the fixture inherits the
# developer's real signing config, and a fixture commit either blocks on a key
# prompt or fails outright in CI — a test run has no business touching a signing
# key. The identity is `.invalid` (RFC 2606) so it can never resolve.
#
# Those two writes are also the damage when the environment is not scrubbed.
# They do not fail; they OVERWRITE the developer's identity and disable signing
# in the repository the suite is running inside — measured in this one. So the
# scrub is taken here rather than asked of the caller, and the aim is checked
# before the first `config`, not before the first commit.
fixture_init_repo() {
	local repo="$1" branch="${2:-main}"

	scrub_git_env

	mkdir -p "$repo" || return 1
	git -C "$repo" init --quiet -b "$branch" || return 1

	# The scrub is the only thing aiming the writes below, and its failure is
	# silent: every assertion downstream still passes while the writes land
	# outside. Confirm the aim, and refuse rather than overwrite.
	local want
	want="$(cd "$repo" 2>/dev/null && pwd -P)/.git"
	if [ "$(git -C "$repo" rev-parse --absolute-git-dir 2>/dev/null)" != "$want" ]; then
		printf 'fixture_init_repo: %s does not resolve to itself — refusing to write config\n' \
			"$repo" >&2
		return 1
	fi

	git -C "$repo" config user.name "Hook Test" || return 1
	git -C "$repo" config user.email "hook-test@example.invalid" || return 1
	git -C "$repo" config commit.gpgsign false || return 1
}
