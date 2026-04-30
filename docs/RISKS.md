# Risk Register — Table View

잔여 위험 단일 추적 문서. 스프린트 handoff를 다시 읽지 않아도 됨.

Last updated: 2026-04-30 (RISK-026~034 ui-evaluation-followup 9건 흡수, RISK-035 REVIEW-P2P1 B1 흡수, 관련 docs 삭제)

## Summary

| Status    | Count |
|-----------|-------|
| Active    | 25    |
| Resolved  | 9     |
| Deferred  | 1     |
| **Total** | **35** |

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
| RISK-009 | 오버레이 pointer-events 미설정 — refetch 중 테이블 조작 가능 (P3)                       | active    | frontend/ui       | 5, 11         | —                                                         |
| RISK-010 | 포트 5432 로컬 충돌 — env var 오버라이드로 부분 해결                                    | active    | infra             | 16            | —                                                         |
| RISK-011 | CSS class명 의존 어설션 — refactoring 시 깨질 수 있음                                   | active    | frontend/testing  | 5, 8          | —                                                         |
| RISK-012 | Mod-Enter 테스트 jsdom 한계 (keymap 직접 호출)                                         | active    | frontend/testing  | 6             | —                                                         |
| RISK-013 | MainArea 자식 컴포넌트 전체 모킹 (prop 계약 미감지)                                    | active    | frontend/testing  | 6             | —                                                         |
| RISK-014 | 테마 아이콘 SVG 구별 불가                                                               | active    | frontend/testing  | 8             | —                                                         |
| RISK-015 | ConnectionConfigLike 타입 프로덕션과 중복                                               | active    | frontend/testing  | 8             | —                                                         |
| RISK-016 | draggedConnectionId 모킹 간접성/취약성                                                 | active    | frontend/testing  | 9, 10         | —                                                         |
| RISK-017 | skip 패턴 불일치 (query vs schema integration)                                          | active    | backend/testing   | 16            | —                                                         |
| RISK-018 | MySQL 어댑터 미구현 (docker-compose에만 정의)                                          | active    | backend           | 16            | —                                                         |
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
| RISK-035 | `StructurePanel` 첫 렌더에 "No columns found" 깜빡임 가능성 — `loading` 초기값 false, `hasFetched` 도입 안 됨 (구 REVIEW-P2P1 B1; 2026-04-30 검증: B2/B3/B4는 해결됨) | active | frontend/ui | P2 P1 review | 종결: 첫 fetch 전 빈 상태 비노출 또는 ColumnsList 자체 가드 |

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
