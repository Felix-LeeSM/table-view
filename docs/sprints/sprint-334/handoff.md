# Sprint 334 Handoff — Slice L live wire (Mongo create/renameCollection)

날짜: 2026-05-15

## 결과

- 신규 backend: `DocumentAdapter::create_collection` +
  `rename_collection` + `MongoAdapter` impl + 2 Tauri commands.
- 신규 frontend: `createCollection` / `renameCollection` wrapper +
  CollectionDdlDialog 3 mode live wire (create / rename / drop).
- 회귀: 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
- `pnpm vitest run --no-coverage` — 3784 통과 / 10 skipped (sprint-333
  3781 → +3; sprint 327 placeholder 2 cases 가 5 신규로 교체).
- tsc / lint exit 0.

## 변경 파일

### Backend
- `src-tauri/src/db/traits.rs` — `DocumentAdapter::create_collection` +
  `rename_collection`.
- `src-tauri/src/db/mongodb.rs` — trait impl wire.
- `src-tauri/src/db/mongodb/schema.rs` —
  `create_collection_impl` (`runCommand({create: <coll>, ...options})`)
  + `rename_collection_impl` (`admin.runCommand({renameCollection,
  to})`). 7 신규 validation unit cases.
- `src-tauri/src/db/testing.rs` — `StubDocumentAdapter` 2 field +
  default + impl.
- `src-tauri/src/db/tests.rs` — `DummyDocument` + `FakeCancellableDocument`
  impl 2 추가.
- `src-tauri/src/commands/document/browse.rs` — 2 Tauri commands +
  `_inner` helpers.
- `src-tauri/src/lib.rs` — invoke_handler 등록.

### Frontend
- `src/lib/tauri/document.ts` — `createCollection` / `renameCollection`
  wrapper.
- `src/components/document/CollectionDdlDialog.tsx` — 3 mode (create /
  rename / drop) live wire + name / options / renameTo inputs +
  validation 가드 + Cancel / Save 버튼.
- `src/components/document/CollectionDdlDialog.test.tsx` — 5 cases
  (closed-no-render, create dispatch, create invalid JSON 가드, rename
  dispatch, drop dispatch).

## 의사결정

- **D-82**: create options 는 raw JSON textarea passthrough. capped /
  timeseries form 필드는 사용자 task 빈도가 낮고, raw 입력으로 모든
  Mongo create 옵션을 커버 — 별 sprint 에서 dedicated form 추가.
- **D-83**: rename 은 same-DB 만 (`admin.renameCollection "<db>.<from>"
  -> "<db>.<to>"`). cross-DB 는 `dropTarget`, 권한 등 별도 UX 가
  필요해 별 sprint.
- **D-84**: drop mode 는 기존 `dropCollection` wrapper 를 통해 dispatch.
  CollectionDdlDialog 가 confirm copy + Save 만 추가.

## 다음 (Sprint 327 D-72 +3 shift 라인업)

- **Sprint 335** — RDB/Mongo CREATE/DROP DATABASE (Slice M live wire).
- **Sprint 336** — Mongo `currentOp` / `killOp` + RDB pg_stat_activity
  wire (U1).
- **Sprint 337** — Mongo `cursor.explain()` + RDB EXPLAIN ANALYZE (U2).
- **Sprint 338** — Mongo `collStats` + RDB pg_stat_user_tables (U3).
- **Sprint 339** — Mongo `buildInfo` + `serverStatus` + RDB pg_settings (U4).
- **Sprint 340** — Mongo `system.profile` + RDB pg_stat_statements (U5).
