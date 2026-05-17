---
id: 0034
title: Per-tab connection affinity + native cancel (Q5.x 통합)
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: Backend 의 connection 모델을 **M-affinity** (tab = session)
로 통일한다. TablePlus 패리티 — transaction / `SET` / TEMP TABLE 이 한
tab 의 lifetime 동안 보존되며 다른 tab 에 누수되지 않는다.

1. **Q5.1 — 같은 conn ID 두 tab = dedicated PoolConnection 분리**.
   Tab A 의 `BEGIN; ...` 이 Tab B 에 영향 0.
2. **Q5.2 — Tab close = 즉시 release + transaction silent rollback**.
   "open transaction commit 하시겠습니까?" 같은 confirm 없음. RDBMS 기본
   동작 (connection close → implicit rollback) 패리티.
3. **Q5.3 — Cancel 메커니즘 = paradigm-native 통일**. PG `pg_cancel_backend
   (server_pid)` / MySQL `KILL QUERY pid` / Mongo `db.killOp(opid)`.
   `DbAdapter::cancel_query(connection_id, query_id)` trait 추가.
4. **Q5.4 — Sidebar 격리 = 별도 `introspection_pool`**. Schema/metadata
   조회용 shared idle connection round-robin. Tab affinity pool 과 격리.
5. **Q5.5 — Cancel 실패 처리 = Hybrid**. `AlreadyCompleted` silent (race
   기본 동작), `PermissionDenied` / `NetworkError` toast (사용자 액션
   필요).
6. **Q5.6 — Tab 수 한계 = Lazy acquire**. Tab 열어도 connection 안 잡음.
   첫 `executeQuery` / `BEGIN` / `SET` 시 acquire. 100 tab 열어도 idle
   tab 자원 0. `tab_affinity: HashMap<tab_id, Option<PoolConnection>>`.
7. **IPC scope** — `executeQuery(tab_id, ...)`, `release_tab_connection
   (connection_id, tab_id)` (codex 7차 #4 — tab_id 만으론 conn 간 collision).

**이유**:

1. **TablePlus 패리티 (사용자 요구사항)** — 한 tab 에서 `BEGIN; ...`
   하고 같은 tab 에서 commit 하는 워크플로우가 RDB 사용자의 표준.
   Shared pool 모델은 두 query 가 다른 connection 으로 routed 되어
   transaction 이 깨짐.
2. **Native cancel 정확성** — `pg_cancel_backend` 같은 paradigm-native
   API 가 server 측에서 가장 정확. Generic `Drop` / connection close
   기반 cancel 은 server 가 query 끝낼 때까지 대기 (실효성 0). `server_pid`
   를 history row 에 기록 (Q5.3 diagnostics).
3. **Lazy acquire 가 자원 효율 + 사용자 가치 (A2 / A5) 일치** — 사용자가
   "참고용" tab 30개 열어둔 워크플로우에서 pool exhaustion 안 일어남.
   첫 query 까지 PoolConnection acquire 안 됨 = max_size 작아도 안전.
4. **Introspection pool 분리 (Q5.4)** — Sidebar 의 schema refresh /
   autocomplete 조회는 사용자 query 와 격리되어야 함. Tab affinity pool
   에서 빌려가면 (a) idle tab 의 transaction 깰 위험, (b) 사용자 query
   가 schema refresh 로 starvation.
5. **Hybrid cancel-fail 분류 (Q5.5)** — `AlreadyCompleted` 는 race 정상
   (cancel 누르는 순간 query 끝남) — silent. `PermissionDenied` 는
   user 가 모를 수 없음 (다른 user 의 query 도 cancel 시도? 권한 다시
   봐라). `NetworkError` 는 connection 죽음 — 재연결 안내 필요.

**트레이드오프**:

- **+** RDB transaction 워크플로우 정확 — TablePlus / DataGrip /
  pgAdmin 패리티.
- **+** Native cancel — 사용자가 `Cmd+.` 누르면 server 가 즉시 query
  중단 (`AlreadyCompleted` 외 케이스).
- **+** Lazy acquire 로 idle tab 비용 0 — 100 tab 열어도 max_size 5
  pool 안 깨짐.
- **+** Sidebar 격리로 schema refresh 가 사용자 query 차단 안 함.
- **−** Tab close = silent rollback — 사용자가 BEGIN 한 후 confirm
  없이 닫으면 데이터 손실. 정책 lock (Q5.2 (α)) 으로 "TablePlus 도 그렇
  다" 패리티 수용. 추후 Cmd+W intercept 로 explicit confirm 옵트인 가능
  (out of scope).
- **−** Per-tab dedicated connection = pool 소모 — 5 tab 모두 active
  query 시 max_size = 5 가 한계. 다음 query 는 대기. 사용자가 max_size
  설정으로 조정.
- **−** `DbAdapter::cancel_query` 의 paradigm-native impl 3개 (PG/MySQL/
  Mongo) — adapter trait 변경 + 통합 테스트 매트릭스.
- **−** `tab_affinity` 의 `HashMap<tab_id, Option<PoolConnection>>` 가
  connection scope 라 PK 가 `(connection_id, tab_id)` — IPC API
  `release_tab_connection` 시그니처도 두 인자 (codex 7차 #4).

**관련**:

- state-management-strategy-2026-05-15.md §Q5 line 410 (M-affinity)
- state-management-strategy-2026-05-15.md §Q5.1 line 411 (dedicated PoolConnection)
- state-management-strategy-2026-05-15.md §Q5.2 line 412 (즉시 release + silent rollback)
- state-management-strategy-2026-05-15.md §Q5.3 line 413 (paradigm-native cancel)
- state-management-strategy-2026-05-15.md §Q5.4 line 414 (introspection pool)
- state-management-strategy-2026-05-15.md §Q5.5 line 415 (cancel fail Hybrid)
- state-management-strategy-2026-05-15.md §Q5.6 line 416 (lazy acquire)
- state-management-strategy-2026-05-15.md §Phase 2 line 754–766
- ADR 0018 — Async cancel policy (1초 임계 + Cancel UX 단일화 — 본
  ADR 이 backend 측 mechanism 으로 보강)
- ADR 0028 — MySQL driver sqlx (cancel mechanism 이 sqlx 위에서 `KILL
  QUERY` raw SQL)
- ADR 0032 — Snapshot bootstrap (`tab_affinity` 는 ephemeral runtime —
  snapshot 미포함)
- ADR 0033 — Cross-window sync (cancel 결과 / connection status 는
  domain="connection" op="status" event)
