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
# Overridable so the RED half of #1932 is reproducible rather than asserted:
#
#   old="$(mktemp)"; git show <ref>:scripts/worktree-cleanup.sh >"$old"
#   WORKTREE_CLEANUP_SCRIPT="$old" bash scripts/test-worktree-cleanup.sh
#
# The pre-fix version judged merges with `git for-each-ref --merged origin/main`,
# so it removed nothing here and exited 0 where this suite requires a removal.
SCRIPT="${WORKTREE_CLEANUP_SCRIPT:-$ROOT/scripts/worktree-cleanup.sh}"
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
printf 'worktrees/\n' >"$repo/.gitignore"
git -C "$repo" add README.md .gitignore
git -C "$repo" commit -q -m "init"
git clone -q --bare "$repo" "$origin"
git -C "$repo" remote add origin "$origin"
git -C "$repo" push -q -u origin main

squashed="$repo/worktrees/feature__squashed"
dirty="$repo/worktrees/feature__dirty"
open_wt="$repo/worktrees/feature__open"
orphan="$repo/worktrees/feature__orphan"

git -C "$repo" worktree add -q -b feature/squashed "$squashed" main
git -C "$repo" worktree add -q -b feature/dirty "$dirty" main
git -C "$repo" worktree add -q -b feature/open "$open_wt" main
squashed="$(cd "$squashed" && pwd -P)"
dirty="$(cd "$dirty" && pwd -P)"
open_wt="$(cd "$open_wt" && pwd -P)"

for wt in "$squashed:squashed" "$dirty:dirty" "$open_wt:open"; do
  path="${wt%:*}"
  name="${wt##*:}"
  printf '%s work\n' "$name" >"$path/$name.txt"
  git -C "$path" add "$name.txt"
  git -C "$path" commit -q -m "work on $name"
done

# GitHub's squash merge: main gets the branch's TREE under a new commit, and the
# branch tip never becomes an ancestor of main. Two of the three branches land
# that way; feature/open stays unmerged.
for branch in feature/squashed feature/dirty; do
  git -C "$repo" merge -q --squash "$branch" >/dev/null 2>&1 \
    || fail "fixture could not squash merge $branch"
  git -C "$repo" commit -q -m "squash merge $branch"
done
git -C "$repo" push -q origin main

# Locks the fixture to the shape the bug needs. Without this, a fast-forward
# merge would satisfy every assertion below for the wrong reason and the
# ancestor-based judgement would look fixed.
if git -C "$repo" for-each-ref --merged origin/main --format='%(refname:short)' refs/heads \
  | grep -qx 'feature/squashed'; then
  fail "fixture is not a squash merge: the ancestor check already sees feature/squashed as merged"
fi

# 51 uncommitted lines of real work sat in a merged PR's worktree on 2026-07-29.
# This is the content that must survive the sweep.
printf 'uncommitted work\n' >>"$dirty/dirty.txt"

# The measured orphan: `.git` points at the repository's path from BEFORE it was
# renamed, so git cannot answer for this directory at all and it never appears in
# `git worktree list`. `--prune` handles only the opposite direction (metadata
# present, directory gone).
mkdir -p "$orphan"
printf 'gitdir: %s\n' "$TMP_DIR/renamed-away/.git/worktrees/feature__orphan" >"$orphan/.git"
orphan="$(cd "$orphan" && pwd -P)"

# Stands in for `gh pr list --head <branch> --state merged --json number --jq length`.
# The suite must not need network or a gh login, so the lookup is injected.
stub="$TMP_DIR/pr-merged-stub.sh"
{
  echo '#!/usr/bin/env bash'
  echo 'case "$1" in'
  echo '  feature/squashed|feature/dirty) echo 1 ;;'
  echo '  *) echo 0 ;;'
  echo 'esac'
} >"$stub"
chmod +x "$stub"
export WORKTREE_CLEANUP_PR_MERGED_CMD="$stub"

if (cd "$repo" && bash "$SCRIPT" feature/dirty) >"$TMP_DIR/dirty.out" 2>"$TMP_DIR/dirty.err"; then
  fail "explicit dirty cleanup should fail"
fi
grep -q "SKIP: dirty worktree not removed" "$TMP_DIR/dirty.err" \
  || fail "dirty cleanup did not explain skip"
[ -d "$dirty" ] || fail "dirty worktree was removed"

merged_rc=0
(cd "$repo" && bash "$SCRIPT" --merged) >"$TMP_DIR/merged.out" 2>"$TMP_DIR/merged.err" || merged_rc=$?

# 1. squash-merged and clean -> removed.
grep -qF "removed: $squashed" "$TMP_DIR/merged.out" \
  || fail "--merged did not remove the squash-merged worktree"
[ ! -d "$squashed" ] || fail "squash-merged worktree still exists"

# 2. squash-merged and dirty -> skipped, work intact.
grep -q "SKIP: dirty worktree not removed" "$TMP_DIR/merged.err" \
  || fail "--merged did not report dirty skip"
[ -d "$dirty" ] || fail "dirty worktree was removed by --merged"
grep -q "uncommitted work" "$dirty/dirty.txt" \
  || fail "uncommitted work in the dirty worktree was lost"
[ "$merged_rc" -ne 0 ] || fail "--merged should fail when any merged worktree is dirty"

# 3. no merged PR -> untouched.
[ -d "$open_wt" ] || fail "unmerged worktree was removed"
if grep -qF "removed: $open_wt" "$TMP_DIR/merged.out"; then
  fail "--merged removed a worktree whose PR is not merged"
fi

# 4. orphan directory -> reported, never removed.
grep -qF "ORPHAN: $orphan" "$TMP_DIR/merged.err" \
  || fail "--merged did not report the orphan directory"
[ -d "$orphan" ] || fail "orphan directory was removed"
[ -f "$orphan/.git" ] || fail "orphan directory contents were touched"

# 5. PR lookup itself failed (no network, no gh login) -> loud, not "nothing to do".
# A swallowed lookup error is indistinguishable from an empty sweep, which is the
# shape of the original bug: 126G sat behind an exit 0 that printed nothing.
failing_stub="$TMP_DIR/pr-merged-fail.sh"
{
  echo '#!/usr/bin/env bash'
  echo 'echo "gh: could not reach api.github.com" >&2'
  echo 'exit 1'
} >"$failing_stub"
chmod +x "$failing_stub"
lookup_rc=0
(cd "$repo" && WORKTREE_CLEANUP_PR_MERGED_CMD="$failing_stub" bash "$SCRIPT" --merged) \
  >"$TMP_DIR/lookup.out" 2>"$TMP_DIR/lookup.err" || lookup_rc=$?
[ "$lookup_rc" -ne 0 ] || fail "--merged exited 0 after every PR lookup failed"
grep -q "WARN: PR state lookup failed for feature/" "$TMP_DIR/lookup.err" \
  || fail "--merged did not report the failed PR lookup"
[ -d "$open_wt" ] || fail "worktree removed while PR state was unknown"

(cd "$repo" && bash "$SCRIPT" --prune) >"$TMP_DIR/prune.out" 2>"$TMP_DIR/prune.err"
grep -qF "ORPHAN: $orphan" "$TMP_DIR/prune.err" \
  || fail "--prune did not report the orphan directory"
[ -d "$orphan" ] || fail "--prune removed the orphan directory"

echo "PASS: worktree-cleanup"
