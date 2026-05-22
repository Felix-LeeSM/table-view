# Risk Register — Table View

잔여 위험 단일 추적 문서. 스프린트 handoff를 다시 읽지 않아도 됨.

Last updated: 2026-05-22 (Sprint 433 — RISK-039 resolved)

## Summary

| Status    | Count |
|-----------|-------|
| Active    | 28    |
| Resolved  | 12    |
| Deferred  | 1     |
| **Total** | **41** |

---

## Risk Register

| ID       | Description                                                                             | Status    | Area              | Origin Sprint | Resolution Note                                           |
|----------|-----------------------------------------------------------------------------------------|-----------|-------------------|---------------|-----------------------------------------------------------|
| RISK-001 | fetchData 경쟁 조건 (DataGrid)                                                          | resolved  | frontend/logic    | 5, 11         | Sprint 12 — fetchIdRef counter pattern applied            |
| RISK-002 | loadTables 실패 시 loadingTables 상태 미해제                                            | resolved  | frontend/logic    | 7             | Sprint 11 — `.catch().finally()` applied                  |
| RISK-003 | handleRefresh loadSchemas 실패 시 loadingSchemas 미해제                                 | resolved  | frontend/logic    | 7             | Sprint 11 — `.catch().finally()` applied                  |
| RISK-004 | connectionId 변경 시나리오 미테스트                                                     | resolved  | frontend/testing  | 7             | Sprint 11 — test added                                    |
| RISK-005 | row_count: 0 엣지 케이스 미검증                                                        | resolved  | frontend/testing  | 7             | Sprint 11 — test added                                    |
| RISK-006 | Backend tests couldn't run in environment                                               | resolved  | ci                | 0             | CI now runs all test jobs with proper services            |
| RISK-007 | test-setup.ts TypeScript build error                                                    | resolved  | frontend/testing  | 0             | Fixed in subsequent sprints                               |
| RISK-008 | commands/connection.rs async commands (connect, disconnect, keep_alive_loop) untested — needs Tauri AppHandle mock | active    | backend           | 14            | —                                                         |
| RISK-009 | 오버레이 pointer-events 미설정 — refetch 중 테이블 조작 가능 (P3)                       | resolved  | frontend/ui       | 5, 11         | Sprint 176 — overlay swallows mouseDown/click/doubleClick/contextmenu in DataGridTable + DocumentDataGrid |
| RISK-010 | 포트 5432 로컬 충돌 — env var 오버라이드로 부분 해결                                    | active    | infra             | 16            | —                                                         |
| RISK-011 | CSS class명 의존 어설션 — refactoring 시 깨질 수 있음                                   | active    | frontend/testing  | 5, 8          | —                                                         |
| RISK-012 | Mod-Enter 테스트 jsdom 한계 (keymap 직접 호출)                                         | active    | frontend/testing  | 6             | —                                                         |
| RISK-013 | MainArea 자식 컴포넌트 전체 모킹 (prop 계약 미감지)                                    | active    | frontend/testing  | 6             | —                                                         |
| RISK-014 | 테마 아이콘 SVG 구별 불가                                                               | active    | frontend/testing  | 8             | —                                                         |
| RISK-015 | ConnectionConfigLike 타입 프로덕션과 중복                                               | active    | frontend/testing  | 8             | —                                                         |
| RISK-016 | draggedConnectionId 모킹 간접성/취약성                                                 | active    | frontend/testing  | 9, 10         | —                                                         |
| RISK-017 | skip 패턴 불일치 (query vs schema integration)                                          | active    | backend/testing   | 16            | —                                                         |
| RISK-018 | MySQL 어댑터 미구현 — Phase 17 (Sprint 251-256) 진입 전 Sprint 250이 seeding 인프라(docker-compose `mysql:8.0` + `e2e/fixtures/seed.mysql.sql` + `scripts/fixtures/mysql.ts` + `scripts/db/wait.sh` MySQL 분기 + `tests/common::mysql_test_config`) 추가. 어댑터 자체는 미구현 — Phase 17 closure 시 RISK resolved. | active    | backend           | 16            | Sprint 250 — seeding 인프라 추가; 어댑터 본체는 Sprint 253 |
| RISK-019 | Schema integration 12개 테스트 CI에서 Docker DB 필요                                    | active    | ci                | 14–16         | CI passes with GitHub service containers; local-dev only  |
| RISK-020 | E2E macOS 미지원 (tauri-driver WKWebView limitation)                                    | deferred  | ci                | 15            | —                                                         |
| RISK-021 | CHECK constraint 표현식 raw SQL 전달 (DB 관리 도구이므로 의도적)                        | active    | backend           | 22            | By design — DB 관리 도구에서 raw SQL 의도적                |
| RISK-022 | E2E 우클릭 미지원 (tauri-driver W3C Actions API 미구현) — 3개 context menu 테스트 skip  | active    | e2e               | E2E 안정화    | tauri-driver 한계; skip 처리                               |
| RISK-023 | E2E 테스트 상태 격리 부족 (maxInstances: 1, 같은 앱 인스턴스 재사용)                      | active    | e2e               | E2E 안정화    | beforeEach에서 상태 복구 필요                              |
| RISK-024 | fireEvent 호출 act() 미래핑 — React state update 경고 가능                              | resolved  | frontend/testing  | 24–40         | act() 래핑 적용 완료                                      |
| RISK-025 | Multi-window split (launcher 720×560 fixed / workspace 1280×800 resizable) phase 12 이월 — single-window stub으로 lifecycle invariants만 잠금 | resolved  | frontend/architecture | 149       | Sprint 150–155 — Phase 12 종결, launcher/workspace 분리 + cross-window IPC sync 완성, ADR 0012가 0011을 supersede |
| RISK-026 | 72 테마 × light/dark의 WCAG AA 실측 미완 — `pnpm contrast:check` baseline 후 axe-devtools/Stark 실측 필요 (구 UI-FU-01) | active | frontend/a11y | UI eval | 종결: 모든 페어 4.5:1 이상 또는 allowlist 사유 등재 |
| RISK-027 | SchemaTree 대량 DB(1k/10k 테이블) 스크롤 FPS 미실측 (구 UI-FU-02) | active | frontend/perf | UI eval | 종결: 1k≥60FPS, 10k≥45FPS 또는 가상화 path DOM 행 ≤ 200 |
| RISK-028 | DataGrid page size 1000 마우스 휠 지연 미실측 (구 UI-FU-03) | active | frontend/perf | UI eval | 종결: 휠→paint latency ≤16ms, DOM `<tr>` ≤101 |
| RISK-029 | VoiceOver/NVDA 발화 경로(Quick Open / DataGrid / SchemaTree) 미검증 (구 UI-FU-04) | active | frontend/a11y | UI eval | 종결: combobox/grid/tree가 명사+상태 형태로 발화, ARIA가 SR에서 일관 작동 |
| RISK-030 | 창 최소 크기(1024×600)에서 Sidebar MAX + Dialog 겹침 미검증 (구 UI-FU-05) | active | frontend/ui | UI eval | 종결: 1024×600에서 X/액션 버튼 미클리핑, Esc/outside-click 동작 |
| RISK-031 | Cmd+Shift+I가 Tauri prod 빌드에서 DevTools와 충돌하는지 미검증 (구 UI-FU-06) | active | tauri | UI eval | 종결: 단일 동작만 수행 또는 키바인딩 재배정 |
| RISK-032 | `MainArea.tsx` EmptyState의 MRU 정책 도입 여부 미결정 (구 UI-FU-07) | active | frontend/ux | UI eval | 종결: MRU 도입/미도입 결정 + 근거 |
| RISK-033 | Sprint 67 이후 Mongo 편집 경로 P0 milestone 미정 (read-only banner / partial / full CRUD) (구 UI-FU-08) | active | frontend/ux | UI eval | 종결: ADR 또는 roadmap 항목 존재 + paradigms 메모 반영 |
| RISK-034 | `pendingEditErrors` 좁은 컬럼 표시 거동 미검증 (구 UI-FU-09) | active | frontend/ui | UI eval | 종결: 메시지 미클리핑 또는 hover/tooltip 접근 가능 |
| RISK-035 | `StructurePanel` 첫 렌더에 "No columns found" 깜빡임 가능성 — `loading` 초기값 false, `hasFetched` 도입 안 됨 (구 REVIEW-P2P1 B1; 2026-04-30 검증: B2/B3/B4는 해결됨) | resolved  | frontend/ui       | P2 P1 review  | Sprint 176 — `hasFetchedColumns/Indexes/Constraints` 게이트가 첫 fetch settle 이전 empty-state 노출 차단 |
| RISK-036 | pre-push e2e 게이트가 image staleness + vite build OOM(4GB)으로 모든 push를 차단 — `lefthook.yml`의 `5_e2e`를 `skip: true`로 일시 비활성화 (2026-05-01) | resolved | ci/e2e | ADR-0044 | pre-push e2e 정책은 superseded. remote PR/main smoke check가 blocking gate로 승격됨 |
| RISK-037 | hickory-proto 0.25.2 의 두 CVE (RUSTSEC-2026-0118 NSEC3 unbounded loop, -0119 O(n²) name compression) — mongodb 3.6.0 가 hickory-proto 를 ~0.25.2 로 핀해 `cargo update` 로 해소 불가. `deny.toml` 의 advisories ignore 에 등록 (2026-05-07). 실 영향: hickory 를 DNS *클라이언트* 로 사용하므로 트리거에 악의적 resolver/응답이 필요 — desktop app 사용자가 임의 MongoDB host 입력 시에만 노출 | active | backend/security | hooks setup | 종결: mongodb 4.x 또는 hickory-proto 0.25.3+ 로 이주 후 ignore 항목 제거 |
| RISK-038 | Code smell audit 2026-05-15 Part A 12 candidate (god file / 룰 위반 / dialect 중복) 중 Sprint 353–376 state-management plan 범위 밖 잔여: #1 `useQueryExecution.ts` paradigm + Safe Mode split, #2 `postgres/mutations.rs` 도메인 분할 (+ mysql pair), #3 `rdb/DataGrid.tsx` column 메타 hook, #4 RDB command handler dispatch 매크로, #5 `CreateTableDialog.tsx` ColumnsTabBody, #6 B-1 위반 5건 store action, #7 `useDataGridEdit.ts` paradigm + undo lib, #8 `postgres/schema.rs` 도메인 분할, #9 identifier validation 공통화, #10 `useFormResetOnOpen`, #11 `workspaceStore` B-6 cross-store 의존 (ADR or signature 변경), #12 `DocumentDataGrid` MQL preview modal | active | refactor backlog | code-smell-audit-2026-05-15 | 종결: 12 candidate 각각 sprint 등록 + 처리 또는 audit 문서 retire 결정 |
| RISK-039 | `dataGridEditStore.entryKey(connId, schema, table)` 가 `workspaceStore` 의 `(connId, db)` 키 공간보다 얕음 — db 차원 누락. 다중 db 에서 같은 `public.users` 존재 시 db1 의 pending edit 가 db2 에 잘못 commit 될 invariant 누수 (audit L1, 🔴 High). | resolved | frontend/logic | code-smell-audit-2026-05-15 (L1) | Sprint 433 — `entryKey(connId, db, schema, table)` 로 확장하고 hook remount / removeTab purge 회귀 테스트로 잠금 |
| RISK-040 | Connection cleanup 책임 5 store × 5+ 호출처 분산 (audit L4, 🔴 High). `connectionStore` / `schemaStore` / `documentStore` / `workspaceStore` / `dataGridEditStore` cleanup 이 paired 호출 보장 없이 호출처별 일부만 trigger. `useConnectionLifecycle.disconnect()` 외 경로 (외부 IPC event 등) 에서 `workspaceStore.clearForConnection` 누락 시 유령 탭 / pendingEdits 잔존. Sprint 365 cross-window `state-changed` 가 일부 cleanup chain 자동화하지만 5 store paired invariant orchestrator 는 별도 작업 | active | frontend/logic | code-smell-audit-2026-05-15 (L4) | 종결: Connection lifecycle 단일 진입점 또는 `connection-removed` event subscribe 패턴 + cleanup invariant 1 곳 표현 + lifecycle 회귀 test |
| RISK-041 | Code smell audit 2026-05-15 Part B 잔여 6항목 (Sprint 353–376 범위 밖): L3 `schemaStore.clearSchema` ≡ `clearForConnection` dead alias, L6 `QueryMode` type alias 가 `workspaceStore` (legacy persisted hint) vs `queryHistoryStore` (dispatched method) 두 의미로 분열, L7 `workspaceStore` queryId stale guard 4 사이트 중복 (~30 LOC 절감 가능), L8 `workspaceStore.ts` 파일에 selector hook 9개 동거 (`selectors.ts` 분리 후보), L9 `paradigm` 정보 3 store cache (drift 0 — 메모 수준), L10 `EMPTY_ENTRY` shallow freeze (`pendingEdits: Map` mutable, 컨벤션 의존 fragile invariant) | active | refactor backlog | code-smell-audit-2026-05-15 | 종결: 6 항목 각각 sprint 등록 + 처리 또는 audit 문서 retire 결정 |

---

## Resolution Log

Details for every resolved risk.

### RISK-001 — fetchData 경쟁 조건 (DataGrid)

- **Origin**: Sprint 5, 11
- **Resolved in**: Sprint 12
- **Fix**: Applied `fetchIdRef` counter pattern so that stale async responses are discarded. The ref is incremented before each fetch; on response arrival the handler compares its captured id against the current ref and bails out on mismatch.

### RISK-002 — loadTables 실패 시 loadingTables 상태 미해제

- **Origin**: Sprint 7
- **Resolved in**: Sprint 11
- **Fix**: Added `.catch()` and `.finally()` handlers so `loadingTables` is always reset to `false`, even when the promise rejects.

### RISK-003 — handleRefresh loadSchemas 실패 시 loadingSchemas 미해제

- **Origin**: Sprint 7
- **Resolved in**: Sprint 11
- **Fix**: Same `.catch().finally()` pattern applied to `loadSchemas` call inside `handleRefresh`.

### RISK-004 — connectionId 변경 시나리오 미테스트

- **Origin**: Sprint 7
- **Resolved in**: Sprint 11
- **Fix**: Added dedicated unit test covering the connection-id change scenario.

### RISK-005 — row_count: 0 엣지 케이스 미검증

- **Origin**: Sprint 7
- **Resolved in**: Sprint 11
- **Fix**: Added unit test asserting correct behaviour when `row_count` is zero.

### RISK-006 — Backend tests couldn't run in environment

- **Origin**: Sprint 0
- **Resolved in**: Subsequent sprints
- **Fix**: CI pipeline now runs all test jobs (frontend, backend, integration) with proper GitHub service containers for PostgreSQL/MySQL.

### RISK-007 — test-setup.ts TypeScript build error

- **Origin**: Sprint 0
- **Resolved in**: Subsequent sprints
- **Fix**: Type definitions and test setup file corrected to compile cleanly under strict mode.

### RISK-024 — fireEvent 호출 act() 미래핑

- **Origin**: Sprint 24–40 (테스트 코드 전반)
- **Resolved in**: 2026-04-12
- **Fix**: 5개 테스트 파일(ContextMenu, ConnectionGroup, ConnectionItem, Sidebar, ConnectionList)의 모든 fireEvent 호출을 `act(() => { ... })`로 래핑. React state update 경고 방지.

### RISK-025 — Multi-window split (launcher/workspace) phase 12 이월

- **Origin**: Sprint 149
- **Resolved in**: Sprint 155 (2026-04-27) — Phase 12 closure
- **Fix**: Phase 12 sprints 150–155가 다음을 차례로 wired:
  - **Sprint 150** — `tauri.conf.json`에 `launcher`(720×560 fixed) + `workspace`(1280×800 resizable) WebviewWindow 정의, `src-tauri/src/launcher.rs`에 label-addressable show/hide/focus/`app_exit` Tauri command surface 추가, `lib.rs` invoke handler 등록.
  - **Sprint 151** — `attachZustandIpcBridge` 공통 모듈 (origin echo + allowlist + diff 기반 broadcast).
  - **Sprint 152** — `connectionStore`에 bridge 부착, plaintext password가 wire payload에 흐르지 않도록 allowlist 차단 회귀 잠금.
  - **Sprint 153** — `tabStore`(workspace-only attach guard) / `mruStore` / `themeStore` / `favoritesStore` 4개 store에 symmetric IPC sync 부착, 5개 sync 채널 + malformed payload 무시 회귀 잠금.
  - **Sprint 154** — `@lib/window-controls` seam(show/hide/focus/exitApp/onCloseRequested) + `LauncherShell`/`WorkspaceShell` 라우터 분기 + 5개 user-facing 전환(Activate/Back/Disconnect/LauncherClose/WorkspaceClose) 와이어, `appShellStore.screen` deprecate.
  - **Sprint 155** — `window-lifecycle.ac141.test.tsx`의 5개 `it.todo()` 실제 회귀 변환, `appShellStore.screen` 좀비 필드 완전 제거, ADR 0011 → 0012 supersede.

### RISK-009 — 오버레이 pointer-events 미설정

- **Origin**: Sprint 5, 11
- **Resolved in**: Sprint 176 (2026-04-30)
- **Fix**: Refetch loading overlay (`absolute inset-0 z-20 ... bg-background/60`) 두 곳 — `DataGridTable.tsx`와 `DocumentDataGrid.tsx` — 에 명시적 이벤트 핸들러(`onMouseDown`/`onClick`/`onDoubleClick`/`onContextMenu` 모두 `preventDefault()` + `stopPropagation()`) 부착. CSS `pointer-events` 토글 대신 핸들러 swallow 방식을 선택해 (a) 오버레이 자체는 hit-test 가능하고 (b) 스피너 시각(Loader2 size=24, `animate-spin text-muted-foreground`)을 변경하지 않는다. AC-176-04 baseline은 두 신규 테스트 파일의 DOM-class 단언으로 잠금.

### RISK-035 — `StructurePanel` 첫 렌더 empty-state 깜빡임

- **Origin**: P2 P1 review (구 REVIEW-P2P1 B1)
- **Resolved in**: Sprint 176 (2026-04-30)
- **Fix**: `StructurePanel.tsx`에 sub-tab별 `hasFetchedColumns` / `hasFetchedIndexes` / `hasFetchedConstraints` 게이트 도입. `fetchData`가 각 fetch를 settle한 직후(성공 set 또는 catch 분기) 해당 플래그를 true로 전이하고, 에디터 분기는 `hasFetched*`가 true일 때에만 렌더한다. 결과: 첫 fetch가 in-flight인 동안 "No columns/indexes/constraints found" copy가 등장하지 않으며, fetch가 `[]`로 settle하면 즉시 노출된다. catch 분기에서도 플래그를 true로 전이하므로 retry 후 빈 결과도 정상적으로 surface한다.
