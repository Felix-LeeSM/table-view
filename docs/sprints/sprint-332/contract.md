# Sprint 332 Contract — Slice J live wire (Mongo list_indexes)

날짜: 2026-05-15

## Scope

Sprint 327 의 IndexesPanel placeholder 를 Mongo paradigm 에서 라이브
화한다. backend `list_collection_indexes` trait fn + Tauri command +
frontend wrapper + grid 렌더링.

RDB paradigm 의 wire 는 별도 sprint — `getTableIndexes` 가 `(table, schema)`
인자를 요구하는데 IndexesPanel 의 현재 prop 표면 `(database, collection)`
은 schema 매핑이 모호하다. 정리되면 진행.

## Done Criteria

1. **Backend**:
   - `DocumentAdapter` trait 에 `fn list_collection_indexes(db, coll)
     -> Vec<IndexInfo>` 추가.
   - `MongoAdapter::list_collection_indexes_impl` — driver
     `Collection::list_indexes()` cursor 를 `IndexInfo` 로 매핑
     (`is_primary = name == "_id_"`, special index name from key value).
   - Tauri command `list_mongo_indexes(connId, db, collection)` 등록.
   - testing stubs (`StubDocumentAdapter`, `DummyDocument`,
     `FakeCancellableDocument`) trait fn impl 추가.
   - `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
2. **Frontend**:
   - `@/lib/tauri/document.ts` 에 `listMongoIndexes` wrapper.
   - `IndexesPanel` 의 `paradigm === "document"` 분기 가 실 fetch +
     loading/error/empty/grid 4 state.
   - `paradigm === "table"` 은 sprint 327 placeholder 유지 (schema 인자
     흐름 정리 후 별도 sprint).
3. **테스트**:
   - frontend ≥ 4 신규 RTL: row 매핑 + empty + error + RDB placeholder
     잔존.
   - tsc / lint / vitest sweep exit 0; sprint-331 3773 → +3.

## Out of Scope

- RDB IndexesPanel wire (별도 sprint).
- Mongo `$indexStats` aggregate (별 sprint — usage stats 는 backend
  추가 wrapper 가 필요).
- IndexesPanel 을 어디에 mount 할지 (StructurePanel tab 추가 등).

## Verification Plan

- Profile: `mixed` (Rust clippy + JS vitest).
- Required checks:
  1. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
  2. `cargo test --lib mongodb::schema` 통과 (8 cases).
  3. `pnpm vitest run --no-coverage` — sprint-331 3773 → +3.
  4. `pnpm tsc --noEmit` exit 0.
  5. `pnpm lint` exit 0.
