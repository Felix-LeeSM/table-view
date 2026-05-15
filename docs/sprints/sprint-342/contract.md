# Sprint 342 Contract — Document inline JSON tree (Option D, V2)

## Scope

Land the V2 enhancements that V1 deferred from Sprint 341:

1. **BSON wrapper inline editor** — leaves coming from `__bson__:<EJSON>`
   wrapper strings open the type-aware `BsonTypeEditor` (ObjectId / Date
   / Decimal128 / binData) inside the tree instead of being read-only.
2. **Regex search toggle** — search bar gains a `.*` toggle that
   switches matching from substring to JS regex (case-insensitive).
   Invalid regex sources fall back to substring so the user can type a
   partial pattern without the tree blanking out mid-edit.
3. **Diff view toggle** — panel header gains a `Diff` button that, when
   on, renders any leaf with a pending edit as
   `original (strike) → pending (amber)` so the user can audit changes
   in-place before pressing Save at the grid level.
4. **Structural edit — leaf delete** — each editable leaf (excluding
   `_id`) gets a trash icon that commits the `__op__:unset` sentinel
   against that path. `mqlGenerator` is extended to route the sentinel
   into a `$unset` operator alongside any existing `$set` on the same
   row.

## Done Criteria

1. `src/lib/jsonTree.ts` — `filterTreeNodes` accepts a `{ regex?: bool }`
   option; with `regex: true` it compiles the query as a
   case-insensitive `RegExp` and falls back to substring on invalid
   source.
2. `src/components/document/DocumentTreePanel.tsx`:
   - BSON leaves mount `BsonTypeEditor` on click; commits round-trip
     through the parent's `tagBsonWrapper` so the existing
     `pendingEdits Map<string, string|Record<string, unknown>>` shape
     is unchanged. Editor wraps in a full-width container with a
     visible primary border (per user feedback during V2 mid-work —
     the BSON editor border was being clipped).
   - Header gains a regex toggle (`document-tree-regex-toggle`) and a
     diff toggle (`document-tree-diff-toggle`).
   - Leaf render now has four ordered branches:
     `pending = __op__:unset` → strike + "● will delete";
     `diffMode && pending` → `original (strike) → pending`;
     `pending` → pending text in the leaf button;
     else → rendered value.
   - Trash icon (`tree-delete-<path>`) per editable leaf commits
     `__op__:unset`. `_id` is excluded (mqlGenerator's id-in-patch
     guard would drop the row).
3. `src/lib/mongo/mqlGenerator.ts`:
   - Per-row `cells` split into `setOps` / `unsetOps` by sentinel
     identity. `MqlCommand.updateOne.patch` now carries the full
     update operator (`{ $set: {...}, $unset: {...} }`) instead of
     the raw `$set` body.
   - Preview string emits `$set` and `$unset` clauses in order on the
     same `updateOne` line when both are present.
4. `src/lib/mongo/mqlToBulk.ts` — `update: cmd.patch` (operator already
   wrapped by the generator).
5. Tests:
   - `src/lib/jsonTree.test.ts` (+2 cases: regex hit, regex fallback).
   - `src/components/document/DocumentTreePanel.test.tsx` (+5 cases:
     BSON editor opens & commits, regex toggle filters, diff toggle
     renders, trash commits `__op__:unset`, `_id` has no trash).
   - `src/lib/mongo/mqlGenerator.test.ts` (+2 cases: `$unset` route,
     combined `$set + $unset`); existing assertions updated to the
     new patch shape.
   - `src/lib/mongo/mqlToBulk.test.ts` — same shape migration plus a
     new combined-operator case.
   - `src/components/datagrid/useDataGridEdit.document.test.ts` —
     assertion updated to the wrapped operator shape.

## Out of Scope

- **Add key / add item** (object `+ key`, array `+ item`). These
  structural-edit affordances need *ghost-node rendering* — paths that
  live in `pendingByPath` but don't exist in `value` — which is its own
  grill (where to insert them, ordering with respect to existing
  children, depth math, undo affordance). Deferred to a follow-up
  sprint.
- Per-leaf revert affordance (undo a pending edit from inside the
  tree). User still discards at the grid level for now.
- BSON `add key` (creating new BSON-typed fields inline).

## Invariants

- The grid-level Commit/Discard buttons still own the save flow — the
  tree panel never calls IPC directly.
- `pendingEdits` Map value type stays `string | Record<string, unknown>`
  (no enum widening). `__op__:unset` rides on the `string` arm as a
  sentinel.
- `_id` cannot be `$unset` from the tree — surfaced as missing trash.
- `mqlGenerator.MqlCommand.updateOne.patch` is now the **full update
  operator object**, not the raw `$set` body — Sprint 326's mqlToBulk
  wrap removed.

## Verification Plan

Profile: `command`
- `pnpm vitest run` (full 320 files / 3832 tests)
- `pnpm tsc --noEmit`
- `pnpm lint`
- lefthook `pre-commit`
