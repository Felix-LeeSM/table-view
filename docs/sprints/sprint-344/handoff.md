# Sprint 344 Handoff — Inline tree add key / add item (Mongo + RDB)

## What shipped

Slice A — **Ghost-node tree traversal**. `buildTreeNodesWithGhosts` merges
`value`-derived children with paths that exist only in `pendingByPath`,
surfacing them as ghost rows with a distinct `NEW` badge (separate from
the existing `● edited` marker). Insertion order preserves `pendingByPath`
Map order so two consecutive ghosts land at predictable indexes. JSON-
parseable ghost values expand into nested ghost subtrees; parse failures
fall back to a string leaf without crashing.

Slice B — **`+ key` inline pair input on object nodes**. Every object
node (root + nested) renders a dashed `+ key` affordance when
`onCommitEdit` is provided. Clicking it opens paired key + value inputs
at the parent's child indent. Tab moves key→value, Shift+Tab moves
value→key, Enter commits, Esc cancels. Empty key and duplicate-key
(against `value` OR `pendingByPath`) reject with `aria-invalid` + inline
message; empty value with a non-empty key commits as an empty string.
Single shared `addingPath` state means only one inline add UI is visible
at a time across the whole tree.

Slice C — **`+ item` inline value input on array nodes**. Every array
node renders a dashed `+ item` affordance. Clicking it shows a read-only
`[N]` index label next to a single value input. Index is auto-derived
from `arrayNode.childCount + max(prior pending bracket-index appends)`,
so two consecutive `+ item` commits land at `[N]` and `[N+1]` without
collision. Pending bracket-index keys are filtered to direct child slots
only — a nested-edit pending like `tags[2].name` does not bump the
counter.

Slice D — **JSON.parse value coercion with outer-quotes rule**. Pure
helper `coerceTreeAddValue` turns a typed string into a JSON-typed
commit payload: bare `42` → number, quoted `"42"` → string, `null` /
`true` / `false` → JSON primitives, `{"a":1}` → object, `[1,"x"]` →
array. Free text that fails `JSON.parse` falls back to the trimmed raw
string (no error surfaced). Outer whitespace is trimmed before parsing.
Empty input returns `""`.

Slice E — **Generator dispatch (jsonb create-missing, jsonb-null base,
ARRAY push)**. `emitJsonbUpdate` now passes `create_missing=true` on
every `jsonb_set(...)` call so adds materialise missing keys. When the
jsonb cell value is SQL `NULL`, the base is wrapped once in
`COALESCE(<col>, '{}'::jsonb)` so chained `jsonb_set` calls grow from
an empty object. Postgres ARRAY push-past-end is handled by
`emitArrayUpdate`'s existing `extraIndexes` branch — regression-locked.
Mongo `$set` natively creates missing paths, so `mqlGenerator.ts` was
not touched; new test cases lock the `(rowIdx-colIdx:<nested.path>)`
emit shape.

Slice F — **Integration + `_id` guard + handoff**. End-to-end tests
through `DocumentDataGrid` (Mongo) and `DataGrid` → `DataGridTable`
(RDB) confirm the wire-up: clicking `+ key` / `+ item` in the inline
tree records the correct `<row>-<col>:<segment>` pendingEdit, and the
preview MQL/SQL emits the expected `$set: { "<col>.<seg>": <v> }` /
`jsonb_set(<col>, '{<seg>}', '<json>'::jsonb, true)` /
`ARRAY[<orig...>, <new>]::etype[]` shapes. Mongo grid adds a
paradigm-agnostic `forbiddenRootKeys={new Set(["_id"])}` prop on
`DocumentTreePanel` so root-level `_id` adds are rejected with the same
aria-invalid + inline-message UX as the duplicate-key reject; nested
`_id` (e.g. inside `meta`) stays legal. RDB grid omits the prop.

## Files touched

Slice A:
- `src/lib/jsonTree.ts` — added `buildTreeNodesWithGhosts`.
- `src/lib/jsonTree.test.ts` — ghost cases.
- `src/components/document/DocumentTreePanel.tsx` — wire ghost render.
- `src/components/document/DocumentTreePanel.test.tsx` — UI ghost cases.

Slice B:
- `src/components/document/DocumentTreePanel.tsx` — `AddKeyRow`, +
  state machine.
- `src/components/document/DocumentTreePanel.test.tsx` — AC-B-01..11
  + edges.

Slice C:
- `src/components/document/DocumentTreePanel.tsx` — `AddItemRow`, +
  array path handling.
- `src/components/document/DocumentTreePanel.test.tsx` — AC-C-01..10
  + edges.

Slice D:
- `src/lib/jsonTree.ts` — `coerceTreeAddValue` helper.
- `src/lib/jsonTree.test.ts` — AC-D-01..11 + extras.

Slice E:
- `src/components/datagrid/sqlGenerator.ts` — 4-arg `jsonb_set` +
  `COALESCE` base.
- `src/components/datagrid/sqlGenerator.test.ts` — AC-E-01..04, E-07.
- `src/lib/mongo/mqlGenerator.test.ts` — AC-E-05, E-06.

Slice F (this slice):
- `src/components/document/DocumentTreePanel.tsx` — `forbiddenRootKeys`
  prop + guard.
- `src/components/document/DocumentTreePanel.test.tsx` — 3 unit tests
  (`forbiddenRootKeys` absent/present/nested) covering AC-344-F-04.
- `src/components/document/DocumentDataGrid.tsx` — module-level
  `MONGO_ROOT_RESERVED_KEYS = new Set(["_id"])`; passed to
  `DocumentTreePanel`.
- `src/components/document/DocumentDataGrid.nested.test.tsx` — 2
  integration tests (AC-344-F-01 Mongo `+ key` E2E; AC-344-F-04 Mongo
  grid wire-up of `_id` reject).
- `src/components/rdb/DataGrid.lifecycle.test.tsx` — 2 integration
  tests (AC-344-F-02 jsonb `+ key` E2E; AC-344-F-03 text[] `+ item`
  E2E).
- `docs/sprints/sprint-344/handoff.md` — this file.

## Verification

- `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx
  src/components/document/DocumentDataGrid.nested.test.tsx
  src/components/rdb/DataGrid.lifecycle.test.tsx` — 3 files, 75/75 pass.
- `pnpm vitest run` (full): 3926 pass / 10 skipped / 2 fail. The 2
  failures are in `src/lib/editor/autocompleteTheme.test.ts` — they
  belong to the user's parallel `autocompleteTheme.ts` /
  `mongoAutocomplete.ts` working-tree edits (token rename
  `var(--primary)` → `var(--tv-primary)`) and have been present since
  Slice A. Not touched by any sprint-344 slice.
- `pnpm tsc --noEmit` — clean.
- `pnpm lint` — clean.

## AC-344-F mapping

- **AC-344-F-01** (Mongo `+ key` E2E):
  `DocumentDataGrid.nested.test.tsx` — `"AC-344-F-01: + key add on
  meta shows a NEW ghost row + MQL preview emits $set: { 'meta.team':
  'owner' }"`. Asserts ghost row carries `NEW` badge, pending-pill
  increments, MQL preview contains `updateOne` + `"meta.team"` +
  `"owner"`.
- **AC-344-F-02** (RDB jsonb `+ key` E2E):
  `DataGrid.lifecycle.test.tsx` — `"AC-344-F-02: jsonb + key add —
  preview SQL contains jsonb_set(...)"`. Asserts preview text contains
  `UPDATE`, `jsonb_set`, `'{"newKey"}'`, `'42'::jsonb`, and the 4-arg
  `, true)` form.
- **AC-344-F-03** (RDB ARRAY `+ item` E2E):
  `DataGrid.lifecycle.test.tsx` — `"AC-344-F-03: text[] + item push —
  preview SQL contains ARRAY['a', 'b', 'c']::text[]"`. Asserts preview
  text contains the appended literal array with the new element.
- **AC-344-F-04** (Mongo `_id` reject):
  `DocumentTreePanel.test.tsx` — 3 unit tests covering the prop
  default (absent → commits), the active rejection (present → no
  commit, aria-invalid, inline message), and the nested escape hatch
  (nested `_id` still commits). Mongo grid wire-up confirmed in
  `DocumentDataGrid.nested.test.tsx` — `"AC-344-F-04: Mongo grid
  rejects _id root add via forbiddenRootKeys"`.
- **AC-344-F-05** (regression zero): full vitest run shows 3926 pass /
  10 skipped / 2 fail (autocompleteTheme out-of-scope, pre-existing).
  No new failure introduced by Slice F.
- **AC-344-F-06** (handoff.md): this file.

## Decisions worth carrying forward

- **Ghost insertion order = `pendingByPath` Map insertion order**
  (Slice A). Users can predict where their newly added rows appear
  because Map preserves insertion order; no extra sort.
- **Outer-quotes rule + JSON.parse fallback to raw string** (Slice D).
  Bare `42` becomes number 42, quoted `"42"` stays string. Free text
  that fails `JSON.parse` is committed as the literal string — no
  error surfaced to the user. Keeps the input forgiving without
  guessing intent.
- **`_id` guard via paradigm-agnostic prop `forbiddenRootKeys`**
  (Slice F). `DocumentTreePanel` accepts a `ReadonlySet<string>` and
  rejects root-level commits whose key matches. The Mongo grid
  injects `Set(["_id"])`; the RDB grid omits the prop. Keeps the
  panel paradigm-agnostic (no `if (mongo)` branches inside the panel).
- **COALESCE wrap on jsonb null base** (Slice E). When the jsonb cell
  is SQL `NULL`, the generator wraps the base in
  `COALESCE(<col>, '{}'::jsonb)` exactly once so chained `jsonb_set`
  calls grow from an empty object. Double-wrap would produce invalid
  SQL; once-only wrap is enforced by the accumulator pattern.
- **ARRAY push past end via `emitArrayUpdate.extraIndexes`** (Slice E).
  The generator already had the branch for synthesised "ghost" indices;
  Slice E only added a regression lock + sequential-index case.
- **4-arg `jsonb_set(..., true)` universal** (Slice E). `create_missing
  = true` is safe for both add and edit: existing keys are overwritten
  identically, and missing keys are now materialised. No conditional
  branch needed at the SQL emit layer.
- **`MONGO_ROOT_RESERVED_KEYS` as a module-level constant** (Slice F).
  Stable Set identity across renders. An inline `new Set([...])` would
  invalidate `commitAddKey`'s dep array every render.

## Deferred to follow-up sprint

- **MySQL JSON / SQLite JSON dispatch** — only Postgres jsonb is wired.
  Carried from sprint-343.
- **jsonb[] / composite arrays** — element-edit on a jsonb[] cell still
  rejects with `onCoerceError`. Carried from sprint-343.
- **Virtualized RDB grid master/detail row** — the inline tree panel
  does not yet render under the virtualizer's body row branch.
  Carried from sprint-343.
- **Drag-and-drop reorder / mid-array insert / key rename** — Slice C
  only handles append-to-end. Reorder and mid-array insert require a
  separate pendingEdit shape (probably index-rewrite list) and are
  out of scope here.
- **Multi-segment ghost path synthesis** — when `pendingByPath`
  contains a dotted path like `"a.b.c"` with no intermediate `a` /
  `a.b` rows, the helper currently renders only the deepest leaf at
  depth=3. Slice A flagged this; Slice B/D's affordances always emit
  single-segment keys, so the case is unreachable in the current
  user flow. Add an intermediate-row synthesizer if a future affordance
  ever emits multi-segment paths.
- **`__proto__` / `constructor` key reserved-name handling** — the
  `forbiddenRootKeys` prop is the right hook for this if it becomes a
  concern; today the panel commits them verbatim, and the downstream
  Map / Object literal builders are structurally safe.
- **autocompleteTheme.test.ts CSS-token rename** — user's parallel
  working-tree work (`var(--primary)` → `var(--tv-primary)`); the test
  file still asserts the old token. Out of scope for sprint-344; the
  2 failures are recorded across every slice's findings.
