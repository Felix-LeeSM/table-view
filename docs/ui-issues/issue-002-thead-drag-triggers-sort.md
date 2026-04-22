# Issue 002 — Records thead 드래그 시 정렬 순서 변경

**상태**: open  
**발견일**: 2026-04-22  
**영역**: DataGridTable

## 증상

DataGrid의 컬럼 헤더(`thead > th`)를 클릭·드래그하면 드래그 종료 위치에 따라
정렬 순서(`onSort`)가 트리거된다.

드래그를 어디서 끝내느냐가 결과에 영향을 준다는 점에서 `mousedown` + `mouseup` 시
클릭(sort)과 드래그의 구분이 없는 것이 원인으로 추정된다.

## 예상 동작

`th`를 드래그해도 정렬이 변경되어서는 안 된다. 짧은 클릭(마우스 이동 없음)만
정렬을 트리거해야 한다.

## 원인 추정

`th`의 `onClick`이 드래그 동작 후에도 발화됨.
드래그 중 이동 거리(`deltaX`, `deltaY`)를 임계값으로 클릭 여부를 판단하는 로직 부재.

## 수정 방향

`th`에 `mousedown` → `mousemove` 감지로 "드래그 중" 플래그를 세우고,
`onClick` 핸들러에서 해당 플래그가 세워져 있으면 sort를 스킵한다.

또는 더 단순하게:
- `pointerdown` 시 좌표 기록
- `pointerup` 시 이동 거리가 4px 미만이면 sort 실행, 이상이면 무시

## 관련 파일

- `src/components/datagrid/DataGridTable.tsx` — `<th onClick>` 핸들러

## 테스트 필요 항목

- `th`를 클릭(이동 없음) → sort 발생
- `th`를 드래그(이동 있음) → sort 미발생
