# Sprint 99: DataGrid 빈 상태 분리 (P1 #6)

**Source**: `docs/ui-evaluation-results.md` P1 #6
**Depends on**: —
**Verification Profile**: mixed

## Goal

DataGrid `"No data"` 단일 메시지를 "필터 결과 0행" vs "테이블 0행" 으로 분리해 사용자가 상태 차이를 명확히 인지하게 한다.

## Acceptance Criteria

1. 활성 필터가 있는 상태에서 0행이면 "0 rows match current filter — Clear filter 버튼" 이 표시된다.
2. 필터 없는 0행이면 "Table is empty" 가 표시된다.
3. Clear filter 버튼 클릭 시 필터가 초기화되고 데이터가 다시 로드된다.
4. 기존 DataGrid 빈 상태 테스트가 두 분기 모두 커버하도록 갱신된다.

## Components to Create/Modify

- `src/components/datagrid/DataGridTable.tsx` 또는 `src/components/DataGrid.tsx`: 빈 상태 분기.
- `src/components/FilterBar.tsx`: Clear filter 버튼 노출.
- 관련 테스트.
