---
title: B. Store 결합도
type: memory
updated: 2026-05-02
---

# B. Store 결합도

상위: [refactoring](../memory.md). 카테고리 B — Zustand store 와 컴포넌트
/ hook 사이 결합도 룰.

## B-1. `useXStore.setState(...)` 직접 호출 금지

- 컴포넌트 / hook / lib 어디서도 `useXStore.setState(...)` 호출 0.
- **예외**: store 자체 코드 (`stores/*.ts`) + IPC bridge
  (`lib/zustand-ipc-bridge.ts`).
- 현재 violations 8 사이트 (SchemaTree:603 + QueryTab × 7) 는 sprint 별
  정리 (SchemaTree → Sprint 191, QueryTab × 7 → Sprint 195 + 일부
  Sprint 189).

## B-2. `useXStore.getState()` read 정책

- **OK**: event handler / setTimeout / IPC callback 안의 read. 컴포넌트
  외부 (`main.tsx`, util) 의 read.
- **금지**: render path 안의 `getState` (reactivity 깨짐). render 안에서는
  selector (`useStore((s) => s.x)`) 만.
- **금지**: read-then-set 패턴
  (`const x = store.getState().x; store.setState({ x: x + 1 });`) —
  race 위험. write 는 항상 action 으로.

## B-3. Action 분할 단위 — 상태 전이별

- **권장**: 상태 전이 단위 — `setQueryRunning(tabId, queryId)` /
  `completeQuery(tabId, queryId, result)` /
  `failQuery(tabId, queryId, error)`.
- **비권장**: 일반화 `transitionQuery(tabId, queryId, next: Status)` —
  잘못된 전이 type 차단 안 되면 가치 < 비용.

## B-4. Stale guard 위치 — store action 안

- 동시성 가드 (queryId match, runningRef 등) 는 store action 이 자체 검사.
- 예: `completeQuery(tabId, queryId, result)` 가 내부에서
  `state.tabs[tabId].runningQueryId === queryId` 일 때만 반영.
- callsite (UI) 는 race 조건 알 필요 없음.

## B-5. Action 명명 — 명령형 + 도메인 이벤트

- **권장**: `evictSchemaCache`, `completeQuery`, `recordHistory`,
  `clearForConnection`.
- **비권장**: `setX` / `updateX` / `changeX` (CRUD 일반어, 의도 불명).
- **예외**: 단순 setter (`setActiveTab`) — 의도가 단어에 이미 있음.

## B-6. Cross-store 결합 — hook 레벨에서만

- **금지**: store 내부에서 다른 store 직접 `import` / `getState()`.
- **요구**: cross-store 조합은 hook 에서 — 예 `useSafeModeGate` 가
  `useSafeModeStore` + `useConnectionStore` 두 개 read.

## B-7. 강제 메커니즘 — 단계적

- **Phase 1 (즉시)**: convention + sprint findings.md audit. 각 refactor
  sprint 가 자신의 surface 에서 violation 0 확인.
- **Phase 2 (도입 예정)**: ESLint custom rule `no-direct-zustand-setstate`
  — `useXStore.setState` 호출 detect. 도입 시점은 violations 0 달성 직후
  (Sprint 198 종료 후 일괄 lint 0 보장).
- **Phase 3 (보류)**: TS 레벨 차단.
