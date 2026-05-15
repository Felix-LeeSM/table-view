# Sprint 332 Handoff — Slice J live wire (Mongo list_indexes)

날짜: 2026-05-15

## 결과

- 신규 backend: `DocumentAdapter::list_collection_indexes` +
  `MongoAdapter` impl + `list_mongo_indexes` Tauri command.
- 신규 frontend: `listMongoIndexes` wrapper + IndexesPanel 실 fetch
  + grid 렌더링.
- 회귀: 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
- `pnpm vitest run --no-coverage` — 3776 통과 / 10 skipped (sprint-331
  3773 → +3; sprint 327 placeholder 2 cases 가 5 신규로 교체).
- tsc / lint exit 0.

## 변경 파일

### Backend
- `src-tauri/src/db/traits.rs` — `DocumentAdapter::list_collection_indexes` 추가.
- `src-tauri/src/db/mongodb.rs` — trait impl wire.
- `src-tauri/src/db/mongodb/schema.rs` — `list_collection_indexes_impl`
  + `map_index_model` + `keys_to_default_name` helpers.
- `src-tauri/src/db/testing.rs` — `StubDocumentAdapter` field + impl.
- `src-tauri/src/db/tests.rs` — `DummyDocument` + `FakeCancellableDocument`
  impl 추가.
- `src-tauri/src/commands/document/browse.rs` — `list_mongo_indexes` cmd.
- `src-tauri/src/lib.rs` — invoke_handler 등록.

### Frontend
- `src/lib/tauri/document.ts` — `listMongoIndexes` wrapper.
- `src/components/schema/IndexesPanel.tsx` — Mongo live wire (loading /
  error / empty / table 4 state). RDB 는 placeholder 유지.
- `src/components/schema/IndexesPanel.test.tsx` — 5 신규 cases.

## 의사결정

- **D-77**: Mongo IndexInfo 매핑.
  - `name` = options.name (fallback: keys-derived).
  - `columns` = key spec field names (insertion order).
  - `index_type` = special key value (text/hashed/2dsphere/2d/geoHaystack)
    우선, 일반은 fields >= 2 → "compound", 단일은 "btree".
  - `is_unique` = options.unique == Some(true).
  - `is_primary` = name == "_id_".
  RDB IndexInfo 의 same wire shape 을 재사용 — frontend 가 paradigm
  없이 grid 렌더 가능.

- **D-78**: `$indexStats` (usage stats) 는 본 sprint scope **외**. driver
  의 일반 aggregate 호출로 가능하지만 IndexInfo 에 새 필드 (usage_count,
  last_used) 추가 + RDB 측은 비대응이라 wire shape 분기 필요. 별 sprint.

## 다음 (Sprint 327 D-72 +3 shift 라인업)

- **Sprint 333** — Mongo `collMod {validator}` (Slice K live wire) +
  ValidatorPanel (Sprint 327 placeholder 교체).
- **Sprint 334** — Mongo `createCollection` / `renameCollection`
  (Slice L live wire).
- **Sprint 335** — RDB/Mongo CREATE/DROP DATABASE (Slice M live wire).
- **Sprint 336** — Mongo `currentOp` / `killOp` + RDB pg_stat_activity
  wire (U1 live wire).
- ... (sprint 340 까지)
