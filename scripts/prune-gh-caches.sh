#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
DRY_RUN="${PRUNE_DRY_RUN:-false}"
MAX_AGE_DAYS="${PRUNE_MAX_AGE_DAYS:-30}"
MIN_SIZE_GB="${PRUNE_MIN_SIZE_GB:-1}"
KEY_PREFIX="${PRUNE_KEY_PREFIX:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi

if ! command -v numfmt >/dev/null 2>&1; then
  echo "numfmt is required." >&2
  exit 1
fi

MIN_SIZE_BYTES=$((MIN_SIZE_GB * 1024 * 1024 * 1024))
CUTOFF_ISO=$(date -u -d "${MAX_AGE_DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ)
CUTOFF_EPOCH=$(date -u -d "$CUTOFF_ISO" +%s)

echo "Prune cache settings:"
echo "  repo=${REPO}"
echo "  dry_run=${DRY_RUN}"
echo "  max_age_days=${MAX_AGE_DAYS}"
echo "  min_size_gb=${MIN_SIZE_GB}"
echo "  key_prefix=${KEY_PREFIX:-<all>}"

mapfile -t CANDIDATES < <(
  gh api --paginate "repos/${REPO}/actions/caches" \
    --jq '.actions_caches' \
  | jq -c --argjson cutoff "$CUTOFF_EPOCH" --arg prefix "$KEY_PREFIX" --arg min_size "$MIN_SIZE_BYTES" \
    '.[] |
     select(.size_in_bytes >= ($min_size | tonumber)) |
     select(((.last_accessed_at // .created_at) | fromdate) <= $cutoff) |
     select($prefix == "" or (.key | startswith($prefix))) |
     {
       id: .id,
       key: .key,
       size: .size_in_bytes,
       last_accessed_at: (.last_accessed_at // .created_at)
     }'
)

if [ "${#CANDIDATES[@]}" -eq 0 ]; then
  echo "No stale cache candidates found."
  exit 0
fi

for entry in "${CANDIDATES[@]}"; do
  id=$(echo "$entry" | jq -r '.id')
  key=$(echo "$entry" | jq -r '.key')
  size=$(echo "$entry" | jq -r '.size')
  accessed=$(echo "$entry" | jq -r '.last_accessed_at')
  size_gb=$(numfmt --to=iec --format='%9.2f' "$size")

  if [ "$DRY_RUN" = "true" ]; then
    echo "DRY-RUN delete cache id=${id} key=${key} size=${size_gb} last_accessed=${accessed}"
    continue
  fi

  echo "Delete cache id=${id} key=${key} size=${size_gb} last_accessed=${accessed}"
  gh api -X DELETE "repos/${REPO}/actions/caches/${id}"
done
