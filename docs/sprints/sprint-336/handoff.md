# Sprint 336 Handoff — U1 live wire (Server activity + Kill)

날짜: 2026-05-15

## 결과

- 신규 backend: 4 trait method (`RdbAdapter::list_server_activity` /
  `kill_session`, `DocumentAdapter::current_op` / `kill_op`) + PG
  override + Mongo impl + 2 paradigm-neutral Tauri commands.
- 신규 model `ServerActivityRow` (camelCase wire shape, paradigm-neutral).
- 신규 frontend: `listServerActivity` / `killServerActivity` wrapper
  (`@/lib/api/serverActivity`) + ServerActivityPanel live wire (grid +
  Refresh + Kill).
- 회귀: 0.
- `cargo clippy ... -D warnings` exit 0.
- `pnpm vitest run --no-coverage` — 3790 통과 / 10 skipped (sprint-335
  3787 → +3; sprint 327 placeholder 2 cases 가 5 신규로 교체).
- tsc / lint exit 0.

## 변경 파일

### Backend
- `src-tauri/src/models/query.rs` + `src-tauri/src/models/mod.rs` —
  `ServerActivityRow` 신규.
- `src-tauri/src/db/traits.rs` — 4 trait method 추가.
- `src-tauri/src/db/postgres.rs` — trait dispatch (2 wire).
- `src-tauri/src/db/postgres/schema.rs` — `list_server_activity` (PG
  `pg_stat_activity` → ServerActivityRow) + `kill_session`
  (`pg_terminate_backend`) + 2 신규 connection-error unit case.
- `src-tauri/src/db/mongodb.rs` — trait dispatch (2 wire).
- `src-tauri/src/db/mongodb/schema.rs` — `current_op_impl`
  (`adminCommand({currentOp: 1, "$all": true})` 매핑) + `kill_op_impl` +
  2 신규 connection-error unit case.
- `src-tauri/src/db/testing.rs` — RDB + Document 양쪽 stub slots.
- `src-tauri/src/db/tests.rs` — DummyDocument + FakeCancellableDocument
  impl.
- `src-tauri/src/commands/meta.rs` — `list_server_activity` /
  `kill_server_activity` Tauri commands + paradigm-neutral dispatch +
  7 신규 unit case.
- `src-tauri/src/lib.rs` — invoke_handler 2 등록.

### Frontend
- `src/lib/api/serverActivity.ts` (NEW) — wrappers + `ServerActivityRow`
  TS type.
- `src/components/connection/ServerActivityPanel.tsx` — grid + Refresh
  + Kill UI.
- `src/components/connection/ServerActivityPanel.test.tsx` — 5 cases
  (fetch + render / empty / kill + re-fetch / refresh / error).

## 의사결정

- **D-88**: `ServerActivityRow` 는 paradigm-neutral wire shape. PG-specific
  `wait_event` 과 Mongo-specific `secs_running` 는 둘 다 Optional 로
  같은 슬롯 (`waitEvent`, `startedAt`) 에 정규화. Paradigm 별 추가
  필드는 후속 sprint 에서 sub-row 로.
- **D-89**: `query_start` 는 PG 서버에서 `to_char` 로 ISO-8601 text 로
  변환. chrono 를 직접 의존성으로 안 끌어들이는 이유 — 다른 곳에서도
  chrono 가 안 쓰여서 의존성 증가 회피.
- **D-90**: Mongo `currentOp` 의 `command` 는 `{:?}` Debug format 으로
  단순 직렬화. EJSON canonical 형식은 후속 sprint (Quick Look 통합 시).

## 다음 (Sprint 327 D-72 +3 shift 라인업)

- **Sprint 337** — Mongo `cursor.explain()` + RDB EXPLAIN ANALYZE (U2).
- **Sprint 338** — Mongo `collStats` + RDB pg_stat_user_tables (U3).
- **Sprint 339** — Mongo `buildInfo` + `serverStatus` + RDB pg_settings (U4).
- **Sprint 340** — Mongo `system.profile` + RDB pg_stat_statements (U5).
