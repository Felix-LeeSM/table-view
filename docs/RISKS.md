# Risk Register — Table View

잔여 위험 단일 추적 문서. 스프린트 handoff를 다시 읽지 않아도 됨.

Last updated: 2026-04-25 (Sprint 116 — UI evaluation follow-up 링크 추가)

## 참고 문서

- [`docs/ui-evaluation-followup.md`](./ui-evaluation-followup.md) — 정적 평가에서 판정 불가하여 ⚠️ 가 붙은 UX / 성능 / a11y 실측 큐. 본 RISKS.md (코드 측 잔여 위험) 와 역할 분담.

## Summary

| Status    | Count |
|-----------|-------|
| Active    | 14    |
| Resolved  | 8     |
| Deferred  | 1     |
| **Total** | **23** |

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
