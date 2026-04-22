# Issue 004 — 편집 중 정렬 변경 시 input이 잘못된 위치에 잔류

**상태**: open  
**발견일**: 2026-04-22  
**영역**: DataGridTable / 편집 모드

## 증상

셀 편집(editingCell) 중 컬럼 헤더를 클릭하여 정렬 순서를 바꾸면,
편집 중이던 셀의 `<input>`이 정렬 후 해당 행·열 위치에 그대로 남아 있다.
행이 재정렬되면서 `editingCell`의 `{ row, col }` 좌표가 더 이상 편집 의도와
일치하지 않는 행을 가리키게 된다.

## 예상 동작

정렬 변경 시 편집 모드가 자동으로 취소(`onCancelEdit`)되어야 한다.
또는 정렬 중 편집이 저장된 후 모드가 해제되어야 한다.

## 수정 방향

`onSort` 핸들러 호출 전 또는 `DataGrid.tsx`의 sort 처리부에서
`editingCell !== null` 이면 `cancelEdit()` 호출.

## 관련 파일

- `src/components/DataGrid.tsx` — `handleSort`, `editingCell` state
- `src/components/datagrid/DataGridTable.tsx` — `onSort` prop 전달부

## 테스트 필요 항목

- 셀 편집 시작 → 컬럼 헤더 클릭(sort) → editingCell이 null이어야 함
- 편집 값이 pendingEdits에 저장되지 않아야 함 (취소이므로)
- 편집 값이 pendingEdits에 저장된 상태에서 sort → 저장된 edit은 유지되어야 함
