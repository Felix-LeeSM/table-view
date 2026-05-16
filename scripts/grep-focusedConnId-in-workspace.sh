#!/usr/bin/env bash
#
# sprint-366 (Phase 4 Q15) — AC-366-05 grep CI.
#
# Workspace tree must read its connection identity from the Tauri window
# label (`useCurrentWindowConnectionId()`), not from
# `connectionStore.focusedConnId` (which is now launcher-only). Any
# regression that resurrects the slot read in a workspace-tree path
# trips this script.
#
# The grep is intentionally narrow: doc-comment references that still
# describe the historical link to `connectionStore.focusedConnId` are
# allowed (they document the migration), so the pattern is anchored at
# `connectionStore.*focusedConnId` — a literal `connectionStore.` access
# rather than the React hook usage `useConnectionStore((s) => s.focusedConnId)`.
# If the doc string itself becomes load-bearing it can be reworded.
#
# Exit codes:
#   0 — clean (workspace tree is free of `connectionStore.focusedConnId`).
#   1 — match found; prints the offending lines.

set -euo pipefail

cd "$(dirname "$0")/.."

# Prefer ripgrep when available (faster, identical semantics); fall back
# to plain `grep -rn` so this script works on CI runners that haven't
# installed ripgrep. Both surfaces honour the same anchored pattern.
SEARCH_TOOL=""
if command -v rg >/dev/null 2>&1; then
  SEARCH_TOOL="rg"
elif command -v grep >/dev/null 2>&1; then
  SEARCH_TOOL="grep"
else
  echo "[grep-focusedConnId-in-workspace.sh] need either ripgrep (rg) or grep" >&2
  exit 2
fi

PATHS=(
  "src/components/layout/Sidebar.tsx"
  "src/components/datagrid/"
  "src/components/query/"
  "src/components/schema/"
  "src/components/document/"
  "src/components/rdb/"
  "src/stores/workspaceStore.ts"
)

# Filter only paths that exist (the rdb/document/datagrid directories
# may not all exist in every checkout; rg errors on missing paths).
EXISTING_PATHS=()
for p in "${PATHS[@]}"; do
  if [[ -e "$p" ]]; then
    EXISTING_PATHS+=("$p")
  fi
done

if [[ ${#EXISTING_PATHS[@]} -eq 0 ]]; then
  echo "[grep-focusedConnId-in-workspace.sh] no workspace-tree paths to scan" >&2
  exit 0
fi

if [[ "$SEARCH_TOOL" == "rg" ]]; then
  MATCHED=$(rg -n "connectionStore.*focusedConnId" "${EXISTING_PATHS[@]}" || true)
else
  MATCHED=$(grep -rEn "connectionStore.*focusedConnId" "${EXISTING_PATHS[@]}" || true)
fi

if [[ -n "$MATCHED" ]]; then
  printf '%s\n' "$MATCHED"
  echo
  echo "[grep-focusedConnId-in-workspace.sh] FAIL — workspace-tree paths must NOT read" >&2
  echo "  \`connectionStore.focusedConnId\`. Use \`useCurrentWindowConnectionId()\` instead" >&2
  echo "  (sprint-366 / state-management-strategy Q15)." >&2
  exit 1
fi

echo "[grep-focusedConnId-in-workspace.sh] OK — workspace tree is free of connectionStore.focusedConnId reads."
