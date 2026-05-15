# Sprint 344 Spec — Inline "Add key" / "Add item" for DocumentTreePanel (Mongo + RDB)

## Feature Description

Extend `DocumentTreePanel` so users can add a new object key or array
item directly inline, with the same UX in the Mongo grid and the RDB
grid (jsonb + Postgres ARRAY). Currently the panel only supports
editing and deleting existing leaves. This sprint resolves the
"Add key / add item / array-push" item explicitly deferred in
Sprint 341, 342, and 343 handoffs.

## Sprint Breakdown

### Slice A — Ghost-node tree traversal

**Goal**: Render leaves that exist only in `pendingByPath` (newly
added paths) alongside leaves derived from `value`, without breaking
the existing leaf-edit / leaf-delete render.

**Verification Profile**: command (vitest)

**Acceptance Criteria**:
1. Given `value = { name: "Felix" }` and `pendingByPath = Map { "tag" => "alpha" }`,
   the panel renders both `name` and `tag` as visible leaves; `tag`
   carries a visible "NEW" or pending badge distinct from the "edited"
   badge so users can tell additions from edits.
2. Given an existing-key edit and a new-key add for the same parent
   object, both render together — no de-duplication mistake collapses
   them.
3. Ghost nodes appear at the bottom of their parent's child list
   (insertion order = order they were added to `pendingByPath`) and
   inherit the parent's indentation depth.
4. Nested ghosts (an object/array value attached to a brand-new key,
   e.g. `pendingByPath["meta"] = "{\"role\":\"owner\"}"`) expand
   correctly — the value is parsed and the inner structure is walked
   into ghost children. If parsing fails, the ghost remains a string
   leaf with no crash.
5. Collapse state, search filter, and diff toggle continue to work
   for ghost nodes (existing behaviour stays a regression-free
   baseline).

**Components to Create/Modify**:
- `src/components/document/DocumentTreePanel.tsx`: tree traversal merges
  `value` children with unresolved ghost paths from `pendingByPath`.
- `src/lib/jsonTree.ts` (optional): a helper that, given `value` and a
  list of pending paths, returns the merged `TreeNode[]` so the merge
  logic stays unit-testable.
- `src/components/document/DocumentTreePanel.test.tsx`: ghost-rendering
  cases.
- `src/lib/jsonTree.test.ts`: helper cases if added.

### Slice B — `+ key` inline pair input on object nodes

**Goal**: A clickable `+ key` affordance on every object node opens
a paired key + value input inline; committing fires
`onCommitEdit(parentPath + "." + key, value)`.

**Verification Profile**: command (vitest)

**Acceptance Criteria**:
1. Every object node (including the root when the cell value is an
   object, and every nested object) renders a `+ key` affordance as
   its last child slot when `onCommitEdit` is provided.
2. Clicking `+ key` reveals two inline inputs side by side at the
   object's child indent: a key input (placeholder e.g. "key")
   focused first, and a value input. Both start empty.
3. Tab from the key input moves focus to the value input; Shift+Tab
   moves back. Enter from either input commits. Esc cancels and
   clears both inputs and the affordance returns.
4. On commit, `onCommitEdit` is called exactly once with path =
   parent-path joined with the typed key (root = bare key, nested =
   `parent.subkey`), and value = the raw value string before type
   coercion (Slice D owns coercion).
5. Empty key + Enter does **not** commit and surfaces an inline
   rejection state (e.g. red border or aria-invalid); empty value +
   non-empty key + Enter **does** commit (the user explicitly wanted
   that value).
6. Attempting to add a key that already exists on the object (either
   in `value` or in `pendingByPath`) blocks commit with an inline
   conflict hint; no `onCommitEdit` is fired.
7. After commit, both inputs disappear, the `+ key` affordance
   re-renders, and the newly added ghost row is visible (covered by
   Slice A — this is the integration assertion).

**Components to Create/Modify**:
- `src/components/document/DocumentTreePanel.tsx`: `+ key` affordance,
  paired input, validation states.
- `src/components/document/DocumentTreePanel.test.tsx`: Tab
  navigation, Enter/Esc, duplicate-key reject, empty-key reject.

### Slice C — `+ item` inline value input on array nodes

**Goal**: A clickable `+ item` affordance on every array node opens
a single value input; index is auto-derived from the current array
length plus pending appends.

**Verification Profile**: command (vitest)

**Acceptance Criteria**:
1. Every array node renders a `+ item` affordance as its last child
   slot when `onCommitEdit` is provided.
2. Clicking `+ item` reveals a single value input. The index label
   rendered to the left of the input shows `[N]` where N = current
   `cellValue` length plus any earlier pending appends to this array
   path. The index label is **not** an input (cannot be edited).
3. Enter commits; Esc cancels. On commit, `onCommitEdit` is called
   once with path = `parent.[N]` (matching the dot/bracket notation
   `buildTreeNodes` already produces) and value = the raw value
   string.
4. Empty value + Enter does commit (a user can intentionally append
   the string `""`); user must press Esc to cancel without adding.
5. Two consecutive `+ item` commits without a save in between produce
   ghost rows at `[N]` and `[N+1]` (no index collision).
6. After commit, the input disappears, the `+ item` affordance
   re-renders, and the newly added ghost row is visible (Slice A
   integration).

**Components to Create/Modify**:
- `src/components/document/DocumentTreePanel.tsx`: `+ item`
  affordance, single input, auto-index.
- `src/components/document/DocumentTreePanel.test.tsx`: single-add,
  double-add (sequential indexes), Esc-cancel, empty-string append.

### Slice D — JSON.parse value coercion with outer-quotes rule

**Goal**: A small pure helper that turns a user-typed value string
into a JSON-typed commit payload, applied by both `+ key` and
`+ item` paths before calling `onCommitEdit`.

**Verification Profile**: command (vitest)

**Acceptance Criteria**:
1. Input `42` (no quotes) → committed as the **number** `42` JSON
   token; the tree row renders the leaf with the NUM type tag.
2. Input `"42"` (with quotes) → committed as the **string** `42`;
   rendered with the STR type tag.
3. Inputs `null`, `true`, `false` (no quotes) → committed as JSON
   primitives `null` / `true` / `false`; rendered with NULL / BOOL
   type tags.
4. Input `{"a":1}` → committed as an **object** and immediately
   expanded as a nested ghost subtree (object with one numeric child
   `a: 1`). Slice A renders this nested ghost.
5. Input `[1,"x"]` → committed as an **array** and expanded as a
   nested ghost subtree with two children.
6. Input that fails `JSON.parse` (e.g. `hello world`, `{broken`) →
   committed as the literal string `hello world` / `{broken`;
   rendered with STR type tag (no error surfaced to the user).
7. The helper is a single pure function and has standalone unit
   coverage independent of the panel.
8. Object/array nested commits write the **single** parent-path edit;
   child paths are derived at render time from the parsed value.
   (Decision recorded: parsed structures expand at render rather than
   emitting one `onCommitEdit` per leaf.)

**Components to Create/Modify**:
- `src/lib/jsonTree.ts` or a new small module (Generator decides):
  exported `coerceTreeAddValue` helper.
- Matching `*.test.ts` file: all coercion cases above.

### Slice E — Generator dispatch (Mongo confirm + RDB create-missing + ARRAY push)

**Goal**: Make sure the existing generator dispatch correctly
persists `+ key` / `+ item` adds. No new SQL/MQL syntax — verify
that current emit already handles the new shapes, and add the
minimum patches needed.

**Verification Profile**: command (vitest)

**Acceptance Criteria**:
1. **Mongo confirm**: a pending edit at `"0-1:meta.role"` for a row
   whose `meta` is `{}` (missing `role`) emits exactly one
   `updateOne(..., { $set: { "meta.role": <value> } })`. The current
   `mqlGenerator.ts` is asserted via a new test case (because
   MongoDB's `$set` natively creates missing paths, no code change is
   expected; the test is a regression lock).
2. **Mongo nested ghost-only column**: a pending edit at `"0-1:newKey"`
   for a column whose current cell value is `{}` (an object sentinel)
   emits `$set: { "<col>.newKey": <value> }`. The sentinel-edit guard
   must **not** fire for this nested path.
3. **RDB jsonb create-missing**: a pending edit at `"0-1:meta.newKey"`
   on a jsonb column produces SQL
   `jsonb_set(<col>, '{"meta","newKey"}', <value>::jsonb, true)`.
   The 4th argument `create_missing=true` is present (current code
   omits it — fix expected here).
4. **RDB jsonb null cell**: when the jsonb cell value is SQL `null`,
   a pending add still produces a valid `jsonb_set` expression — the
   generator falls back to `'{}'::jsonb` as the base so the path can
   be created (decision: treat jsonb-null as "empty object" for the
   purpose of structural adds).
5. **Postgres ARRAY push past end**: a pending edit at `"0-1:[N]"`
   where `N == cellValue.length` produces
   `ARRAY[..., <new>]::elemtype[]` (the new element appended to the
   reassigned array). Sequential adds at `[N]` and `[N+1]` produce
   both new elements in order.
6. **Mixed top-level + nested-add** on the same cell: existing
   precedence (top-level wins, nested entries reported via
   `onCoerceError`) continues unchanged.
7. Adds on a non-structural RDB column (e.g. `text`) report
   `onCoerceError`; no SQL emitted.

**Components to Create/Modify**:
- `src/components/datagrid/sqlGenerator.ts`: enable
  `create_missing=true` on `jsonb_set` (if not already); handle
  jsonb-null base.
- `src/components/datagrid/sqlGenerator.test.ts`: add cases per
  AC 3–5 and 7. Comment lines: reason + date `2026-05-15`.
- `src/lib/mongo/mqlGenerator.ts`: read-only confirm; no code change
  expected.
- `src/lib/mongo/mqlGenerator.test.ts`: add cases per AC 1–2 and 6.
  Comment lines: reason + date `2026-05-15`.

### Slice F — Integration + handoff

**Goal**: Wire the new affordances end-to-end through both grids
(Mongo and RDB), lock regression coverage at the grid boundary, and
write the handoff doc.

**Verification Profile**: mixed (command + static)

**Acceptance Criteria**:
1. `DocumentDataGrid` (Mongo) integration test: in the inline tree,
   click `+ key` on an object cell, type a key + value, press Enter,
   then Commit — the preview line contains exactly
   `$set: { "<col>.<newkey>": <value> }`. Pre-existing leaf-edit +
   leaf-delete preview cases still pass.
2. `DataGridTable` (RDB) integration test: in the inline tree, click
   `+ key` on a jsonb cell, type a key + value, press Enter, then
   preview — the SQL contains
   `jsonb_set(<col>, '{<existing>,<newkey>}', '<json>'::jsonb, true)`.
3. `DataGridTable` (RDB) integration test: in the inline tree, click
   `+ item` on an ARRAY cell, type a value, Enter, preview — the SQL
   is `UPDATE … SET <col> = ARRAY[<original>, <new>]::<etype>[]`.
4. `pnpm vitest run` shows all pre-existing tests pass plus the new
   ones added in Slices A–E; `pnpm tsc --noEmit` and `pnpm lint` are
   clean.
5. `docs/sprints/sprint-344/handoff.md` is written and records: scope
   shipped, files touched, decisions (ghost-node insertion order,
   outer-quotes coercion, jsonb-null base default), deferred items
   (virtualized RDB grid, jsonb[]/composite, MySQL/SQLite JSON
   dispatch — carried forward from Sprint 343).

**Components to Create/Modify**:
- `src/components/document/DocumentDataGrid.test.tsx` or its
  `.nested.test.tsx` sibling: Mongo end-to-end add-key case.
- `src/components/rdb/DataGrid.lifecycle.test.tsx` (or a sibling):
  RDB end-to-end add-key + add-item cases.
- `docs/sprints/sprint-344/handoff.md`: written at the end of Slice F.

## Global Acceptance Criteria

1. **Mongo + RDB UX parity**: the affordances, keyboard flow, and
   visual treatment of ghost rows are identical regardless of which
   grid mounted the panel. `DocumentTreePanel` remains a single
   component for both paradigms.
2. **No regression on leaf edit / leaf delete**: every test that
   passed before this sprint still passes. Specifically, the
   `__op__:unset` sentinel, BSON inline editor, regex toggle, diff
   toggle, and pending pill in the header all behave identically for
   non-ghost rows.
3. **Column dispatch unchanged for non-structural cells**:
   nested-edit-on-text-column still rejects with the existing
   `onCoerceError` message; sentinel-edit guard still fires for
   top-level edits on sentinel cells.
4. **`safeStringifyCell` lint rule**: any new code that stringifies a
   cell-domain value imports `safeStringifyCell` (per the
   `no-restricted-syntax` rule). `pnpm lint` clean is part of the
   merge gate.
5. **Tests carry the convention comment**: every new test case
   includes a one-line comment with its reason and the date
   `2026-05-15`.

## Data Flow

- User clicks `+ key` on an object node inside `DocumentTreePanel`.
- Panel renders two paired inputs at the object's child indent.
- User types a key, Tab, types a value, Enter.
- Panel runs the Slice D coercion helper on the value string.
- Panel calls `onCommitEdit(parentPath + "." + key, coercedValue)`
  exactly once. (For root-level adds, `parentPath` is empty; the
  wired path is the bare key.)
- The grid's `setPendingEdits` writes an entry under
  `"{rowIdx}-{colIdx}:{newPath}"` — same shape sprint 322 and 343
  already use.
- `buildNestedPendingByPath` slices that pendingEdit back out and
  feeds it into `pendingByPath` on the next render — the new path
  is in `pendingByPath` but **not** in `value`, so Slice A's
  traversal renders it as a ghost.
- On Commit (grid-level toolbar):
  - Mongo: `mqlGenerator` groups by row, emits
    `updateOne(filter, { $set: { "<col>.<newPath>": <value> } })`.
    MongoDB creates the missing path automatically.
  - RDB jsonb: `sqlGenerator.emitJsonbUpdate` emits
    `jsonb_set(<col>, '{<segments>}', <jsonbValue>, true)`. The
    `true` 4th argument creates missing intermediate keys.
  - RDB ARRAY: `sqlGenerator.emitArrayUpdate` walks the current
    array, appends each new index found in `extraIndexes`, emits
    `ARRAY[...]::etype[]`.

## UI States

- **Idle**: each object / array node shows a faint dashed `+ key`
  or `+ item` affordance after its last child.
- **Editing (object)**: two paired inputs at child indent; key
  input focused; placeholder text shows expected shape; both inputs
  share a primary-color outline.
- **Editing (array)**: index label `[N]` (read-only, muted) plus
  single value input focused; same primary-color outline.
- **Conflict (object only)**: empty key or duplicate key on Enter —
  inputs flash with `aria-invalid` and a 12px inline message under
  the inputs. No commit fires until cleared.
- **Ghost row (post-commit, pre-save)**: renders with the
  pending-edit amber tint plus a "NEW" badge distinct from
  "● edited". Trash icon is available to revert via `__op__:unset`.
- **Saved (after Commit)**: ghost row promotes to a normal row on
  the next data fetch.
- **Error (Commit fails)**: the grid's existing per-key error
  mechanism (`onCoerceError`) flags the ghost row's cell.

## Edge Cases

- Adding the first key to an empty object cell `{}` (Mongo) and to
  an empty `{}` jsonb cell (RDB).
- Adding the first item to an empty array `[]` (Mongo) and to an
  empty Postgres ARRAY `{}` (RDB) — the resulting SQL
  `ARRAY[<v>]::etype[]` must be valid.
- Adding a key to a jsonb cell whose current value is SQL `NULL` —
  base falls back to `'{}'::jsonb`.
- Adding a nested object value (e.g. `{"a":1}`) on a single `+ key`
  commit — only one pendingEdit entry written; the ghost subtree is
  computed at render time.
- Two consecutive `+ item` adds without a save: indexes `[N]` and
  `[N+1]` are distinct ghost rows, not a collision.
- Mixed top-level cell edit + add-key on the same cell: top-level
  wins (existing sprint-343 behaviour), nested add reported via
  `onCoerceError`.
- Duplicate-key block: typing a key that already exists either in
  `value` or in `pendingByPath` — commit blocked with inline hint.
- Empty-key block: empty key + Enter → blocked.
- Empty-value commit on `+ key` and `+ item` → allowed.
- Add on `_id` — `+ key` is hidden at the document root if the
  field name would collide with `_id`. Within nested objects, no
  special-case.
- Adding to a sentinel non-structural column (RDB `text`, etc.) —
  generator rejects via `onCoerceError`.
- Adding to `jsonb[]` / composite ARRAY (Sprint 343 deferred
  bucket) — generator still rejects with the existing message;
  this sprint does not unblock that.

## Test Strategy

- `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` —
  ghost rendering, `+ key`, `+ item` UX, validation states.
- `pnpm vitest run src/lib/mongo/mqlGenerator.test.ts` — Mongo `$set`
  creates missing paths.
- `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts` —
  jsonb create_missing flag, jsonb-null base, ARRAY push.
- `pnpm vitest run src/components/document/DocumentDataGrid.nested.test.tsx`
  `src/components/rdb/DataGrid.lifecycle.test.tsx` — end-to-end
  add-key / add-item.
- `pnpm tsc --noEmit && pnpm lint` — clean.

## Invariants

1. `DocumentTreePanel` remains paradigm-agnostic — no Mongo or RDB
   imports leak in.
2. Leaf edit / leaf delete (`__op__:unset`) behaviour stays exactly
   as Sprint 342 shipped.
3. Sprint 343's `(rowIdx, colIdx)` dispatch — top-level wins,
   non-structural reject, mixed-mode reporting — unchanged.
4. `safeStringifyCell` is used wherever a cell-domain JSON payload is
   serialised.

## Critical Files

- `src/components/document/DocumentTreePanel.tsx`
- `src/lib/jsonTree.ts`
- `src/components/datagrid/sqlGenerator.ts`
- `src/lib/mongo/mqlGenerator.ts`
- `src/components/datagrid/DataGridTable.tsx`
