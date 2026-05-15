# Sprint 341 Handoff — Document inline JSON tree (Option D, V1)

## Status: ✅ Complete

## Changes

### Frontend
- `src/lib/jsonTree.ts` (NEW) — `buildTreeNodes`, `computeTreeStats`,
  `renderLeafValue`, `filterTreeNodes`. BSON wrapper strings
  (`__bson__:<EJSON>`) recognised as leaves.
- `src/lib/jsonTree.test.ts` (NEW) — 12 cases.
- `src/components/document/DocumentTreePanel.tsx` (NEW) — collapsible
  tree, stats grid (6 cards), search input, inline leaf edit
  (Enter commits / Esc cancels), BSON leaves read-only.
- `src/components/document/DocumentTreePanel.test.tsx` (NEW) — 8 cases.
- `src/components/document/DocumentDataGrid.tsx` —
  - drop `NestedExpandPopover` import; replace with `DocumentTreePanel`.
  - add `expandedNested: { rowIdx, colIdx } | null` state.
  - sentinel cell renders as `{`/`[` + middle toggle button + `}`/`]`.
    Closed glyph: `...` for objects / `N items` for arrays. Open glyph:
    `✕`. Toggle stops propagation so row selection is not affected.
  - per-row Fragment now emits a master/detail row immediately after the
    data row when that row is the expanded one. Detail row spans all
    columns and mounts `DocumentTreePanel` with the existing
    `pendingByPath` / `onCommitEdit` wiring.
- `src/components/document/DocumentDataGrid.test.tsx` — sentinel test
  rewritten to the new bracket-toggle-bracket shape; double-click is
  still a no-op on the toggle; 2 new integration cases for expand /
  collapse and switching the expanded cell within the same row.
- `src/components/document/DocumentDataGrid.nested.test.tsx` —
  rewritten as Option D regression guard (6 cases) — keeps the MQL
  preview `$set: { "meta.role": "owner" }` end-to-end gate.

### Untouched
- `NestedExpandPopover.tsx` + its tests stay on disk but are no longer
  imported by the grid. A follow-up sprint can delete them once Option
  D is locked in.

## Verification

- `pnpm vitest run` → 3822 passed, 10 skipped
- `pnpm tsc --noEmit` (clean)
- `pnpm lint` (clean)

## Notes / Follow-ups

- V2: wire `BsonTypeEditor` into the tree (currently BSON leaves are
  read-only).
- V2: structural edits (add key / delete / array push-pop). The
  `onCommitEdit` callback already accepts a dot-path so the wiring can
  be extended with `$unset` / `$push` payloads without changing the
  tree-panel surface.
- Cleanup: drop `NestedExpandPopover.tsx` + tests once Option D ships
  to users without regressions.
