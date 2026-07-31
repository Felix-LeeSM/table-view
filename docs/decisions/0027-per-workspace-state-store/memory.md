---
id: 0027
title: Per-workspace state — workspaceStore (tabStore 흡수) keyed by (connId, db) with explicit-API
status: Accepted
date: 2026-05-12
supersedes: null
superseded_by: null
---

**결정**: RDB workspace 의 사용자 상태 (open tabs, active tab, sidebar 의 selected node / expanded nodes / scroll position) 를 `(connId, database)` 키로 분리된 응집 객체 (`WorkspaceState`) 에 저장한다. 기존 `tabStore` 는 새 `workspaceStore` 로 rename + 흡수 — 두 store 분리하지 않음. 자료구조는 `workspaces: Record<connId, Record<db, WorkspaceState>>` 의 2-level nested map. 모든 mutating action 은 explicit `(connId, db)` 받는다 (tab-id targeted 액션도 명시적으로 받음 — Q7 'a' lock 으로 결정). 현재 active workspace 식별자는 `connectionStore` 에서 derive (`focusedConnId` + `activeStatuses[focusedConnId].activeDb`) — `workspaceStore` 는 그 자체로 active key 를 보유하지 않는다. workspace 생성은 lazy (첫 쓰기 액션 시점에 entry 생성, 읽기는 `undefined` 가능). cleanup 은 `clearForConnection(connId)` 단 하나로 connection 삭제 시에만. 기존 `table-view-tabs` flat localStorage 는 migrate 하지 않고 새 key `table-view-workspaces` 에 nested 로 시작 — 업데이트 사용자는 탭 상태를 잃는다 (의도적 트레이드오프).

**이유**:

(1) **DB 별 컨텍스트 격리**: 한 connection 안에서 db A 와 db B 는 별개 스키마/테이블 셋. 같은 탭 셋 / 같은 sidebar expansion 을 공유하면 사용자가 "이 탭은 어느 DB?" 를 매번 추리해야 함. (connId, db) 키 분리 = DB 전환 = workspace 전환.

(2) **응집 객체 (Q6 'c')**: tabs 와 sidebar 는 같은 `workspaceKey` + 같은 lifecycle (workspace 시작 시 함께 등장, 정리 시 함께 사라짐) + UI 결합 (sidebar selected → tab open) 이라 한 객체 안에 둠. 평행 map (`Record<key, Tab[]>` + `Record<key, SidebarState>`) 로 쪼개면 key 동기화 부담 발생.

(3) **tabStore 분리 안 함 (Q3)**: tabStore 와 workspaceStore 의 분리는 인위적. `dataGridEditStore` 는 lifecycle (commit/discard 까지) + key (`(conn, db, schema, table, row)`) 가 달라서 분리 정당화되지만, workspace 의 tabs/sidebar 는 그 축들이 모두 동일. 통합 후 정직하게 `workspaceStore` 로 rename.

(4) **`(connId, db)` nested vs flat string key (Q6 'c' vs 'a')**: DB 이름은 임의 문자열 (밑줄, 콜론, 공백 포함 가능) — separator 기반 flat key 는 충돌 위험. Nested 2-level 은 separator 자체가 필요 없음. `delete workspaces[connId]` 한 줄 cleanup 가능.

(5) **Explicit API (Q7 'a')**: ambient context (현재 focused workspace) 를 store 가 내부적으로 derive 하면 race condition 위험 — caller 가 action 발동하는 순간과 DbSwitcher / focused conn 변경이 동시 발생 시 의도와 다른 workspace 에 작용. callsite 에서 explicit `(connId, db)` 전달 = 그 클래스 버그 원천 차단. tab-id targeted 액션도 explicit 으로 통일 — "모든 걸 매번 derive" 가 mental model 로 가장 단순.

(6) **Derived active workspace (Q4 'a')**: 같은 사실 (focused conn + active DB) 이 두 store 에 있으면 drift. Single source: `connectionStore`. workspaceStore selector 가 그 두 값을 읽어 현재 key 계산.

(7) **Lazy create (Q9 'a')**: connect / DB switch 시점에 빈 workspace 를 seed 안 함. 첫 쓰기 액션이 lazy create 책임. seed-on-event 누락 클래스 버그 원천 차단. workspace 존재 = 사용자가 그 (conn, db) 에서 무언가 한 적 있음.

(8) **No migration (Q8 'c')**: 기존 `table-view-tabs` 의 flat shape 을 nested 로 변환하지 않음. 새 key `table-view-workspaces` 에 빈 상태로 시작. flat 데이터는 localStorage 에 fossil 로 남음 (롤백 안전망). 사용자 한 명당 평균 탭 수 적고, migrate 코드 복잡도 (db resolution race, connection async hydrate) > 손실 비용.

**트레이드오프**:

**장점**:
- DB 전환 시 자동 컨텍스트 swap (탭 셋 + 사이드바 상태) — TablePlus / DataGrip 패리티.
- `clearForConnection` 한 줄 cleanup.
- Workspace 좌표가 callsite 에서 항상 명시적 → 디버깅 시 "어느 workspace?" 즉시 확인 가능.
- workspaceStore 자체는 connectionStore 미의존 — write 쪽 cross-store 의존 0. Read 쪽만 component 가 두 store 를 glue.

**단점**:
- 기존 `useTabStore` caller 가 많아 (700+ 줄 store, 7 개 test file, 다수 component) big-bang 마이그레이션 위험. 단일 sprint 안에서 atomic 으로 처리 필요.
- 업데이트 사용자는 기존 탭 상태 손실 (Q8 'c' lock — 트레이드오프 수용).
- Sidebar 의 selected/expanded/scroll 은 신규 도입 → SchemaTree component 의 prop drilling / hook 추가 필요.
- `addTab(connId, init)` 의 db 결정 path: `init.database ?? resolveActiveDb(connId)` — resolveActiveDb 의 cross-store 의존 (connectionStore lookup) 은 기존 `tabStore.persistence.ts` 에서 유지. eslint exemption 동반.

**구현 위치**:

1. **새 `src/stores/workspaceStore.ts`**: 응집 `WorkspaceState` + nested `workspaces` map + explicit API (`addTab(connId, init)`, `closeTab(connId, db, tabId)`, `setActiveTab(connId, db, tabId)`, `toggleExpand(connId, db, nodeId)`, `setSelectedNode(connId, db, nodeId)`, `setScrollTop(connId, db, px)`, `clearForConnection(connId)`, ...) + lazy create + localStorage persistence (`table-view-workspaces`).

2. **`useCurrentWorkspace()` / `useCurrentWorkspaceKey()` 셀렉터 훅** (`src/hooks/` 또는 `workspaceStore` co-located): `connectionStore` 의 focusedConnId + activeDb 에서 derive.

3. **`tabStore.ts` + `tabStore/` 디렉토리 삭제**: 모든 caller 를 `workspaceStore` API 로 일괄 마이그레이션 (병행 운영 X). 기존 `closedTabHistory`, `dirtyTabIds` 도 `WorkspaceState` 내부로 흡수 (per-workspace 의미가 맞음).

4. **Sidebar 컴포넌트 (`src/components/sidebar/` 추정)**: `selectedNode` / `expanded` / `scrollTop` 을 `workspaceStore` 에서 read/write. DbSwitcher 변경 → derived current workspace key 변경 → sidebar 가 새 workspace 의 sidebar state 로 자동 swap.

**관련**:

- Sprint 262 spec — AC-262-01..06 구현.
- ADR 0003 (focusedConnId store) — workspaceStore 의 active key derivation 이 의존.
- ADR 0002 (Zustand 분리 컨벤션) — 본 ADR 이 그 컨벤션을 lifecycle + persistence + key 축으로 명시화.
- Sprint 261 / ADR 0026 — 직전 sprint. 본 sprint 와 무관 (read-path / wire 정밀도).

**관련 코드**:

- `src/stores/tabStore.ts` (700 줄, 흡수 대상)
- `src/stores/tabStore/types.ts` (Tab union, TabState interface — 일부 WorkspaceState 로 이동)
- `src/stores/tabStore/persistence.ts` (resolveActiveDb 유지, STORAGE_KEY 변경)
- `src/stores/connectionStore.ts` (focusedConnId + activeStatuses — workspaceStore 가 read-only 의존)
- `src/components/workspace/DbSwitcher.tsx` (활성 DB 변경 → derived workspace key 자동 swap)
- Sidebar 컴포넌트 — Slice B 에서 식별 + wire-up
