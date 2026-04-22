# Issue 005 — 새로고침 후 편집 모드 및 입력 상태 유지

**상태**: open  
**발견일**: 2026-04-22  
**영역**: DataGrid / 편집 모드 / 새로고침

## 증상

편집(edit) 모드 중 데이터 새로고침(Refresh)을 실행하면:
1. `editingCell`이 유지되어 편집 input이 화면에 남아 있다
2. 새로고침으로 서버에서 새 데이터를 받아와도 이전 편집 상태가 겹쳐 보인다

## 예상 동작

새로고침 시 편집 모드는 즉시 취소(`cancelEdit`)되어야 한다.
`pendingEdits`, `pendingNewRows`, `pendingDeletedRowKeys`는 사용자 확인 없이
서버 데이터로 덮어쓰이면 안 되므로, 변경 사항이 있는 경우 경고 다이얼로그를
표시하거나 변경 사항을 초기화하는 옵션을 제공해야 한다.

## 연관 시나리오

새로고침 후 행 위치가 밀린 경우:
- `pendingEdits`의 key는 `rowIndex` 기반이므로 행이 추가/삭제되면
  잘못된 행에 편집 값이 표시될 수 있다
- row identity를 primary key 기반으로 관리하는 방향 검토 필요

## 수정 방향

`DataGrid.tsx`의 새로고침 트리거 함수에서:
1. `setEditingCell(null)` 호출
2. `setEditValue("")` 호출
3. (선택) `pendingEdits.size > 0` 이면 경고 처리

## 관련 파일

- `src/components/DataGrid.tsx` — `handleRefresh` (또는 `loadData`) 함수
- `src/components/datagrid/DataGridTable.tsx` — 편집 관련 props

## 테스트 필요 항목

- 편집 중 새로고침 → editingCell이 null
- 편집 중 새로고침 → editValue가 빈 문자열
- pendingEdits가 있는 상태에서 새로고침 → 경고 or 초기화 처리 확인
- 새로고침 후 행 수가 늘어난 경우 기존 pendingEdits key 충돌 없음 확인
