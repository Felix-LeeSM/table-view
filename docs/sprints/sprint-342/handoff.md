# Sprint 342 Handoff — Document inline JSON tree (Option D, V2)

## What shipped

- **BSON inline editor in the tree** — ObjectId / Date / Decimal128 /
  binData leaves now open `BsonTypeEditor` in-place. The editor is
  wrapped in a full-width `border border-primary` container so the
  outline isn't clipped by the leaf row (user feedback during V2
  mid-work: the original editor border was visually cropped).
- **Regex search toggle** — `.*` checkbox to the right of the search
  input promotes the substring matcher to a case-insensitive `RegExp`.
  Invalid regex source (e.g. user mid-typing `Gloss[`) falls back to
  substring matching so the tree never blanks out unexpectedly.
- **Diff view toggle** — header `Diff` button. When on, every leaf with
  a pending edit renders as `original (strike) → pending (amber)` so
  the user can audit edits before pressing Save at the grid level.
- **Leaf delete** — trash icon next to each editable leaf (excluding
  `_id`) commits a `__op__:unset` sentinel against the leaf path. The
  generator routes this into a `$unset` clause on the same `updateOne`
  as any concurrent `$set` for the row.

## Files touched

- `src/lib/jsonTree.ts` — `filterTreeNodes(nodes, query, { regex })`
  with regex compilation + safe fallback.
- `src/lib/jsonTree.test.ts` — +2 regex cases.
- `src/components/document/DocumentTreePanel.tsx` — BSON editor branch
  (full-width primary-border wrap), regex toggle, diff toggle, trash
  button, strike-through + "● will delete" badge, `_id` trash exclusion.
- `src/components/document/DocumentTreePanel.test.tsx` — BSON read-only
  test rewritten to assert editable behavior; +5 new cases (regex,
  diff, delete, `_id`-no-trash).
- `src/lib/mongo/mqlGenerator.ts` — per-row split into `setOps` /
  `unsetOps`; `MqlCommand.updateOne.patch` now carries the full update
  operator (`{ $set, $unset }`) instead of the raw `$set` body.
- `src/lib/mongo/mqlGenerator.test.ts` — +2 cases ($unset route,
  combined $set+$unset); patch-shape assertions updated.
- `src/lib/mongo/mqlToBulk.ts` — `update: cmd.patch` (no longer
  re-wraps in `{ $set }`).
- `src/lib/mongo/mqlToBulk.test.ts` — patch-shape migration + combined
  operator case.
- `src/components/datagrid/useDataGridEdit.document.test.ts` —
  patch-shape assertion update.

## Verification

- `pnpm vitest run` — 320 files, 3832 passed, 10 skipped.
- `pnpm tsc --noEmit` — clean.
- `pnpm lint` — clean (added `safeStringifyCell` import to satisfy the
  cell-domain `no-restricted-syntax` rule).

## Decisions worth carrying forward

- **Patch shape migration**. The pre-Sprint-342 `cmd.patch` was the
  inside of a `$set` operator and `mqlToBulk` wrapped it back into
  `{ $set: patch }`. Sprint 342 moves the operator wrapping up into the
  generator so a single row can express `$set + $unset` (and later
  `$push`, `$inc`, …) without `mqlToBulk` re-deriving structure. Any
  future consumer of `MqlCommand.updateOne.patch` should treat it as a
  fully-formed update document.
- **Sentinel encoding**. Structural edits ride on the existing
  `pendingEdits Map<string, string | Record<string, unknown>>` shape via
  `__op__:` prefix tokens. This keeps `useDataGridEdit` /
  `DocumentDataGrid` wiring unchanged. The contract is loose (any
  string starting with `__op__:` is reserved for the generator); the
  generator currently recognises only `__op__:unset`.
- **`_id` UX guards**. The trash icon is omitted for `_id` because
  mqlGenerator's `id-in-patch` guard would drop the entire row. Showing
  a non-functional control would be a UX trap. The same logic should
  apply to any future structural-edit affordance: hide the entry-point
  rather than surface a downstream error.

## Deferred to follow-up sprint

- **Add key (`+ key` on object nodes)** and **add item (`+ item` on
  array nodes)**. The blocker is *ghost-node rendering*: a newly added
  path lives in `pendingByPath` but has no entry in `value`, so the
  tree currently has no way to surface it. Resolving this needs a
  grill on:
  - Where ghosts insert relative to existing children (sorted? end?).
  - How to display the type chooser inline when the value is fresh.
  - Undo/revert affordance — closing the loop on accidental adds.
  - Depth math when the parent itself is a ghost (nested ghosts).
- **Per-leaf revert from inside the tree** — currently the user has to
  Discard at the grid level to undo a pending edit. A per-leaf undo
  would close the loop but needs an `onRevertEdit?: (path) => void`
  callback plumbed through `DocumentDataGrid`.

## Test counts

| File | Cases |
|------|-------|
| `src/lib/jsonTree.test.ts` | 14 (was 12) |
| `src/components/document/DocumentTreePanel.test.tsx` | 13 (was 9; BSON test rewritten + 5 new) |
| `src/lib/mongo/mqlGenerator.test.ts` | 19 (was 17) |
| `src/lib/mongo/mqlToBulk.test.ts` | 6 (was 5) |
