# Sprint 106 Handoff — DataGrid `role="grid"` + cell ARIA (#A11Y-3)

## Verdict: PASS

All Acceptance Criteria are satisfied with concrete evidence; verification commands pass; the diff is surgical (ARIA-only additions with zero behavior, styling, or handler changes).

## Sprint 106 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| AC Coverage | 9/10 | All 7 ACs have direct test evidence in `DataGridTable.aria-grid.test.tsx`. AC-01: `expect(grid).toHaveAttribute("aria-rowcount","4")`. AC-02 (rowindex=1 + colindex 1..N): test #2 + test #3. AC-03 (body rowindex=2..N+1): test #3 (`aria-rowindex` 2,3,4 across 3 data rows). AC-04: test #4 (3 gridcells with colindex 1,2,3 + matching text). AC-05 (visual reorder): test #5 (`columnOrder=[1,0,2]` → `aria-colindex=1` is "name"/"Alice", colindex=2 is "id"/"1"). AC-06 (pending rows): test #6 (rowcount=5, pending tr `aria-rowindex=5`, 3 pending gridcells). AC-07 (zero regression): full suite 1782/1782 passes. -1 for test #6 only validating one pending row — multi-pending-row indexing (e.g. newIdx=1 → rowindex=6) is not directly asserted, though the formula is symmetric. |
| Verification Quality | 9/10 | All three required commands run clean: `pnpm vitest run` → 103 files / 1782 tests pass, `pnpm tsc --noEmit` → 0 errors, `pnpm lint` → 0 errors. Findings explicitly maps each AC to a numbered test. The `cell` → `gridcell` migration in `DataGrid.test.tsx` is a smoking-gun proof the role token is actually emitted by the DOM (the existing tests would have failed otherwise). |
| Code Quality | 9/10 | Diff is minimal (only `role`/`aria-*` attribute additions, no logic touched). Formula `aria-rowindex={rowIdx + 2}` correctly accounts for the header at index 1. `aria-colindex={visualIdx + 1}` correctly tracks visual position (per ARIA spec `aria-colindex` is the visual column number). Empty-state row deliberately omits `aria-rowindex` because it has no underlying data row — this matches contract guidance and is documented in findings. `aria-rowcount={1 + data.rows.length + pendingNewRows.length}` correctly excludes the empty-state placeholder (which only renders when both counts are 0). No TypeScript `any`, no console statements, no TODO. |
| Regression Risk | 9/10 | The `getAllByRole("cell")` → `getAllByRole("gridcell")` migration in `DataGrid.test.tsx` (21 sites, lines 236–1546) is a clean find-and-replace; no assertion logic was touched. `StructurePanel.test.tsx` (which renders a different component whose `<td>`s are unchanged) correctly retains the `cell` role and continues to pass. 1782 tests pass with no failures. -1 for the latent risk that any future external test or e2e check that queries `role="cell"` against this grid will silently miss — but this is inherent to the ARIA upgrade, not a flaw of the implementation. |
| Documentation | 9/10 | `findings.md` is exemplary: states what changed line-by-line, maps ACs to specific test numbers, documents the empty-state `aria-rowindex` omission with rationale, explains the `cell`→`gridcell` migration choice, and explicitly lists assumptions (visual order = source of truth for `aria-colindex`; `aria-rowcount` excludes empty-state placeholder). Residual Risk section correctly references out-of-scope deferrals (keyboard nav, `aria-selected`, `aria-sort`). |
| **Overall** | **9/10** | |

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** `<table>` has `role="grid"` — DataGridTable.tsx:495 emits `role="grid"`; test #1 asserts `screen.getByRole("grid")` resolves and checks `aria-rowcount=4`, `aria-colcount=3`.
- [x] **AC-02** Header `<tr>` has `role="row"` + `aria-rowindex="1"`; all `<th>` have `role="columnheader"` + `aria-colindex=1..N` — DataGridTable.tsx:500, 508-509; tests #2 and #3.
- [x] **AC-03** Body `<tr>` (rowIdx 0..N-1) has `role="row"` + `aria-rowindex=2..N+1` — DataGridTable.tsx:583-584 (`aria-rowindex={rowIdx + 2}`); test #3 verifies indices 2, 3, 4 for 3 data rows.
- [x] **AC-04** Body `<td>` has `role="gridcell"` + `aria-colindex=1..M` — DataGridTable.tsx:620-621; test #4 verifies cell roles, indices, and content text.
- [x] **AC-05** Column reorder → `aria-colindex` follows visual order — DataGridTable.tsx uses `visualIdx + 1` (not `dIdx + 1`); test #5 with `columnOrder=[1,0,2]` confirms colindex=1 maps to "name"/"Alice".
- [x] **AC-06** pendingNewRows `<tr>` has `role="row"` + correct `aria-rowindex`; their `<td>` get `role="gridcell"` + `aria-colindex` — DataGridTable.tsx:894-895, 904-905; test #6 (`aria-rowindex=5` for dataRows=3 + newIdx=0 + 2).
- [x] **AC-07** Zero regressions — 1782/1782 tests pass; tsc clean; lint clean. The `cell`→`gridcell` migration in DataGrid.test.tsx prevented the 24 pre-existing tests from regressing.

## Verification Evidence

| Check | Result |
|-------|--------|
| `pnpm vitest run` | 103 files / 1782 tests pass (was 1775; +7 new sprint-106 tests) |
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors |
| Visual / behavioral diff | None — only ARIA attribute additions on existing elements |

## Files Modified

- `/Users/felix/Desktop/study/view-table/src/components/datagrid/DataGridTable.tsx` — 7 ARIA attribute add-sites (table, thead tr, th, body tr, body td, empty-state tr+td, pending tr+td).
- `/Users/felix/Desktop/study/view-table/src/components/datagrid/DataGridTable.aria-grid.test.tsx` — new file, 7 tests covering all ACs.
- `/Users/felix/Desktop/study/view-table/src/components/DataGrid.test.tsx` — `getAllByRole("cell")` → `getAllByRole("gridcell")` at 21 sites (regression fix; no assertion logic changed).

## Out-of-Scope Items (deferred per contract)

- Keyboard cell navigation (Tab/Arrow grid navigation).
- `aria-selected` on rows.
- Header `aria-sort`.

## Minor Suggestions (non-blocking)

1. **Multi-pending-row coverage gap**: test #6 only exercises a single pending row. Consider adding an assertion that a second pending row gets `aria-rowindex=6` to lock in the `data.rows.length + newIdx + 2` formula across newIdx>0. Not a blocker — the formula is obviously correct by inspection.
2. **`aria-rowindex` on empty-state row**: contract explicitly says omit it, and findings document the rationale, but for screen readers some users prefer `aria-rowindex=2` even on a placeholder cell so the position is announced. Worth revisiting in a follow-up A11Y sprint if user research surfaces a need.
3. **`aria-rowcount` semantics with virtualization**: when sprint-? eventually introduces row virtualization, `aria-rowcount` should reflect the *full* dataset count (not just rendered rows). Today the value (`1 + data.rows.length + pendingNewRows.length`) is correct because the table always renders all paginated rows. Worth a comment near line 496 anchoring the assumption.

These are forward-looking suggestions; they do not affect this sprint's PASS verdict.

## Status: ready for merge

Sprint 106 closed out. Next sprint can pick from `docs/sprints/sprint-106/spec.md` follow-ups or move to the next #A11Y- ticket.
