---
id: 0039
title: Workspace window per-connection — TablePlus 패턴 + idempotent open
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: Workspace window 의 1:1 정책 — connection 당 최대 1 workspace
window. 같은 connection 두 번째 클릭 시 새 window 를 띄우지 않고 기존
`workspace-{connection_id}` window label 을 focus 한다 (TablePlus 패턴).

1. **Window label 마이그** — 단일 `"workspace"` → per-connection
   `workspace-{connection_id}`. Backend `KnownWindowLabel` union 확장.
2. **Idempotent `open_workspace_window(connection_id)` IPC** — 동작:
   - 기존 `workspace-{connection_id}` label window 존재 → show + focus.
   - 없으면 신규 create.
   - 어느 경로든 1 window 만 보장.
3. **Sub-workspace = `(connection_id, db_name)` PK** — 한 window 안에서
   사용자가 DB 전환 시 sub-workspace state 분리 영속. SQLite `workspaces`
   PK `(connection_id, db_name)`. 한 connection 의 N db = N row.
4. **`query_history.workspace_id` 컬럼 / index 제거** — Q13 으로
   connection 당 1 window 라 `workspace_id` 는 `connection_id` 와
   redundant. `WHERE connection_id = ? AND tab_id = ?` index 로 derive
   충분.
5. **N connection 동시 가능** — 서로 다른 N 개 connection 의 workspace
   window N 개 동시 띄울 수 있음. Single-instance (ADR 0033) 위에서 process
   1개 + window N 개.
6. **`useCurrentWindowConnectionId()` hook** — workspace 코드 path 의
   connection identity 는 Tauri window label (`workspace-{conn_id}`) 에서
   const derive. `connectionStore.focusedConnId` read 사이트 0 (grep CI).
   Launcher path 만 store slot 사용.

**이유**:

1. **TablePlus 패턴 검증** — 사용자가 같은 connection 의 워크플로우를
   "2개로 분리" 하고 싶은 시나리오는 드뭄 (검증된 사용자 인터뷰).
   Connection 당 1 window 가 (a) 사용자 mental model 단순, (b) connection
   상태 (active DB, transaction 상태) 가 한 곳에서 단일 source, (c)
   window 사이 동기화 책임 없음.
2. **Sub-workspace 분리 의 가치** — 한 window 안에서 DB 전환 시 sidebar /
   tab 셋 / scroll 위치가 sub-workspace 별 보존되어야 함 (DataGrip /
   DBeaver 패리티). PK `(connection_id, db_name)` 이 그 grain 의 자연
   표현 — ADR 0027 의 nested map 정책과 1:1.
3. **`workspace_id` 컬럼 redundancy 제거** — Q13 으로 connection 당 1
   window 라 `workspace_id` 는 `connection_id` 의 alias. Schema 단순화
   + index size 절감. Per-tab derivation 은 `(connection_id, tab_id)`
   compound index 로 충분.
4. **Idempotent open 의 race safety** — 사용자가 빠른 더블 클릭 또는
   keyboard shortcut 두 번 누르면 IPC 가 두 번 호출됨. Idempotent 한
   "exist → focus, miss → create" 로 두 race 호출 모두 안전 (last
   wins = focus).
5. **`useCurrentWindowConnectionId()` 가 store slot 대체** — Workspace
   path 에서 `focusedConnId` read 는 사실 window identity 의 잘못된
   대용. Window label 에서 const derive 하면 (a) launcher 의 store slot
   변경이 workspace 에 누수 안 됨, (b) workspace path 는 인 자료가
   window 식별자로 절대 명확.

**트레이드오프**:

- **+** TablePlus 패리티 — 사용자 mental model 매핑 직관.
- **+** Connection state 단일화 — transaction 상태 / active DB 가 한
  window 안에서만 변하는 invariant.
- **+** 사용자가 더블 클릭해도 새 window 안 뜸 (idempotent open).
- **+** Schema 단순 — `query_history` 의 `workspace_id` 컬럼 제거,
  index 1개 절감.
- **+** Workspace path 의 connection identity 명확 — window label const
  derive, store slot race 0.
- **−** 사용자가 같은 connection 의 두 워크플로우를 분리하고 싶을 때
  workaround 필요 — (a) 다른 connection (e.g. 같은 호스트의 두 다른
  user) 으로 우회, (b) tab 분리만으로 워크플로우 분리. 본 사용 case
  의 빈도 낮다는 인터뷰 가정.
- **−** Window label rename 의 migration — `KnownWindowLabel` union /
  router resolve / close handler 모두 새 패턴 인식 필요. 기존 e2e 테스트
  의 window selector 도 update.
- **−** Launcher 의 workspace summary cache 가 lazy fetch — `get_workspace_summaries
  (connection_ids: Vec<String>)` IPC 별 path (F.2 §Launcher escape hatch).
- **−** Sub-workspace (PK 2-tuple) 의 N row boot 폭주 가능성 — 1 connection
  × 100 db = 100 row, 100 connection × 5 db = 500 row. Window-partition
  snapshot (ADR 0032 의 `byConnectionId`) 으로 launcher 는 빈 받고
  workspace window 만 자기 connection 받음.

**관련**:

- state-management-strategy-2026-05-15.md §Q13 line 424 (workspace window per-connection)
- state-management-strategy-2026-05-15.md §Q15 line 426 (focusedConnId 의 workspace
  마이그 — `useCurrentWindowConnectionId()` hook)
- state-management-strategy-2026-05-15.md §Phase 3 AC line 1637–1644 (window label
  마이그 + Q13 검증)
- state-management-strategy-2026-05-15.md §F.2 line 941–957 (window scope 결정 source
  — Tauri `window: tauri::Window` 인자)
- ADR 0012 — Multi-window launcher/workspace (window 분리의 기반)
- ADR 0017 — Launcher lazy workspace window (cold-boot 최적화 — lazy
  spawn 정책 본 ADR 의 1:1 정책과 정합)
- ADR 0027 — Per-workspace state store (nested map `(connId, db)` —
  본 ADR 의 sub-workspace PK 와 1:1)
- ADR 0032 — SQLite infrastructure (`workspaces` PK 2-tuple + 윈도우
  partition snapshot)
- ADR 0033 — Single-instance + cross-window sync (idempotent open 의
  in-process 전제)
