# Sprint Execution Brief: sprint-99

## Objective
DataGrid 빈 상태 분기 — "0 rows match current filter" + Clear filter 버튼 vs "Table is empty".

## In Scope
- `src/components/datagrid/DataGridTable.tsx` — 빈 상태 분기 + Clear filter 버튼.
- `src/components/DataGrid.tsx` — `activeFilterCount` + `onClearFilters` 전달.
- 테스트: `DataGrid.test.tsx`, `DataGridTable.context-menu.test.tsx` 의 "No data" 단언 갱신 + 신규 케이스.

## Out of Scope
- DocumentDataGrid, QueryResultGrid, EditableQueryResultGrid 빈 상태.
- FilterBar Clear All.
- sprint-88~98 산출물.

## Done Criteria
1. 필터 있음 + 0행 → "0 rows match current filter" + Clear filter 버튼.
2. 필터 없음 + 0행 → "Table is empty".
3. Clear filter 클릭 → filters/appliedFilters/rawSql/appliedRawSql 모두 클리어 → 재로드.
4. 회귀 0.

## Verification
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Hint
- 기존 빈 상태 UI: `DataGridTable.tsx:834-843`.
- DataGrid 의 `activeFilterCount` 계산: `DataGrid.tsx:313-315` (`appliedRawSql.trim().length > 0 ? 1 : appliedFilters.length`). 이 값을 그대로 prop 으로 전달.
- Clear filter 의미: `setFilters([])` + `setAppliedFilters([])` + `setRawSql("")` + `setAppliedRawSql("")`. 둘 중 한 쪽 (raw vs structured) 만 클리어하면 unfiltered 상태로 전환되지 않음.
- 기존 "No data" 단언 갱신: `DataGrid.test.tsx:661`, `DataGridTable.context-menu.test.tsx:321,324`.

## Untouched
- `memory/`, `CLAUDE.md`, sprint-88~98 산출물.
