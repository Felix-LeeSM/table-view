# Sprint 318 Execution Brief (Slice D.2)

## Objective

RDB DataGrid / DataGridTable 에 hide column 도입 (Sprint 317 의
Mongo 패턴 1:1 복제). HeaderRow 의 `onHideColumn` 을 wire, 상단
배지 + Show all 마크업 동일.

## Scope Boundary

수정/추가:
- `src/components/datagrid/DataGridTable.tsx`
- `src/components/datagrid/DataGridTable.hide.test.tsx` (NEW)
- `src/components/rdb/DataGrid.tsx`
- `src/components/rdb/DataGrid.hide.test.tsx` (NEW)
- `docs/phases/phase-28-decision-log.md` (D-39..D-??)
- `docs/sprints/sprint-318/handoff.md`

미변경:
- Mongo `DocumentDataGrid` 및 그 테스트.
- backend.
- `useHiddenColumns` hook.
- HeaderRow.

## Invariants

- 기존 RDB grid 테스트 회귀 0.
- 기존 useColumnWidths localStorage 호환.
- HeaderRow context menu (sprint-316) 동작 유지.

## Done Criteria

1. DataGridTable 가 `hiddenColumnNames` + `onHideColumn` prop 수용.
2. 미제공 시 plain (회귀 0).
3. 제공 시 header/row/pendingNewRows/aria-colcount 모두 visible 만.
4. RDB DataGrid wire + 배지.
5. localStorage persist `hidden-columns:rdb:<schema>:<table>`.
6. ≥ 5 RTL/unit.
7. tsc / lint / build / vitest exit 0.

## Verification Plan

- Profile: `command`
- Required checks: vitest run + 정적 체크 3종
- Evidence: 변경 파일 + 신규 테스트 + baseline 3657 → 신규 카운트 +
  D-39..D-??
