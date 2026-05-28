# Sprint 317 Execution Brief (Slice D.1)

## Objective

Mongo DocumentDataGrid 에 hide column 기능 추가. context menu trigger
+ 상단 배지 + per-collection localStorage persist.

## Scope Boundary

수정/추가:
- `src/hooks/useHiddenColumns.ts` (NEW)
- `src/hooks/useHiddenColumns.test.ts` (NEW)
- `src/components/datagrid/DataGridTable/HeaderRow.tsx`
- `src/components/datagrid/DataGridTable/HeaderRow.contextmenu.test.tsx`
- `src/components/document/DocumentDataGrid.tsx`
- `src/components/document/DocumentDataGrid.hide.test.tsx` (NEW)
- `docs/archives/phases/retired/phase-28-decision-log.md`
- `docs/sprints/sprint-317/handoff.md`

미변경:
- RDB DataGrid / DataGridTable / FilterBar.
- Backend.
- `useColumnWidths`.

## Invariants

- 기존 Mongo grid 회귀 0
- 기존 HeaderRow / context menu 회귀 0 (`onHideColumn` 미제공 → item
  미노출)
- RDB DataGrid 회귀 0 (변경 안 함)
- localStorage 기존 key 호환

## Done Criteria

1. `useHiddenColumns` hook 동작 (load/save/clear)
2. Context menu "Hide column" item
3. DocumentDataGrid hide column 적용 (`visibleOrder`)
4. 상단 배지 + Show all
5. ≥ 5 RTL/unit
6. tsc / lint / build / vitest exit 0

## Verification Plan

- Profile: `command`
- Required checks: vitest run + 정적 체크 3종
- Evidence: 변경 파일 + 신규 테스트 + baseline 3641 → 신규 카운트 +
  D-35..D-38
