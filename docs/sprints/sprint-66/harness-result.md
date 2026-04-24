# Sprint 66 — Harness Result (Phase 6 plan C)

## Status: PASS
- Attempts: 1 / 5
- Overall Score: 8.55/10
- Verdict: 모든 dimension ≥ 7 통과

## Scorecard
| Dimension | Score |
|-----------|-------|
| Correctness (35%) | 9/10 |
| Completeness (25%) | 8/10 |
| Reliability (20%) | 8/10 |
| Verification Quality (20%) | 9/10 |

Weighted: 0.35·9 + 0.25·8 + 0.20·8 + 0.20·9 = **8.55/10**.

## Verification (8/8 통과)

| # | Command | Result |
|---|---|---|
| 1 | `cd src-tauri && cargo fmt --all -- --check` | pass (exit 0, no diff) |
| 2 | `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | pass (exit 0, 0 warnings) |
| 3 | `cd src-tauri && cargo test --lib` | pass — 215 / 215 |
| 4 | `docker compose -f docker-compose.test.yml up -d mongodb postgres` + `./scripts/wait-for-test-db.sh` | pass (mongo:7 + postgres + mysql + redis all healthy from pre-existing session; no PGPORT override needed) |
| 5 | `cargo test --test schema_integration --test query_integration --test mongo_integration` | pass — schema 14/14, query 17/17, mongo 3/3 (including new seeded infer+find test) |
| 6 | `pnpm tsc --noEmit` | pass (exit 0) |
| 7 | `pnpm lint` | pass (exit 0) |
| 8 | `pnpm vitest run` | pass — 60 files / 1133 tests |

Mongo integration live log:
```
running 3 tests
test test_mongo_adapter_ping_without_connect_returns_error ... ok
test test_mongo_adapter_infer_and_find_on_seeded_collection ... ok
test test_mongo_adapter_connect_ping_list_disconnect_happy_path ... ok
test result: ok. 3 passed; 0 failed
```

Inspection grep checks:
- `grep 'list_mongo_databases\|list_mongo_collections\|infer_collection_fields\|find_documents' src-tauri/src/lib.rs` → 4 hits at lines 48–51 (all registered in `tauri::generate_handler!`).
- `grep 'Err(AppError::Unsupported' src-tauri/src/db/mongodb.rs` → 4 hits (aggregate/insert/update/delete), matching the contract's Out of Scope list.
- `grep 'impl DocumentAdapter for MongoAdapter' src-tauri/src/db/mongodb.rs` → line 219; `find` at line 299 and `infer_collection_fields` at line 262 are real implementations.
- `grep 'paradigm === "document"' src/components/` → `SchemaPanel.tsx:104`, `MainArea.tsx:23`, `useDataGridEdit.ts:232` (all three paradigm branches).

## 주요 변경

### Backend (Rust)
- `src-tauri/src/db/mongodb.rs`: Sprint 65 `infer_collection_fields` + `find` stubs replaced with real implementations. Added `flatten_cell`, `bson_type_name`, `infer_columns_from_samples` (presence-count + has-null model that retroactively marks fields nullable when missing from earlier samples), `columns_from_docs`, `project_row`, `validate_ns`, `modal_type` helpers. Unit tests grew from 13 → 24 (including 2 infer helpers, 2 flatten_cell cases, 1 project_row, 1 modal-type). The 4 remaining `Unsupported` stubs (aggregate/insert/update/delete) are preserved with regression tests.
- `src-tauri/src/commands/document/mod.rs` (new): `pub mod browse; pub mod query;`.
- `src-tauri/src/commands/document/browse.rs` (new): `list_mongo_databases`, `list_mongo_collections`, `infer_collection_fields` commands + `DatabaseInfo` / `CollectionInfo` wire types. All three resolve through `state.active_connections.lock().await → get(&id)? → as_document()?`.
- `src-tauri/src/commands/document/query.rs` (new): `find_documents(connection_id, database, collection, body: Option<FindBody>)` → `DocumentQueryResult`; missing body coerces to `FindBody::default()` (empty filter, no sort/projection, skip 0, limit 300).
- `src-tauri/src/commands/mod.rs`: `pub mod document;` added.
- `src-tauri/src/lib.rs`: 4 new entries in `tauri::generate_handler!` at lines 48–51.
- `src-tauri/tests/mongo_integration.rs`: new `seed_client` helper + new `test_mongo_adapter_infer_and_find_on_seeded_collection` (`#[serial]`, skip-on-unavailable). Seeds 3 heterogeneous docs into `table_view_test.users`, asserts `infer` + `find` expected shapes + sentinel assertions + teardown drop.

### Frontend (TypeScript)
- `src/types/document.ts` (new): `DatabaseInfo`, `CollectionInfo`, `DocumentColumn`, `FindBody`, `DocumentQueryResult`, `DOCUMENT_SENTINELS` constants, `isDocumentSentinel(value)` helper.
- `src/lib/tauri.ts`: 4 new wrappers — `listMongoDatabases`, `listMongoCollections`, `inferCollectionFields`, `findDocuments`.
- `src/stores/documentStore.ts` (new): Zustand store with `databases`/`collections`/`fieldsCache`/`queryResults` slices, 5 actions (`loadDatabases`, `loadCollections`, `inferFields`, `runFind`, `clearConnection`), stale-response guard via module-scoped `requestCounters: Map<string, number>` (synchronous increment/compare, not in Zustand state). `__resetDocumentStoreForTests()` export for tests.
- `src/stores/documentStore.test.ts` (new, 7 tests): happy-path + failure-path for `loadDatabases`, stale-guard for `loadCollections` + `runFind`, cache population for `inferFields` + `runFind`, body passthrough, `clearConnection`.
- `src/stores/tabStore.ts`: `TableTab.paradigm?: Paradigm` added; `loadPersistedTabs` migration at line 305 maps legacy persisted tabs to `paradigm: "rdb"`.
- `src/stores/tabStore.test.ts`: +2 tests (legacy migration fallback + persisted-document round-trip).
- `src/components/schema/DocumentDatabaseTree.tsx` (new): 2-level tree (databases → collections). Auto-load on mount, lazy-load collections on first db expand, double-click-or-Enter opens a `paradigm: "document"` TableTab. Aria labels `"${name} database"` / `"${name} collection"` for test queries.
- `src/components/schema/DocumentDatabaseTree.test.tsx` (new, 5 tests): mount render, lazy-load on expand, double-click opens document TableTab, loading state, store cache population.
- `src/components/schema/SchemaPanel.tsx`: paradigm branch at line 104 — `paradigm === "document"` renders `DocumentDatabaseTree`, else `SchemaTree`.
- `src/components/schema/SchemaPanel.test.tsx`: +1 test (`renders DocumentDatabaseTree when connection paradigm is document`).
- `src/components/DocumentDataGrid.tsx` (new): minimal P0 read-only grid. Fetches via `useDocumentStore.runFind` with skip-based pagination, renders `{...}` / `[N items]` sentinel cells with italic muted tone, no inline edit.
- `src/components/layout/MainArea.tsx`: `TableTabView` routes `tab.paradigm === "document"` to `DocumentDataGrid`, bypassing Records/Structure sub-tabs. RDB path unchanged.
- `src/components/datagrid/useDataGridEdit.ts`: added optional `paradigm?: "rdb" | "document" | "search" | "kv"` param (default `"rdb"`). `handleStartEdit` early-returns under `paradigm === "document"`.
- `src/components/datagrid/useDataGridEdit.paradigm.test.ts` (new, 2 tests): paradigm-document guard + default-rdb still works.

## Done Criteria Coverage

DC1–DC13 all satisfied; full matrix in `findings.md`.

## 다음 단계

- **Sprint 67**: Quick Look panel (`BsonTreeViewer.tsx`) using `raw_documents` from `find`. Also good moment to extract a shared `TreeNode` primitive from `SchemaTree` + `DocumentDatabaseTree`.
- **Sprint 68**: `MongoAdapter::aggregate` real impl + Find/Aggregate 쿼리 탭 (`QueryEditor` paradigm branch + JSON CodeMirror mode + `execute_mongo_query` command).
- **Sprint 69**: Mongo 인라인 편집 / 문서 추가/삭제 (real `insert_document` / `update_document` / `delete_document`); converge `DocumentDataGrid` + `DataGridTable` behind the paradigm guard.
- **Backlog** (from Sprint 66 findings.md feedback):
  - Update Sprint-66-era "not implemented until Sprint 66" error messages to name the actual target sprint (4 call sites in `mongodb.rs`).
  - Move `DocumentDataGrid.tsx` under `src/components/datagrid/` to keep the grid surface in one directory.
  - Replace inline sentinel regex in `DocumentDataGrid.tsx:174-176` with the shared `isDocumentSentinel()` helper.
  - Document `estimated_document_count`'s eventual-consistency caveat near `totalPages` in `DocumentDataGrid`.
- **Deferred per contract**: exact `count_documents`, deep-nested field inference, MySQL/SQLite (Phase 9), mongo URI paste import (flagged in Sprint 65's residual risk).
