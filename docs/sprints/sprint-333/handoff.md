# Sprint 333 Handoff — Slice K live wire (Mongo collMod validator)

날짜: 2026-05-15

## 결과

- 신규 backend: `DocumentAdapter::get_collection_validator` +
  `set_collection_validator` + `MongoAdapter` impl + 2 Tauri commands
  (`get_mongo_validator`, `set_mongo_validator`).
- 신규 frontend: `getMongoValidator` / `setMongoValidator` wrapper +
  ValidatorPanel raw JSON editor + Save / Clear wire.
- 회귀: 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
- `pnpm vitest run --no-coverage` — 3781 통과 / 10 skipped (sprint-332
  3776 → +5; sprint 327 placeholder 1 case 가 6 신규로 교체).
- tsc / lint exit 0.

## 변경 파일

### Backend
- `src-tauri/src/db/traits.rs` — `DocumentAdapter::get_collection_validator`
  + `set_collection_validator` 추가.
- `src-tauri/src/db/mongodb.rs` — trait impl wire (두 메서드).
- `src-tauri/src/db/mongodb/schema.rs` —
  `get_collection_validator_impl` (`listCollections` cursor → options.validator
  → canonical extjson) + `set_collection_validator_impl` (`runCommand
  collMod` with validationLevel="moderate", validationAction="error";
  None payload = empty `{}` reset).
- `src-tauri/src/db/testing.rs` — `StubDocumentAdapter` 2 field +
  default + trait impl.
- `src-tauri/src/db/tests.rs` — `DummyDocument` + `FakeCancellableDocument`
  impl 2 추가.
- `src-tauri/src/commands/document/browse.rs` — `get_mongo_validator` /
  `set_mongo_validator` cmd + `_inner` 헬퍼.
- `src-tauri/src/lib.rs` — invoke_handler 등록.

### Frontend
- `src/lib/tauri/document.ts` — `getMongoValidator` / `setMongoValidator`
  wrapper.
- `src/components/document/ValidatorPanel.tsx` — Mongo live wire (raw
  JSON textarea + Save + Clear, loading / error / save-error 상태).
- `src/components/document/ValidatorPanel.test.tsx` — 6 신규 cases
  (sprint 327 placeholder 1 case 대체).

## 의사결정

- **D-79**: validator wire shape 은 `Option<serde_json::Value>` —
  bson::Document 를 직접 노출하면 EJSON 의 `$oid`/`$date` 표기까지 강제하게
  되는데, validator 는 거의 항상 plain JSON ($jsonSchema 등). canonical
  EJSON 으로 변환해 textarea 에 그대로 표시.
- **D-80**: validationLevel / validationAction 은 "moderate" / "error"
  로 하드코딩. 토글 UI 는 별 sprint (실 사용자 대부분이 default 라 P0 가
  raw editor 로 충분).
- **D-81**: 빈 textarea 는 `None` payload → Mongo `collMod
  validator:{}` reset. trailing whitespace 만 있어도 reset 으로 본다
  (사용자가 의도적으로 비운 경우와 구별 불가).

## 다음 (Sprint 327 D-72 +3 shift 라인업)

- **Sprint 334** — Mongo `createCollection` / `renameCollection`
  (Slice L live wire).
- **Sprint 335** — RDB/Mongo CREATE/DROP DATABASE (Slice M live wire).
- **Sprint 336** — Mongo `currentOp` / `killOp` + RDB pg_stat_activity
  wire (U1 live wire).
- **Sprint 337** — Mongo `cursor.explain()` + RDB EXPLAIN ANALYZE
  (U2 live wire).
- **Sprint 338** — Mongo `collStats` + RDB pg_stat_user_tables (U3).
- **Sprint 339** — Mongo `buildInfo` + `serverStatus` + RDB pg_settings
  (U4).
- **Sprint 340** — Mongo `system.profile` + RDB pg_stat_statements (U5).
