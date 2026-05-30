#!/usr/bin/env bash
# Fail early in linked worktrees when staged Rust files would trigger expensive
# native rebuilds without a warmed dependency cache.

set -euo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

TOPLEVEL="$(git rev-parse --show-toplevel)"

STAGED_RUST="$(git diff --cached --name-only --diff-filter=ACMR -- '*.rs' || true)"
if [ -z "$STAGED_RUST" ]; then
  exit 0
fi

case "$TOPLEVEL" in
  */worktrees/*) ;;
  *) exit 0 ;;
esac

has_duckdb_build_cache() {
  local base="$1"

  [ -d "$base/build" ] || return 1
  find "$base/build" -mindepth 1 -maxdepth 1 -type d -name 'libduckdb-sys-*' -print -quit | grep -q .
}

missing=()

if [ ! -d "$TOPLEVEL/src-tauri/target" ]; then
  missing+=("src-tauri/target")
else
  if ! has_duckdb_build_cache "$TOPLEVEL/src-tauri/target/debug"; then
    missing+=("src-tauri/target/debug/build/libduckdb-sys-*")
  fi

  if ! has_duckdb_build_cache "$TOPLEVEL/src-tauri/target/llvm-cov-target/debug"; then
    missing+=("src-tauri/target/llvm-cov-target/debug/build/libduckdb-sys-*")
  fi
fi

if [ "${#missing[@]}" -eq 0 ]; then
  exit 0
fi

echo "ERROR: Rust pre-commit is running in an unbootstrapped worktree." >&2
echo "       Starting Cargo here can rebuild DuckDB from source." >&2
echo "       worktree: $TOPLEVEL" >&2
echo "       missing:" >&2
for item in "${missing[@]}"; do
  echo "         - $item" >&2
done
echo "" >&2
echo "Fix from the primary repo:" >&2
echo "  bash scripts/worktree-bootstrap-deps.sh \"$TOPLEVEL\"" >&2
echo "" >&2
echo "Or recreate the worker with:" >&2
echo "  bash scripts/worktree-spawn.sh <branch>" >&2
exit 1
