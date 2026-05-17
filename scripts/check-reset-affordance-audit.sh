#!/usr/bin/env bash
#
# Sprint 376 (2026-05-17, Phase 6 Q21) — Reset-to-default audit gate.
#
# Reads `docs/sprints/sprint-376/audit-checklist.md` and counts the
# checked items (`- [x]`). The 9-affordance Q21 contract requires every
# item to be set before sprint merge. Less than 9 → exit 1 with a clear
# diagnostic listing the unchecked rows.
#
# Used by:
#   1. Sprint 376 final verification (本 sprint).
#   2. Future regressions — if a future sprint introduces a new persisted
#      A/C state slot, the strategy doc Q21 line 1683 requires extending
#      the checklist or pausing the merge.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
DOC="$ROOT/docs/sprints/sprint-376/audit-checklist.md"

if [[ ! -f "$DOC" ]]; then
  echo "audit-checklist not found: $DOC" >&2
  exit 1
fi

# Count checked items.  `^- \[x\]` is the conventional GitHub task syntax.
CHECKED=$(grep -c '^- \[x\]' "$DOC" || true)
UNCHECKED=$(grep -c '^- \[ \]' "$DOC" || true)
EXPECTED=9

if [[ "$CHECKED" -lt "$EXPECTED" ]]; then
  echo "Sprint 376 audit FAIL: $CHECKED/$EXPECTED affordance(s) checked." >&2
  echo "Unchecked rows:" >&2
  grep -n '^- \[ \]' "$DOC" >&2 || true
  exit 1
fi

echo "Sprint 376 audit PASS: $CHECKED affordance(s) checked ($UNCHECKED unchecked)."
