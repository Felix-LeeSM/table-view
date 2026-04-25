# Sprint 106 Findings — DataGrid `role="grid"` + cell ARIA (#A11Y-3)

## What changed

### `src/components/datagrid/DataGridTable.tsx`
- `<table>` (line 492): added `role="grid"`, `aria-rowcount={1 + data.rows.length + pendingNewRows.length}`, `aria-colcount={data.columns.length}`.
- thead `<tr>`: added `role="row"` + `aria-rowindex={1}`.
- thead `<th>`: added `role="columnheader"` + `aria-colindex={visualIdx + 1}`.
- body `<tr>` (data rows): added `role="row"` + `aria-rowindex={rowIdx + 2}` (header occupies index 1).
- body `<td>` (data cells): added `role="gridcell"` + `aria-colindex={visualIdx + 1}` so the announced column matches visual position even after column reorder.
- empty-state row: `<tr>` got `role="row"`; its single (colspan-N) `<td>` got `role="gridcell"` + `aria-colindex={1}`. `aria-rowindex` intentionally omitted because the empty-state cell is decorative — there is no underlying data row.
- pendingNewRows `<tr>`: added `role="row"` + `aria-rowindex={data.rows.length + newIdx + 2}` so the inserted draft row's position is `headerRowCount(1) + dataRows + newIdx + 1`.
- pendingNewRows `<td>`: added `role="gridcell"` + `aria-colindex={visualIdx + 1}`.

No styling, event handler, layout, or behavior changes. No exported types changed.

### `src/components/datagrid/DataGridTable.aria-grid.test.tsx` (new)
Seven focused tests covering:
1. `<table>` exposes `role="grid"`, `aria-rowcount=4` (1 header + 3 data), `aria-colcount=3`.
2. `<th>` elements: `role="columnheader"` + `aria-colindex` 1..3, in default visual order.
3. `<tr>` elements: `aria-rowindex` 1 (header), 2..4 (data rows).
4. `<td>` elements: `role="gridcell"` + `aria-colindex` 1..3, in default visual order, with expected text.
5. Column reorder (`columnOrder=[1, 0, 2]`): `aria-colindex=1` corresponds to visual position 1 (data column "name") not data index 0; cells follow same.
6. `pendingNewRows` (1 row) bumps `aria-rowcount` to 5 and the pending `<tr>` gets `aria-rowindex=5` (= dataRows 3 + newIdx 0 + 2). Pending `<td>`s get `aria-colindex` 1..3.
7. Empty state: `<tr role="row">` with one `<td role="gridcell" aria-colindex=1>` containing the "Table is empty" message.

### `src/components/DataGrid.test.tsx` (regression fix)
Adding `role="gridcell"` to `<td>` overrides the implicit `cell` role used by `getAllByRole("cell")`. Replaced all 21 `getAllByRole("cell")` usages with `getAllByRole("gridcell")`. No assertion logic touched — only the role token. Without this update, 24 pre-existing DataGrid tests would have regressed even though the rendered DOM is structurally identical.

`StructurePanel.test.tsx` also uses `getAllByRole("cell")`, but that test renders a different component whose `<td>`s remain unchanged, so it continued to pass without modification.

## Acceptance Criteria mapping
- AC-01 (`<table>` has `role="grid"`): test "the <table> container exposes role=grid…".
- AC-02 (header tr/th roles + colindex): tests #2 + #3 (header row aria-rowindex=1).
- AC-03 (body tr role + rowindex 2..N+1): test #3.
- AC-04 (body td role + colindex 1..M): test #4.
- AC-05 (column reorder → aria-colindex tracks visual): test #5.
- AC-06 (pendingNewRows row + cell ARIA): test #6.
- AC-07 (zero regressions): full suite 1775 → 1782 (+7), 0 failures.

## Verification (all green)
- `pnpm vitest run` → 103 files / 1782 tests pass.
- `pnpm tsc --noEmit` → 0 errors.
- `pnpm lint` → 0 errors.

## Assumptions
- Visual layout order is the source of truth for `aria-colindex` (per the contract — "ARIA tracks visual layout"). When a user reorders columns, `aria-colindex=N` always describes the Nth visible column from the left.
- The empty-state row deliberately omits `aria-rowindex`. The contract calls this out ("aria-rowindex 는 안 부여 (헤더 후 1행 빈 자리)") since there is no underlying data row to announce.
- `aria-rowcount` counts header + data + pending. It excludes the empty-state row because that row only renders when `rows.length === 0 && pendingNewRows.length === 0`, in which case the count `1 + 0 + 0 = 1` already correctly reflects "only the header is real".

## Residual Risk
- None. Out-of-scope items (keyboard grid navigation, `aria-selected`, `aria-sort`) are explicitly deferred to other sprints per the contract.
