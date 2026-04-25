# Sprint 99 → next Handoff

## Sprint 99 Result
- **PASS** (9.0/10, 1 attempt)
- 4 AC 모두 PASS, 회귀 0 (1735 / 1735 tests, +1 신규 시나리오).

## 산출물
- `src/components/datagrid/DataGridTable.tsx`:
  - `activeFilterCount?: number` (default 0), `onClearFilters?: () => void` 추가.
  - 빈 상태 분기:
    - `activeFilterCount > 0` → "0 rows match current filter" + `<Button aria-label="Clear filters">Clear filter</Button>`.
    - else → "Table is empty".
- `src/components/DataGrid.tsx`:
  - `handleClearAllFiltersFromEmptyState` — `setFilters([])`, `setAppliedFilters([])`, `setRawSql("")`, `setAppliedRawSql("")`, + `setPage(1)`.
  - DataGridTable 에 `activeFilterCount`, `onClearFilters` 전달.
- `src/components/DataGrid.test.tsx`: 기존 #21 ("No data") → "Table is empty" 갱신 + #21a 신규 (필터 활성 0행 → Clear filter → 재로드 단언).
- `src/components/datagrid/DataGridTable.context-menu.test.tsx`: "No data" → "Table is empty" string drift 갱신.

## 인계
- **`setPage(1)` 부산물**: clear handler 가 페이지를 1로 리셋. 사용자 경험상 자연스러움 (필터 클리어 후 첫 페이지로 이동) — 명시적으로 contract 에 없으나 의도된 추가. 향후 기억할 동작.
- **Visible "Clear filter" vs aria-label "Clear filters"**: 의도된 비대칭. 시각 라벨은 단수 (single button), aria-label 은 복수 (filters can be many). 후속에 코멘트 한 줄 권장.
- **Out-of-scope 빈 상태**: `QueryResultGrid`, `EditableQueryResultGrid`, `DocumentDataGrid` 는 자체 빈 상태를 가짐. 필요 시 후속 sprint 로 일관화 가능.
- **rawSql 분기 카운트**: `activeFilterCount = appliedRawSql.trim().length > 0 ? 1 : appliedFilters.length` (기존). raw SQL 만 활성이어도 "0 rows match current filter" 로 표시됨 — 의도된 동작 (raw SQL 도 사용자 관점에서 필터).

## 다음 Sprint 후보
- sprint-100 ~ 123: 잔여 ui-evaluation findings.
- 후속 cosmetic: Document/Query grid 빈 상태 일관화.
