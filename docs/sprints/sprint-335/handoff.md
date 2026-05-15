# Sprint 335 Handoff — Slice M live wire (CREATE/DROP DATABASE)

날짜: 2026-05-15

## 결과

- 신규 backend: `RdbAdapter::create_database` + `drop_database` (trait
  default `Unsupported`, PG override + `DocumentAdapter::drop_database`
  (Mongo) + 3 Tauri commands.
- 신규 frontend: `createRdbDatabase` / `dropRdbDatabase` /
  `dropMongoDatabase` wrappers + DbLifecycleDialog 4-case live wire (RDB
  create / RDB drop / Mongo lazy-create info / Mongo drop).
- 회귀: 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
- `pnpm vitest run --no-coverage` — 3787 통과 / 10 skipped (sprint-334
  3784 → +3; sprint 327 placeholder 2 cases 가 5 신규로 교체).
- tsc / lint exit 0.

## 변경 파일

### Backend
- `src-tauri/src/db/traits.rs` — `RdbAdapter::create_database` +
  `drop_database` (default `Unsupported`) + `DocumentAdapter::drop_database`.
- `src-tauri/src/db/postgres.rs` — trait dispatch wire.
- `src-tauri/src/db/postgres/schema.rs` — `create_database` /
  `drop_database` inherent impl + 5 신규 validation/connection unit
  cases.
- `src-tauri/src/db/mongodb.rs` — trait dispatch wire.
- `src-tauri/src/db/mongodb/schema.rs` — `drop_database_impl` + 2 신규
  validation/connection unit cases.
- `src-tauri/src/db/testing.rs` — `drop_database_fn` field + default +
  stub impl.
- `src-tauri/src/db/tests.rs` — 두 dummy adapter 에 `drop_database`
  impl 추가.
- `src-tauri/src/commands/rdb/ddl.rs` — `create_rdb_database` /
  `drop_rdb_database` Tauri commands + `_inner` helpers.
- `src-tauri/src/commands/document/browse.rs` — `drop_mongo_database`
  Tauri command + `_inner` helper.
- `src-tauri/src/lib.rs` — invoke_handler 3 등록.

### Frontend
- `src/lib/tauri/document.ts` — `dropMongoDatabase` wrapper.
- `src/lib/tauri/ddl.ts` — `createRdbDatabase` / `dropRdbDatabase` wrapper.
- `src/components/connection/DbLifecycleDialog.tsx` — 4-case live wire +
  name input (create) / confirmation copy (drop) / Mongo lazy-create
  info pane.
- `src/components/connection/DbLifecycleDialog.test.tsx` — 5 cases.

## 의사결정

- **D-85**: Mongo create database 는 wrap 하지 않는다. driver 가
  database 를 lazy 생성 (collection 첫 write 시) — UX 차원에서
  "documents 를 넣으면 자동 생성" 안내 copy 가 정확한 mental model.
- **D-86**: PG CREATE/DROP DATABASE 는 transaction 외부에서 실행. sqlx
  의 single-statement `query.execute(pool)` 가 자동으로 새 connection 에서
  transactionless 실행. 사용자 명시 transaction wrap 은 PG 가 거부.
- **D-87**: drop database 후 evict-active-sessions 헬퍼 없음 — PG 가
  `database "X" is being accessed by other users` 에러 surface, 사용자가
  본 후 직접 연결 끊고 재시도. follow-up sprint 에서 force-drop helper.

## 다음 (Sprint 327 D-72 +3 shift 라인업)

- **Sprint 336** — Mongo `currentOp` / `killOp` + RDB pg_stat_activity
  wire (U1).
- **Sprint 337** — Mongo `cursor.explain()` + RDB EXPLAIN ANALYZE (U2).
- **Sprint 338** — Mongo `collStats` + RDB pg_stat_user_tables (U3).
- **Sprint 339** — Mongo `buildInfo` + `serverStatus` + RDB pg_settings
  (U4).
- **Sprint 340** — Mongo `system.profile` + RDB pg_stat_statements (U5).
