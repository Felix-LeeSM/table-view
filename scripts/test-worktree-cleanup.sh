#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$ROOT/scripts/worktree-cleanup.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

repo="$TMP_DIR/repo"
origin="$TMP_DIR/origin.git"

git init -q -b main "$repo"
git -C "$repo" config user.email "test@example.com"
git -C "$repo" config user.name "Test User"
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
