# Sprint 250 Findings

Date: 2026-05-09
Evaluator: harness Evaluator agent
Verification Profile: `command`

## Sprint 250 Evaluation Scorecard

| Dimension | Weight | Score | Notes |
|-----------|--------|-------|-------|
| **Correctness** | 35% | 9/10 | onBlur path routes through `saveCurrentEdit` (DataRow.tsx:194 NULL chip, DataRow.tsx:267 typed input). Race/loop guard delegated to existing `if (!editingCell) return;` at `useDataGridEdit.ts:530` — minimal-diff and verified by AC-250-05 idempotency test (`useDataGridEdit.onblur.test.ts:196-227`). Esc keydown handler (`DataGrid.tsx:293-310`) correctly orders the three short-circuits: key-mismatch → editor-local guard → modal selector → preventDefault + discard. Modal selector uses the contract-prescribed verbatim string `'[role="dialog"], [role="alertdialog"]'` (DataGrid.tsx:301). Editor-local Esc precedence works because React's synthetic `e.stopPropagation()` does not stop native window listeners — so the explicit `editingCell !== null` guard is required and present. `useDataGridEdit.ts` diff = 0 lines. |
| **Completeness** | 25% | 9/10 | All six AC mapped to tests. AC-250-01 (commit + no-op): `useDataGridEdit.onblur.test.ts:96, 121`. AC-250-02 (body Esc + harmless no-op): `DataGrid.esc.test.tsx:111, 229`. AC-250-03 (modal bypass): `DataGrid.esc.test.tsx:151`. AC-250-04 (editor-local Esc + isolation): `DataGrid.esc.test.tsx:186` + `useDataGridEdit.onblur.test.ts:139, 162`. AC-250-05 (race guard): `useDataGridEdit.onblur.test.ts:196`. AC-250-06 (regression): full vitest suite green (2989/2989). One soft gap: no positive test that the popover/menu (`role="menu"`) edge case still discards — handoff acknowledges this as deferred residual risk per contract. |
| **Reliability** | 20% | 8/10 | `useDataGridEdit` returned 30+ field shape preserved (zero diff). Sprint 249 9 undo AC + Sprint 248 dry-run flow + Sprint 245 SafeMode matrix: 2989 tests pass with no regression. `clearAllPending` (line 432-445) zeroes `undoStack` — Sprint 249 already documented this as intentional fresh-slate behavior, so Esc → discard purging undo is the correct re-use. Mongo grid invariant preserved: `DocumentDataGrid.tsx` does not consume `DataRow.tsx` (separate grid component), so onBlur path is unreachable. `useRawQueryGridEdit.ts` is a separate hook and unchanged. Listener cleanup correct (`window.removeEventListener` in useEffect cleanup). Two minor reliability concerns retained as residual risk: (a) global `[role="dialog"]` selector may catch unrelated app modals from sibling routes, (b) popovers using `[role="menu"]` won't suppress grid discard. Both acknowledged in handoff and within contract scope. |
| **Verification Quality** | 20% | 9/10 | All 7 required checks executed and pass: tsc 0, lint 0/0, vitest 233/2989 green, cargo lib 627/0/2-ignored, clippy clean, `rg "onBlur"` 2 hits in `DataRow.tsx`, `rg "Escape"` 1 hit in `DataGrid.tsx`. Each AC mapped to test file:line. Code citations (onBlur handler body + Esc keydown handler body) included verbatim in handoff. TDD evidence stated as one line at top of handoff and elaborated in "TDD Evidence" section — claims "AC-250-02 was the intended red". Single-commit-uncommitted state means we cannot independently verify red-then-green ordering from git history (changes are still in working tree); we accept the generator's narrative because the test-file → source-file dependency direction is evident in the contract design. |
| **Overall** | 100% | **8.85/10** | Weighted: 0.35*9 + 0.25*9 + 0.20*8 + 0.20*9 = 8.8. |

## Verdict: PASS

All four dimensions ≥ 7. Overall 8.85 ≥ 7.0. PASS_THRESHOLD met.

## Sprint Contract Status (Done Criteria)

- [x] **DC1** cell input onBlur → saveCurrentEdit routing
  - Evidence: `DataRow.tsx:194` (NULL chip `onBlur={onSaveCurrentEdit}`), `DataRow.tsx:267` (typed `<input>` `onBlur={onSaveCurrentEdit}`). Verified by `useDataGridEdit.onblur.test.ts:96` (commit) and `:121` (no-op skip).
- [x] **DC2** window keydown Esc with editor-local + modal-aware skip
  - Evidence: `DataGrid.tsx:293-310` (new `useEffect`). Verified by `DataGrid.esc.test.tsx:111, 151, 186, 229`.
- [x] **DC3** AC-250-01..06 mapped to tests
  - All 6 AC mapped (see Completeness row above).
- [x] **DC4** /tdd flow recorded
  - Handoff first line: "Tests-first (TDD): 신규 테스트 작성 → red → 구현 → green." TDD Evidence section names AC-250-02 as the intended red.
- [x] **DC5** Verification Plan 7 checks all pass
  - Re-run by evaluator: tsc 0 errors / lint 0 errors 0 warnings / vitest 233 files 2989 tests / cargo test 627 passed / clippy clean / rg onBlur 2 hits / rg Escape 1 hit.

## Spot-Check Results

### a) onBlur wireup (`DataRow.tsx`)
- NULL chip onBlur → saveCurrentEdit: ✓ `DataRow.tsx:194`.
- Typed input onBlur → saveCurrentEdit: ✓ `DataRow.tsx:267`.
- Race / loop guard: ✓ delegated to `useDataGridEdit.ts:530` (`if (!editingCell) return;`). After first commit, `setEditingCell(null)` runs synchronously before the next blur fires; second blur is captured by the closure with the still-non-null `editingCell` value but the guard checks the live state because `saveCurrentEdit` reads `editingCell` from the hook closure that re-binds each render. AC-250-05 test confirms exactly one snapshot pushed.

### b) Esc keydown (`DataGrid.tsx`)
- Window keydown listener mount + cleanup: ✓ lines 308-309.
- Conditions: `e.key === "Escape"` (line 295) → editor-local guard (line 298) → modal selector (line 300) → preventDefault + handleDiscard (lines 305-306). Order is correct.
- Selector verbatim: ✓ `'[role="dialog"], [role="alertdialog"]'` matches contract specification.
- Editor-local Esc precedence: ✓ explicit `if (editingCell !== null) return;` short-circuit. Necessary because React's `e.stopPropagation()` in DataRow's onKeyDown does not stop native window listeners.

### c) Regression guards
- `useDataGridEdit.ts` returned 30+ fields preserved: ✓ `git diff` shows zero changes.
- Sprint 249 undo AC: ✓ `useDataGridEdit.undo.test.ts` (9 cases) + `DataGrid.undo.test.tsx` (5 cases) all green in full suite.
- Sprint 248 dry-run: ✓ no related test failure in 2989-test run.
- Mongo grid read-only invariant: ✓ `DocumentDataGrid.tsx` does not import `DataRow.tsx`; onBlur path unreachable from Mongo paradigm. `useDataGridEdit` paradigm dispatch unchanged.
- Tauri IPC / safeModeStore changes: ✓ zero (no Rust diff, no store diff).

### d) TDD flow
- Handoff first line + dedicated section assert tests-first. The two test files are net-new (untracked in git). Source diffs to `DataRow.tsx` and `DataGrid.tsx` are minimal and consistent with implementing-against-tests rather than test-after-code (no scaffolded assertions, no commented-out checks). We accept the narrative.

### e) Out-of-scope honored
- Sprint 251 store-lift not touched: ✓ `pendingEdits`/`pendingNewRows`/`pendingDeletedRowKeys`/`undoStack` still `useState` in `useDataGridEdit.ts:432-445`.
- Sprint 252 PreviewDialog polish not touched: ✓ no changes to any `PreviewDialog`/`SqlPreviewDialog`/`MqlPreviewModal` files.
- DDL editor / raw query grid: ✓ unchanged (`useRawQueryGridEdit.ts` not modified).
- `decideSafeModeAction` body: ✓ unchanged.

### f) Test mapping
- `useDataGridEdit.onblur.test.ts`: AC-250-01 (lines 96, 121), AC-250-04 (lines 139, 162), AC-250-05 (line 196). ✓
- `DataGrid.esc.test.tsx`: AC-250-02 (lines 111, 229), AC-250-03 (line 151), AC-250-04 (line 186). ✓
- AC-250-06: regression suite (existing 233 vitest files) — all pass. ✓

## Skeptical-Review Findings

These were the explicit risks called out by the evaluator brief; below is the verdict for each.

1. **onBlur fires later than next-cell click → race?**
   - Mitigated by the `if (!editingCell) return;` guard in `saveCurrentEdit`. The first blur commits and clears `editingCell`; the next click's `handleStartEdit` sees no active editor and proceeds to open a fresh editor. AC-250-05 test pins the contract.
   - The handoff also notes blur → click ordering is browser-standard and replicated in jsdom.

2. **Editor-local Esc could miss its guard → grid-wide discard fires inside an editor?**
   - The guard is verbatim present (`DataGrid.tsx:298`). Verified by AC-250-04 test (`DataGrid.esc.test.tsx:186`) which dispatches Esc inside an active editor and asserts the prior pending edit on a different row survives.

3. **Modal selector too narrow → popover/menu cases bypass?**
   - Confirmed limitation. `[role="dialog"], [role="alertdialog"]` does not catch `[role="menu"]` or popovers. This is documented in residual risk. Contract explicitly scoped to "DOM query 한 번이면 충분" and out-of-scope for narrower selectors. Acceptable for Sprint 250.

4. **Cmd+Z and Esc handler conflict / dependency miss?**
   - Two distinct `useEffect`s with disjoint key conditions (`Escape` vs `z`). Dependency arrays correct: `[editingCell, handleDiscard]` and `[canUndo, undoPending]`. No conflict.

5. **handleDiscard purging undoStack — Sprint 249 regression?**
   - `clearAllPending` already zeroes `undoStack` (line 441) — this was Sprint 249's intentional fresh-slate behavior on commit-success / explicit-discard. Esc reusing it is consistent. Sprint 249 undo test suite (`useDataGridEdit.undo.test.ts` + `DataGrid.undo.test.tsx`) passes unchanged.

6. **Mongo grid accidentally triggering onBlur path?**
   - `DocumentDataGrid.tsx` does not consume `DataRow.tsx`. Mongo grid renders documents through its own component tree. onBlur path unreachable. ✓

7. **TDD flow not actually followed?**
   - We have only the handoff narrative as evidence (single-uncommitted-tree state means no atomic commit-by-commit history yet). The two test files are net-new untracked files, source diffs are minimal — consistent with test-driven implementation. Accepting the narrative; recommend single-commit pattern at user's git step.

## Open Findings (Severity)

- **P3 (Nice-to-have)**: Add a regression test that confirms an open `[role="menu"]` popover does NOT suppress grid discard — clarifies the documented selector boundary so a future polish sprint can intentionally widen the selector with a failing-then-passing test.
- **P3 (Nice-to-have)**: Snapshot the `useDataGridEdit` return-type interface in a `*.types.test.ts` to make Sprint 251's store-lift contract violation impossible to land silently.

No P1 / P2 findings.

## Feedback for Generator

1. **Selector boundary documentation**
   - Current: residual risk paragraph mentions popover/menu Esc co-discard.
   - Expected: a single failing-or-skip-with-rationale test that pins the selector boundary so Sprint 251/252 doesn't accidentally regress.
   - Suggestion: add an additional `it("[AC-250-03 boundary] role=menu popover does not suppress discard")` test to `DataGrid.esc.test.tsx` — either (a) assert current behavior verbatim (popover open → grid still discards) or (b) skip with a TODO comment referencing a future ticket. The contract forbids `it.skip`, so (a) is preferred.

2. **TDD audit trail**
   - Current: tests-first stated only in handoff prose.
   - Expected: when the user finally commits, propose a single atomic commit so the test file dates and source file dates are anchored together, removing the need for narrative trust.
   - Suggestion: at commit time, group `useDataGridEdit.onblur.test.ts` + `DataGrid.esc.test.tsx` + `DataRow.tsx` + `DataGrid.tsx` into one commit body that mentions tests-first.

3. **Minor: AC label in test descriptions**
   - Current: tests prefix with `[AC-250-XX]` ✓ — good.
   - Expected: keep this convention in Sprint 251 / 252 (it's the cleanest test-to-AC mapping in the harness so far).
   - Suggestion: noted as a pattern to lift into the Generator boilerplate.

## Evidence Packet (for handoff)

### Re-run checks (evaluator)

| Check | Result |
| --- | --- |
| `pnpm tsc --noEmit` | EXIT=0 (0 errors) |
| `pnpm lint` | EXIT=0 (0 errors / 0 warnings) |
| `pnpm vitest run` | 233 files / 2989 tests, 0 failed, duration 48.54s |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | 627 passed, 0 failed, 2 ignored |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | clean (0 warnings) |
| `rg "onBlur" src/components/datagrid/DataGridTable.tsx src/components/datagrid/DataGridTable/` | 2 hits (DataRow.tsx) |
| `rg "Escape" src/components/rdb/DataGrid.tsx` | 1 hit (new keydown handler) |

### Files changed
- `src/components/datagrid/DataGridTable/DataRow.tsx` (modified, +13 lines comment + handler attachment).
- `src/components/rdb/DataGrid.tsx` (modified, +35 lines new useEffect).
- `src/components/datagrid/useDataGridEdit.onblur.test.ts` (new, 5 cases).
- `src/components/rdb/DataGrid.esc.test.tsx` (new, 4 cases).

### Files unchanged (invariant proof)
- `src/components/datagrid/useDataGridEdit.ts` — 0 diff (returned shape preserved).
- `src/components/document/DocumentDataGrid.tsx` — 0 diff (Mongo invariant).
- `src/components/query/useRawQueryGridEdit.ts` — 0 diff (raw query invariant).
- All Rust files — 0 diff (no IPC change).

## Done
