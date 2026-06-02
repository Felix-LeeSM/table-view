#!/usr/bin/env bash
# Smoke tests for scripts/hooks/check-signed-commits.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/hooks/check-signed-commits.sh"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/signed-commits-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

git -C "$TMP_DIR" init --quiet
git -C "$TMP_DIR" config user.name "Test User"
git -C "$TMP_DIR" config user.email "test@example.invalid"
git -C "$TMP_DIR" config commit.gpgsign false
git -C "$TMP_DIR" remote add origin "$TMP_DIR"

printf 'one\n' >"$TMP_DIR/file.txt"
git -C "$TMP_DIR" add file.txt
git -C "$TMP_DIR" commit --quiet -m "test: unsigned commit"
UNSIGNED_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"

ZERO_OID="0000000000000000000000000000000000000000"

set +e
stderr="$(
  cd "$TMP_DIR" &&
    printf 'refs/heads/main %s refs/heads/main %s\n' "$UNSIGNED_SHA" "$ZERO_OID" |
      "$CHECK" 2>&1 >/dev/null
)"
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo "FAIL: unsigned commit was allowed" >&2
  exit 1
fi

if ! grep -q "unsigned outgoing commit" <<<"$stderr"; then
  echo "FAIL: missing unsigned commit diagnostic" >&2
  echo "$stderr" >&2
  exit 1
fi

set +e
empty_stderr="$(
  cd "$TMP_DIR" &&
    printf 'refs/heads/main %s refs/heads/main %s\n' "$UNSIGNED_SHA" "$UNSIGNED_SHA" |
      "$CHECK" 2>&1 >/dev/null
)"
empty_exit=$?
set -e

if [ "$empty_exit" -ne 0 ] || [ -n "$empty_stderr" ]; then
  echo "FAIL: empty outgoing range should pass silently" >&2
  echo "$empty_stderr" >&2
  exit 1
fi

printf 'two\n' >>"$TMP_DIR/file.txt"
git -C "$TMP_DIR" add file.txt
git -C "$TMP_DIR" commit --quiet -m "test: unsigned commit already on origin main"
REMOTE_MAIN_SHA="$(git -C "$TMP_DIR" rev-parse HEAD)"
git -C "$TMP_DIR" update-ref refs/remotes/origin/main "$REMOTE_MAIN_SHA"

set +e
remote_main_stderr="$(
  cd "$TMP_DIR" &&
    printf 'refs/heads/feature %s refs/heads/feature %s\n' "$REMOTE_MAIN_SHA" "$UNSIGNED_SHA" |
      "$CHECK" 2>&1 >/dev/null
)"
remote_main_exit=$?
set -e

if [ "$remote_main_exit" -ne 0 ] || [ -n "$remote_main_stderr" ]; then
  echo "FAIL: commits already present on origin remotes should not be rechecked" >&2
  echo "$remote_main_stderr" >&2
  exit 1
fi

git -C "$TMP_DIR" update-ref refs/remotes/origin/feature "$UNSIGNED_SHA"
git -C "$TMP_DIR" switch --quiet -c feature "$REMOTE_MAIN_SHA"
git -C "$TMP_DIR" config branch.feature.remote origin
git -C "$TMP_DIR" config branch.feature.merge refs/heads/feature
fallback_range="$(git -C "$TMP_DIR" rev-list '@{u}'..HEAD)"
if ! grep -q "$REMOTE_MAIN_SHA" <<<"$fallback_range"; then
  echo "FAIL: fallback test did not create an upstream..HEAD range" >&2
  echo "$fallback_range" >&2
  exit 1
fi

set +e
fallback_stderr="$(
  cd "$TMP_DIR" &&
    "$CHECK" 2>&1 >/dev/null </dev/null
)"
fallback_exit=$?
set -e

if [ "$fallback_exit" -ne 0 ] || [ -n "$fallback_stderr" ]; then
  echo "FAIL: fallback upstream range should ignore commits already on origin remotes" >&2
  echo "$fallback_stderr" >&2
  exit 1
fi

echo "PASS: check-signed-commits smoke tests"
