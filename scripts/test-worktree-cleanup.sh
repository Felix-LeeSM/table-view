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
#   old="$(mktemp)"
#   git show <ref>:scripts/worktree-cleanup.sh >"$old"
#   WORKTREE_CLEANUP_SCRIPT="$old" bash scripts/test-worktree-cleanup.sh
#
# It is also how every mutant below is run: one edit, one copy, one command.
SCRIPT="${WORKTREE_CLEANUP_SCRIPT:-$ROOT/scripts/worktree-cleanup.sh}"
TMP_DIR="$(fixture_mktemp worktree-cleanup-check)"
trap '[ -n "${WORKTREE_CLEANUP_KEEP_FIXTURE:-}" ] && echo "KEPT: $TMP_DIR" >&2 || rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

repo="$TMP_DIR/repo"
origin="$TMP_DIR/origin.git"

fixture_init_repo "$repo"
printf 'base\n' >"$repo/README.md"
printf 'worktrees/\nlocal-notes.txt\n' >"$repo/.gitignore"
git -C "$repo" add README.md .gitignore
git -C "$repo" commit -q -m "init"
git clone -q --bare "$repo" "$origin"
git -C "$repo" remote add origin "$origin"
git -C "$repo" push -q -u origin main
repo="$(cd "$repo" && pwd -P)"

# One worktree per behaviour the sweep has to get right. The directory name is
# the branch with `/` sanitized, which is what worktree-spawn.sh produces.
for branch in feature/squashed feature/dirty feature/open feature/untracked \
  feature/ahead feature/garbage feature/fork feature/broken b2/cwd b2/next; do
  path="$repo/worktrees/${branch//\//__}"
  git -C "$repo" worktree add -q -b "$branch" "$path" main
  # One file per branch: two branches touching the same path would collide in
  # the squash merges below and the fixture would fail for an unrelated reason.
  printf '%s work\n' "$branch" >"$path/${branch//\//__}.txt"
  git -C "$path" add "${branch//\//__}.txt"
  git -C "$path" commit -q -m "work on $branch"
done

squashed="$repo/worktrees/feature__squashed"
dirty="$repo/worktrees/feature__dirty"
open_wt="$repo/worktrees/feature__open"
untracked="$repo/worktrees/feature__untracked"
ahead="$repo/worktrees/feature__ahead"
garbage="$repo/worktrees/feature__garbage"
fork="$repo/worktrees/feature__fork"
broken="$repo/worktrees/feature__broken"
b2cwd="$repo/worktrees/b2__cwd"
b2next="$repo/worktrees/b2__next"
orphan="$repo/worktrees/feature__orphan"

# GitHub's squash merge: main gets the branch's TREE under a new commit, and the
# branch tip never becomes an ancestor of main.
for branch in feature/squashed feature/dirty feature/untracked; do
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

# feature/ahead: the PR was merged, then another commit landed on the branch. The
# merged head is an ancestor of the tip, which is the direction that must NOT
# count as merged — the extra commit was never merged anywhere.
ahead_merged_oid="$(git -C "$ahead" rev-parse HEAD)"
printf 'after the merge\n' >"$ahead/after.txt"
git -C "$ahead" add after.txt
git -C "$ahead" commit -q -m "work after the merge"

# 51 uncommitted lines of real work sat in a merged PR's worktree on 2026-07-29.
printf 'uncommitted work\n' >>"$dirty/feature__dirty.txt"
# Untracked-only is dirty too: nothing has ever committed this file.
printf 'scratch\n' >"$untracked/scratch.txt"
# Ignored local state. It is not dirty, it goes with the directory, and the only
# thing between it and silence is the NOTE the sweep prints.
printf 'local\n' >"$squashed/local-notes.txt"

# The measured orphan: `.git` points at the repository's path from BEFORE it was
# renamed, so git cannot answer for this directory at all and it never appears in
# `git worktree list`. `--prune` handles only the opposite direction (metadata
# present, directory gone).
mkdir -p "$orphan"
printf 'gitdir: %s\n' "$TMP_DIR/renamed-away/.git/worktrees/feature__orphan" >"$orphan/.git"

# feature/broken is registered but git cannot answer for it: its `.git` file
# points at a gitdir that does not exist, which is what a renamed repository
# leaves behind. `git status` there fails, and a failed status is not "clean".
printf 'gitdir: %s\n' "$TMP_DIR/renamed-away/.git/worktrees/feature__broken" >"$broken/.git"

for name in squashed dirty open_wt untracked ahead garbage fork broken b2cwd b2next orphan; do
  eval "$name=\"\$(cd \"\${$name}\" && pwd -P)\""
done

# Stands in for `gh pr list --head <branch> --state merged --json headRefOid
# --jq '.[].headRefOid'`. The suite must not need network or a gh login, so the
# lookup is injected: one file per branch holding what GitHub would answer.
make_stub() {
  local stub="$1" dir="$2"
  mkdir -p "$dir"
  {
    echo '#!/usr/bin/env bash'
    printf 'f="%s/${1//\\//__}"\n' "$dir"
    echo '[ -f "$f" ] && cat "$f"'
    echo 'exit 0'
  } >"$stub"
  chmod +x "$stub"
}

oids="$TMP_DIR/oids"
stub="$TMP_DIR/pr-merged-stub.sh"
make_stub "$stub" "$oids"
git -C "$squashed" rev-parse HEAD >"$oids/feature__squashed"
git -C "$dirty" rev-parse HEAD >"$oids/feature__dirty"
git -C "$untracked" rev-parse HEAD >"$oids/feature__untracked"
printf '%s\n' "$ahead_merged_oid" >"$oids/feature__ahead"
git -C "$repo" rev-parse HEAD >"$oids/main"
# What a broken lookup looks like when it still exits 0: `--jq` over an
# unexpected shape answers `null`. That must not read as "merged", and must not
# read as "not merged" either.
printf 'null\n' >"$oids/feature__garbage"
# A well-formed commit id this repository has never seen: what a PR from a fork
# answers. Unknown is not "not merged", and it is certainly not "delete it".
printf '%s\n' "0123456789abcdef0123456789abcdef01234567" >"$oids/feature__fork"
git -C "$repo" rev-parse "refs/heads/feature/broken" >"$oids/feature__broken"
export WORKTREE_CLEANUP_PR_MERGED_CMD="$stub"

if (cd "$repo" && bash "$SCRIPT" feature/dirty) >"$TMP_DIR/dirty.out" 2>"$TMP_DIR/dirty.err"; then
  fail "explicit dirty cleanup should fail"
fi
grep -q "SKIP: dirty worktree not removed" "$TMP_DIR/dirty.err" \
  || fail "dirty cleanup did not explain skip"
[ -d "$dirty" ] || fail "dirty worktree was removed"

merged_rc=0
(cd "$repo" && bash "$SCRIPT" --merged) >"$TMP_DIR/merged.out" 2>"$TMP_DIR/merged.err" || merged_rc=$?

# 1. squash-merged, clean, tip is the merged head -> removed.
grep -qF "removed: $squashed" "$TMP_DIR/merged.out" \
  || fail "--merged did not remove the squash-merged worktree"
[ ! -d "$squashed" ] || fail "squash-merged worktree still exists"

# 1b. its ignored local state was named before it went.
grep -qF "NOTE: ignored local files are deleted with this worktree: $squashed" "$TMP_DIR/merged.err" \
  || fail "--merged deleted ignored local state without naming it"
grep -q '!! local-notes.txt' "$TMP_DIR/merged.err" \
  || fail "--merged did not list the ignored file it deleted"

# 2. squash-merged and dirty -> skipped, work intact.
grep -q "SKIP: dirty worktree not removed" "$TMP_DIR/merged.err" \
  || fail "--merged did not report dirty skip"
[ -d "$dirty" ] || fail "dirty worktree was removed by --merged"
grep -q "uncommitted work" "$dirty/feature__dirty.txt" \
  || fail "uncommitted work in the dirty worktree was lost"
[ "$merged_rc" -ne 0 ] || fail "--merged should fail when any merged worktree is dirty"

# 3. squash-merged holding only an untracked file -> still dirty, still skipped.
[ -d "$untracked" ] || fail "worktree holding only untracked files was removed"
[ -f "$untracked/scratch.txt" ] || fail "untracked file was deleted"
grep -qF "SKIP: dirty worktree not removed: $untracked" "$TMP_DIR/merged.err" \
  || fail "--merged did not skip the worktree holding only untracked files"

# 4. no merged PR -> untouched.
[ -d "$open_wt" ] || fail "unmerged worktree was removed"
if grep -qF "removed: $open_wt" "$TMP_DIR/merged.out"; then
  fail "--merged removed a worktree whose PR is not merged"
fi

# 5. a merged PR exists but the tip is not in it (commits after the merge, or a
# reused branch name) -> untouched, and said out loud.
[ -d "$ahead" ] || fail "worktree with commits after the merge was removed"
grep -q "SKIP: feature/ahead has a merged PR but its tip" "$TMP_DIR/merged.err" \
  || fail "--merged did not explain why the ahead branch was kept"

# 6. the lookup answered something that is not a commit id -> loud, not a silent
# downgrade to "not merged", and above all not a removal.
[ -d "$garbage" ] || fail "worktree was removed on an unusable lookup answer"
grep -q "WARN: PR lookup for feature/garbage answered something that is not a commit id" "$TMP_DIR/merged.err" \
  || fail "--merged swallowed an unusable lookup answer"

# 6b. the merged head is well formed but not in this repository (a fork PR):
# undecidable, so loud and kept — not quietly downgraded to "not merged".
[ -d "$fork" ] || fail "worktree was removed on a merged head this repository does not have"
grep -q "WARN: merged PR head 0123456789abcdef0123456789abcdef01234567 for feature/fork is not in this repository" "$TMP_DIR/merged.err" \
  || fail "--merged did not report the unresolvable merged head"

# 6c. the worktree's own state cannot be read at all -> refuse, never remove.
# A failed `git status` used to be indistinguishable from a clean one.
[ -d "$broken" ] || fail "worktree with an unreadable state was removed"
grep -qF "REFUSE: cannot read worktree state, not removing: $broken" "$TMP_DIR/merged.err" \
  || fail "--merged did not refuse the worktree it could not read"

# 7. the main worktree is never a target, even when the lookup calls it merged.
grep -qF "REFUSE: not removing the main worktree: $repo" "$TMP_DIR/merged.err" \
  || fail "--merged did not refuse the main worktree"
[ -f "$repo/README.md" ] || fail "main worktree was damaged"

# 8. orphan directory -> reported, never removed.
grep -qF "ORPHAN: $orphan" "$TMP_DIR/merged.err" \
  || fail "--merged did not report the orphan directory"
[ -d "$orphan" ] || fail "orphan directory was removed"
[ -f "$orphan/.git" ] || fail "orphan directory contents were touched"

# 9. the sweep always says what it did. An empty sweep that prints nothing is
# indistinguishable from a broken one, which is how #1932 stayed invisible.
grep -q "scanned 11 worktree(s): removed 1, kept 10" "$TMP_DIR/merged.err" \
  || fail "--merged did not summarise what it did"

# 10. run from inside a linked worktree: the current one is kept, and the sweep
# does not truncate after it. `b2/*` were not merged for the run above.
oids2="$TMP_DIR/oids-b2"
stub2="$TMP_DIR/pr-merged-stub-b2.sh"
make_stub "$stub2" "$oids2"
git -C "$b2cwd" rev-parse HEAD >"$oids2/b2__cwd"
git -C "$b2next" rev-parse HEAD >"$oids2/b2__next"
inner_rc=0
(cd "$b2cwd" && WORKTREE_CLEANUP_PR_MERGED_CMD="$stub2" bash "$SCRIPT" --merged) \
  >"$TMP_DIR/inner.out" 2>"$TMP_DIR/inner.err" || inner_rc=$?
[ "$inner_rc" -ne 0 ] || fail "--merged from inside a worktree exited 0 after skipping it"
grep -qF "REFUSE: not removing the worktree this command runs from: $b2cwd" "$TMP_DIR/inner.err" \
  || fail "--merged removed or ignored the worktree it was run from"
[ -d "$b2cwd" ] || fail "--merged deleted the directory it was standing in"
grep -qF "removed: $b2next" "$TMP_DIR/inner.out" \
  || fail "--merged truncated after the worktree it was run from"
[ ! -d "$b2next" ] || fail "the merged worktree after the current one survived"
grep -qF "ORPHAN: $orphan" "$TMP_DIR/inner.err" \
  || fail "--merged from inside a worktree looked for orphans in the wrong root"

# 11. a lookup that fails outright is loud, not "nothing to do".
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
grep -q "could not reach api.github.com" "$TMP_DIR/lookup.err" \
  || fail "--merged did not pass the lookup's own error through"
[ -d "$open_wt" ] || fail "worktree removed while PR state was unknown"

(cd "$repo" && bash "$SCRIPT" --prune) >"$TMP_DIR/prune.out" 2>"$TMP_DIR/prune.err"
grep -qF "ORPHAN: $orphan" "$TMP_DIR/prune.err" \
  || fail "--prune did not report the orphan directory"
[ -d "$orphan" ] || fail "--prune removed the orphan directory"

# 12. the removal must stay unforced. Measured on git 2.50.1: plain
# `git worktree remove` refuses a worktree holding modified or untracked files
# (rc=128) and `--force` deletes it (rc=0). With the dirty check in front of it
# that refusal is unreachable in a passing run, so no behavioural assertion can
# see it — and an unreachable backstop is exactly what gets "simplified" away.
if awk '!/^[[:space:]]*#/ && /git worktree remove/' "$SCRIPT" \
  | grep -qE '(^|[[:space:]])(-f|--force)([[:space:]]|$)'; then
  fail "git worktree remove must not carry a force flag: it is the last guard against deleting modified files"
fi

echo "PASS: worktree-cleanup"
