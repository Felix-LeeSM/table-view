# Issue 001 — 탭 드래그 후 렌더링 순서가 바뀌지 않음

**상태**: open  
**발견일**: 2026-04-22  
**영역**: TabBar / tabStore

## 증상

탭을 드래그해서 다른 탭 위에 드롭해도 탭의 표시 순서가 변경되지 않는다.
`dataTransfer.setData/getData` 방식으로 전환했음에도 여전히 재현됨.

## 예상 동작

드래그 소스 탭이 드롭 대상 탭 위치로 이동하여 순서가 즉시 반영되어야 한다.

## 관련 파일

- `src/components/layout/TabBar.tsx` — 드래그 핸들러 (`onDragStart`, `onDrop`)
- `src/stores/tabStore.ts` — `moveTab` 액션

## 디버깅 힌트

1. `onDrop`에서 `dataTransfer.getData("text/plain")`이 빈 문자열을 반환하는지 확인
2. `moveTab(fromId, tab.id)` 호출 여부를 `console.log`로 확인
3. 브라우저에서 `dragover` → `drop` 이벤트 순서가 정상적으로 발화되는지 DevTools로 확인
4. Tauri WebView 환경에서 `dataTransfer` API 동작 차이가 있을 수 있음
