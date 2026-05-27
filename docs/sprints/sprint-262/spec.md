# Sprint 262 Spec — Per-workspace state (workspaceStore, ADR 0027 구현)

## Feature Description

RDB workspace 의 사용자 상태 (tabs + sidebar) 를 `(connId, db)` 별로 분리해 저장한다. DbSwitcher 로 DB 를 바꾸면 사이드바뿐 아니라 탭 셋과 사이드바 expansion / scroll / selected 가 함께 swap 된다. 기존 `tabStore` 는 정직하게 `workspaceStore` 로 rename + 흡수 (병행 운영 안 함).

## Sprint Breakdown

단일 sprint (Sprint 262). 슬라이스 3 개:
1. **Slice A**: `workspaceStore` 신규 (응집 `WorkspaceState`, nested map, explicit API, lazy create, localStorage persistence) + 기존 `tabStore` 의 모든 caller 를 새 API 로 마이그레이션 + `tabStore.ts` + `tabStore/` 디렉토리 삭제. TDD vertical slice.
2. **Slice B**: Sidebar (SchemaTree) 의 `selectedNode` / `expanded` / `scrollTop` 을 workspaceStore 에 wire-up. DB 전환 시 자동 swap 검증.
3. **Slice C**: 회귀 가드 (frontend 전체 test + tsc + lint + Rust clippy).

## Acceptance Criteria

### AC-262-01 — ADR 0027 + spec lock

- `docs/archives/decisions/0027-per-workspace-state-store/memory.md` 작성.
- `docs/archives/decisions/memory.md` 인덱스 entry 추가.
- 본 spec 작성.
- **상태**: 완료 (sprint 첫 작업).

### AC-262-02 — `workspaceStore` 신규 + 자료구조

#### Shape

```ts
type SidebarState = {
  selectedNode: string | null;
  expanded: string[];   // 순서 보존 — Set 대신 array (localStorage round-trip 단순)
  scrollTop: number;
};

type WorkspaceState = {
  tabs: Tab[];
  activeTabId: string | null;
  closedTabHistory: Tab[];
  dirtyTabIds: string[];     // localStorage round-trip 위해 Set → array
  sidebar: SidebarState;
};

interface WorkspaceStoreState {
  workspaces: Record<string /*connId*/, Record<string /*db*/, WorkspaceState>>;
}
```

- `closedTabHistory`, `dirtyTabIds` 도 per-workspace 의미로 이동 (Q3 의 응집 객체 원칙).
- localStorage key: `table-view-workspaces` (기존 `table-view-tabs` 와 분리, 충돌 없음).

#### Action 시그니처 (모두 explicit `(connId, db)` — Q7 'a')

```ts
// Tab actions
addTab(connId: string, init: Omit<TableTab, "id" | "isPreview"> & { permanent?: boolean }): void;
addQueryTab(connId: string, db: string, opts?: {...}): void;
removeTab(connId: string, db: string, tabId: string): void;
setActiveTab(connId: string, db: string, tabId: string): void;
setSubView(connId: string, db: string, tabId: string, subView: TabSubView): void;
promoteTab(connId: string, db: string, tabId: string): void;
updateTabSorts(connId: string, db: string, tabId: string, sorts: SortInfo[]): void;
setTabDirty(connId: string, db: string, tabId: string, dirty: boolean): void;
moveTab(connId: string, db: string, fromId: string, toId: string, position?: "before" | "after"): void;
reopenLastClosedTab(connId: string, db: string): void;

// Query lifecycle
updateQuerySql(connId: string, db: string, tabId: string, sql: string): void;
updateQueryState(connId: string, db: string, tabId: string, state: QueryState): void;
setQueryMode(connId: string, db: string, tabId: string, mode: QueryMode): void;
completeQuery(connId: string, db: string, tabId: string, queryId: string, result: QueryResult): void;
failQuery(connId: string, db: string, tabId: string, queryId: string, errorMessage: string): void;
completeMultiStatementQuery(connId: string, db: string, tabId: string, queryId: string, payload: {...}): void;
completeQueryDryRun(connId: string, db: string, tabId: string, queryId: string, result: QueryResult, statements?: QueryStatementResult[]): void;
loadQueryIntoTab(payload: {...}): void;  // 내부에서 active workspace 의 db resolve

// Sidebar actions
setSelectedNode(connId: string, db: string, nodeId: string | null): void;
toggleExpand(connId: string, db: string, nodeId: string): void;
setExpanded(connId: string, db: string, nodes: string[]): void;
setScrollTop(connId: string, db: string, px: number): void;

// Cleanup
clearForConnection(connId: string): void;

// Persistence
loadPersistedWorkspaces(): void;
```

#### Read selector 헬퍼

```ts
// Component 가 workspaceStore + connectionStore 를 glue
function useCurrentWorkspaceKey(): { connId: string; db: string } | null;
function useCurrentWorkspace(): WorkspaceState | null;
function useWorkspaceFor(connId: string | null, db: string | null): WorkspaceState | null;
```

#### TDD vertical slice (tracer bullet → 증분)

1. **트레이서 불릿**: `addTab((conn1, dbA), { type: "table", schema: "public", table: "users" })` → `workspaces[conn1][dbA].tabs` 가 그 탭 한 개 + `activeTabId === tab.id`.
2. **다중-DB 격리**: `addTab((conn1, dbA), ...)` 후 `addTab((conn1, dbB), ...)` → 두 workspace 가 독립적 (각자 자기 tab 만).
3. **`closeTab`**: 활성 탭 닫으면 마지막 남은 탭이 새 active, 모두 닫히면 active = null.
4. **`setActiveTab`**: 같은 workspace 안의 다른 탭 id 로 전환.
5. **`clearForConnection`**: `workspaces[connId]` 전체 삭제, 다른 conn 은 영향 없음.
6. **Sidebar `toggleExpand`**: lazy 생성 + `expanded` 배열 toggle.
7. **Sidebar `setScrollTop`**: 특정 workspace 의 scrollTop 만 변경.
8. **Persistence round-trip**: action 호출 → debounce → localStorage 저장 → `loadPersistedWorkspaces` 시 복원.
9. **Lazy 생성 + 빈 읽기**: 한 번도 쓴 적 없는 (conn, db) 의 selector 결과는 `null`.

### AC-262-03 — `tabStore` caller 마이그레이션

기존 `useTabStore` import 가 frontend 전체에서 `useWorkspaceStore` (또는 헬퍼 훅) 로 치환된다. Caller 마이그레이션은 단일 commit 으로 atomic — 병행 API 가 잠시라도 살아 있는 시간 없음.

영향 영역 (사전 식별):
- `src/stores/tabStore.ts` (700 줄) — 삭제.
- `src/stores/tabStore/` 디렉토리 (types.ts / persistence.ts / tracker.ts) — `Tab` union 등 type 만 새 store 옆으로 이동, 나머지 삭제.
- `src/stores/tabStore.*.test.ts` 7 개 — `workspaceStore.*.test.ts` 로 rename + nested key 컨텍스트 반영해 재작성.
- `src/components/workspace/TabBar*` — active tab 읽기 / 전환 / drag 모두 새 API.
- `src/components/datagrid/**` — `setTabDirty`, `updateTabSorts`, `setSubView`, `promoteTab` 호출.
- `src/components/query/**` — `addQueryTab`, `updateQuerySql`, `completeQuery`, `failQuery`, `loadQueryIntoTab` 등.
- `src/hooks/**` — query lifecycle 훅 다수.
- `src/stores/queryHistoryStore.ts` 와의 통합 (있다면) — `loadQueryIntoTab` payload 시그니처 호환.
- E2E test fixtures (workspaceStore 의존하면 새 API 로 갱신).

### AC-262-04 — `tabStore` 삭제

위 마이그레이션 commit 안에서 동시에:
- `src/stores/tabStore.ts` 삭제.
- `src/stores/tabStore/persistence.ts` — `resolveActiveDb` 만 `src/stores/workspaceStore/resolveActiveDb.ts` 등으로 분리 후 그 외 삭제.
- `src/stores/tabStore/tracker.ts` — 기능 보존 필요시 `workspaceStore/tracker.ts` 로 이동.
- `src/stores/tabStore/types.ts` — `Tab` union, `TabSubView`, `TabObjectKind`, `QueryMode` 는 `src/stores/workspaceStore/types.ts` 로 이동.
- localStorage `table-view-tabs` 데이터는 자동 삭제 안 함 (사용자 fossil 로 유지).

### AC-262-05 — Sidebar state wire-up (Slice B)

SchemaTree 컴포넌트 (정확 경로는 Slice B 진입 시 식별):
- `selectedNode` / `expanded` / `scrollTop` 을 `workspaceStore` 에서 read/write.
- DbSwitcher → derived workspace key 변경 → 컴포넌트 re-render → 새 workspace 의 sidebar state 로 자동 swap.
- 첫 방문 (lazy 미생성) workspace 는 selected = null, expanded = [], scrollTop = 0 default.

테스트:
- DB 전환 시 sidebar expanded state 가 swap 되는지 (vitest + RTL).
- 같은 conn 의 db1 → db2 → db1 로 돌아왔을 때 db1 의 expanded 가 보존.

### AC-262-06 — 회귀 가드

- frontend tests baseline 3264 (sprint-261 후) 유지 또는 증가.
- Rust tests baseline 변화 없음 (이번 sprint 는 frontend-only).
- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0 (변경 없지만 회귀 확인).

## Out of Scope (Sprint 263+ 또는 별도 backlog)

- **Mongo workspace 의 (db, collection) 별 상태 분리**: 본 sprint 는 RDB 한정. Mongo 는 (connId, db) 까지만 nesting (collection level 분리는 별도 결정).
- **Workspace 명시적 닫기 UI**: orphan workspace 누적은 본 sprint 에서 자동 정리 없음. 별도 "house-keeping" 패널 (orphan 목록 + 일괄 정리) 필요시 향후.
- **DB drop server-side 감지 시 cleanup** (Q5 'c' 옵션): 본 sprint 는 connection 삭제 시에만 cleanup.
- **`table-view-tabs` 의 자동 정리**: fossil 로 유지 (롤백 안전망).
- **Cross-window workspace 동기화 강화**: 현재 localStorage + 윈도우 focus hydration 패턴 그대로. 실시간 broadcast 는 별도 sprint.

## Sprint Schedule / Slicing

1. **Slice A** (workspaceStore + tabStore 흡수): 새 store TDD 정원 슬라이스 + 단일 commit 으로 caller 마이그레이션 + 구 tabStore 삭제. (2-3 일)
2. **Slice B** (Sidebar state): SchemaTree 컴포넌트의 selected/expanded/scrollTop wire-up + DB swap 시나리오 테스트. (반-1 일)
3. **Slice C** (회귀): 전체 frontend test + tsc + lint + Rust clippy. (반 일)

총 약 3-4 일.
