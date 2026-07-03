#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
DRY_RUN="${PRUNE_DRY_RUN:-false}"
# Defaults tuned 2026-07-03: GitHub already auto-evicts caches unaccessed for
# 7 days, so a 30-day floor was effectively unreachable; and the real dead
# caches (per-tag release trees) are each <1GiB, so a 1GiB size filter never
# caught them. 7 days / 0GiB makes this a genuine backstop for when GitHub's
# own eviction lags (observed 8-9 days). MIN_SIZE_GB=0 => MIN_SIZE_BYTES=0,
# which passes every size.
MAX_AGE_DAYS="${PRUNE_MAX_AGE_DAYS:-7}"
MIN_SIZE_GB="${PRUNE_MIN_SIZE_GB:-0}"
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

# Advisory report (audit 2026-07-03). Caches fail silently — empty vite
# archives, dead tag-ref caches, and a near-full quota all sat unnoticed for
# months. After pruning (dry-run included) this prints the full cache inventory
# and warns on three known failure signatures. Advisory only: the caller wraps
# it in `|| true`, and it prints WARNING lines rather than changing exit status.
print_cache_advisory() {
  local caches active_bytes tag_count empty_count
  caches="$(gh api --paginate "repos/${REPO}/actions/caches" --jq '.actions_caches' | jq -s 'add // []')"
  active_bytes="$(gh api "repos/${REPO}/actions/cache/usage" --jq '.active_caches_size_in_bytes // 0')"

  echo ""
  echo "Cache inventory (size desc):"
  printf '  %9s  %-20s  %-26s  %s\n' "SIZE(MB)" "LAST_ACCESSED" "REF" "KEY"
  echo "$caches" | jq -r 'sort_by(-.size_in_bytes) | .[]
    | [((.size_in_bytes / 1048576 * 10 | round) / 10 | tostring),
       (.last_accessed_at // .created_at), (.ref // "-"), .key] | @tsv' \
    | while IFS=$'\t' read -r size acc ref key; do
        printf '  %9s  %-20s  %-26s  %s\n' "$size" "$acc" "$ref" "$key"
      done

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Cache inventory (size desc)"
      echo ""
      echo "| Size (MB) | Last accessed | Ref | Key |"
      echo "|---:|---|---|---|"
      echo "$caches" | jq -r 'sort_by(-.size_in_bytes) | .[]
        | "| \((.size_in_bytes / 1048576 * 10 | round) / 10) | \(.last_accessed_at // .created_at) | \(.ref // "-") | \(.key) |"'
    } >>"$GITHUB_STEP_SUMMARY"
  fi

  # Three failure-signature warnings.
  local warnings=()
  tag_count="$(echo "$caches" | jq '[.[] | select((.ref // "") | startswith("refs/tags/"))] | length')"
  empty_count="$(echo "$caches" | jq '[.[] | select(.size_in_bytes < 1048576)] | length')"

  if [ "$tag_count" -gt 0 ]; then
    warnings+=("WARNING: ${tag_count} cache(s) on refs/tags/* — dead weight, a future run cannot restore a prior tag's cache.")
  fi
  if [ "$active_bytes" -gt 8589934592 ]; then
    warnings+=("WARNING: active cache size $(numfmt --to=iec "$active_bytes") exceeds 8GiB (80% of the 10GB cap).")
  fi
  if [ "$empty_count" -gt 0 ]; then
    warnings+=("WARNING: ${empty_count} cache(s) under 1MiB — suspected empty payload (e.g. the retired vite cache).")
  fi

  if [ "${#warnings[@]}" -gt 0 ]; then
    echo "" >&2
    printf '%s\n' "${warnings[@]}" >&2
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      {
        echo ""
        echo "### Cache warnings"
        echo ""
        printf -- '- %s\n' "${warnings[@]}"
      } >>"$GITHUB_STEP_SUMMARY"
    fi
  fi
}

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
     # GitHub returns sub-second precision (e.g. ...54.894619000Z) which jq
     # fromdate (strict %Y-%m-%dT%H:%M:%SZ) cannot parse — it threw on the first
     # entry, so this filter matched nothing and prune silently deleted nothing
     # (audit 2026-07-03). Strip the fractional seconds before fromdate.
     select(((.last_accessed_at // .created_at) | sub("\\.[0-9]+";"") | fromdate) <= $cutoff) |
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
else
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
fi

# Advisory inventory + failure-signature warnings; never affects exit status.
print_cache_advisory || true
