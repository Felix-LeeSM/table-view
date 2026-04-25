# Sprint Contract: sprint-99

## Summary
- Goal: DataGrid 빈 상태("No data") 단일 메시지를 "필터 결과 0행" vs "테이블 0행" 으로 분리. Clear filter affordance 제공.
- Profile: `command` (DOM assertion via Vitest + RTL)

## In Scope
- `src/components/datagrid/DataGridTable.tsx`:
  - 새 prop `activeFilterCount?: number` (default 0).
  - 새 prop `onClearFilters?: () => void` (활성 필터가 있을 때만 사용).
  - 빈 상태 분기:
    - `activeFilterCount > 0` → "0 rows match current filter" + Clear filter 버튼 (`aria-label="Clear filters"`).
    - 그 외 → "Table is empty" (또는 동등 i18n 친화 텍스트).
  - 기존 "No data" 텍스트는 더 이상 사용 안 함 (DataGridTable 내부).
- `src/components/DataGrid.tsx`:
  - `activeFilterCount` 와 `onClearFilters` 를 `DataGridTable` 에 전달.
  - `onClearFilters`: `setFilters([])` + `setAppliedFilters([])` + `setRawSql("")` + `setAppliedRawSql("")`. (rawSql 도 active filter 카운트에 기여하므로 같이 클리어.)
- 기존 테스트 갱신:
  - `src/components/DataGrid.test.tsx` 의 "shows No data message when rows are empty" 단언을 두 분기 (필터 없음 / 필터 있음 + Clear filter 동작) 로 확장.
  - `src/components/datagrid/DataGridTable.context-menu.test.tsx` 의 "No data" 텍스트 단언을 새 텍스트로 갱신.

## Out of Scope
- DocumentDataGrid, QueryResultGrid, EditableQueryResultGrid 의 별도 "No data" — 이 sprint 는 DataGridTable 한정.
- FilterBar 자체의 Clear All 버튼 (이미 존재). 이 sprint 는 빈 상태 영역의 affordance.
- sprint-88~98 산출물 추가 변경.
- `CLAUDE.md`, `memory/`.

## Invariants
- 회귀 0 (1734 + 신규 ≥ 2 통과).
- DataGridTable 의 다른 행 렌더링 (pendingNewRows, dataRow) 동작 보존.
- sprint-91~98 산출물 동작 보존.

## Acceptance Criteria
- AC-01: `data.rows.length === 0 && pendingNewRows.length === 0` 이고 `activeFilterCount > 0` 일 때 "0 rows match current filter" 텍스트 + Clear filter 버튼 (`role="button"`, accessible name "Clear filters" 또는 동등) 표시.
- AC-02: 같은 빈 상태에서 `activeFilterCount === 0` 일 때 "Table is empty" 표시. Clear filter 버튼 미표시.
- AC-03: Clear filter 버튼 클릭 시 `onClearFilters` 호출 → DataGrid 의 filters/appliedFilters/rawSql/appliedRawSql 가 클리어 → 데이터 재로드 (기존 effect 가 appliedFilters 변경을 트리거).
- AC-04: 기존 DataGrid 빈 상태 테스트가 두 분기 모두 커버.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Test Requirements
- AC-01 단언 1+ — 필터 있음 빈 결과 텍스트 + Clear filter 버튼 가시성.
- AC-02 단언 1+ — 필터 없음 빈 결과 텍스트 + Clear filter 버튼 부재.
- AC-03 단언 1+ — Clear filter 클릭 후 filters 클리어 + 재로드 (`fetchTableData` 두 번 호출 또는 mock 단언).
- 기존 "No data" 단언 전부 새 텍스트로 갱신.

## Exit Criteria
- P1/P2 findings: 0
- All checks pass
