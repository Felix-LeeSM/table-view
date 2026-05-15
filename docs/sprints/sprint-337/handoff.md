# Sprint 337 Handoff — U2 live wire (Explain viewer)

날짜: 2026-05-15

## 결과

- 신규 backend: 2 trait method (`RdbAdapter::explain_query`,
  `DocumentAdapter::explain_query`) + PG override + Mongo impl +
  2 Tauri commands.
- 신규 frontend: `explainRdbQuery` / `explainMongoFind` wrapper
  (`@/lib/api/explain`) + `ExplainViewer` live wire (raw JSON tree
  + Refresh).
- 회귀: 0. ServerActivityPanel 5 cases 그대로 통과.
- `cargo clippy ... -D warnings` exit 0.
- `pnpm vitest run --no-coverage` — 3792 통과 / 10 skipped (sprint-336
  3790 → +2; sprint 327 placeholder 2 cases 가 4 신규로 교체).
- tsc / lint exit 0.

## 변경 파일

### Backend
- `src-tauri/src/db/traits.rs` — `RdbAdapter::explain_query` default
  `Unsupported` + `DocumentAdapter::explain_query` required method.
- `src-tauri/src/db/postgres.rs` — trait dispatch wire.
- `src-tauri/src/db/postgres/schema.rs` — `explain_query` inherent
  (`EXPLAIN (ANALYZE, FORMAT JSON) <sql>` → first cell → JSON) +
  3 unit case (empty / whitespace / without_connection).
- `src-tauri/src/db/mongodb.rs` — trait dispatch wire.
- `src-tauri/src/db/mongodb/schema.rs` — `explain_query_impl`
  (`runCommand({explain: {find, filter}, verbosity})`) + 3 unit case.
- `src-tauri/src/db/testing.rs` — RDB + Document stub slots
  (`explain_query_fn`).
- `src-tauri/src/db/tests.rs` — DummyDocument + FakeCancellableDocument
  `explain_query` 추가 + 1 default Unsupported 단언 (RdbAdapter).
- `src-tauri/src/commands/rdb/query.rs` — `explain_rdb_query` Tauri
  command + `_inner` helper + 4 unit case.
- `src-tauri/src/commands/document/query.rs` — `explain_mongo_find`
  Tauri command + `_inner` helper + 4 unit case.
- `src-tauri/src/lib.rs` — invoke_handler 2 등록.

### Frontend
- `src/lib/api/explain.ts` (NEW) — wrappers + `ExplainMongoFindArgs` TS
  type.
- `src/components/query/ExplainViewer.tsx` — placeholder 제거, live wire
  (raw JSON tree + Refresh). props 변경 (`query?` → `rdbSql?` +
  `mongoSpec?`).
- `src/components/query/ExplainViewer.test.tsx` — 4 cases (RDB happy +
  Mongo dispatch + error alert + refresh re-fetch).

## 의사결정

- **D-91**: PG explain 은 `EXPLAIN (ANALYZE, FORMAT JSON)` 으로 wrap.
  `ANALYZE` 가 실제 query 를 실행하기 때문에 caller 가 read-only
  SELECT 만 넘기는 것을 전제 — UX layer 에서 mutating SQL 입력 시
  경고 (후속 sprint scope 외).
- **D-92**: Mongo explain 은 driver 의 cursor option 대신
  `runCommand({explain: {find, filter}, verbosity})` 로 dispatch —
  raw response Document 를 그대로 JSON 화하면 driver shape 변경에 덜
  민감하고 verbosity 토글이 쉽다.
- **D-93**: Wire shape 은 paradigm 통일된 `serde_json::Value` — frontend
  tree viewer (현재 pre-print) 가 paradigm-neutral. 트리 viewer 는 후속
  sprint scope.
- **D-94**: aggregate pipeline explain 은 v1 scope 외 — A1 cursor.explain()
  이 흔히 사용되는 find 부터 우선.

## 다음 (Sprint 327 D-72 +4 shift)

- **Sprint 338** — Mongo `collStats` + RDB pg_stat_user_tables (U3).
- **Sprint 339** — Mongo `buildInfo` + `serverStatus` + RDB pg_settings (U4).
- **Sprint 340** — Mongo `system.profile` + RDB pg_stat_statements (U5).
