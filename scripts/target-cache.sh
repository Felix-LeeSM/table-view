#!/usr/bin/env bash
# Manual Rust target warm-up/copy helper.
#
# No automatic stale judgment, no separate cache directory, and no lock. Run it
# explicitly when you want to warm a checkout or copy one checkout's Rust target
# caches into another. Test binaries are the main payload: default warm-up must
# keep both the debug nextest lane and the llvm-cov nextest lane hot.

set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PUSH_TESTS=(
  storage_integration
  query_integration
  schema_integration
  fixture_loading
  mongo_integration
  mysql_integration
  duckdb_file_analytics
  mariadb_ddl_preview
)

usage() {
  cat <<EOF
target-cache.sh - manual Rust target helper

Usage:
  bash scripts/target-cache.sh [repo-root]
  bash scripts/target-cache.sh --debug-only [repo-root]
  bash scripts/target-cache.sh --coverage-only [repo-root]
  bash scripts/target-cache.sh copy <source-repo-root> <target-repo-root>
  bash scripts/target-cache.sh copy-from <source-repo-root> [target-repo-root]
  bash scripts/target-cache.sh copy-to <target-repo-root> [source-repo-root]

Behavior:
  warm-all            compile all routine Rust test warm-start caches (default)
  --debug-only        compile cargo-check and push-profile test binaries
  --coverage-only     compile llvm-cov push-profile test binaries without running tests
  copy                overlay Rust target caches from source repo into target repo

Copy notes:
  - copy uses rsync --ignore-existing, so existing target files are not replaced.
  - top-level release, tmp, incremental, profraw, and profdata outputs are excluded.
  - debug/coverage test deps, llvm-cov-target, and DuckDB native build outputs are preserved.
  - SQL/Mongo parser-core target caches are copied when present.
  - Generated WASM artifacts are tracked files and are not copied. Use pnpm
    build:sql-wasm and pnpm build:mongosh-wasm when those artifacts must change.
EOF
}

repo_root() {
  local path="${1:-$SCRIPT_ROOT}"

  git -C "$path" rev-parse --show-toplevel
}

require_rsync() {
  if ! command -v rsync >/dev/null 2>&1; then
    echo "ERROR: rsync is required for target copy." >&2
    exit 1
  fi
}

require_nextest() {
  if ! command -v cargo-nextest >/dev/null 2>&1; then
    echo "ERROR: cargo-nextest is missing." >&2
    echo "       Run 'bash scripts/setup.sh' and retry." >&2
    exit 1
  fi
}

require_coverage_tools() {
  require_nextest

  if ! rustup component list --installed 2>/dev/null | grep -q '^llvm-tools'; then
    echo "ERROR: rustup llvm-tools-preview component is missing." >&2
    echo "       Run 'bash scripts/setup.sh' and retry." >&2
    exit 1
  fi

  if ! cargo llvm-cov --version >/dev/null 2>&1; then
    echo "ERROR: cargo-llvm-cov is missing." >&2
    echo "       Run 'bash scripts/setup.sh' and retry." >&2
    exit 1
  fi
}

build_nextest_target_args() {
  NEXTEST_TARGET_ARGS=(--lib)

  local test_name
  for test_name in "${PUSH_TESTS[@]}"; do
    NEXTEST_TARGET_ARGS+=(--test "$test_name")
  done
}

copy_target() {
  local source_root="$1"
  local target_root="$2"

  require_rsync

  if [ ! -d "$target_root/src-tauri" ]; then
    echo "ERROR: target repo has no src-tauri directory: $target_root" >&2
    exit 1
  fi

  copy_target_dir "$source_root" "$target_root" "src-tauri/target" "required"
  copy_target_dir "$source_root" "$target_root" "src-tauri/sql-parser-core/target" "optional"
  copy_target_dir "$source_root" "$target_root" "src-tauri/mongosh-parser-core/target" "optional"
  echo "target-cache: copy complete" >&2
}

copy_target_dir() {
  local source_root="$1"
  local target_root="$2"
  local rel_path="$3"
  local mode="$4"
  local source_target="$source_root/$rel_path"
  local target_target="$target_root/$rel_path"

  if [ ! -d "$source_target" ]; then
    if [ "$mode" = "required" ]; then
      echo "ERROR: source target does not exist: $source_target" >&2
      exit 1
    fi
    echo "target-cache: skip missing $rel_path" >&2
    return 0
  fi

  mkdir -p "$target_target"
  echo "target-cache: copy $source_target -> $target_target" >&2
  rsync -a --ignore-existing \
    --exclude=/release/ \
    --exclude=/tmp/ \
    --exclude='*/incremental/' \
    --exclude='*.profraw' \
    --exclude='*.profdata' \
    -- "$source_target/" "$target_target/"
}

warm_rust_debug() {
  local root
  root="$(repo_root "${1:-$SCRIPT_ROOT}")"

  require_nextest
  echo "target-cache: compiling cargo-check and debug push-profile test binaries in $root" >&2
  (
    cd "$root/src-tauri"
    cargo check
    build_nextest_target_args
    cargo nextest list --profile push --target-dir target "${NEXTEST_TARGET_ARGS[@]}" >/dev/null
  )
  echo "target-cache: debug warm-up complete" >&2
}

warm_rust_coverage() {
  local root
  root="$(repo_root "${1:-$SCRIPT_ROOT}")"

  require_coverage_tools
  echo "target-cache: compiling llvm-cov push-profile test binaries in $root" >&2
  (
    cd "$root/src-tauri"
    build_nextest_target_args
    eval "$(CARGO_TARGET_DIR=target/llvm-cov-target cargo llvm-cov show-env --sh)"
    cargo nextest list --profile push --target-dir target/llvm-cov-target "${NEXTEST_TARGET_ARGS[@]}" >/dev/null
  )
  echo "target-cache: llvm-cov warm-up complete" >&2
}

warm_all() {
  local root
  root="$(repo_root "${1:-$SCRIPT_ROOT}")"

  echo "target-cache: warming all routine Rust target caches in $root" >&2
  warm_rust_debug "$root"
  warm_rust_coverage "$root"
  echo "target-cache: all warm-ups complete" >&2
}

command="${1:-}"
case "$command" in
  "")
    warm_all "$SCRIPT_ROOT"
    ;;
  --help | -h | help)
    usage
    ;;
  warm-all | all)
    shift
    warm_all "${1:-$SCRIPT_ROOT}"
    ;;
  --debug-only | --debug)
    shift
    warm_rust_debug "${1:-$SCRIPT_ROOT}"
    ;;
  --coverage-only | --coverage)
    shift
    warm_rust_coverage "${1:-$SCRIPT_ROOT}"
    ;;
  warm-rust-debug)
    shift
    warm_rust_debug "${1:-$SCRIPT_ROOT}"
    ;;
  warm-rust-coverage)
    shift
    warm_rust_coverage "${1:-$SCRIPT_ROOT}"
    ;;
  copy)
    shift
    if [ $# -ne 2 ]; then
      echo "ERROR: copy requires <source-repo-root> <target-repo-root>." >&2
      usage >&2
      exit 1
    fi
    copy_target "$(repo_root "$1")" "$(repo_root "$2")"
    ;;
  copy-from)
    shift
    if [ $# -lt 1 ] || [ $# -gt 2 ]; then
      echo "ERROR: copy-from requires <source-repo-root> [target-repo-root]." >&2
      usage >&2
      exit 1
    fi
    copy_target "$(repo_root "$1")" "$(repo_root "${2:-$SCRIPT_ROOT}")"
    ;;
  copy-to)
    shift
    if [ $# -lt 1 ] || [ $# -gt 2 ]; then
      echo "ERROR: copy-to requires <target-repo-root> [source-repo-root]." >&2
      usage >&2
      exit 1
    fi
    copy_target "$(repo_root "${2:-$SCRIPT_ROOT}")" "$(repo_root "$1")"
    ;;
  -*)
    echo "ERROR: unknown option: $command" >&2
    usage >&2
    exit 1
    ;;
  *)
    if git -C "$command" rev-parse --show-toplevel >/dev/null 2>&1; then
      warm_all "$command"
    else
      usage >&2
      exit 1
    fi
    ;;
esac
