# Feature Spec: tabStore cross-store import 제거 (Sprint 212)

## Description

`src/stores/tabStore.ts` (entry, 668 lines, Sprint 208 entry-pattern split 완료) 가 여전히 두 cross-store 직접 import 를 보유한다. `useMruStore` 는 `addTab` (L93) / `addQueryTab` (L298) 두 action 안에서 `markConnectionUsed(connectionId)` 를 부른다. `useQueryHistoryStore` 는 `recordHistory` (L467) action 안에서 `addHistoryEntry({...})` 를 부른다. 두 import 는 각각 `/* eslint-disable no-restricted-imports */` 블록 (L23–26, L43–56) 으로 감싸여 있고, entry 파일 상단의 TODO 주석 (L19–22) 이 본 sprint 의 정확한 scope ("React layer hook 또는 호출 사이트로 옮겨 import 들을 제거") 를 명시한다.

본 sprint 는 두 cross-store action call 을 **caller layer (use-case hook 또는 caller component)** 으로 이동하고, store action 내부에서 cross-store side effect 를 제거한다. 외부 import path (`@stores/tabStore`) 와 51 caller signature 는 보존하지만, 행동의 **소유권** 이 이동한다 — tabStore 는 tab list 만 책임지고, MRU marking / query history recording 은 caller 책임이 된다. 결과: entry 의 두 `eslint-disable no-restricted-imports` 블록 제거 + `useMruStore` / `useQueryHistoryStore` import 0 + `no-restricted-imports` lint rule 의 entry 예외 0.

## Sprint Breakdown

### Sprint 212: tabStore cross-store coupling 제거

**Goal**: tabStore entry 의 `useMruStore` / `useQueryHistoryStore` 직접 import 와 두 `eslint-disable no-restricted-imports` 블록을 제거한다. MRU marking 책임을 모든 `addTab` / `addQueryTab` caller layer (use-case hook 또는 caller component) 로 이동하고, query history recording 책임을 `recordHistory` 의 유일한 caller (`useQueryExecution.ts`) 로 이동한다. tabStore 는 tab list mutation 만 책임지고, 두 store 가 양방향 의존 0 인 상태가 된다. 행동 변경 0 — 사용자 관찰 가능한 모든 path (table preview / persistent open, query tab open via 5+ entry points, query execution 의 success/error/cancelled history entry, 멀티-window MRU sync, EmptyState CTA target) 가 동일 결과 산출.

**Verification Profile**: command

**Acceptance Criteria**:

1. **Cross-store import 0 + eslint-disable 블록 0.** `grep -n "useMruStore\|useQueryHistoryStore" src/stores/tabStore.ts` 매치 0. `grep -n "eslint-disable no-restricted-imports" src/stores/tabStore.ts` 매치 0 (entry 의 두 블록 모두 제거 — L23-26, L43-56). `grep -nE "^/\\* eslint-(disable|enable) no-restricted-imports \\*/$" src/stores/tabStore.ts` 매치 0. entry 상단의 TODO 주석 (현재 L19-22, "별도 sprint 에서 cross-store 의존을 제거해야 한다") 도 함께 제거 — 이미 처리되었기 때문.

2. **두 cross-store action call 이 caller layer 에 위치.** `grep -rn "markConnectionUsed" src/stores/` 매치 0 (`mruStore.ts` 정의는 제외 — `grep -rn "markConnectionUsed" src/stores/ | grep -v "src/stores/mruStore"` 로 검사). `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` 매치 0. 두 호출은 `src/hooks/` 또는 `src/components/**/use*.ts(x)?` 또는 `src/App.tsx` / 기타 caller component 에 존재 — `grep -rn "markConnectionUsed" src/ --include="*.ts" --include="*.tsx" | grep -v "src/stores/mruStore"` 매치 ≥ 1, `grep -rn "addHistoryEntry" src/ --include="*.ts" --include="*.tsx" | grep -v "src/stores/queryHistoryStore"` 매치 ≥ 1.

3. **MRU marking 보존 — 모든 addTab/addQueryTab caller path 가 marking 발화.** 다음 caller path 가 모두 사전과 동일하게 `markConnectionUsed(connectionId)` 를 발화 (call site 가 store action 안 → caller 안으로 옮겨졌어도 결과는 동일):
   - `src/components/schema/SchemaTree/useSchemaTreeActions.ts` — `handleTableClick` / `handleTableDoubleClick` / `handleOpenStructure` / `handleViewClick` / `handleOpenViewStructure` / `handleFunctionClick` (총 6 handler 가 addTab/addQueryTab 호출).
   - `src/components/schema/DocumentDatabaseTree.tsx` — `handleCollectionOpen` / `handleCollectionDoubleClick`.
   - `src/components/rdb/DataGrid.tsx` — `handleNavigateToFk`.
   - `src/components/layout/MainArea.tsx` — `EmptyState` "New Query" CTA.
   - `src/components/layout/Sidebar.tsx` — header strip "+ Query" button.
   - `src/App.tsx` — Cmd+T global shortcut, `navigate-table` event handler, `quickopen-function` event handler.

   기존 통합 회귀 테스트 (`src/components/layout/MainArea.test.tsx::AC-01/AC-04 — opening a query tab via the CTA marks that connection as MRU`, line 666-681) 가 그대로 통과해야 한다 (test 파일 변경 0).

4. **Query history recording 보존 — 유일 caller `useQueryExecution.ts` 가 직접 `addHistoryEntry` 호출.** 8 call site (single SQL success/error, multi-statement final, document find success/error, mongo aggregate success/error) 모두 `useQueryHistoryStore.addHistoryEntry({...})` 를 직접 호출하며 (selector subscription 패턴, `useSchemaTreeActions.ts:117` 의 기존 pattern 답습), 각 호출이 **사전 store-side `recordHistory` 와 동일한 payload 모양** (`sql` / `executedAt` / `duration` / `status` + 자동 추출되는 `connectionId` / `paradigm` / `queryMode` / `database` / `collection` + optional `source`) 을 전달한다. 행동 변경 0 — `useQueryHistoryStore.getState().entries` 의 모양과 카운트는 사전과 동일.

5. **`recordHistory` action 제거 (또는 store 의 cross-store coupling 0 화).** `TabState` interface (`src/stores/tabStore/types.ts`) 의 `recordHistory: (tabId, payload) => void` 시그니처를 제거하거나, 제거가 caller migration 일정상 어려우면 본문을 cross-store 호출 없는 no-op (또는 caller 로 redirect) 로 축소. 권장: **시그니처 제거 + 8 call site 를 새 caller hook 또는 inline payload-build 로 마이그레이션**. `grep -n "recordHistory" src/stores/tabStore.ts src/stores/tabStore/types.ts` 가 호출의 정의가 아닌 doc-comment 만 남기거나 0 매치.

6. **TabState 의 `addTab` / `addQueryTab` 시그니처 보존 (caller 계약).** 두 action 의 입력 타입과 store-state mutation 결과는 변경 0 — 기존 51 caller 의 `addTab({...})` / `addQueryTab(connectionId, opts?)` 호출 부 0 변경. 외부 caller signature 의 동일성은 `grep -rn "from \"@stores/tabStore\"" src/ e2e/ | wc -l` 매치 수가 사전 50 (entry 자기 import 제외) 이상으로 유지되는 것으로 확인.

7. **localStorage tab persistence + IPC bridge sync + tracker 보존.** `src/stores/tabStore/persistence.ts` 의 `useConnectionStore` cross-store import (`resolveActiveDb`) 는 본 sprint scope 외 — 그대로 유지 (별도 candidate). `tabStore/tracker.ts` / IPC bridge attach (`SYNCED_KEYS` / workspace-only guard) / `useActiveTab` selector / persist subscribe 은 entry 에 그대로 유지. 모든 cross-window 동작은 사전과 동일.

8. **Project-wide 회귀 0.**
   - `pnpm vitest run` exit 0, post-Sprint-211 baseline (189 files / 2725 tests pass) 이상 유지. file 카운트 동일 또는 1-2 신규 hook 파일 추가시 약간 증가 허용.
   - `pnpm tsc --noEmit` exit 0.
   - `pnpm lint` exit 0 — 새 `eslint-disable*` directive 0 (sprint 산출 파일 git diff 의 `^+.*eslint-disable` 매치 0). entry 의 두 기존 `eslint-disable no-restricted-imports` 블록은 제거.
   - eslint `no-restricted-imports` rule (eslint.config.js L110-128, `src/stores/**/*.ts` 의 cross-store coupling 금지) 가 본 entry 에 대해 더는 위반을 만들지 않음 — 위 AC-1 grep 으로 검사.

**Components to Create/Modify**:

- `src/stores/tabStore.ts` (modify): entry 파일. 두 `eslint-disable no-restricted-imports` 블록 (L23-26, L43-56) 모두 제거. `useMruStore` / `useQueryHistoryStore` import 두 줄 제거. `addTab` / `addQueryTab` action 본문에서 `useMruStore.getState().markConnectionUsed(...)` 두 호출 제거. `recordHistory` action 본문에서 `useQueryHistoryStore.getState().addHistoryEntry({...})` 호출 제거 (action 자체 제거 권장 — AC-5). entry 상단의 TODO 주석 (L19-22) 제거. zustand `create()` + 나머지 actions + persist subscribe + tracker subscribe + IPC bridge attach + `useActiveTab` selector + re-export 그대로 유지.

- `src/stores/tabStore/types.ts` (modify): `TabState` interface 에서 `recordHistory: (tabId, payload) => void` 시그니처 제거 (AC-5 권장 path). 다른 시그니처는 변경 0. `QueryHistorySource` / `QueryHistoryStatus` re-import 도 더 이상 store 에서 필요 없으면 제거. 단, type-only import 는 그대로 유지 가능 (`allowTypeImports` rule 으로 lint 통과).

- `src/hooks/useOpenTableTab.ts` (create, optional pattern): `addTab` 호출 + `markConnectionUsed(connectionId)` 호출을 한 곳에서 묶는 use-case hook. 11 caller (table click / view click / FK navigate / collection open / quick-open navigate-table / etc) 가 이 hook 으로 수렴하면 marking 누락 회귀 위험이 줄어든다. **선택 사항** — generator 가 caller 가 적은 경우 hook 도입 없이 각 caller 에서 직접 `markConnectionUsed` 호출하는 것도 허용 (행동 동일).

- `src/hooks/useOpenQueryTab.ts` (create, optional pattern): `addQueryTab` 호출 + `markConnectionUsed(connectionId)` 호출을 묶는 use-case hook. 5 caller (Cmd+T / Sidebar+Query / MainArea EmptyState / SchemaTree procedure-source / quickopen-function) 가 수렴. **선택 사항** — 위와 동일한 trade-off.

- `src/components/query/QueryTab/useQueryExecution.ts` (modify): `recordHistory = useTabStore((s) => s.recordHistory)` selector 제거. 대신 `addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry)` selector 추가 + `tab` (이미 hook arg 로 보유) 에서 `connectionId` / `paradigm` / `queryMode` / `database` / `collection` 를 직접 읽어 payload 를 구성. 8 call site 의 sql / executedAt / duration / status / source (optional) 는 사전과 동일한 의미. payload 는 선택적으로 `src/lib/queryHistory/buildHistoryEntry.ts` 같은 pure helper 로 추출 가능 (재사용 + 테스트 용이성). deps 억제 (`react-hooks/exhaustive-deps` 1곳, Sprint 25 정책) 그대로 유지.

- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (modify): 기존 `addTab` / `addQueryTab` 호출 site 6+ 곳에서 `markConnectionUsed(connectionId)` 를 명시 호출 (또는 새 `useOpenTableTab` / `useOpenQueryTab` hook 사용). `useMruStore` selector subscription 추가. `addHistoryEntry` selector subscription 은 이미 보유 (L117) — 변경 없음.

- `src/components/schema/DocumentDatabaseTree.tsx` (modify): `handleCollectionOpen` / `handleCollectionDoubleClick` 에서 `markConnectionUsed(connectionId)` 추가 호출 (또는 `useOpenTableTab` 사용). `useMruStore` selector subscription 추가. 본 컴포넌트의 기존 `addHistoryEntry` 호출 (drop collection history) 는 변경 없음.

- `src/components/rdb/DataGrid.tsx` (modify): `handleNavigateToFk` 에서 `markConnectionUsed(connectionId)` 추가 호출 (또는 `useOpenTableTab` 사용). `useMruStore` selector subscription 추가.

- `src/components/layout/MainArea.tsx` (modify): `EmptyState` 의 "New Query" CTA `onClick` 에서 `markConnectionUsed(target.id)` 추가 호출 (또는 `useOpenQueryTab` 사용). `useMruStore` selector subscription 추가 — 이미 `lastUsedConnectionId` 를 읽고 있으므로 같은 store 의 `markConnectionUsed` 도 추가.

- `src/components/layout/Sidebar.tsx` (modify): "+ Query" 버튼 onClick 에서 `markConnectionUsed(focusedConnId)` 추가 호출 (또는 `useOpenQueryTab` 사용). `useMruStore` selector subscription 추가.

- `src/App.tsx` (modify): 3 caller (Cmd+T global shortcut handler, `navigate-table` event handler, `quickopen-function` event handler) 모두에서 `markConnectionUsed(connectionId)` 추가 호출. `useMruStore` selector subscription 은 이미 `loadPersistedMru` 로 보유 — 같은 selector 에 `markConnectionUsed` 추가.

- `src/stores/tabStore.test.ts` (modify): AC-195-03 / AC-196-02 (line 2226-2383, recordHistory + source 테스트 ~5건) 는 store action `recordHistory` 가 제거되면 더 이상 store-level test 로 의미가 없다. 두 가지 옵션 중 선택 — (a) 동등 커버리지가 `useQueryExecution.ts` 의 기존 통합 path 에서 보장되면 본 5건 삭제 (regression suite 가 source of truth), (b) `useQueryExecution.test.ts` 가 이미 paradigm/connectionId/database/collection 추출을 검증하면 그쪽으로 이동 — 단 **신규 unit test 작성 0** 원칙 준수, 즉 새 케이스 추가 금지, 기존 케이스의 import / setUp 만 갱신. 권장: (a) — 사용자 관찰 가능 동작은 `addHistoryEntry` 가 caller 측에서 호출된다는 사실이며, 이는 8 call site 의 회귀가 통합 동작 (`useQueryHistoryStore.entries` shape) 으로 직접 검증 가능. tabStore.test.ts 의 다른 테스트 (addTab/addQueryTab/lifecycle/persistence/sync 등 ~95% 비중) 는 0 변경.

## Global Acceptance Criteria

1. **행동 변경 0.** 사용자 관찰 가능한 모든 흐름이 사전과 동일:
   - Table tab single-click → preview tab 생성 + MRU marking + tab list 반영.
   - Table tab double-click → persistent tab 생성 + MRU marking.
   - SchemaTree drop / rename / function-source / view open → tab 동작 + MRU marking + (drop/function-source) history entry 동일.
   - Document collection open (single + double click) + drop collection → 동일.
   - DataGrid FK navigate → 새 tab + initialFilters + MRU marking 동일.
   - QueryTab handleExecute → SQL single / multi / mongo find / mongo aggregate 4 path + cancel + warn-confirm 모두 동일 → `useQueryHistoryStore.entries` 에 사전과 동일한 entry 1건 추가, 동일한 status / paradigm / queryMode / database / collection / source 필드 보유.
   - HistoryPanel restore (`loadQueryIntoTab`) → 동일 (이 action 은 cross-store import 와 무관).
   - Cmd+T / Cmd+W / Cmd+Shift+T / "navigate-table" event / "quickopen-function" event → 동일 + MRU marking 발화.
   - Cross-window IPC sync (`tab-sync` / `mru-sync`) — 두 store 가 각각 자신의 SYNCED_KEYS 만 broadcast. 변경 0.

2. **외부 import path / 51 caller signature 보존.** `grep -rn "from \"@stores/tabStore\"" src/ e2e/ | grep -v "src/stores/tabStore" | wc -l` 결과 ≥ 50 (Sprint 208 handoff 의 baseline). 모든 importer 가 `useTabStore` / `Tab` / `TableTab` / `QueryTab` / `TabSubView` / `QueryMode` / `useActiveTab` / `getLastActiveTabIdForConnection` / `__resetLastActiveTabsForTests` / `SYNCED_KEYS` 를 그대로 import. 단, `recordHistory` 시그니처가 제거되면 그것을 import 하던 유일 caller (`useQueryExecution.ts:91`) 는 변경 — 이 변경은 본 sprint 의 의도된 일부.

3. **eslint rule 위반 0 + 새 eslint-disable 0.** `pnpm lint` exit 0. `git diff` 에서 본 sprint touched 파일들의 `^+.*eslint-disable` 매치 0 (entry 의 두 기존 블록 제거가 아닌 신규 추가가 0이라는 뜻). eslint.config.js 의 `no-restricted-imports` rule (L110-128, `src/stores/**/*.ts` cross-store 금지) 와 `no-restricted-syntax` rule (L88-103, `.tsx` 의 `.getState()` 직접 호출 금지) 모두 위반 없음. caller migration 시 `.getState()` 직접 호출은 컴포넌트/페이지 `.tsx` 에서 금지 — selector subscription (`const markConnectionUsed = useMruStore(s => s.markConnectionUsed)`) 사용.

4. **TypeScript strict mode 준수.** `pnpm tsc --noEmit` exit 0. `recordHistory` 시그니처 제거시 `useQueryExecution.ts` 와 `TabState` interface 양쪽 모두 갱신 — 비동기 type drift 없음.

5. **회귀 테스트 통과.** `pnpm vitest run` exit 0 — 다음 핵심 회귀가 모두 통과:
   - `src/stores/tabStore.test.ts` — addTab / addQueryTab / lifecycle / persistence / sync (recordHistory AC-195-03, AC-196-02 만 영향, 위 마지막 컴포넌트 항목 참조).
   - `src/stores/mruStore.test.ts` — 변경 0.
   - `src/stores/queryHistoryStore.test.ts` — 변경 0.
   - `src/__tests__/cross-window-store-sync.test.tsx` — `mru-sync` AC-153-02a 그대로 통과 (mruStore 의 broadcast 시점은 `markConnectionUsed` 호출 위치와 무관 — caller 가 호출하든 store action 이 호출하든 broadcast 시점은 동일).
   - `src/__tests__/cross-window-connection-sync.test.tsx` — connection store 만 다룸, 영향 없음.
   - `src/components/layout/MainArea.test.tsx` — AC-01/AC-04 (line 666) "opening a query tab via the CTA marks that connection as MRU" 그대로 통과.
   - `src/components/schema/SchemaTree.preview.test.tsx` / `SchemaTree.test.tsx` — table preview / persistent / drop / rename / view / function-source path 에서 MRU + history 동작 동일.
   - `src/components/query/QueryTab.test.tsx` / `useQueryExecution` 관련 테스트 — handleExecute 8 path 의 history entry shape 그대로.
   - `src/components/document/DocumentDataGrid.test.tsx` 및 관련 — drop collection history 동작 동일.

6. **store ownership 명확화 + dependency graph 단방향.**
   - tabStore 는 더 이상 mruStore / queryHistoryStore 에 의존하지 않는다 (entry 의 import 0, eslint 위반 0).
   - mruStore / queryHistoryStore 는 사전과 동일하게 tabStore 에 의존하지 않는다 (queryHistoryStore 의 `import type { QueryMode } from "@stores/tabStore"` 는 type-only — `allowTypeImports` 규칙으로 허용됨, 변경 없음).
   - tabStore 의 `persistence.ts` 가 `connectionStore` 에 의존하는 부분 (`resolveActiveDb`) 은 별도 candidate — 본 sprint scope 외, eslint-disable 그대로 유지.

## Data Flow

### Before (current state)

- `caller` (e.g., `SchemaTree.handleTableClick`) → `useTabStore.addTab(...)` → 내부에서 `useMruStore.getState().markConnectionUsed(connectionId)` 호출 → tab list mutation.
- `caller` (e.g., `Sidebar` "+Query" button) → `useTabStore.addQueryTab(connectionId, opts?)` → 내부에서 `useMruStore.getState().markConnectionUsed(connectionId)` 호출 → tab list mutation.
- `useQueryExecution.ts` (8 call sites) → `useTabStore.recordHistory(tabId, payload)` → 내부에서 `tabs.find(t => t.id === tabId)` + tab 의 connectionId/paradigm/queryMode/database/collection 자동 추출 → `useQueryHistoryStore.getState().addHistoryEntry({...})` 호출.

### After (this sprint)

- `caller` (e.g., `SchemaTree.handleTableClick`) → `useTabStore.addTab(...)` (cross-store side effect 0) **and** caller 가 명시적으로 `useMruStore` 의 `markConnectionUsed(connectionId)` 호출 (selector subscription pattern). 두 call 의 순서는 의미상 동일 (둘 다 tab open 시점) — 권장 순서: `addTab` 먼저, `markConnectionUsed` 다음 (현 store action 내부 순서 답습).
- `caller` (e.g., `Sidebar` "+Query") → 동일 패턴 — `addQueryTab` + `markConnectionUsed` 순서 호출.
- `useQueryExecution.ts` (8 call sites) → tab 객체에서 paradigm/queryMode/database/collection/connectionId 직접 읽음 (`tab` 은 이미 hook arg) → `useQueryHistoryStore.addHistoryEntry({sql, executedAt, duration, status, source, connectionId, paradigm, queryMode, database, collection})` 직접 호출. Sprint 195 의 auto-extract 의미 보존, 다만 추출 위치가 store action 안 → caller hook 안.

### Optional intermediate: caller use-case hooks

선택적으로 `useOpenTableTab` / `useOpenQueryTab` hook 도입:
- `useOpenTableTab(connectionId): (tab) => void` — `addTab(tab) + markConnectionUsed(connectionId)` 묶음.
- `useOpenQueryTab(connectionId): (opts?) => void` — `addQueryTab(connectionId, opts) + markConnectionUsed(connectionId)` 묶음.
- 11 + 5 caller 가 수렴하면 marking 누락 회귀 (caller migration 미스) 위험 ↓.
- 선택 사항 — 도입하지 않고 각 caller 에서 직접 호출 묶는 것도 허용. trade-off: hook 도입 시 신규 파일 +2, 컴포넌트 boilerplate ↓; 직접 호출 시 신규 파일 0, 컴포넌트 의존성 noise ↑ (16 caller 에 `useMruStore` selector 추가).

### Cross-store dependency graph (post-sprint)

```
caller (component / hook)
  ├─→ useTabStore  (addTab / addQueryTab / 모든 actions)
  ├─→ useMruStore  (markConnectionUsed)
  └─→ useQueryHistoryStore (addHistoryEntry — useQueryExecution / SchemaTree drop / DocumentDataGrid drop / structure editors)

useTabStore  ←×  useMruStore  (cross import 0)
useTabStore  ←×  useQueryHistoryStore (cross import 0; type-only import 는 허용)
```

## UI States

본 sprint 는 store-level refactor 로 UI states 독립 — 사용자가 보는 상태가 변경되지 않는다. 모든 loading / empty / error / success 화면은 사전과 동일.

## Edge Cases

- **빠른 연속 tab open** (예: SchemaTree 에서 5개 table 을 빠르게 single-click): `addTab` 5회 + `markConnectionUsed` 5회. 마지막이 `recentConnections[0]` 에 위치 — 사전과 동일.
- **MRU sync race (cross-window)**: workspace 가 `markConnectionUsed("c1")` 호출 → mruStore 의 `recentConnections` 업데이트 → `mru-sync` channel 로 launcher window 에 broadcast. caller 가 `markConnectionUsed` 를 호출하든 store action 안에서 호출하든 broadcast 시점은 mruStore 내부 set 직후로 동일. 회귀 0.
- **Query cancel 후 즉시 재실행**: cancel 시점은 `cancelQuery(queryId)` Tauri call 한 번만 — history entry 발화 0 (사전과 동일). 재실행 시 새 queryId + 새 history entry — caller hook 이 직접 `addHistoryEntry` 호출, store-side stale-response guard 는 `completeQuery` / `failQuery` 에 그대로 보존.
- **DDL-only execution** (예: `CREATE TABLE`, `ALTER TABLE` 등 multi-statement script): `useQueryExecution` 의 multi-statement path 에서 statementResults 누적 + 마지막에 1개 history entry 만 추가 (사전과 동일). status 는 successCount === statements.length 기준 — 사전 의미 보존.
- **`recordHistory` 호출 이전 tab 이 닫힘** (race): 사전 store action 은 `tabs.find` 가 실패시 silent no-op (line 465). caller migration 후에는 `useQueryExecution` 이 `tab` arg 를 hook 외부에서 selector 로 읽으므로 tab 이 닫히면 hook 자체가 unmount → handleExecute 호출 자체가 unreachable. 동등하거나 더 안전.
- **tab 이 query tab 이 아닌데 `recordHistory` 호출** (사전 store action 의 type-guard, line 466): `useQueryExecution` 은 type-narrowed `QueryTab` 만 받으므로 (line 79: `tab: QueryTab`), 이 케이스는 caller 측에서 type system 으로 제거됨 — 더 안전.
- **Document mode tab + RDB connectionId 의 MRU mark race**: caller migration 시 paradigm 무관 — connectionId 만 mark. 사전과 동일.
- **`navigate-table` / `quickopen-function` event 가 connectionId 없이 dispatch**: 사전 App.tsx event handler 가 connectionId 를 detail 에서 읽음 — caller migration 시 동일 위치에서 markConnectionUsed 호출. detail 이 비어있으면 사전과 동일하게 no-op.

## Verification Hints

- 본 sprint 의 핵심 unit test 는 store-level test (`tabStore.test.ts`) 가 아니라 **통합 회귀 (component + hook integration)** 에서 보호됨. 회귀 안전망:
  1. `pnpm vitest run src/stores/tabStore.test.ts` — addTab/addQueryTab/lifecycle/persistence/sync 모두 통과 (recordHistory AC-195-03/AC-196-02 만 마이그레이션 영향).
  2. `pnpm vitest run src/stores/mruStore.test.ts` — 변경 0.
  3. `pnpm vitest run src/stores/queryHistoryStore.test.ts` — 변경 0.
  4. `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx src/__tests__/cross-window-connection-sync.test.tsx` — 변경 0.
  5. `pnpm vitest run src/components/layout/MainArea.test.tsx` — `AC-01/AC-04` MRU marking via CTA 통과 (line 666).
  6. `pnpm vitest run src/components/schema/SchemaTree.preview.test.tsx src/components/schema/SchemaTree.test.tsx` — single/double click + drop + rename + view + function-source 모두 통과.
  7. `pnpm vitest run src/components/query/QueryTab.test.tsx` (또는 `useQueryExecution` 관련 테스트) — 8 call site 의 history entry shape 검증.
  8. `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/schema/DocumentDatabaseTree.test.tsx` — collection open / drop / refresh path 통과.
  9. `pnpm vitest run` — 전체 suite 회귀.
  10. `pnpm tsc --noEmit` + `pnpm lint` — 모두 exit 0.

- **eslint-disable 제거 검증**:
  - `grep -nE "/\\* eslint-(disable|enable) no-restricted-imports \\*/" src/stores/tabStore.ts` — 0 매치.
  - `grep -n "useMruStore\\|useQueryHistoryStore" src/stores/tabStore.ts src/stores/tabStore/types.ts` — 매치 0 (단, types.ts 의 type-only import 는 type-only 표현 시 별도 처리, 또는 inline literal 로 대체).
  - `grep -nE "useMruStore\\|useQueryHistoryStore" src/stores/tabStore/persistence.ts src/stores/tabStore/tracker.ts` — 매치 0 (사전과 동일).
  - `git diff src/stores/tabStore.ts | grep "^+.*eslint-disable"` — 0 라인.

- **MRU marking caller migration 검증**:
  - `grep -rn "markConnectionUsed" src/ --include="*.ts" --include="*.tsx" | grep -v "src/stores/mruStore" | grep -v ".test."` — 16 caller 의 새 호출이 모두 잡혀야 함 (또는 `useOpenTableTab` / `useOpenQueryTab` hook 안에 1-2 호출만 잡힘 — hook 도입 시).
  - `grep -rn "markConnectionUsed" src/stores/ --include="*.ts"` — 매치는 `mruStore.ts` 의 정의 1건뿐.

- **History recording caller migration 검증**:
  - `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` — 매치 0.
  - `grep -rn "addHistoryEntry" src/components/query/QueryTab/useQueryExecution.ts` — 8 매치 (사전과 동일 횟수, 다만 caller pattern: `addHistoryEntry({...})` 직접 호출).

- **diff sanity**:
  - `git diff --stat src/stores/tabStore.ts src/stores/tabStore/types.ts` — 두 파일 모두 net `-` 라인 수가 net `+` 라인 수보다 큼 (코드 제거 > 추가).
  - `git diff --stat src/components/query/QueryTab/useQueryExecution.ts` — selector swap (recordHistory → addHistoryEntry) + payload 확장 8회 = 적당한 변경 수준 (~20-40 라인 추가/수정).
  - `git diff --stat src/App.tsx src/components/layout/MainArea.tsx src/components/layout/Sidebar.tsx src/components/rdb/DataGrid.tsx src/components/schema/DocumentDatabaseTree.tsx src/components/schema/SchemaTree/useSchemaTreeActions.ts` — 각 파일에 `useMruStore` selector + 1-6 markConnectionUsed 호출 추가.

- **`recordHistory` action 제거 검증** (AC-5 권장 path):
  - `grep -n "recordHistory" src/stores/tabStore.ts src/stores/tabStore/types.ts` — 매치 0 (또는 doc-comment 만, 정의 0).
  - `grep -rn "useTabStore.*recordHistory\\|s\\.recordHistory" src/ --include="*.ts" --include="*.tsx"` — 매치 0 (`useQueryExecution.ts` 의 기존 selector 도 제거됨).

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/stores/tabStore.ts
- /Users/felix/Desktop/study/view-table/src/stores/tabStore/types.ts
- /Users/felix/Desktop/study/view-table/src/components/query/QueryTab/useQueryExecution.ts
- /Users/felix/Desktop/study/view-table/src/components/schema/SchemaTree/useSchemaTreeActions.ts
- /Users/felix/Desktop/study/view-table/src/App.tsx
