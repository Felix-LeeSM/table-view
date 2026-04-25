# Sprint 99 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | Branch logic precisely matches contract: `DataGridTable.tsx:858` checks `activeFilterCount > 0` and renders the filtered branch (lines 863-873) with the message "0 rows match current filter" + Clear filter `Button`; otherwise the literal `"Table is empty"` (line 875). Default value `activeFilterCount = 0` at line 158 makes the prop optional and defaults to the unfiltered branch — older test usages keep working. The condition is also correctly nested inside `data.rows.length === 0 && pendingNewRows.length === 0` (line 852), so the empty-state cell only appears when there are truly no rows to render. |
| **Completeness** | 9/10 | All four ACs satisfied with line-cited evidence. `DataGrid.tsx:317-323` defines `handleClearAllFiltersFromEmptyState` clearing all four state slots (`setFilters([])`, `setAppliedFilters([])`, `setRawSql("")`, `setAppliedRawSql("")`) plus `setPage(1)`. Both new props are wired through at `DataGrid.tsx:422-423`. The context-menu test was updated (`DataGridTable.context-menu.test.tsx:320-325`). Out-of-scope grids (`QueryResultGrid.tsx:107`, `EditableQueryResultGrid.tsx:390`) and their tests (`QueryResultGrid.test.tsx:222`) intentionally retain "No data" — correct per contract. `git diff --stat HEAD` confirms changes are limited to the 4 in-scope files. |
| **Reliability** | 9/10 | Clear filter handler (`DataGrid.tsx:317-323`) clears ALL FOUR slots; the test (`DataGrid.test.tsx:670-720`) explicitly asserts call-count delta after click and that positional args 6 (`filters`) and 7 (`rawSql`) are both `undefined` — meaning the re-fetch fires with the unfiltered shape (the 8-arg `queryTableData(...)` signature confirmed at `DataGrid.tsx:169-178`). The fetch effect already retriggers when `appliedFilters`/`appliedRawSql` change, and the rendered "3 rows" toolbar text (line 719) confirms the unfiltered fetch resolved. Wrapped in `useCallback([])` so the prop identity is stable across renders. Minor nit (-1): the handler also calls `setPage(1)` (line 322) — useful but undocumented in the contract; harmless because tests don't fail. |
| **Verification Quality** | 9/10 | Tests directly assert each AC with both positive and negative single-branch claims. Test #21 (`DataGrid.test.tsx:653-666`) asserts `Table is empty` is present AND that neither the filtered text nor the Clear filter button exists. Test #21a (`DataGrid.test.tsx:670-720`) asserts the filtered message + button accessible name "Clear filters", verifies the call-count delta, asserts both positional `undefined`s after click, and waits for the unfiltered "3 rows" to re-render. Context-menu test (`DataGridTable.context-menu.test.tsx:322,325`) updated to the new copy. Full suite 1735/1735, +1 new test (baseline 1734), tsc/lint clean. |
| **Overall** | **9/10** | |

## Verdict: PASS (attempt 1)

All four dimensions are ≥ 7/10 (each scored 9/10). All checks pass.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** — filtered empty branch shows "0 rows match current filter" + Clear filter button.
  Evidence: `src/components/datagrid/DataGridTable.tsx:858-873` (branch + Button with `aria-label="Clear filters"` at line 868). Asserted by `src/components/DataGrid.test.tsx:687-691` (`findByText("0 rows match current filter")` + `getByRole("button", { name: "Clear filters" })`).

- [x] **AC-02** — unfiltered empty branch shows "Table is empty", no Clear filter button.
  Evidence: `DataGridTable.tsx:874-875` (else-branch literal text). Asserted by `DataGrid.test.tsx:663-665` (positive `getByText("Table is empty")` + dual negative `queryByText("0 rows match current filter")` and `queryByRole("button", { name: "Clear filters" })`). Mirrored by `DataGridTable.context-menu.test.tsx:322`.

- [x] **AC-03** — Clear filter click clears all four slots and triggers refetch.
  Evidence: `DataGrid.tsx:317-323` (`handleClearAllFiltersFromEmptyState` calls `setFilters([])`, `setAppliedFilters([])`, `setRawSql("")`, `setAppliedRawSql("")`). Wired at `DataGrid.tsx:423`. Asserted by `DataGrid.test.tsx:701-716`: click triggers `mockQueryTableData.mock.calls.length > callsBefore`, last call's positional args `[6]` (filters) and `[7]` (rawSql) are both `undefined`. Re-render assertion at line 719 (`findByText("3 rows")`) confirms the unfiltered dataset rendered.

- [x] **AC-04** — existing empty-state test extended to cover both branches; no regressions.
  Evidence: `DataGrid.test.tsx:653-666` (#21 rewritten) + `:670-720` (#21a new). `DataGridTable.context-menu.test.tsx:322,325` updated. Full suite 1735/1735, baseline 1734 → +1 new test.

## Special Checks

- [x] **Out-of-scope grids untouched.** `git diff --stat HEAD` shows only `src/components/DataGrid.test.tsx`, `src/components/DataGrid.tsx`, `src/components/datagrid/DataGridTable.context-menu.test.tsx`, and `src/components/datagrid/DataGridTable.tsx` modified. `QueryResultGrid.tsx:107`, `EditableQueryResultGrid.tsx:390`, `DocumentDataGrid` not in diff. FilterBar untouched.
- [x] **`aria-label="Clear filters"` present** on the Clear filter button at `DataGridTable.tsx:868`. Visible label is "Clear filter" (singular) but the accessible name resolves to the `aria-label` "Clear filters" — matches the contract literally.
- [x] **`activeFilterCount` prop is optional with default 0.** Declared `activeFilterCount?: number` at `DataGridTable.tsx:110`, destructured with `activeFilterCount = 0` at line 158. Existing context-menu test that calls `renderTable(...)` without passing the prop still works (verified by suite passing).
- [x] **Re-fetch is real, not a stale read.** Test #21a's `mockResolvedValueOnce(... rows: [] ...)` followed by `mockResolvedValue({ ...MOCK_DATA })` (lines 676-678) plus the `findByText("3 rows")` re-render assertion at line 719 prove the second fetch resolves with the unfiltered dataset.
- [x] **Verification commands all green.** `pnpm vitest run` → 1735/1735 (re-run by evaluator), `pnpm tsc --noEmit` → exit 0, `pnpm lint` → exit 0.

## Feedback for Generator

1. **Polish — undocumented `setPage(1)` in clear handler**.
   - Current: `DataGrid.tsx:322` resets the page index to 1 inside `handleClearAllFiltersFromEmptyState`. The contract didn't mention this.
   - Expected: contract literally says "`setFilters([])` + `setAppliedFilters([])` + `setRawSql("")` + `setAppliedRawSql("")`".
   - Suggestion: keep the call (it's the right UX — clearing filters from page N should reset paging) but mention it in the next findings note so the contract for similar clear flows can include it next time. No code change required for this sprint.

2. **Polish — visible label vs aria-label mismatch is intentional but worth a comment**.
   - Current: visible "Clear filter" (singular) vs `aria-label="Clear filters"` (plural). Generator notes this in findings.md but the source has no inline comment.
   - Expected: a one-line comment near `DataGridTable.tsx:865-872` explaining why the labels differ would help the next reader.
   - Suggestion: add `// aria-label is plural ("Clear filters") to match the underlying semantic — there can be many structured chips and/or a raw SQL filter; visible label stays singular to match the message copy.` Optional, not blocking.

3. **Polish — test uses positional indices 6/7 of `queryTableData` mock**.
   - Current: `DataGrid.test.tsx:714-716` reads `lastCall[6]` / `lastCall[7]`.
   - Expected: this is consistent with the file's existing style (other tests use `lastCall[3..5]`) but it couples the test to the call shape.
   - Suggestion: optionally introduce a `const FILTERS_ARG = 6; const RAW_SQL_ARG = 7;` near the top of the test so future contributors who change the call signature know what indices mean. Not blocking — the existing tests in this file already use positional indices.

## Handoff Evidence

- **Branch**: `main` (no new branch created)
- **Files changed** (4): `src/components/DataGrid.test.tsx`, `src/components/DataGrid.tsx`, `src/components/datagrid/DataGridTable.context-menu.test.tsx`, `src/components/datagrid/DataGridTable.tsx`
- **Diff summary**: `4 files changed, 117 insertions(+), 8 deletions(-)`
- **Verification commands**:
  - `pnpm vitest run` → 98 files / 1735 tests passed (baseline 1734 + 1 new = 1735)
  - `pnpm tsc --noEmit` → exit 0 (no output)
  - `pnpm lint` → exit 0 (no output)
- **AC line citations**:
  - AC-01: `DataGridTable.tsx:858-873`, asserted by `DataGrid.test.tsx:687-691`
  - AC-02: `DataGridTable.tsx:874-875`, asserted by `DataGrid.test.tsx:663-665` and `DataGridTable.context-menu.test.tsx:322`
  - AC-03: `DataGrid.tsx:317-323` + `:423`, asserted by `DataGrid.test.tsx:701-719`
  - AC-04: `DataGrid.test.tsx:653-720` + `DataGridTable.context-menu.test.tsx:320-325`
- **Out-of-scope confirmed untouched**: `QueryResultGrid.tsx`, `EditableQueryResultGrid.tsx`, `DocumentDataGrid.tsx`, `FilterBar.tsx`, `memory/`, `CLAUDE.md`, sprint-88~98 artifacts.
- **Residual risks**: none identified.

**Verdict: PASS on attempt 1. Ready to merge.**
