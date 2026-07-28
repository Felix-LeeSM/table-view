#!/usr/bin/env bash
set -euo pipefail

# Before the `git rev-parse` below, not after. This file builds a repository AND
# adds worktrees to it, which is both halves of the damage the helper exists to
# stop, and a hook hands it GIT_DIR/GIT_WORK_TREE.
#
# What decides the damage is not whose gitdir it is, but whether GIT_WORK_TREE
# points outside GIT_DIR's parent — which is what git sets inside a linked
# worktree. Under that,
#
#   GIT_DIR=<repo>/.git/worktrees/<n> GIT_WORK_TREE=<repo>/worktrees/<n> \
#     git init -q -b main <newdir>
#
# writes `core.worktree=<repo>/worktrees/<n>` into the SHARED <repo>/.git/config,
# never the per-worktree one, and so does the same call with GIT_DIR set to the
# shared .git. That is the state this repository was found in: the primary
# worktree answering a linked worktree for `git rev-parse --show-toplevel`, and
# `git status` there reporting phantom modifications. `worktree add -b` under the
# same environment creates its branch in the outer repository, which is where the
# stray `refs/heads/linked-fixture` came from.
#
# Measured on the pre-conversion version of this file, aimed at a decoy: it
# injected core.worktree and overwrote the decoy's user.email and user.name,
# then exited 128. The crash is not the protection — the damage lands first.
# shellcheck source=hooks/lib/git-fixture.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/hooks/lib" && pwd)/git-fixture.sh" || exit 1
scrub_git_env

ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$ROOT/scripts/worktree-cleanup.sh"
TMP_DIR="$(fixture_mktemp worktree-cleanup-check)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

repo="$TMP_DIR/repo"
origin="$TMP_DIR/origin.git"

fixture_init_repo "$repo"
printf 'base\n' >"$repo/README.md"
git -C "$repo" add README.md
git -C "$repo" commit -q -m "init"
git clone -q --bare "$repo" "$origin"
git -C "$repo" remote add origin "$origin"
git -C "$repo" push -q -u origin main

clean="$repo/worktrees/feature__clean"
dirty="$repo/worktrees/feature__dirty"

git -C "$repo" worktree add -q -b feature/clean "$clean" main
git -C "$repo" worktree add -q -b feature/dirty "$dirty" main
clean="$(cd "$clean" && pwd -P)"
dirty="$(cd "$dirty" && pwd -P)"
printf 'dirty\n' >>"$dirty/README.md"

if (cd "$repo" && "$SCRIPT" feature/dirty) >"$TMP_DIR/dirty.out" 2>"$TMP_DIR/dirty.err"; then
  fail "explicit dirty cleanup should fail"
fi
grep -q "SKIP: dirty worktree not removed" "$TMP_DIR/dirty.err" \
  || fail "dirty cleanup did not explain skip"
[ -d "$dirty" ] || fail "dirty worktree was removed"

if (cd "$repo" && "$SCRIPT" --merged) >"$TMP_DIR/merged.out" 2>"$TMP_DIR/merged.err"; then
  fail "--merged should fail when any merged worktree is dirty"
fi
grep -q "removed: $clean" "$TMP_DIR/merged.out" \
  || fail "--merged did not remove clean merged worktree"
grep -q "SKIP: dirty worktree not removed" "$TMP_DIR/merged.err" \
  || fail "--merged did not report dirty skip"
[ ! -d "$clean" ] || fail "clean worktree still exists"
[ -d "$dirty" ] || fail "dirty worktree was removed by --merged"

echo "PASS: worktree-cleanup"
