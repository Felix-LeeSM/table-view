# Handoff: sprint-251

## Outcome

- Status: **complete** — all four pending-edit slices (`pendingEdits`,
  `pendingNewRows`, `pendingDeletedRowKeys`, `undoStack`) lifted from
  `useState` to a new in-memory zustand store
  (`src/stores/dataGridEditStore.ts`) keyed by
  `${connectionId}::${schema}::${table}`. Tab unmount/remount no longer
  drops the user's pending work; `tabStore.removeTab` purges entries
  when no surviving tab targets the same key, and
  `tabStore.clearTabsForConnection` purges the connection's whole
  prefix in one shot.
- Summary: 1 new store + 4 lifted setters in the hook + 2 lifecycle
  wire-ups in `tabStore`. `useDataGridEdit` returned shape is
  byte-identical (30+ fields verbatim). Sprint 249 / 250 invariants
  preserved (verified by re-running the existing `*.undo.test.ts`,
  `*.onblur.test.ts`, `DataGrid.esc.test.tsx`, `DataGrid.undo.test.tsx`
  unmodified).

## /tdd Evidence (test-first order)

> Tests-first (TDD): 신규 테스트 작성 → red → 구현 → green.

1. **Red** — Wrote three new test files first
   (`src/stores/dataGridEditStore.test.ts`,
   `src/components/datagrid/useDataGridEdit.persist.test.ts`,
   `src/stores/tabStore.purge.test.ts`) and ran them. Failure
   one-liner: `Failed to resolve import "./dataGridEditStore" from
   src/stores/tabStore.purge.test.ts. Does the file exist?` (3/3 test
   files failed at the import-resolution step — the store and wire-up
   did not exist yet).
2. **Green** — Implemented `dataGridEditStore.ts`, rewired
   `useDataGridEdit.ts` to consume store-backed slices via wrapper
   setters, and added `purgeKey` / `purgeForConnection` calls inside
   `tabStore.removeTab` / `clearTabsForConnection`. Added a global
   `beforeEach` reset in `src/test-setup.ts` so existing tests using
   the canonical `("conn1", "public", "users")` fixture do not leak
   pending state across tests.
3. **Verify** — Re-ran all 8 sprint-relevant test files (66 tests pass)
   then the full vitest suite (3003 tests pass), plus tsc / lint /
   cargo test / clippy / grep.

## Verification Profile

- Profile: `command`
- Overall score: 7/7 required checks pass.
- Final evaluator verdict: pending evaluator review.

## Evidence Packet

### Checks Run

1. `pnpm tsc --noEmit` → **pass** (0 errors).
   ```
   $ pnpm tsc --noEmit
   (no output)
   ```
2. `pnpm lint` → **pass** (0 errors / 0 warnings).
   ```
   $ pnpm lint
   > table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
   > eslint .
   (no output → 0 errors)
   ```
3. `pnpm vitest run` → **pass** (3003 / 3003 across 236 files).
   ```
   Test Files  236 passed (236)
        Tests  3003 passed (3003)
   ```
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` → **pass**
   (627 / 627; 2 ignored).
   ```
   test result: ok. 627 passed; 0 failed; 2 ignored; 0 measured; ...
   ```
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
   --all-features -- -D warnings` → **pass** (0 warnings).
   ```
   Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.63s
   ```
6. `rg "dataGridEditStore|DataGridEditStore" src/` → **pass** (≥3 — 5
   distinct files: store source, store test, useDataGridEdit hook,
   persist test, tabStore wire-up, tabStore purge test, test-setup).
7. `rg "purgeKey|purgeForConnection" src/stores/tabStore.ts` → **pass**
   (2 matches — one for each call site).
   ```
   useDataGridEditStore.getState().purgeKey(closingKey);
   useDataGridEditStore.getState().purgeForConnection(connectionId);
   ```

### Acceptance Criteria Coverage

#### Store (AC-251-S1..S5)

- `AC-251-S1` (cross-key isolation):
  `src/stores/dataGridEditStore.test.ts:32` — "[AC-251-S1] two
  different keys are isolated".
- `AC-251-S2` (setSlice preserves other slices):
  `src/stores/dataGridEditStore.test.ts:46` — "[AC-251-S2] setSlice on
  one slice preserves the other three slices".
- `AC-251-S3` (clearEntry empties all four slices):
  `src/stores/dataGridEditStore.test.ts:70` — "[AC-251-S3] clearEntry
  empties all four slices for that key".
- `AC-251-S4` (purgeKey deletes the entry):
  `src/stores/dataGridEditStore.test.ts:96` — "[AC-251-S4] purgeKey
  deletes the entry from the store map entirely".
- `AC-251-S5` (purgeForConnection prefix-scoped):
  `src/stores/dataGridEditStore.test.ts:109` — "[AC-251-S5]
  purgeForConnection removes every entry whose key starts with the
  connectionId prefix".

#### Hook (AC-251-H1..H5)

- `AC-251-H1` (unmount → remount preserves all 4 slices):
  `src/components/datagrid/useDataGridEdit.persist.test.ts:104` —
  "[AC-251-H1] unmount → re-mount with same key preserves all 4
  slices".
- `AC-251-H2` (different key → empty state):
  `src/components/datagrid/useDataGridEdit.persist.test.ts:139` —
  "[AC-251-H2] mount with a different key starts with empty pending
  state".
- `AC-251-H3` (two hooks, same key, share state):
  `src/components/datagrid/useDataGridEdit.persist.test.ts:151` —
  "[AC-251-H3] two hook instances on the same key share state".
- `AC-251-H4` (clearAllPending wipes the entry):
  `src/components/datagrid/useDataGridEdit.persist.test.ts:163` —
  "[AC-251-H4] clearAllPending (via handleDiscard) wipes the store
  entry".
- `AC-251-H5` (Sprint 249 / 250 regressions hold under store):
  `src/components/datagrid/useDataGridEdit.persist.test.ts:188` —
  "[AC-251-H5] Sprint 249 / 250 invariants hold under store-backed
  state".

#### tabStore wire-up (AC-251-T1..T3)

- `AC-251-T1` (removeTab purges when no other tab uses key):
  `src/stores/tabStore.purge.test.ts:31` — "[AC-251-T1] removeTab
  purges the store entry when no other tab shares the same key".
- `AC-251-T2` (removeTab does NOT purge when sibling tab survives):
  `src/stores/tabStore.purge.test.ts:51` — "[AC-251-T2] removeTab
  does NOT purge when another tab still targets the same key".
- `AC-251-T3` (clearTabsForConnection bulk purge):
  `src/stores/tabStore.purge.test.ts:97` — "[AC-251-T3]
  clearTabsForConnection purges every store entry whose key starts
  with the connectionId prefix".

#### Regression (AC-251-R1..R4)

- `AC-251-R1`: `src/components/datagrid/useDataGridEdit.undo.test.ts`
  — 9 / 9 pass (verified, no source change).
- `AC-251-R2`: `src/components/rdb/DataGrid.undo.test.tsx` — 5 / 5
  pass (verified, no source change).
- `AC-251-R3`: `src/components/datagrid/useDataGridEdit.onblur.test.ts`
  — 5 / 5 pass (verified, no source change).
- `AC-251-R4`: `src/components/rdb/DataGrid.esc.test.tsx` — 4 / 4
  pass (verified, no source change). `DataGrid.editing.test.tsx` (15
  / 15) also re-verified for completeness.

### Code Excerpts

#### `entryKey` helper + immutable update pattern (`src/stores/dataGridEditStore.ts`)

```ts
// L100-108 — entry key composition (single source of truth, shared by
// useDataGridEdit + tabStore so the key never drifts).
export function entryKey(
  connectionId: string,
  schema: string,
  table: string,
): string {
  return `${connectionId}::${schema}::${table}`;
}

// L120-130 — setSlice: every mutation produces a fresh entry +
// fresh entries Map. Map / Set / Array values are passed verbatim;
// callers ALWAYS pass a freshly-allocated container.
setSlice: (key, slice, value) =>
  set((state) => {
    const existing = state.entries.get(key);
    const base: PendingEntry = existing ?? freshEntry();
    const nextEntry: PendingEntry = { ...base, [slice]: value };
    const nextEntries = new Map(state.entries);
    nextEntries.set(key, nextEntry);
    return { entries: nextEntries };
  }),

// L145-156 — purgeForConnection: prefix-scoped delete with identity
// short-circuit so a no-op call doesn't perturb subscribers.
purgeForConnection: (connectionId) =>
  set((state) => {
    const prefix = `${connectionId}::`;
    let mutated = false;
    const nextEntries = new Map(state.entries);
    for (const key of state.entries.keys()) {
      if (key.startsWith(prefix)) {
        nextEntries.delete(key);
        mutated = true;
      }
    }
    if (!mutated) return state;
    return { entries: nextEntries };
  }),
```

#### `useDataGridEdit` rewire (returned shape preserved)

```ts
// L406-435 — store-backed reads. The 4 slices come from a single
// entry selection so reads stay coherent across one render.
const storeKey = useMemo(() => {
  if (!connectionId || !schema || !table) {
    return fallbackInstanceKeyRef.current!;
  }
  return makeStoreEntryKey(connectionId, schema, table);
}, [connectionId, schema, table]);

const entry = useDataGridEditStore((s) => s.entries.get(storeKey)) ??
  EMPTY_ENTRY;
const pendingEdits = entry.pendingEdits;
const pendingNewRows = entry.pendingNewRows;
const pendingDeletedRowKeys = entry.pendingDeletedRowKeys;
const undoStack = entry.undoStack;

// L437-485 — setter wrappers. The hook body uses
// `setPendingEdits((prev) => ...)` extensively (e.g. inside
// `pushSnapshot`); the wrappers preserve that signature so internal
// callsites are byte-identical to the pre-Sprint-251 useState world.
const setPendingEdits = useCallback(
  (next: Map<string, string | null> | ((prev: Map<string, string | null>) => Map<string, string | null>)) => {
    const current = useDataGridEditStore.getState().getEntry(storeKey).pendingEdits;
    const value = typeof next === "function" ? next(current) : next;
    storeSetSlice(storeKey, "pendingEdits", value);
  },
  [storeKey, storeSetSlice],
);
// (… setPendingNewRows, setPendingDeletedRowKeys, setUndoStack — same
//   shape, same wrapper pattern.)
```

```ts
// L500-509 — clearAllPending now delegates to store.clearEntry, which
// resets all four slices in one set() call.
const clearAllPending = useCallback(() => {
  storeClearEntry(storeKey);
  setPendingEditErrors(new Map());
  clearSelection();
  setEditingCell(null);
  setEditValue("");
}, [storeKey, storeClearEntry, clearSelection]);
```

```ts
// L865-900 — return statement (UNCHANGED from pre-Sprint-251). 30+
// fields verbatim: editingCell, editValue, setEditValue, setEditNull,
// pendingEdits, pendingEditErrors, pendingNewRows,
// pendingDeletedRowKeys, sqlPreview, setSqlPreview, commitError,
// setCommitError, mqlPreview, setMqlPreview, selectedRowIds,
// anchorRowIdx, selectedRowIdx, hasPendingChanges, isCommitFlashing,
// saveCurrentEdit, cancelEdit, handleStartEdit, handleSelectRow,
// handleCommit, handleExecuteCommit, pendingConfirm,
// confirmDangerous, cancelDangerous, handleDiscard, handleAddRow,
// handleDeleteRow, handleDuplicateRow, undo, canUndo.
```

#### `tabStore` wire-up (`src/stores/tabStore.ts`)

```ts
// L155-202 — removeTab. The purge fires AFTER the set() so the
// surviving tab list is observed atomically. Sibling check uses the
// pre-removal snapshot to avoid an off-by-one race.
removeTab: (id) => {
  const stateBefore = get();
  const closingTab = stateBefore.tabs.find((t) => t.id === id);
  const survivors = stateBefore.tabs.filter((t) => t.id !== id);
  set((state) => { /* unchanged tabs/dirty mutation */ });

  if (closingTab && closingTab.type === "table") {
    const closingSchema = closingTab.schema;
    const closingTable = closingTab.table;
    if (closingSchema && closingTable) {
      const closingKey = makeDataGridEditKey(
        closingTab.connectionId,
        closingSchema,
        closingTable,
      );
      const stillUsed = survivors.some(
        (t) =>
          t.type === "table" &&
          t.connectionId === closingTab.connectionId &&
          t.schema === closingSchema &&
          t.table === closingTable,
      );
      if (!stillUsed) {
        useDataGridEditStore.getState().purgeKey(closingKey);
      }
    }
  }
},
```

```ts
// L227-273 — clearTabsForConnection. Bulk purge after the set();
// `hadAny` short-circuit keeps the call a no-op when no tab from the
// connection is open.
clearTabsForConnection: (connectionId) => {
  const hadAny = get().tabs.some((t) => t.connectionId === connectionId);
  set((state) => { /* unchanged tabs/dirty mutation */ });
  if (hadAny) {
    useDataGridEditStore.getState().purgeForConnection(connectionId);
  }
},
```

### Screenshots / Links / Artifacts

- N/A (pure logic / state-management refactor — no UI chrome change).

## Changed Areas

- `src/stores/dataGridEditStore.ts` — **NEW.** Zustand store backing
  the four lifted pending-edit slices. In-memory only (no persist /
  no IPC bridge) per contract.
- `src/stores/dataGridEditStore.test.ts` — **NEW.** 6 cases covering
  AC-251-S1..S5 + `entryKey` helper composition.
- `src/components/datagrid/useDataGridEdit.persist.test.ts` — **NEW.**
  5 cases covering AC-251-H1..H5 (hook persistence across
  unmount/remount, cross-key isolation, store-shared state, discard
  cleanup, Sprint 249 / 250 regression in the new store environment).
- `src/stores/tabStore.purge.test.ts` — **NEW.** 3 cases covering
  AC-251-T1..T3 (removeTab purge / no-purge-when-shared / bulk
  connection purge).
- `src/components/datagrid/useDataGridEdit.ts` — **MODIFIED.** Four
  `useState` hooks for the pending diff slices replaced by store
  selectors + setter wrappers; `clearAllPending` now delegates to
  `clearEntry`. Returned 30+ field shape unchanged.
- `src/stores/tabStore.ts` — **MODIFIED.** `removeTab` and
  `clearTabsForConnection` call `dataGridEditStore.purgeKey` /
  `purgeForConnection` at the lifecycle seam. Sibling-tab check
  ensures preview + persistent tabs sharing one key are not
  prematurely purged.
- `src/test-setup.ts` — **MODIFIED.** Global `beforeEach` resets the
  store between tests so the canonical `("conn1", "public", "users")`
  fixture (used by ~10 existing test files) doesn't leak pending
  state. This is the single change that lets the existing regression
  tests pass without source modification.

## Assumptions

- **Hot-reload store identity** — Vite HMR may replace the
  `useDataGridEditStore` module instance; in that case all entries
  reset (acceptable for dev). Production builds keep the singleton
  for the workspace window's lifetime.
- **Two tabs sharing the same key share pending state by design** —
  AC-251-T2 confirms purge is suppressed when a sibling tab survives.
  AC-251-H3 confirms two concurrently-mounted hook instances see the
  same pending writes immediately. This is the intended semantics: a
  preview tab and its persistent counterpart both target the same
  `(connectionId, schema, table)` so they SHOULD share buffered
  edits.
- **Mongo grid (paradigm `"document"`) on the document grid passes
  `database`/`collection` as `schema`/`table`** — the store key for
  Mongo therefore becomes `${cid}::${database}::${collection}`. Mongo
  grids use `useDataGridEdit` in read-only fashion (no commit path
  fires), so the buffered slices stay empty and the per-tab key is
  harmless. The contract excludes Mongo from semantic changes.
- **`undoStack` 50-entry cap (`UNDO_STACK_MAX`)** — `pushSnapshot`
  still enforces the cap inside its `setUndoStack(updater)` body
  (line 544: `if (next.length > UNDO_STACK_MAX) next.shift();`),
  identical to the pre-Sprint-251 behaviour. The store doesn't impose
  its own cap because the hook is the only writer that conceptually
  bounds the stack (Sprint 249 invariant).
- **Fallback instance key** — When `connectionId`, `schema`, or
  `table` is empty (an edge case never observed in the rdb code path
  but theoretically reachable through `DocumentDataGrid`'s pre-load
  state), the hook falls back to a per-mount instance key
  (`__instance__::<random>`). This preserves the pre-Sprint-251 reset-
  on-remount semantics for that specific edge so no Mongo regression
  is possible.
- **`no-restricted-imports` waiver in `tabStore.ts`** — the rule
  forbids store-to-store imports, but the contract explicitly puts
  the wire-up in `tabStore` and the verification grep targets
  `src/stores/tabStore.ts`. Used `eslint-disable` with a justifying
  comment block matching the existing precedent (the `tabStore/persistence`
  sibling import uses the same waiver). The dataGridEditStore is a
  one-way write-only sink from `tabStore`; no back-edge exists.

## Residual Risk

- **Cross-window pending state is intentionally NOT synced.** Two
  workspace windows opened on the same connection + table will have
  independent pending buffers. This was explicitly out of scope per
  contract; surfacing this in the next sprint candidate list.
- **localStorage persistence is intentionally NOT implemented.**
  Workspace restart wipes the buffer. Surfacing this as a follow-up
  candidate too.
- **DDL editor + raw-query grid (`useRawQueryGridEdit`) keep their
  own per-mount `useState` pending state** — they were explicitly
  excluded from the lift. A future sprint can apply the same store
  pattern there if the same UX pain shows up.
- **Hook selector recomputes** — `useDataGridEditStore((s) =>
  s.entries.get(storeKey))` returns a new entry reference on every
  store mutation (correct), so subscribers re-render every time any
  slice changes for that key. This matches the pre-Sprint-251
  granularity (the four `useState` calls also each forced a render);
  no perf regression. If a future sprint needs finer-grained
  selectors per-slice, the wrapping is straightforward.
- **`fallbackInstanceKeyRef`** uses `Math.random()` + `Date.now()` —
  collision probability is negligible (52 bits of entropy in a single
  workspace), but for safety the key is namespaced under
  `__instance__::` so it can never collide with a real
  `${cid}::${schema}::${table}` value.

## Next Sprint Candidates

- **Sprint 252** (already queued) — PreviewDialog copy button + SQL
  syntax highlight.
- **localStorage persistence** for `dataGridEditStore` so a workspace
  restart restores in-flight pending edits. (Out of scope per
  Sprint 251 contract but a natural follow-on once the in-memory lift
  is bedded in.)
- **DDL editor / raw-query grid** lift — apply the same
  store-backed pattern to `useRawQueryGridEdit` + DDL form state.
- **Cross-window sync** for pending state — would require BroadcastChannel
  + serialisation (Map/Set are not JSON-serialisable as-is).
- **Tab close confirmation dialog** — "you have pending changes — discard?"
  prompt when the user closes a dirty tab whose entry would be purged.
