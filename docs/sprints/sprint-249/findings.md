# Sprint 249 Evaluation Findings

ADR 0022 Phase 5 — DataGrid pending-edit `Cmd+Z` / `Ctrl+Z` undo.
Verification profile: `command`. Date: 2026-05-09.

## Verification Plan Outcomes (7 required checks)

| # | Check | Outcome |
|---|-------|---------|
| 1 | `pnpm tsc --noEmit` | **pass** — 0 errors (no stdout). |
| 2 | `pnpm lint` (`eslint .`) | **pass** — 0 errors / 0 warnings (no stdout). |
| 3 | `pnpm vitest run` | **pass** — `Test Files 231 passed (231) / Tests 2980 passed (2980)` — duration 41.15s. |
| 4 | `cargo test --lib --manifest-path src-tauri/Cargo.toml` | **pass** — `627 passed; 0 failed; 2 ignored`. |
| 5 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **pass** — `Finished dev profile`, no diagnostics. |
| 6 | `rg "metaKey.*z\|ctrlKey.*z\|key === \"z\"" src/components/rdb/DataGrid.tsx` | **pass** — ≥ 1 match (`!((e.metaKey \|\| e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey)`). |
| 7 | `rg "canUndo\|undoStack" src/components/datagrid/useDataGridEdit.ts` | **pass** — 6 hits (state decl + derived + comments + return key + interface). |

All 7 required checks pass.

## Spot-check (per evaluator brief)

### a) Hook body — `src/components/datagrid/useDataGridEdit.ts`

- `undoStack` state: line 404, `useState<EditSnapshot[]>([])`. **OK**.
- `pushSnapshot` helper: lines 456-470, deep-copy of all three slices —
  `new Map(pendingEdits)`, `pendingNewRows.map((row) => [...row])`,
  `new Set(pendingDeletedRowKeys)`. **Snapshot is deep at the row-array
  level**: rows are spread (`[...row]`), so a later `pendingNewRows` push
  doesn't alias. (*Caveat*: if a row contains an inner object like a JSON
  cell, that inner object is still aliased — but the codebase's mutation
  paths always replace rows wholesale, so this is theoretical only and
  the handoff acknowledges it.) **OK**.
- 50-entry cap: lines 466-468, `if (next.length > UNDO_STACK_MAX) next.shift();`
  with `UNDO_STACK_MAX = 50` (line 256). **OK**.
- `clearAllPending` clears the stack: lines 437-441
  (`setUndoStack([])` inside the `useCallback`). Comment cites Sprint 249
  rationale. **OK**.
- 5 mutating handlers push (only AFTER guards):
  - `saveCurrentEdit` (lines 539-543): computes resolved next map,
    pushes only if `next !== pendingEdits` (no-op skip). **OK**.
  - `handleStartEdit` auto-save (lines 594-603): same `next !== pendingEdits`
    condition. **OK**.
  - `handleAddRow` (lines 624-627): `if (!data) return;` guard, then
    `pushSnapshot()` before `setPendingNewRows`. **OK**.
  - `handleDeleteRow` (lines 634-638): `if (selectedRowIds.size === 0) return;`
    guard, then `pushSnapshot()`. **OK**.
  - `handleDuplicateRow` (lines 652-655): combined `!data ||
    selectedRowIds.size === 0` guard, then `pushSnapshot()`. **OK**.
- `setEditNull` does NOT push (lines 579-582 — only flips `editValue`
  state, which is intentional per contract). **OK**.
- Returned shape: `undo` and `canUndo` exposed at lines 784-785; interface
  declares them at lines 360, 362. **OK**.

### b) Keyboard handler — `src/components/rdb/DataGrid.tsx`

- Window keydown listener registered in `useEffect` (lines 285-309).
  Cleanup via `removeEventListener` on unmount. **OK**.
- Modifier check: `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z"
  && !e.shiftKey` (line 288). The `toLowerCase()` is a nice touch — it
  also catches the `key === "Z"` case when Shift+Caps changes the
  reported key, but the `!e.shiftKey` gate still rejects redo
  semantics, so this is correct. **OK**.
- INPUT / TEXTAREA / contenteditable skip: lines 292-302 — early return
  before any state read. Uses `target.isContentEditable` (the standard
  HTMLElement property) and `tagName` check. **OK**.
- `canUndo` gate before `e.preventDefault()` + `editState.undo()`
  (lines 303-305). **OK**.

### c) Toolbar button — `src/components/datagrid/DataGridToolbar.tsx`

- `onUndo?` and `canUndo?` props declared at lines 97-98 (typed as
  optional with default `canUndo = false`). **OK**.
- Undo button rendered only when `onUndo` is provided (lines 199-214) —
  `disabled={!canUndo}`, `aria-label="Undo last pending change"`,
  `title="Undo (Cmd+Z) — pending changes only"`. Uses `Undo2` icon
  imported at line 14. **OK**.
- The `onUndo &&` gate is intentional: prevents the document-grid path
  from getting a non-functional button when the document hook hasn't
  yet wired pending-undo. **OK**.

### d) Wire-up — `src/components/rdb/DataGrid.tsx`

- Lines 443-444: `onUndo={editState.undo}` + `canUndo={editState.canUndo}`
  passed to `<DataGridToolbar>`. **AC-249-W1 OK**.
- Hook returns `undo` / `canUndo` (lines 784-785) → DataGrid consumes
  via `editState.undo` / `editState.canUndo`. **AC-249-W2 OK**.

### e) Out-of-scope honored

- Raw query grid (`useRawQueryGridEdit`) — **unchanged**
  (`git diff --stat HEAD -- src` shows only the 5 in-scope files).
- DDL editor — **unchanged**.
- `decideSafeModeAction`, `SafeModeStore`, dry-run IPC, dialog body —
  **unchanged** (only DataGrid.tsx imports remain identical; the
  comment at line 259 referencing `decideSafeModeAction` is read-only).
- `handleExecuteCommit` / commit-path — **unchanged** in
  `useDataGridPreviewCommit`. The hook only adds a side-effect via
  `clearAllPending` clearing `undoStack`, which the contract
  authorised.
- Redo (Cmd+Shift+Z) — **not implemented**. The `!e.shiftKey` guard
  reserves the slot. **OK per scope**.

### f) AC mapping (17 tests + 1 guard)

| AC | Test | File:line |
|----|------|-----------|
| AC-249-U1 | empty-stack undo no-op | `src/components/datagrid/useDataGridEdit.undo.test.ts:98-113` |
| AC-249-U2 | handleAddRow → undo | `useDataGridEdit.undo.test.ts:115-130` |
| AC-249-U3 | handleDeleteRow → undo | `useDataGridEdit.undo.test.ts:132-153` |
| AC-249-U4 | handleDuplicateRow → undo | `useDataGridEdit.undo.test.ts:155-172` |
| AC-249-U5 | saveCurrentEdit (changed) → undo | `useDataGridEdit.undo.test.ts:174-196` |
| AC-249-U6 | saveCurrentEdit (no-op) skip | `useDataGridEdit.undo.test.ts:198-211` |
| AC-249-U7 | clearAllPending empties stack | `useDataGridEdit.undo.test.ts:213-232` (via `handleDiscard`) |
| AC-249-U8 | >50 pushes drop oldest | `useDataGridEdit.undo.test.ts:234-266` |
| AC-249-U9 | LIFO restore | `useDataGridEdit.undo.test.ts:268-293` |
| AC-249-K1 | Cmd+Z (metaKey) | `src/components/rdb/DataGrid.undo.test.tsx:105-121` |
| AC-249-K2 | Ctrl+Z (ctrlKey) | `DataGrid.undo.test.tsx:123-137` |
| AC-249-K3 | Cmd+Shift+Z guard | `DataGrid.undo.test.tsx:139-159` |
| AC-249-K4 | INPUT focus skip | `DataGrid.undo.test.tsx:161-188` |
| AC-249-K5 | post-commit canUndo=false | `DataGrid.undo.test.tsx:190-225` |
| AC-249-T1 | canUndo=true → enabled | `src/components/datagrid/DataGridToolbar.test.tsx:155-163` |
| AC-249-T2 | canUndo=false → disabled | `DataGridToolbar.test.tsx:165-172` |
| AC-249-T3 | click → onUndo called | `DataGridToolbar.test.tsx:174-184` |
| (guard) | no `onUndo` prop → no button | `DataGridToolbar.test.tsx:186-195` |

## Skeptical Checks

The evaluator brief asked for these specific failure modes — each one
I personally tried to trip:

- **Snapshot deep-copy missing**: snapshot uses `new Map(pendingEdits)`,
  `pendingNewRows.map((row) => [...row])`, `new Set(pendingDeletedRowKeys)` —
  all three slices are cloned at the container level, and rows
  individually spread. The ONLY remaining alias is row-cell objects
  (e.g. JSON columns); the handoff residual-risk note acknowledges
  this and the live code never mutates rows in place (`setPendingNewRows
  ([...prev, ...])`). **PASS but worth flagging as a residual risk
  for future Phase 6 raw-query-grid sprint where in-place row mutation
  may exist.**
- **`clearAllPending` not clearing stack**: line 441 `setUndoStack([])`
  is present and `[AC-249-U7]` covers commit/discard scenarios.
- **INPUT-focused Cmd+Z hijacks native undo**: lines 292-302 explicitly
  bail out before `editState.undo()`. `[AC-249-K4]` covers this with
  a real `<input>` focus.
- **Cmd+Shift+Z fires our undo too**: `!e.shiftKey` guard at line 288.
  `[AC-249-K3]` covers.
- **50-entry cap missing → memory leak**: `UNDO_STACK_MAX = 50` at
  line 256, enforced at lines 466-468. `[AC-249-U8]` covers FIFO drop.
- **No-op edit pollutes stack**: both `saveCurrentEdit` (lines
  539-543) and `handleStartEdit` auto-save (lines 594-603) compute
  `next` first and push only when `next !== pendingEdits`. `[AC-249-U6]`
  covers.
- **Phase 4 invariant regression**: vitest passes 2980 tests including
  `useDataGridEdit.safe-mode.test.ts` (which references the AC-247 /
  AC-248 dry-run path). cargo test 627 passes — Rust untouched.

## Verdict — Quality Notes

- The handoff Generator self-report says "5 mutating handler" not 6 —
  the contract listed 6 but flagged `setEditNull` as the one that
  shouldn't snapshot (no pending state mutation). The handoff matches
  the contract intent. **Resolved: not a discrepancy.**
- One typo in the handoff: line 217 "Cmd+S (commit) Cmd+S handler" —
  cosmetic only, no impact on code.
- Test file naming uses `.undo.test` axis suffix matching the existing
  `.editing.test`, `.safe-mode.test` pattern — clean alignment.

## Sprint 249 Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | **9/10** | All 9 hook ACs + 5 keyboard ACs + 3 toolbar ACs pass. Snapshot deep-copy is correct at the documented invariant level. INPUT skip works for both `<input>` and `[contenteditable]`. The `key.toLowerCase()` check is a small but considerate detail. |
| Completeness | **9/10** | 17/17 contract ACs mapped to test:line. Wire-up (W1, W2) verified. Out-of-scope hooks untouched per `git diff --stat`. The `onUndo &&` guard in the toolbar correctly preserves the document-grid path. |
| Reliability | **8/10** | 50-entry cap + no-op skip + INPUT-focus deferral + clear-on-commit / discard all in place. The lone residual risk is the row-internal object alias case, which is theoretical for the current code path (no in-place row mutation) and explicitly documented in the handoff. |
| Verification Quality | **9/10** | All 7 required checks reproduce locally; 2980 vitest cases incl. the 17 new ones pass; cargo test + clippy clean; both `rg` greps land. Evidence packet has direct file:line citations for every AC. |
| **Overall** | **8.75/10** | Solid contract-fidelity work. Single small ding for the row-cell-alias caveat (acknowledged as residual risk — not fixed but bounded). |

## Verdict: PASS

Each dimension ≥ 7/10 and overall ≥ 7.0/10 (PASS_THRESHOLD met).

## Sprint Contract Status (Done Criteria)

- [x] **DC1** `useDataGridEdit` adds `undoStack` + `pushSnapshot` + `undo`
  + `canUndo`, 50-entry cap, no-op edit skip, `clearAllPending` empties
  stack — verified at `useDataGridEdit.ts:404, 456-470, 472-484, 486,
  437-441, 256`.
- [x] **DC2** 5 mutating handlers integrated with snapshot push
  (saveCurrentEdit, handleStartEdit auto-save, handleAddRow,
  handleDeleteRow, handleDuplicateRow); `setEditNull` correctly
  excluded — verified at `useDataGridEdit.ts:539-543, 594-603,
  624-627, 634-638, 652-655, 579-582`.
- [x] **DC3** `DataGrid.tsx` window keydown listener with modifier
  check + INPUT/textarea/contenteditable skip + `e.preventDefault()`
  + `editState.undo()` — verified at `DataGrid.tsx:285-309`.
- [x] **DC4** `DataGridToolbar.tsx` Undo button gated by `canUndo`,
  with `aria-label` + `title` containing `Cmd+Z` — verified at
  `DataGridToolbar.tsx:199-214`.
- [x] **DC5** AC-249-U1..U9 / K1..K5 / T1..T3 / W1..W2 mapped — see
  AC mapping table above.
- [x] **DC6** All 7 verification checks pass — see Outcomes table.

## Feedback for Generator

1. **Code Quality (minor)**: handoff body line 217 contains
   "Cmd+S (commit) Cmd+S handler" — appears to be a typo.
   - Current: "Cmd+S (commit) Cmd+S handler in the hook's
     `commit-changes`…"
   - Expected: "Cmd+S (commit) handler in the hook's
     `commit-changes`…"
   - Suggestion: tidy the residual-risk text in the handoff. No code
     change needed.

2. **Robustness (residual risk follow-up)**: snapshot row-cell objects
   (e.g. JSON columns) are aliased — the handoff acknowledges this
   correctly but a defensive `structuredClone(row)` in `pushSnapshot`
   would close the door for any future code path that mutates rows
   in place (raw query grid Phase 6 candidate).
   - Current: `pendingNewRows.map((row) => [...row])` — one-level spread.
   - Expected: deep clone of each row (e.g. `structuredClone(row)`)
     when row cells may be objects.
   - Suggestion: optional Phase 6 hardening; not a blocker for Sprint
     249. Consider adding a regression test that asserts the snapshot
     does NOT alias when rows contain JSON-shaped objects, so any
     future `useRawQueryGridEdit` adoption inherits the guarantee.

3. **Testing Coverage (nit)**: AC-249-K3 fires `key: "z"` with both
   `metaKey` and `shiftKey`. It does NOT also exercise the
   `Ctrl+Shift+Z` Windows redo combination.
   - Current: only Cmd+Shift+Z is tested (macOS).
   - Expected: testing parity with Ctrl+Shift+Z would mirror the
     K1↔K2 split.
   - Suggestion: add a one-liner Windows-redo guard test
     (`{ key: "z", ctrlKey: true, shiftKey: true }`) — single
     assertion (`pendingNewRows.length` unchanged) so coverage
     is symmetric. Not a blocker.

4. **Discoverability (nit)**: the toolbar button title says
   "Undo (Cmd+Z) — pending changes only" — Windows / Linux users
   won't recognise `Cmd`. Consider platform-aware copy
   (`Ctrl+Z` on non-mac).
   - Current: hard-coded `Cmd+Z` literal.
   - Expected: detect platform via `navigator.platform` /
     `navigator.userAgentData` and swap label.
   - Suggestion: optional polish — TablePlus uses `⌘Z` literally
     and DBeaver shows `Ctrl+Z` regardless of OS. Either is
     defensible; document the choice and move on.
