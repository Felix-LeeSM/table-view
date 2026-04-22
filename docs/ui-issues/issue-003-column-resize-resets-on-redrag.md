# Issue 003 — 컬럼 재조정 시 최초 너비에서 드래그 시작

**상태**: open  
**발견일**: 2026-04-22  
**영역**: DataGridTable / 컬럼 리사이즈

## 증상

한 번 컬럼 너비를 조정한 뒤, 같은 컬럼의 리사이즈 핸들을 다시 드래그하면
현재 너비가 아닌 최초(기본) 너비에서 드래그가 시작되어 시각적으로 어색하다.

## 예상 동작

재드래그 시 현재 컬럼 너비를 기준점으로 사용해야 한다.

## 원인 추정

`mousedown` 핸들러에서 `startWidth`를 `th.getBoundingClientRect().width` 대신
`columnWidths[col]` prop 기본값(혹은 `getColumnWidth()` 반환값)으로 읽고 있을 가능성.

또는 `resizing` ref에 저장된 초기 너비가 첫 번째 드래그 완료 후 갱신되지 않는 경우.

## 관련 파일

- `src/components/datagrid/DataGridTable.tsx` — `handleResizeMouseDown` (또는 동등한 함수)
- `src/components/DataGrid.tsx` — `columnWidths` state 관리

## 디버깅 힌트

`mousedown` 시점에 `resizingRef.current.startWidth`에 할당되는 값을 로그로 확인.
`th` 요소의 실제 렌더링 너비(`getBoundingClientRect().width`)와 비교.

## 테스트 필요 항목

- 첫 번째 리사이즈 후 너비 확인
- 두 번째 리사이즈 시작 시 `startWidth`가 첫 번째 리사이즈 결과와 일치하는지 확인
