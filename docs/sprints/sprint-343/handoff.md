# Sprint 343 Handoff — RDB inline JSON tree (JSONB + Postgres ARRAY)

## What shipped

Mount the inline JSON tree panel (sprint-341/342 `DocumentTreePanel`)
in the RDB data grid. Same UI Mongo users already know, now editing
PostgreSQL `jsonb` columns and Postgres native `ARRAY` (`text[]` /
`int[]` / etc.) columns.

- **Sentinel rendering.** Non-null jsonb object / jsonb array / Postgres
  ARRAY cells render as `{ ... }` / `[ N items ]` with a toggle button
  inside the brackets, mirroring Mongo's Option-D pattern. Scalar
  jsonb values (`42` / `"foo"` / `null`) keep the existing cell-level
  text edit path so users can still author an initial value.
- **Inline tree expand.** Click the sentinel → master/detail row
  mounts `DocumentTreePanel` with the parsed cell value. The same
  pendingByPath / onCommitEdit / `__op__:unset` contract applies; no
  Mongo-specific dependency leaks in.
- **Per-row PK snapshot.** `expandedNested` carries
  `{ rowIdx, colIdx, pkSnapshot }`. Whenever `data.rows` changes, an
  effect re-derives the PK tuple at `rowIdx` and auto-closes the
  panel if it diverged from the snapshot (sort / filter / refetch
  rearranged the page). For PK-less tables the snapshot uses the full
  row, matching the WHERE-clause builder's fallback.
- **Viewport-fit panel.** `scrollContainerWidth` measured via
  ResizeObserver (`[data]` deps so the observer attaches after the
  scroll container mounts behind its `{data && ...}` guard). Detail
  row uses the same `display: grid; gridTemplateColumns: var(--cols)`
  as data rows so `position: sticky; left: 0` on the inner anchors to
  the visible viewport — same fix as Sprint 342's V2 feedback.
- **sqlGenerator dispatch.** `pendingEdits` keys can now carry a
  `:dot.path` suffix. The generator groups entries per `(row, col)`,
  then dispatches by `column.data_type`:
  - **jsonb** → chained `jsonb_set(..., '{path,segments}', '<json>'::jsonb)`
    with `__op__:unset` routing into `col #- '{path}'` on the same
    chain. Numeric / boolean / null leaves stay raw JSON; strings get
    JSON-encoded then escaped as a SQL literal.
  - **`text[]` / `int[]` / etc.** → full `ARRAY[...]::elemtype[]`
    reassignment. Element edits and index deletes apply in a single
    pass over the current cell value, so a row with mixed edit +
    delete + untouched elements round-trips in one UPDATE.
  - **Mixed top-level + nested on the same cell** → top-level wins,
    nested entries reported via `onCoerceError`.
  - **Nested edit on a non-structural column** → `onCoerceError`
    with a clear message.

## Files touched

- `src/components/datagrid/sqlGenerator.ts` — new `parseEditKey`,
  `jsonbPathLiteral`, `jsonbValueLiteral`, `arrayElementType`,
  `isJsonbColumn`, `isArrayColumn`, `emitJsonbUpdate`,
  `emitArrayUpdate`, and a refactored `generateSqlWithKeys` UPDATE
  path that groups by cell and dispatches.
- `src/components/datagrid/sqlGenerator.test.ts` — 11 new cases
  covering jsonb set / chained / unset / bracket-index path,
  ARRAY single edit / single delete / combined / non-index reject /
  non-structural column reject.
- `src/components/datagrid/DataGridTable.tsx` — `Fragment` row map
  with master/detail row; `expandedNested` state + PK snapshot
  auto-close; `scrollContainerWidth` ResizeObserver;
  `buildNestedPendingByPath` helper; DocumentTreePanel mount with
  onCommitEdit wired into `setPendingEdits`.
- `src/components/datagrid/DataGridTable/DataRow.tsx` — sentinel
  branch for jsonb / Postgres ARRAY cells: bracket-toggle-bracket
  structure, `Expand <col>` aria-label, amber `● N` indicator when
  nested pending edits exist, double-click suppressed.
- `src/components/rdb/DataGrid.tsx` — forward
  `editState.setPendingEdits` to `DataGridTable` so the tree panel
  can commit dot-path entries.
- `src/components/rdb/DataGrid.lifecycle.test.tsx` — Sprint 238
  "compact one-line JSON" test rewritten to assert the new sentinel
  buttons; raw `JSON.stringify({key:"value"})` text negative-checked.
- `src/components/rdb/DataGrid.editing.test.tsx` — AC-186-06 (warn +
  production + dangerous) was double-clicking the `meta` cell
  (index 2); switched to `name` (index 1) since `meta` is now a
  sentinel.

## Verification

- `pnpm vitest run` — 321 files, 3849 tests pass, 10 skipped.
- `pnpm tsc --noEmit` — clean.
- `pnpm lint` — clean (`safeStringifyCell` used wherever a JSON
  payload touches cell-domain code, per the no-restricted-syntax
  rule).

## Decisions worth carrying forward

- **`pendingEdits` value type stays `string | null`.** The Mongo
  pendingEdits uses `string | Record<string, unknown>` because of
  BSON wrapper objects; RDB has no equivalent (jsonb values
  round-trip through JSON.stringify safely). We keep the simpler
  shape and let `DocumentTreePanel`'s prop type (a wider union)
  absorb the difference at the boundary. `safeStringifyCell` guards
  the object branch on the off-chance a non-string value reaches
  `setPendingEdits` from a future caller.
- **ARRAY reassignment over `array_remove`.** Postgres'
  `array_remove(col, val)` removes ALL matching values, not the
  element at a given index — wrong semantics for inline-tree edits.
  Reassigning the whole array (`ARRAY[...]::elemtype[]`) is exact,
  works for duplicates, and keeps edit + delete in a single
  statement. The generator already had the row in hand for the
  WHERE clause, so reading the current array is free.
- **Postgres ARRAY is 1-based in SQL but 0-based in the UI.** We
  reassign the full array, so the +1 conversion never appears in the
  emitted SQL — it's hidden inside the dispatch. If a future
  follow-up reverts to `col[i] = val` for single edits, that helper
  must remember to add 1.
- **JSONB path components are quoted.** `jsonb_set` accepts both
  numeric (`'{tags,0,name}'`) and quoted (`'{"tags","0","name"}'`)
  segments; we quote everything so future segments with embedded
  commas / unicode round-trip safely.

## Deferred to follow-up sprint

- **MySQL `JSON` / SQLite `JSON` columns.** Same UI is reusable but
  the dispatch needs per-dialect emit (`JSON_SET` / `JSON_REMOVE` vs
  `jsonb_set` / `#-`). Plumbing `db_type` through `generateSql` is
  the prerequisite — see `paradigmEditAdapter` in the survey notes.
- **`jsonb[]` / composite `[]` arrays.** Currently rejected with an
  explicit error (`"jsonb[] / json[] element edits are not yet
  supported"`). The tree UI can already display nested paths into an
  array element; the dispatch needs split parsing (array index +
  inner jsonb path).
- **Add key / add item / array-push.** Both Mongo (Sprint 342) and
  RDB (this sprint) deferred this because it needs ghost-node
  rendering in `DocumentTreePanel` for paths that exist in
  `pendingByPath` but not in `value`. The next sprint should unify
  this for both paradigms in one pass.
- **Virtualized branch.** The non-virtualized rowgroup got the
  master/detail row; the virtualized branch (`> VIRTUALIZE_THRESHOLD
  = 200`) does NOT yet. Need variable-height rows + `measureElement`
  for the detail row's height. Documented as a known gap; users
  with > 200 rows on a page can lower page size as a workaround.

## Test counts

| File | Cases |
|------|-------|
| `src/components/datagrid/sqlGenerator.test.ts` | 70 (was 59 — +11) |
| `src/components/rdb/DataGrid.lifecycle.test.tsx` | rewrote 1 |
| `src/components/rdb/DataGrid.editing.test.tsx` | adjusted 1 |
