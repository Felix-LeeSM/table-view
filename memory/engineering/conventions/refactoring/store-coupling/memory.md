---
title: B. Store 결합도
type: memory
updated: 2026-05-28
---

# B. Store 결합도

상위: [refactoring](../memory.md). 카테고리 B — Zustand store 와 컴포넌트
/ hook 사이 결합도 룰.

## B-1. `useXStore.setState(...)` 직접 호출 금지

- production component / hook / runtime lib 에서 `useXStore.setState(...)`
  직접 write 금지. 상태 변화는 store public action 으로 표현한다.
- **예외**: store 자체 코드 (`src/stores/**`), test/reset/helper 코드,
  infrastructure bridge (`src/lib/zustand-ipc-bridge.ts`) 처럼 Zustand plumbing 을
  직접 다루는 얇은 경계.
- `src/lib/runtime/**` 는 store 를 다룰 수 있지만 직접 `setState` 하지 않는다.
  필요한 write 는 `hydrate*`, `apply*`, `recover*`, `record*` 같은 action 을
  store 에 추가한 뒤 호출한다.
- 현재 legacy debt: `src/hooks/useSchemaTableMutations.ts`,
  `src/hooks/useConnectionSessionHydration.ts` 는 아직 direct `setState` 를 쓴다.
  새 코드가 따라 해서는 안 되며, touched scope 에서 store action 또는
  `src/lib/runtime/**` use-case 로 낮춘다.

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

## B-6. Cross-store 결합 — runtime use-case 로 중앙화

- **금지**: store 내부에서 다른 store 직접 `import` / `getState()`.
- **요구**: store 2개 이상을 묶는 orchestration 은 `src/lib/runtime/**` use-case
  로 중앙화한다. hook/component 는 해당 use-case 를 호출하고 UI state 만 소유한다.
- **허용**: 단순 render selector 조합은 hook/component 에 둔다. side effect,
  stale guard, recovery, cross-window sync 가 섞이면 runtime 으로 올린다.

## B-7. 강제 메커니즘 — 단계적

- **현재**: convention + sprint findings audit. 위 legacy debt 외 production
  surface 에 새 direct `setState` 를 만들지 않는다.
- **계획**: ESLint custom rule `no-direct-zustand-setstate` 로 production source 를
  차단하고, test/reset/helper 예외를 allowlist 한다.
- **보류**: TS 레벨 차단.
