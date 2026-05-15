# Sprint 336 Contract — U1 live wire (Server activity + Kill)

날짜: 2026-05-15

## Scope

Sprint 327 의 ServerActivityPanel placeholder 를 live 화한다. RDB 는
`pg_stat_activity` + `pg_terminate_backend`, Mongo 는 `currentOp` +
`killOp` 양쪽 모두.

공유 wire shape `ServerActivityRow { id, db, user, query, state,
wait_event?, started_at? }` — 두 paradigm 이 같은 grid 컴포넌트로
렌더 가능.

## Done Criteria

1. **Backend**:
   - 신규 `ServerActivityRow` model.
   - `RdbAdapter::list_server_activity() -> Vec<ServerActivityRow>` —
     PG override: `SELECT pid, datname, usename, state, wait_event,
     query, query_start FROM pg_stat_activity WHERE pid <> pg_backend_pid()`.
   - `RdbAdapter::kill_session(id: i64) -> ()` — PG override:
     `SELECT pg_terminate_backend($1)`.
   - `DocumentAdapter::current_op() -> Vec<ServerActivityRow>` —
     `adminCommand({currentOp: 1, "$all": true})` → row 매핑.
   - `DocumentAdapter::kill_op(id: i64) -> ()` — `adminCommand({killOp,
     op: id})`.
   - 4 Tauri commands.
   - testing stubs.
   - `cargo clippy ... -D warnings` exit 0.
2. **Frontend**:
   - `listServerActivity`, `killSession`, `mongoCurrentOp`, `mongoKillOp`
     wrappers.
   - ServerActivityPanel: refresh 버튼 + activity grid (id/db/user/state/
     wait/query/started) + Kill 버튼.
3. **테스트**:
   - frontend ≥ 4 신규 RTL.
   - tsc / lint / vitest sweep exit 0.

## Out of Scope

- Activity grid 의 auto-refresh interval (수동 refresh 만).
- Slow-query 필터 (Sprint 340 U5).
- Wait-event 분류 시각화 (별 sprint).

## Verification Plan

- Profile: `mixed`.
- Required checks: clippy / cargo test / vitest / tsc / lint.
