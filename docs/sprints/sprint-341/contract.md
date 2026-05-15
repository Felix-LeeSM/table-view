# Sprint 341 Contract — Document inline JSON tree (Option D, V1)

## Scope

Replace `NestedExpandPopover` usage inside `DocumentDataGrid` with an
in-grid master/detail row that renders a jsoncrack-style collapsible
tree for MongoDB JSON / array cells. V1 focuses on read + leaf-edit;
structural edits (key add / delete / array push) defer to V2.

Triggers: the JSON cell itself. `{...}` cell shows `{ ... }` with the
`...` middle glyph as the toggle button; `[N items]` shows `[ N items ]`
with the `N items` middle glyph as the toggle. Open state replaces the
middle glyph with `✕` so the same hitbox closes the tree.

## Done Criteria

1. New util `src/lib/jsonTree.ts` — `buildTreeNodes`, `computeTreeStats`,
   `renderLeafValue`, `filterTreeNodes`. BSON wrapper strings
   (`__bson__:<EJSON>`) recognised as leaves (not unfolded objects).
2. New component `src/components/document/DocumentTreePanel.tsx` —
   collapsible tree, stats grid (NODES / KEYS / DEPTH / OBJ / ARR /
   MAX), search input (key + value substring), inline leaf edit
   (Enter commits, Esc cancels). BSON leaves are read-only in V1.
3. `DocumentDataGrid` integration —
   - new `expandedNested: { rowIdx, colIdx } | null` state.
   - sentinel cell renders the bracket-toggle-bracket structure with a
     button as the toggle; click sets `expandedNested`.
   - if a row is the expanded row, a master/detail row immediately
     after it spans the full grid and mounts `DocumentTreePanel`.
   - panel's `onCommitEdit` reuses the existing `pendingEdits` Map +
     `tagBsonWrapper` flow so the MQL preview keeps emitting
     `$set: { "<col>.<path>": <value> }`.
4. Tests:
   - `src/lib/jsonTree.test.ts` (12 cases)
   - `src/components/document/DocumentTreePanel.test.tsx` (8 cases)
   - `DocumentDataGrid.test.tsx` regression — 2 new integration cases
     for toggle expand/collapse + switching between cells.
   - `DocumentDataGrid.nested.test.tsx` rewritten to Option D shape
     (6 cases) — keeps the MQL `$set: { "meta.role": ... }` end-to-end
     gate alive.

## Out of Scope

- BSON wrapper inline editor (V1 leaves BSON read-only).
- Structural edits (key add / delete, array push / pop).
- Regex search.
- Diff view between original and pending.

## Invariants

- The grid-level Commit button still owns the save flow — the tree
  panel never calls IPC directly.
- Sentinel cell never starts a cell-level edit on double-click.
- `NestedExpandPopover.tsx` stays on disk (its own tests pass) but is
  no longer imported by `DocumentDataGrid` — keeping it lets a future
  sprint reinstate it without re-derivation; future cleanup ticket
  can remove it once Option D is locked in.

## Verification Plan

Profile: `command`
- `pnpm vitest run`
- `pnpm tsc --noEmit`
- `pnpm lint`
- lefthook `pre-commit`
