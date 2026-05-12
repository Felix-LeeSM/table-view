# Sprint 262 — Handoff

Date: 2026-05-12
Status: PASS

## Sprint identifier

Sprint 262 — `tabStore` → `workspaceStore` rename + 흡수. RDB workspace 의
사용자 상태 (tabs + sidebar) 를 `(connId, db)` 키로 분리한 응집
`WorkspaceState` 에 저장. DbSwitcher 로 DB 를 바꾸면 탭 셋과 sidebar
expansion / scroll / selected 가 함께 swap 된다. ADR 0027 구현.

## Contract

- `docs/sprints/sprint-262/spec.md` (locked at session start, 2026-05-12).
- `memory/decisions/0027-per-workspace-state-store/memory.md` (ADR 0027).

## Implementation under review

본 sprint 는 3 commit 으로 분할.

### Commit 1 — `11bad57` (Slice A part 1: 신규 store + TDD)

`workspaceStore` 신규. 응집 `WorkspaceState`, nested
`Record<connId, Record<db, WorkspaceState>>` map, explicit-API (모든 mutating
action 이 `(connId, db)` 받음 — Q7 'a' lock), lazy create (`withWorkspace`
helper), localStorage persistence (`table-view-workspaces` 키), TDD vertical
slice 19 케이스 (lifecycle / persistence / selectors / sidebar 4 axis
파일).

#### Files
- `memory/decisions/0027-per-workspace-state-store/memory.md` (신규).
- `memory/decisions/memory.md` (index entry).
- `docs/sprints/sprint-262/spec.md` (신규).
- `src/stores/workspaceStore.ts` (신규, 902 줄).
- `src/stores/workspaceStore/types.ts` (신규, 214 줄).
- `src/stores/workspaceStore/persistence.ts` (신규, 97 줄).
- `src/stores/workspaceStore.lifecycle.test.ts`,
  `workspaceStore.persistence.test.ts`,
  `workspaceStore.selectors.test.ts`,
  `workspaceStore.sidebar.test.ts` (신규).
- `eslint.config.js` — `no-restricted-imports` 가 `src/stores/**/*.ts` 안에서
  cross-store import 를 막도록 강화.

### Commit 2 — `5ee9a58` (Slice A part 2: atomic caller migration + `tabStore` 삭제)

기존 `useTabStore` import 가 frontend 전체에서 `useWorkspaceStore` (또는 헬퍼 훅) 로 일괄 치환. 병행 API 없이 atomic.

#### Production migration (28 callsites)
TabBar / Sidebar / DataGrid / DocumentDataGrid / QueryEditor /
QueryHistory / useQueryExecution / useDataGridEdit / connectionStore / ...
모두 explicit `(connId, db)` action 으로 전환. cross-window IPC bridge
채널 `tab-sync` → `workspace-sync` 전환, payload `{tabs, activeTabId}` →
`{workspaces}`.

#### Test migration (50+ files)
flat `useTabStore.getState()` 읽기 → `getTestWorkspace(connId, db)` 또는
`getAllTabsForConnection(connId)` 로 전환. `seedWorkspace` helper 가
`firstTab.connectionId` + `firstTab.database` 에서 (connId, db) 를 자동
파생하도록 보강 (test 작성 부담 최소화). `setState` 콜의 mock arity 를 4-arg
explicit-API 에 맞춰 갱신 (DataGrid sort / promote / edit).

#### `tabStore` 디렉토리 완전 삭제
`tabStore.ts` (701 줄), `tabStore/persistence.ts`, `tabStore/types.ts`,
`tabStore/tracker.ts`, 7 개 `tabStore.*.test.ts` 파일 모두 삭제. 의미 있는
type 은 `workspaceStore/types.ts` 로 흡수. `resolveActiveDb` 는
`workspaceStore.ts` 안에 살아남음 (autofill path 가 그대로 필요).

#### 부수 발견 / 수정
- **Preview-slot 매칭 production bug** — `addTab` 의 preview-slot 재사용 조건이 `connectionId` 일치 체크를 잃어버려, 다른 connection 의 preview 가 우연히 덮어써질 수 있었음. legacy `tabStore` 의 의도를 복원 (코드주석 참조: `workspaceStore.ts:182-189`).
- **Obsolete cross-db preview-swap 테스트 2건 삭제** — DocumentDatabaseTree.test 의 "global preview swap across DBs" 시나리오는 ADR 0027 의 per-database preview 의미와 충돌. per-database preview 의미를 단언하는 두 테스트로 rewrite.

### Commit 3 — `109dd33` (Slice B: sidebar wire-up)

SchemaTree 의 `selectedNode` / `expanded` / `scrollTop` 을 component-local
`useState` 에서 `workspaceStore.sidebar` axis (per-`(connId, db)`) 로
이전. DbSwitcher 가 activeDb 를 바꾸면 derived workspace key 가 새로
잡혀 sidebar 가 자동 swap, 같은 workspace 로 복귀하면 직전 상태가 보존.

#### Files
- `src/stores/workspaceStore.ts` — `useWorkspaceKeyForConnection(connId)`
  셀렉터 추가. SchemaTree 가 prop 으로 받는 connection 의 workspace key
  를 explicit 으로 해석 (focused conn 과 일치하지 않는 transient race 시에도 정확한 슬롯 가리킴).
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  - `expandedSchemas` / `selectedNodeId` useState 폐기 → store-backed
    selector + ref-stable setter wrapper. ref-stable 이유: workspace key
    가 바뀔 때 setter identity 가 같이 바뀌면 mount effect 의 deps 가
    re-fire 하면서 user collapse 가 매 swap 마다 덮어써짐.
  - session-scoped `seededKeysRef` — fresh-workspace 첫 진입에서만 "모든
    스키마 expanded" 시드. 같은 인스턴스로 다시 진입하면 user 상태 보존.
- `src/components/schema/SchemaTree.tsx` — 중복 auto-expand effect 제거,
  scrollTop wire 는 신규 hook 으로 분리.
- `src/hooks/useSidebarScrollPersistence.ts` (신규) — workspace key 변경 시
  one-shot 복원 + 스크롤 이벤트마다 store write. lint rule
  `no-restricted-syntax` 가 `.tsx` 에서 `store.getState()` 직접 호출을
  막기 때문에 hook 으로 분리.
- `src/stores/__tests__/workspaceStoreTestHelpers.ts` — `seedWorkspace` 가
  mid-test 두 번째 호출 시 prior sidebar/closedTabHistory/dirtyTabIds 를
  보존하도록 보강. tabStore 시절엔 sidebar 가 store 에 없어서 무관했지만
  Slice B 이후 mid-test re-seed 가 sidebar 를 wipe 하던 문제 차단.
- `src/components/schema/SchemaTree.workspace-state.test.tsx` (신규, 3
  케이스) — db1 collapse → db2 swap → db1 swap-back 시 collapse 보존,
  함수 클릭 → `selectedNode` 기록, 스크롤 → scrollTop persist + remount
  복원.

## Verification evidence

### Static / lint / type
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` — exit 0.

### Tests
- `pnpm vitest run` — **3179 passed (257 files)**. Sprint 261 (3178) +1
  (Slice B 의 신규 workspace-state 테스트 3 케이스 — 단 단일 신규 파일).
  Slice A 의 net 변화: tabStore 7 개 test 파일 삭제, workspaceStore 4 개
  test 파일 + 50+ 기존 caller test 마이그레이션 (대부분 in-place
  rewrite). 케이스 수는 비슷한 수준 유지.
- `cargo test` — **회귀 0** (667 + 31 + 32 + 12 + 11 + 3 + …). 본 sprint
  는 frontend-only.

## Acceptance Criteria coverage

| AC | Status |
|----|--------|
| AC-262-01 ADR 0027 + spec lock | ✓ |
| AC-262-02 `workspaceStore` 신규 + 자료구조 + TDD 9 케이스 | ✓ |
| AC-262-03 `tabStore` caller 마이그레이션 (atomic) | ✓ |
| AC-262-04 `tabStore` 디렉토리 삭제 | ✓ |
| AC-262-05 Sidebar state wire-up (selectedNode/expanded/scrollTop) + DB swap 보존 | ✓ |
| AC-262-06 회귀 가드 (vitest / tsc / lint / clippy) | ✓ |

## Verdict

**PASS.** ADR 0027 의 (connId, db) 응집 workspace state 마이그레이션
종료. tabStore 의 700 줄이 workspaceStore 의 902 줄 (sidebar axis 흡수
포함) 로 정직하게 rename + 흡수됐고, 50+ caller 가 explicit-API 로 일괄
전환됐으며, sidebar 상태가 per-workspace 로 분리되어 DbSwitcher 전환 시
탭 셋과 함께 자연스럽게 swap 된다. 병행 운영 0, fossil `table-view-tabs`
로컬스토리지 키는 롤백 안전망으로 유지.

## Follow-up — Sprint 263+ (spec 의 Out of Scope 항목 + Slice 진행 중 발견)

1. **Mongo workspace 의 (db, collection) 별 상태 분리** — 본 sprint 는 RDB
   한정. Mongo 는 (connId, db) 까지만 nesting (collection level 분리는 별도
   결정).
2. **Workspace 명시적 닫기 UI** — orphan workspace 누적 자동 정리 없음.
   "house-keeping" 패널 (orphan 목록 + 일괄 정리) 가 필요해질 시점에
   별도 sprint.
3. **DB drop server-side 감지 시 cleanup** — 본 sprint 는 connection 삭제
   시에만 cleanup. server 측 DB drop 자동 감지는 별도.
4. **`table-view-tabs` 의 자동 정리** — fossil 로 유지 (롤백 안전망). 충분
   기간 후 별도 sprint 에서 일괄 삭제.
5. **Cross-window workspace 동기화 강화** — 현재 localStorage + 윈도우
   focus hydration + IPC bridge `workspace-sync` 패턴 그대로. 실시간
   broadcast 의 정합성 강화는 별도.
6. **`useSchemaCache` 의 (connId, db) 별 분리** — Slice B 진행 중 발견:
   현재 schema cache 는 connection-keyed. DB 마다 schema 셋이 다른
   환경에선 db1 의 캐시가 db2 로 누설될 수 있음. 본 sprint 는 sidebar
   상태만 격리 — schema cache 의 db-aware 화는 별도 sprint.
7. **`expandedCategories` / `tableSearch` 의 per-workspace 화** — 본
   sprint 는 sidebar 의 3 axis (selectedNode/expanded/scrollTop) 만
   wire-up. category-level expansion 과 table search filter 는 여전히
   component-local. 필요성 평가 후 별도.
8. **`activeSchema` auto-expand 의 라운드트립 동작** — DB 전환 후 복귀시
   active tab 의 schema 가 자동 재expand 되는 entrance 효과는 user 의
   explicit collapse 와 미세하게 충돌 가능. 본 sprint 는 무 test
   시나리오에선 무해해서 그대로 유지. UX 보고가 들어오면 별도.
