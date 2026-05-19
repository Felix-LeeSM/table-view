#!/usr/bin/env bash
# check-signed-commits.sh — pre-push gate for outgoing unsigned commits.
#
# Reads git pre-push stdin when available:
#   <local-ref> <local-oid> <remote-ref> <remote-oid>
# Falls back to @{u}..HEAD or commits not in origin remotes for manual runs.

set -euo pipefail

ZERO_OID="0000000000000000000000000000000000000000"
TMP_COMMITS="$(mktemp "${TMPDIR:-/tmp}/signed-commits.XXXXXX")"
trap 'rm -f "$TMP_COMMITS"' EXIT

append_commits_for_range() {
  local local_oid="$1"
  local remote_oid="$2"

  if [ "$local_oid" = "$ZERO_OID" ]; then
    return 0
  fi
  if ! git cat-file -e "${local_oid}^{commit}" 2>/dev/null; then
    return 0
  fi

  if [ "$remote_oid" = "$ZERO_OID" ]; then
    git rev-list "$local_oid" --not --remotes=origin >>"$TMP_COMMITS"
  else
    git rev-list "${remote_oid}..${local_oid}" >>"$TMP_COMMITS"
  fi
}

read_stdin_ranges() {
  local saw_input=0
  while read -r local_ref local_oid remote_ref remote_oid; do
    saw_input=1
    append_commits_for_range "$local_oid" "$remote_oid"
  done
  [ "$saw_input" = "1" ]
}

fallback_current_branch() {
  local upstream
  upstream="$(git rev-parse --verify --quiet '@{u}' 2>/dev/null || true)"
  if [ -n "$upstream" ]; then
    git rev-list "${upstream}..HEAD" >>"$TMP_COMMITS"
  else
    git rev-list HEAD --not --remotes=origin >>"$TMP_COMMITS"
  fi
}

if [ -t 0 ]; then
  fallback_current_branch
else
  if ! read_stdin_ranges; then
    fallback_current_branch
  fi
fi

if [ ! -s "$TMP_COMMITS" ]; then
  exit 0
fi

sort -u "$TMP_COMMITS" -o "$TMP_COMMITS"

failures=0
while read -r commit; do
  [ -n "$commit" ] || continue
  sig_status="$(git log -1 --format='%G?' "$commit")"
  subject="$(git log -1 --format='%s' "$commit")"
  case "$sig_status" in
    G | U)
      ;;
    N)
      echo "ERROR: unsigned outgoing commit: ${commit} ${subject}" >&2
      failures=$((failures + 1))
      ;;
    *)
      echo "ERROR: outgoing commit signature is not good (${sig_status}): ${commit} ${subject}" >&2
      failures=$((failures + 1))
      ;;
  esac
done <"$TMP_COMMITS"

if [ "$failures" -gt 0 ]; then
  cat >&2 <<'EOF'

GPG signing is required. Do not use --no-gpg-sign or commit.gpgsign=false.
If pinentry timed out, stop and ask the user to warm up gpg-agent cache.
EOF
  exit 1
fi

exit 0
