# Sprint Contract: sprint-359

## Summary

- Goal: Phase 2 tab affinity + cancel — Q5.1 dedicated `PoolConnection`, Q5.2 release+rollback, Q5.3 native cancel impl (`DbAdapter::cancel_query`), Q5.4 sidebar 격리 `introspection_pool` (shared idle round-robin), Q5.5 cancel error 분류 (`AlreadyCompleted`/`PermissionDenied`/`NetworkError`), Q5.6 lazy acquire (`Option<(PoolConnection, server_pid)>`). `executeQuery(tab_id)` 시 첫 호출에 affinity bind + `cancel_query` 가 native level (PG `pg_cancel_backend` / MySQL `KILL QUERY` / Mongo `killOp`).
- Audience: state-management-strategy Phase 2 — long-running query 취소 + per-tab transaction 격리.
- Owner: Generator (sprint-359)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

Supersession note: sprint-405 keeps the Q5.5 cancel classes but replaces the
transport from JSON embedded in `AppError::Database` to the typed top-level
`AppError::Cancel` envelope. See `docs/sprints/sprint-405/contract.md`.

## In Scope

- `src-tauri/src/state/active_connections.rs` — `ActiveConnection { pool, introspection_pool, tab_affinity: HashMap<TabId, Option<(PoolConnection, server_pid)>> }` 스키마 추가. boot 시 빈 HashMap (Q5.6 lazy 의 None — codex 정합).
- `src-tauri/src/db/postgres/`, `mysql/`, `mongodb/` — `DbAdapter::cancel_query` impl:
  - PG: `pg_cancel_backend(pid)` 별 connection.
  - MySQL: `KILL QUERY <thread_id>`.
  - Mongo: `killOp(opid)` admin command.
- `src-tauri/src/commands/execute_query.rs` — `executeQuery(tab_id, sql, ...)` 의 첫 호출에 affinity bind: pool 에서 `acquire` 후 `Some((PoolConnection, server_pid))` 저장. 그 후부터는 같은 connection 재사용.
- `src-tauri/src/commands/cancel_query.rs` — `cancel_query(connection_id, server_pid)` IPC. `CancelError` enum (Q5.5): `AlreadyCompleted` / `PermissionDenied` / `NetworkError`.
- `src-tauri/src/commands/release_tab_connection.rs` — `release_tab_connection(connection_id, tab_id)` IPC (strategy line 765 정합). 진행 중 transaction `ROLLBACK` + PoolConnection drop.
- `src-tauri/src/state/introspection_pool.rs` — Q5.4 sidebar 격리. tab pool 과 별도, idle connection shared round-robin (max_K=5).
- `src-tauri/src/db/postgres/schema.rs` (또는 caller) — sidebar fetch IPC 가 `introspection_pool.acquire()` 사용 (기존 `pool.acquire()` 호출 사이트 grep 후 분리).
- `src/lib/tauri/cancel.ts` — frontend wrapper + 에러 type.
- 단위 / integration 테스트:
  - `src-tauri/tests/tab_affinity_lazy.rs` — boot 직후 affinity 빈 상태, 첫 executeQuery 후 bind.
  - `src-tauri/tests/cancel_pg.rs` / `cancel_mysql.rs` / `cancel_mongo.rs` (live container).
  - `src-tauri/tests/release_tab_connection_rollback.rs`.
  - `src-tauri/tests/cancel_error_classes.rs` — 3 enum case.

## Out of Scope

- Cross-window schemaCache invalidate (sprint-365).
- Self-window schemaCache invalidate (sprint-360).
- Q14 ConnectionStatus enum 확장 (sprint-364).
- Window label per-conn migration (sprint-361).

## Invariants

- 기존 `executeQuery` 의 wire 호환 — `tabId` 가 optional 인 경우 affinity 안 잡고 일회성 pool acquire (sidebar-prefetch 등).
- Cancel 은 native level — frontend abort signal 만으로 server-side 종료 0.
- Tab close 시 transaction rollback 보장 — 미해제 leak 0.
- Affinity 는 HashMap (in-memory) — boot 시 0, persist 안 함.
- 기존 cargo integration test 회귀 0.

## Acceptance Criteria

- `AC-359-01` Affinity boot 빈 상태: 앱 boot 직후 `state.active_connections[*].tab_affinity` 모두 empty HashMap. Test: `tab_affinity_lazy.rs`.
- `AC-359-02` Lazy bind: tab open 직후 `tab_affinity[tab_id] = None`. 첫 `executeQuery(tab_id)` 후 `Some((PoolConnection, server_pid))`. Test: bind 시점 sequencing + type signature 검증.
- `AC-359-02b` Q5.4 introspection_pool: sidebar schema fetch IPC 가 `introspection_pool.acquire()` 호출 (not `pool.acquire()`). max_K=5 idle round-robin. Test: pool 별 호출 spy.
- `AC-359-03` PG cancel: `BEGIN; SELECT pg_sleep(60);` 실행 중 → `cancel_query(connection_id, server_pid)` → 0.5s 안에 query terminate, `executeQuery` 결과 `Err(Cancelled)`. Test: `cancel_pg.rs`.
- `AC-359-04` MySQL cancel: `SELECT SLEEP(60)` 실행 중 → `cancel_query(connection_id, server_pid)` → terminate. Test: `cancel_mysql.rs`.
- `AC-359-05` Mongo cancel: `find({$where: "sleep(60000)"})` 실행 중 → `cancel_query(connection_id, opid)` (server_pid 자리에 opid 전달) → terminate. Test: `cancel_mongo.rs`.
- `AC-359-06` Cancel error enum: 이미 완료 → `AlreadyCompleted`, 권한 부족 (PG `pg_cancel_backend` 다른 사용자 PID) → `PermissionDenied`, 네트워크 단절 → `NetworkError`. Test: `cancel_error_classes.rs`.
- `AC-359-07` `release_tab_connection` rollback: `BEGIN; INSERT INTO foo VALUES (1);` 미커밋 → `release_tab_connection` → INSERT rollback (다음 SELECT 결과 0 row). Test: `release_tab_connection_rollback.rs`.
- `AC-359-08` Tab close 시 release IPC 호출 — frontend `useQueryTab` cleanup 에서 `release_tab_connection` invoke. Test: RTL unmount 시 IPC spy.

## Design Bar / Quality Bar

- TDD: 각 cancel impl 의 timeout 동작 (>10s 대기 안 함) 단언이 red 로 시작.
- Native cancel impl 은 별 connection (cancel 용) 으로 — 같은 connection 으로는 query in flight 라서 send 불가.
- Affinity HashMap 은 mutex (`tokio::sync::Mutex<HashMap<...>>`) — concurrent executeQuery 안전.
- 테스트 작성 날짜 + 사유 코멘트. live container 미가용 시 skip path.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test tab_affinity_lazy --test release_tab_connection_rollback --test cancel_error_classes`
3. `cd src-tauri && cargo test -p table-view-lib --test cancel_pg --test cancel_mysql --test cancel_mongo` (skip-on-no-container expected)
4. `pnpm vitest run src/lib/tauri/cancel.test.ts`
5. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

### Required Evidence

- 3 DB cancel timeline (start → cancel → terminate < 0.5s).
- Affinity HashMap state log (bind 전/후).
- Rollback test 의 row count assert.

## Test Requirements

- Cargo integration: 7 테스트 파일.
- Vitest: cancel wrapper + RTL release_tab_connection on unmount.
- Coverage: `src-tauri/src/commands/{cancel_query, execute_query, release_tab_connection}` 70%.
- Scenario: (a) lazy affinity, (b) PG/MySQL/Mongo cancel, (c) 3 error class, (d) release rollback, (e) unmount release.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test tab_affinity_lazy --test release_tab_connection_rollback --test cancel_error_classes`
3. `cd src-tauri && cargo test -p table-view-lib --test cancel_pg --test cancel_mysql --test cancel_mongo -- --ignored` (container)
4. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. 기존 query/connection IPC 의 호환 wire 유지.
- Merge order: 355 이후 (Phase 1 dual-write 와 병렬 가능 — codex 피드백). 360 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 9/9 PASS
- 3 DB cancel < 0.5s evidence
