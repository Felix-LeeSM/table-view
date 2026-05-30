#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
HOOK="$ROOT/scripts/hooks/check-worktree-bootstrap.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_repo() {
  local repo="$TMP_DIR/repo"

  git init -q -b main "$repo"
  git -C "$repo" config user.email "test@example.com"
  git -C "$repo" config user.name "Test User"
  mkdir -p "$repo/src-tauri/src"
  printf 'pub fn base() {}\n' >"$repo/src-tauri/src/lib.rs"
  git -C "$repo" add src-tauri/src/lib.rs
  git -C "$repo" commit -q -m "init"

  echo "$repo"
}

stage_rust_change() {
  local worktree="$1"
  local symbol="$2"

  printf '\npub fn %s() {}\n' "$symbol" >>"$worktree/src-tauri/src/lib.rs"
  git -C "$worktree" add src-tauri/src/lib.rs
}

repo="$(make_repo)"

missing="$repo/worktrees/missing-cache"
git -C "$repo" worktree add -q -b missing-cache "$missing" main
stage_rust_change "$missing" "missing_cache"
if (cd "$missing" && "$HOOK") >"$TMP_DIR/missing.out" 2>"$TMP_DIR/missing.err"; then
  fail "missing cache worktree should fail"
fi
grep -q "unbootstrapped worktree" "$TMP_DIR/missing.err" \
  || fail "missing cache error did not explain bootstrap failure"

no_rust="$repo/worktrees/no-rust"
git -C "$repo" worktree add -q -b no-rust "$no_rust" main
(cd "$no_rust" && "$HOOK") >"$TMP_DIR/no-rust.out" 2>"$TMP_DIR/no-rust.err" \
  || fail "worktree with no staged Rust should pass"

ready="$repo/worktrees/ready-cache"
git -C "$repo" worktree add -q -b ready-cache "$ready" main
mkdir -p \
  "$ready/src-tauri/target/debug/build/libduckdb-sys-test" \
  "$ready/src-tauri/target/llvm-cov-target/debug/build/libduckdb-sys-test"
stage_rust_change "$ready" "ready_cache"
(cd "$ready" && "$HOOK") >"$TMP_DIR/ready.out" 2>"$TMP_DIR/ready.err" \
  || fail "bootstrapped Rust worktree should pass"

echo "PASS: check-worktree-bootstrap"
