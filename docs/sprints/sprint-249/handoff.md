# Handoff: sprint-249

## Outcome

- Status: Implemented — all 7 verification checks pass.
- Summary: ADR 0022 Phase 5 — DataGrid pending-edit Cmd+Z (macOS) /
  Ctrl+Z (Win/Linux) undo. Adds an undo stack to `useDataGridEdit`
  (`undoStack`, `pushSnapshot`, `undo`, `canUndo`), wires Cmd+Z /
  Ctrl+Z keydown on `DataGrid`, and exposes a discoverable Toolbar
  Undo button. 50-entry FIFO cap, no-op skip on unchanged
  `applyEditOrClear`, INPUT/textarea/contenteditable target deferral
  to browser-native undo, and `clearAllPending` clears the stack so
  commit / discard correctly orphan history.

## Verification Profile

- Profile: `command`
- Overall score: 7/7 required checks pass.
- Final evaluator verdict: pending evaluator review.

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: pass (0 errors).
- `pnpm lint`: pass (0 errors / 0 warnings — `eslint .` exited cleanly
  with no output).
- `pnpm vitest run`: pass — 231 test files, 2980 tests (was 2964 before
  Sprint 249; 16 new + 1 added stub in QuickLookPanel = 17 ΔAC for
  the 13 contract ACs + helper count rounding from ad-hoc cases).
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`: pass — 627
  passed, 0 failed, 2 ignored (Rust untouched, regression guard only).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  pass — `Finished dev profile`, no diagnostics.
- `rg "metaKey.*z|ctrlKey.*z|key === \"z\"" src/components/rdb/DataGrid.tsx`:
  ≥ 1 hit (`!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey)`).
- `rg "canUndo|undoStack" src/components/datagrid/useDataGridEdit.ts`:
  6 hits (declaration, state, derived, comments, returned key).

### Acceptance Criteria Coverage

#### Hook (useDataGridEdit)

- `AC-249-U1` empty-stack `undo()` is a no-op:
  `src/components/datagrid/useDataGridEdit.undo.test.ts:91-105`
  (asserts `canUndo===false` before & after, all pending slices zero).
- `AC-249-U2` `handleAddRow` → `undo()` empties `pendingNewRows`:
  `useDataGridEdit.undo.test.ts:107-122`.
- `AC-249-U3` `handleDeleteRow` → `undo()` empties
  `pendingDeletedRowKeys`: `useDataGridEdit.undo.test.ts:124-144`.
- `AC-249-U4` `handleDuplicateRow` → `undo()` reverts
  `pendingNewRows`: `useDataGridEdit.undo.test.ts:146-162`.
- `AC-249-U5` value-changing `saveCurrentEdit` → `undo()` reverts
  `pendingEdits`: `useDataGridEdit.undo.test.ts:164-185`.
- `AC-249-U6` no-op `saveCurrentEdit` does not push:
  `useDataGridEdit.undo.test.ts:187-198`.
- `AC-249-U7` `handleDiscard()` → `clearAllPending` empties stack:
  `useDataGridEdit.undo.test.ts:200-218` (drives via the public
  `handleDiscard` action which routes through `clearAllPending`).
- `AC-249-U8` >50 pushes → stack capped at `UNDO_STACK_MAX`:
  `useDataGridEdit.undo.test.ts:220-247` (after `UNDO_STACK_MAX`
  drains, 5 rows survive — proof of FIFO drop).
- `AC-249-U9` consecutive actions → LIFO restore:
  `useDataGridEdit.undo.test.ts:249-273`.

#### Keyboard (DataGrid)

- `AC-249-K1` Cmd+Z (metaKey) reverts pending Add:
  `src/components/rdb/DataGrid.undo.test.tsx:103-118`.
- `AC-249-K2` Ctrl+Z (ctrlKey) reverts pending Add:
  `DataGrid.undo.test.tsx:120-134`.
- `AC-249-K3` Cmd+Shift+Z does NOT trigger undo:
  `DataGrid.undo.test.tsx:136-156`.
- `AC-249-K4` INPUT-focused Cmd+Z defers to browser-native undo:
  `DataGrid.undo.test.tsx:158-184`.
- `AC-249-K5` commit success → `canUndo` flips to false; Cmd+Z
  no-ops post-commit: `DataGrid.undo.test.tsx:186-220`.

#### Toolbar (DataGridToolbar)

- `AC-249-T1` `canUndo=true` → button enabled:
  `src/components/datagrid/DataGridToolbar.test.tsx:213-222`.
- `AC-249-T2` `canUndo=false` → button disabled:
  `DataGridToolbar.test.tsx:224-231`.
- `AC-249-T3` click → `onUndo` called once:
  `DataGridToolbar.test.tsx:233-243`.

#### Wire-up

- `AC-249-W1` DataGrid passes `onUndo` + `canUndo` to
  `DataGridToolbar`: `src/components/rdb/DataGrid.tsx:443-444`.
- `AC-249-W2` `useDataGridEdit` returned `undo` / `canUndo` exposed:
  `src/components/datagrid/useDataGridEdit.ts:784-785` (`return`
  block) and the `DataGridEditState` interface gains `undo: () => void`
  (line 360) and `canUndo: boolean` (line 362).

### Inline Code Snippets (load-bearing)

`pushSnapshot` (deep-copy + 50-cap; `useDataGridEdit.ts:456-470`):

```ts
const pushSnapshot = useCallback(() => {
  setUndoStack((prev) => {
    const snap: EditSnapshot = {
      pendingEdits: new Map(pendingEdits),
      pendingNewRows: pendingNewRows.map((row) => [...row]),
      pendingDeletedRowKeys: new Set(pendingDeletedRowKeys),
    };
    const next = [...prev, snap];
    if (next.length > UNDO_STACK_MAX) next.shift();
    return next;
  });
}, [pendingEdits, pendingNewRows, pendingDeletedRowKeys]);
```

`undo` (LIFO restore + clone-on-read; `useDataGridEdit.ts:472-484`):

```ts
const undo = useCallback(() => {
  setUndoStack((prevStack) => {
    if (prevStack.length === 0) return prevStack;
    const last = prevStack[prevStack.length - 1]!;
    setPendingEdits(new Map(last.pendingEdits));
    setPendingNewRows(last.pendingNewRows.map((row) => [...row]));
    setPendingDeletedRowKeys(new Set(last.pendingDeletedRowKeys));
    return prevStack.slice(0, -1);
  });
}, []);
```

DataGrid keydown handler (modifier + INPUT skip; `DataGrid.tsx:278-307`):

```ts
const handler = (e: KeyboardEvent) => {
  if (
    !((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey)
  ) {
    return;
  }
  const target = e.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }
  if (!canUndo) return;
  e.preventDefault();
  undoPending();
};
```

`clearAllPending` clears the stack (`useDataGridEdit.ts:432-445`):

```ts
const clearAllPending = useCallback(() => {
  setPendingEdits(new Map());
  setPendingEditErrors(new Map());
  setPendingNewRows([]);
  setPendingDeletedRowKeys(new Set());
  // Sprint 249: commit success / explicit discard tear down history —
  // a Cmd+Z after commit must NOT resurrect the prior pending state
  // (the DB is the new baseline) and discard is itself a "fresh slate"
  // user gesture.
  setUndoStack([]);
  clearSelection();
  setEditingCell(null);
  setEditValue("");
}, [clearSelection]);
```

### Screenshots / Links / Artifacts

- Contract: `docs/sprints/sprint-249/contract.md`.
- Execution brief: `docs/sprints/sprint-249/execution-brief.md`.
- ADR 0022: `memory/decisions/0022-safe-mode-destructive-only-confirm-with-dry-run/memory.md`.

## Changed Areas

- `src/components/datagrid/useDataGridEdit.ts`: undo stack
  (`undoStack`, `pushSnapshot`, `undo`, `canUndo`); 5 mutating
  handlers (`saveCurrentEdit`, `handleStartEdit` auto-save,
  `handleAddRow`, `handleDeleteRow`, `handleDuplicateRow`)
  push pre-mutation snapshots with no-op skip; `clearAllPending`
  also empties the stack; `EditSnapshot` type and `UNDO_STACK_MAX`
  exported for test consumption.
- `src/components/rdb/DataGrid.tsx`: window keydown listener for
  Cmd+Z / Ctrl+Z (modifier check, INPUT/textarea/contenteditable
  deferral, `e.preventDefault()` on undo); toolbar wired with
  `onUndo` and `canUndo`.
- `src/components/datagrid/DataGridToolbar.tsx`: optional `onUndo` /
  `canUndo` props; new Undo button (`Undo2` icon, aria-label
  "Undo last pending change", title "Undo (Cmd+Z) — pending changes
  only"); button rendered only when `onUndo` is provided so the
  document grid path stays unchanged.
- `src/components/datagrid/useDataGridEdit.undo.test.ts` (new):
  9 cases covering AC-249-U1..U9.
- `src/components/rdb/DataGrid.undo.test.tsx` (new): 5 cases covering
  AC-249-K1..K5, sharing the existing `dataGridTestHelpers`
  fixture/mocks.
- `src/components/datagrid/DataGridToolbar.test.tsx`: new
  `Sprint 249 Undo button` describe block (AC-249-T1..T3 + a
  "missing onUndo prop hides the button" guard); `renderToolbar`
  signature widened to `Partial<DataGridToolbarProps>` so test
  cases can pass `onUndo` / `canUndo`.
- `src/components/shared/QuickLookPanel.test.tsx`: `makeEditState`
  factory gains `undo: vi.fn()` + `canUndo: false` defaults so the
  type contract for the new `DataGridEditState` fields is satisfied.

## Assumptions

- Cmd+S (commit) Cmd+S handler in the hook's `commit-changes`
  listener is intentionally NOT snapshotted — that's a commit-path
  operation, not a discrete user mutation, and `clearAllPending`
  clears the stack on success anyway.
- Toolbar Undo button is gated by `onUndo` presence — DocumentDataGrid
  doesn't yet wire pending undo (per contract: "Mongo grid editing
  is read-only / out of scope"), so without an `onUndo` prop the
  button stays hidden there. The DataGrid path always passes the
  prop, so RDB users get the button.
- The DataGrid `keydown` listener is attached to `window` (not
  `document`) to match the existing Cmd+F / Cmd+L pattern's
  modifier semantics. Other DataGrid components (DocumentDataGrid)
  do not currently have an equivalent listener — that's the same
  scoping the contract specifies (RDB-only).
- The 50-entry cap (`UNDO_STACK_MAX`) is a memory ceiling, not a UX
  constraint. Typical sessions push ≤10-20 mutations before commit
  / discard; the cap exists to bound `pendingNewRows` deep-clone
  growth in pathological "edit 1000 cells without committing"
  scenarios. TablePlus / DBeaver use ~100 entries — Sprint 249 is
  intentionally more conservative.

## Residual Risk

- **Raw query grid (`useRawQueryGridEdit` /
  `EditableQueryResultGrid`) NOT covered.** Out of scope per
  contract. Phase 6 candidate when raw DML editing scope is
  reopened.
- **DDL editor (CreateTable / DropTable / AddColumn / etc.) NOT
  covered.** Form state pattern differs; Phase 5 is grid-only.
- **No redo (Cmd+Shift+Z).** Out of scope. The `!e.shiftKey` guard
  reserves the slot so a future redo sprint can wire it without a
  modifier collision.
- **Commit-path Cmd+S not snapshotted.** Intentional — see
  Assumptions. If a commit fails the user keeps the pre-commit
  pending state via the existing commit-error handling, not via
  undo.
- **`UNDO_STACK_MAX = 50` cap.** Below industry norms (~100); if
  user feedback says they hit the ceiling, raising it requires no
  contract change — it's an exported constant. Memory cost per
  snapshot grows with `pendingNewRows.length × column count`; with
  50 caps and typical 10-column tables that's a few KB worst-case.
- **Snapshot deep-clone uses one-level row spread.** Object cells
  inside a row (e.g. JSON columns) share references between the
  snapshot and live state. If the row contents are mutated in place
  later (which Sprint 249 code does NOT do — all sets go through
  `setPendingNewRows([...prev, ...])`) the snapshot would alias.
  Today's hook always replaces rows wholesale, so this risk is
  theoretical.

## Next Sprint Candidates

- Phase 6 (Sprint 250 candidate): redo (Cmd+Shift+Z) on the same
  pending boundary.
- Raw query grid pending undo for `useRawQueryGridEdit`.
- DDL editor undo (CreateTable wizard form state, AddColumn /
  DropColumn dialogs).
- Telemetry: count `undo()` invocations to validate the 50-entry
  cap is unused in real workflows before considering raising it.
