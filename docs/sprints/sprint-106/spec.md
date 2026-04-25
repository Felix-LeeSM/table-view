# Sprint 106: DataGrid role=grid + 셀 ARIA (#A11Y-3)

**Source**: `docs/ui-evaluation-results.md` #A11Y-3
**Depends on**: —
**Verification Profile**: browser

## Goal

DataGrid 컨테이너에 `role="grid"` 와 셀에 `role="gridcell"` + `aria-rowindex`/`aria-colindex` 를 부여해 스크린 리더가 셀 위치를 인지하도록 한다.

## Acceptance Criteria

1. DataGrid 컨테이너가 `role="grid"`, 셀이 `role="gridcell"` + `aria-rowindex`/`aria-colindex` 를 가진다.
2. 헤더 행에는 `role="row"` + `role="columnheader"` 가 부여된다.
3. ARIA 속성은 정렬/필터 변경 시에도 정확한 인덱스를 유지한다.
4. 기존 DataGrid 테스트 회귀 0 + ARIA 단언 테스트 추가.

## Components to Create/Modify

- `src/components/datagrid/DataGridTable.tsx`: ARIA grid 역할 부여.
- 관련 테스트.
