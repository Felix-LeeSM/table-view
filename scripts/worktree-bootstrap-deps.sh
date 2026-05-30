#!/usr/bin/env bash
# Bootstrap dependencies for an existing linked worktree.
#
# Usage:
#   bash scripts/worktree-bootstrap-deps.sh [--full-target] <worktree-path-or-branch> [source-root]
#
# Default source-root is the current repository. Run this from the primary repo
# when warming a worker worktree.

set -euo pipefail

usage() {
  cat <<EOF
worktree-bootstrap-deps.sh — warm-start an existing worktree

Usage:
  bash scripts/worktree-bootstrap-deps.sh [--full-target] <worktree-path-or-branch> [source-root]

Examples:
  bash scripts/worktree-bootstrap-deps.sh worktrees/issue-437
  bash scripts/worktree-bootstrap-deps.sh issue-437
  bash scripts/worktree-bootstrap-deps.sh --full-target worktrees/issue-437

Behavior:
  - copies node_modules when missing
  - copies or overlays src-tauri/target from source-root
  - default target copy is pruned: release/tmp/incremental/profraw/profdata removed
  - preserves llvm-cov-target and DuckDB native build outputs
  - runs pnpm install --frozen-lockfile and cargo fetch when available
EOF
}

PRUNE_TAURI_TARGET=1

while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h)
      usage
      exit 0
      ;;
    --full-target)
      PRUNE_TAURI_TARGET=0
      shift
      ;;
    --pruned-target)
      PRUNE_TAURI_TARGET=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "ERROR: unknown option: $1. See --help." >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

TARGET_ARG="${1:-}"
SOURCE_ARG="${2:-}"

if [ -z "$TARGET_ARG" ]; then
  echo "ERROR: worktree path or branch required. See --help." >&2
  exit 1
fi

if [ -n "$SOURCE_ARG" ]; then
  SOURCE_ROOT="$(git -C "$SOURCE_ARG" rev-parse --show-toplevel)"
else
  SOURCE_ROOT="$(git rev-parse --show-toplevel)"
fi

if [ "${TARGET_ARG#/}" != "$TARGET_ARG" ]; then
  TARGET_PATH="$TARGET_ARG"
elif [ -d "$TARGET_ARG" ] || [[ "$TARGET_ARG" == worktrees/* ]]; then
  TARGET_PATH="$SOURCE_ROOT/$TARGET_ARG"
else
  SANITIZED="${TARGET_ARG//\//__}"
  TARGET_PATH="$SOURCE_ROOT/worktrees/$SANITIZED"
fi

if [ ! -d "$TARGET_PATH" ]; then
  echo "ERROR: target worktree does not exist: $TARGET_PATH" >&2
  exit 1
fi

SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"
TARGET_PATH="$(cd "$TARGET_PATH" && pwd)"

if [ "$SOURCE_ROOT" = "$TARGET_PATH" ]; then
  echo "ERROR: source root and target worktree are the same path." >&2
  echo "       Run from the primary repo or pass source-root explicitly." >&2
  exit 1
fi

TARGET_TOPLEVEL="$(git -C "$TARGET_PATH" rev-parse --show-toplevel 2>/dev/null || true)"
if [ "$TARGET_TOPLEVEL" != "$TARGET_PATH" ]; then
  echo "ERROR: target is not a clean git worktree toplevel." >&2
  echo "       target: $TARGET_PATH" >&2
  echo "       git top: ${TARGET_TOPLEVEL:-<none>}" >&2
  exit 1
fi

copy_dir_if_missing() {
  local rel_path="$1"
  local src="$SOURCE_ROOT/$rel_path"
  local dst="$TARGET_PATH/$rel_path"

  if [ ! -d "$src" ]; then
    echo "deps: skip missing $rel_path" >&2
    return 0
  fi

  if [ -e "$dst" ]; then
    echo "deps: skip existing $rel_path" >&2
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  echo "deps: copy $rel_path" >&2
  if command -v rsync >/dev/null 2>&1; then
    rsync -a -- "$src/" "$dst/"
  else
    cp -R -p "$src" "$dst"
  fi
}

prune_tauri_target() {
  local dst="$TARGET_PATH/src-tauri/target"

  rm -rf -- "$dst/release" "$dst/tmp"

  if [ -d "$dst" ]; then
    find "$dst" -type d -name incremental -prune -exec rm -rf -- {} +
    find "$dst" \( -name '*.profraw' -o -name '*.profdata' \) -type f -exec rm -f -- {} +
  fi
}

rsync_tauri_target() {
  local src="$SOURCE_ROOT/src-tauri/target"
  local dst="$TARGET_PATH/src-tauri/target"
  local ignore_existing="$1"
  local args=(-a)

  if [ "$ignore_existing" = "1" ]; then
    args+=(--ignore-existing)
  fi

  if [ "$PRUNE_TAURI_TARGET" -eq 1 ]; then
    args+=(
      "--exclude=/release/"
      "--exclude=/tmp/"
      "--exclude=*/incremental/"
      "--exclude=*.profraw"
      "--exclude=*.profdata"
    )
  fi

  mkdir -p "$dst"
  rsync "${args[@]}" -- "$src/" "$dst/"
}

copy_tauri_target() {
  local src="$SOURCE_ROOT/src-tauri/target"
  local dst="$TARGET_PATH/src-tauri/target"

  if [ ! -d "$src" ]; then
    echo "deps: skip missing src-tauri/target" >&2
    return 0
  fi

  if [ -e "$dst" ]; then
    echo "deps: refresh missing src-tauri/target entries" >&2
    if command -v rsync >/dev/null 2>&1; then
      rsync_tauri_target "1"
      [ "$PRUNE_TAURI_TARGET" -eq 0 ] || prune_tauri_target
    else
      echo "WARN: rsync not found; existing src-tauri/target left unchanged" >&2
    fi
    return 0
  fi

  mkdir -p "$(dirname "$dst")"

  if [ "$PRUNE_TAURI_TARGET" -eq 0 ]; then
    echo "deps: copy src-tauri/target (full)" >&2
    copy_dir_if_missing "src-tauri/target"
    return 0
  fi

  echo "deps: copy src-tauri/target (pruned)" >&2

  if [ "$(uname -s 2>/dev/null || echo '')" = "Darwin" ]; then
    if cp -cR "$src" "$dst"; then
      prune_tauri_target
      return 0
    fi
    rm -rf -- "$dst"
  fi

  if command -v rsync >/dev/null 2>&1; then
    rsync_tauri_target "0"
    prune_tauri_target
  else
    cp -R -p "$src" "$dst"
    prune_tauri_target
  fi
}

copy_dir_if_missing "node_modules"
copy_tauri_target

if [ -f "$TARGET_PATH/package.json" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    echo "deps: pnpm install --frozen-lockfile" >&2
    (cd "$TARGET_PATH" && pnpm install --frozen-lockfile)
  else
    echo "WARN: pnpm not found; skipped pnpm install" >&2
  fi
fi

if [ -f "$TARGET_PATH/src-tauri/Cargo.toml" ]; then
  if command -v cargo >/dev/null 2>&1; then
    echo "deps: cargo fetch --manifest-path src-tauri/Cargo.toml" >&2
    (cd "$TARGET_PATH" && cargo fetch --manifest-path src-tauri/Cargo.toml)
  else
    echo "WARN: cargo not found; skipped cargo fetch" >&2
  fi
fi
