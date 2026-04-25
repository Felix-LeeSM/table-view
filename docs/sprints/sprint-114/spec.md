# Sprint 114: DataGrid 가상화 (#PERF-1, #GRID-3)

**Source**: `docs/ui-evaluation-results.md` #PERF-1 + #GRID-3
**Depends on**: —
**Verification Profile**: mixed

## Goal

DataGrid 가 page size 1000 에서도 viewport 외 행을 가상화해 DOM 행 수가 일정 상한 이하로 유지되도록 한다.

## Acceptance Criteria

1. DataGrid 가 page size 1000 에서도 viewport 외 행을 가상화해 DOM 행 수가 일정 상한 (예: 100) 이하로 유지된다.
2. 정렬/필터 변경 시 viewport 가 정확히 재계산되어 첫 행이 보인다.
3. 셀 ARIA 속성(role/aria-rowindex/aria-colindex) 이 가상화 후에도 정확히 유지된다.
4. 기존 DataGrid 테스트 회귀 0 (가상화 도입으로 셀 쿼리 패턴 변경 시 테스트도 함께 갱신).

## Components to Create/Modify

- `src/components/datagrid/DataGridTable.tsx`: 가상화 도입.
- 관련 테스트 (가상화 인지 쿼리 패턴).

## Edge Cases

- 가상화 켠 상태에서 컬럼 정렬/필터 변경 — viewport 재계산 정확.
