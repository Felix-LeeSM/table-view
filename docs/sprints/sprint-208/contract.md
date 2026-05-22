# Sprint 208 — Contract

Sprint: `sprint-208` (refactor — `tabStore.ts` god file 분해).
Date: 2026-05-05.
Type: refactor (행동 변경 0; entry-pattern 답습).

[`docs/PLAN.md`](../../PLAN.md) Sprint 208 row + `/CODE_SMELLS.md` §1-1.

## 배경

`src/stores/tabStore.ts` (1009 lines, frontend god file #4) 가 단일 파일에
타입 정의 / 영속화 helper / store factory + 모든 actions / IPC bridge /
last-active-tab tracker 의 5 책임 응집. 변경 여파가 큰 god file. SchemaTree
(Sprint 199) / DataGridTable (Sprint 200) / QueryTab (Sprint 201) /
postgres.rs (Sprint 202) 의 entry-pattern 답습.

## 패턴 결정

**entry-pattern (보수 4-way split)**:
- entry path 보존 (`src/stores/tabStore.ts`) — 51 외부 caller 의 import
  경로 변경 0.
- 책임 분리되는 파트만 sub-file 로 발췌 (types / persistence / tracker).
- store factory + actions + bridge 는 entry 에 보존 — zustand `create()`
  call 분산은 더 큰 변경이라 본 sprint 미적용.

slice pattern (`createTableActions(set, get)` 으로 actions 분리) 은
zustand `StateCreator` type signature 가 까다로워 본 sprint scope 초과.
필요 시 후속 sprint.

## Sprint 안에서 끝낼 단위

### 1. `src/stores/tabStore/types.ts` (신규, ~190 lines)

발췌:
- `TabSubView`, `TabObjectKind`
- `TableTab`, `QueryMode`, `QueryTab`
- `Tab` union
- `TabState` interface

도메인 타입 + store interface 만. 의존성: `@/types/connection`, `@/types/query`, `@/types/schema`, `@stores/queryHistoryStore` (`QueryHistoryStatus`, `QueryHistorySource` import).

### 2. `src/stores/tabStore/persistence.ts` (신규, ~120 lines)

발췌:
- `STORAGE_KEY`
- `persistTabs(tabs, activeTabId)` — single localStorage write
- `debouncePersist(tabs, activeTabId)` — 200ms debounced persist
- `migrateLoadedTabs(rawTabs)` — Sprint 73/76/129 migration helpers
  (loadPersistedTabs 의 migration body 를 추출)
- `resolveActiveDb(connectionId)` — `connectionStore` lookup helper

cross-store import (`useConnectionStore`) 는 `eslint-disable
no-restricted-imports` 와 함께 보존 — 본 sprint 가 cross-store
의존성을 풀지 않음 (별도 sprint candidate, line 9-13 의 TODO 주석).

### 3. `src/stores/tabStore/tracker.ts` (신규, ~85 lines)

발췌:
- `lastActiveTabIdByConnection` Map
- `getLastActiveTabIdForConnection(connectionId)`
- `__resetLastActiveTabsForTests()`
- subscribe 등록 (`useTabStore.subscribe(...)`) — 단 subscribe 는 entry
  에서 등록하는 게 cleaner (`useTabStore` 가 entry 에 정의). tracker 가
  helper 만 export, 등록은 entry 에서.

### 4. `src/stores/tabStore.ts` (entry, ~600 lines)

보존:
- `useTabStore = create<TabState>(...)` — 모든 actions
- IPC bridge attach (`SYNCED_KEYS`, workspace-only guard, `attachZustandIpcBridge`)
- `useActiveTab` selector
- persist subscribe (`useTabStore.subscribe(state => debouncePersist(...))`)
- tracker subscribe (`useTabStore.subscribe(state => lastActiveTabIdByConnection.set(...))`)
- re-export from sub-files: `Tab`, `TableTab`, `QueryTab`, `TabSubView`,
  `TabObjectKind`, `QueryMode`, `getLastActiveTabIdForConnection`,
  `__resetLastActiveTabsForTests`

51 외부 caller signature 동일 — `import { useTabStore, Tab, TableTab,
... } from "@stores/tabStore"` 경로 보존.

## Acceptance Criteria

### AC-208-01 — entry path 보존

`grep -rn "from \"@stores/tabStore\"\|from \"@/stores/tabStore\"" src/ e2e/`
의 51 매치 모두 변경 없음. import path 동일.

### AC-208-02 — sub-file 갯수 + 라인

- `tabStore/types.ts` 존재, ~150-200 lines.
- `tabStore/persistence.ts` 존재, ~80-150 lines.
- `tabStore/tracker.ts` 존재, ~50-100 lines.
- `tabStore.ts` (entry) ~500-700 lines (god file 1009 의 60% 이하).

### AC-208-03 — 회귀 0

- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- `pnpm vitest run` baseline (Sprint 207 = 189 files / 2732 tests pass)
  동일.

### AC-208-04 — 행동 변경 0

- 51 외부 caller 의 동작 동일 — 모든 export (useTabStore / 타입 / 함수)
  의 signature 동일.
- localStorage migration 동작 동일 — Sprint 73/76/129 의 가정 보존.
- IPC bridge attach 동작 동일 — workspace-only guard 보존.

## Out of scope

- **slice pattern (createTableActions / createQueryActions)** — zustand
  StateCreator slice 도입은 큰 패턴 변경. 본 sprint 미적용.
- **cross-store 의존성 제거** — line 9-13 의 TODO ("tabStore 가 mru/
  connection/queryHistory action 직접 호출, React layer hook 으로 옮길
  것") 는 별도 sprint.
- **localStorage helper 통일** — Sprint 205 의 후속 candidate. 본 sprint
  는 god file 분해만.
- **`tabStore.test.ts` 재구성** — 기존 테스트는 entry path 만 import
  하므로 변경 없음. 새 sub-file 별 테스트는 후속 sprint candidate.

## 검증 명령

```sh
pnpm tsc --noEmit
pnpm lint
pnpm vitest run
wc -l src/stores/tabStore.ts src/stores/tabStore/*.ts
grep -rn "from \"@stores/tabStore\"" src/ e2e/ | wc -l
```

기대값: tsc 0 / lint 0 / vitest 189 files 2732 tests pass / entry +
3 sub-file 모두 존재 / importer 51 변경 없음.
