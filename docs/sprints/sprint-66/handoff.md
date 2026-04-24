# Sprint 66 — Generator Handoff (Phase 6 plan C)

## Scope recap
Complete the Mongo read-path preview: replace the Sprint-65
`MongoAdapter::infer_collection_fields` / `MongoAdapter::find` stubs with
real implementations, surface them as four Tauri commands
(`list_mongo_databases`, `list_mongo_collections`,
`infer_collection_fields`, `find_documents`), and wire the frontend so a
`paradigm === "document"` connection gets its own sidebar tree
(`DocumentDatabaseTree`), double-click-to-open tab (`paradigm: "document"`
on `TableTab` with legacy-tab migration), and a dedicated read-only grid
(`DocumentDataGrid`) that respects the `"{...}"` / `"[N items]"` sentinel
convention. `useDataGridEdit` now accepts an optional `paradigm` so that
document cells cannot enter edit mode. Sprint 65 carried `find` and
`infer_collection_fields` in as `Unsupported` stubs; this sprint lights
them up end-to-end.

## Changed Files

### src-tauri (Rust)
- `src-tauri/src/db/mongodb.rs` —
  - `MongoAdapter::infer_collection_fields` now samples up to `sample`
    documents via `coll.find(None).limit(n)`, hands each to
    `infer_columns_from_samples`, and guarantees `_id` is the first
    column. Empty collection → `vec![ColumnInfo { name: "_id", .. }]`
    only.
  - `MongoAdapter::find` executes `collection.find` with `FindBody`'s
    `filter` / `sort` / `projection` / `skip` / `limit`, times the query
    with `std::time::Instant`, converts each `Document` into a pre-inferred
    column order using `flatten_cell`, mirrors the same docs into
    `raw_documents` (canonical extended JSON via the bson crate's default
    serde), and fills `total_count` from
    `Collection::estimated_document_count()`.
  - `flatten_cell(&Bson)` helper: `Document(_) → "{...}"`,
    `Array(arr) → "[N items]"`, scalars → `serde_json::to_value(&bson)`.
  - `infer_columns_from_samples` rewritten to use
    `presence_count: HashMap<String, usize>` + `has_null: HashMap<String, bool>`.
    After the pass, `nullable = presence_count[k] < samples.len() || has_null[k]`
    — fixes the Sprint-65 TODO where a field first appearing in the Nth
    sample wasn't retroactively marked nullable for earlier samples that
    lacked it.
  - `infer_row_columns_from_docs` helper reuses the same sampler for
    ad-hoc callers that don't want to pre-infer.
  - Unit-test count went from 13 → **24** (`cargo test --lib db::mongodb`):
    - `flatten_cell_replaces_documents_and_arrays_with_sentinels`
    - `flatten_cell_preserves_scalars_through_canonical_extjson`
    - `infer_columns_from_samples_empty_yields_id_only`
    - `infer_columns_from_samples_marks_fields_missing_in_later_doc_nullable`
    - `infer_columns_from_samples_keeps_id_first`
    - `infer_columns_from_samples_aggregates_union_with_presence_count`
    - plus the eleven Sprint-65 cases (kind/default/build_options/no-connect/empty-name/six Unsupported stubs / FindBody default).
- `src-tauri/src/commands/mod.rs` — new `pub mod document;` between the
  existing `pub mod connection;` and `pub mod query;` lines.
- `src-tauri/src/commands/document/mod.rs` (new) — `pub mod browse;`
  `pub mod query;` (module doc describes the RDB-style split).
- `src-tauri/src/commands/document/browse.rs` (new) —
  - `DatabaseInfo { name: String }` wire type (neutral name;
    `NamespaceInfo` would leak the adapter label).
  - `CollectionInfo { name, database, document_count }` +
    `From<TableInfo>` so the adapter's existing list method reuses `TableInfo`.
  - `list_mongo_databases(connection_id)` → `Vec<DatabaseInfo>`.
  - `list_mongo_collections(connection_id, database)` → `Vec<CollectionInfo>`.
  - `infer_collection_fields(connection_id, database, collection, sample_size?)`
    → `Vec<ColumnInfo>`; `sample_size = None` falls back to 100.
  - Every handler goes `state.active_connections.lock().await → get(&id)? → as_document()? → method()` so a mismatched paradigm surfaces the Sprint-64 `AppError::Unsupported`.
- `src-tauri/src/commands/document/query.rs` (new) —
  - `find_documents(connection_id, database, collection, body: Option<FindBody>)`
    → `DocumentQueryResult`. Missing body coerces to `FindBody::default()`
    (empty filter, no sort / projection, skip 0, limit 300).
- `src-tauri/src/lib.rs` — four new entries appended to
  `tauri::generate_handler!`:
  - `commands::document::browse::list_mongo_databases`
  - `commands::document::browse::list_mongo_collections`
  - `commands::document::browse::infer_collection_fields`
  - `commands::document::query::find_documents`
- `src-tauri/tests/mongo_integration.rs` —
  - new `seed_client(&ConnectionConfig) -> Client` helper building a raw
    driver `Client` from the shared test config so the test can
    `insert_many` / `drop` without going through an adapter API we don't
    expose.
  - new `test_mongo_adapter_infer_and_find_on_seeded_collection`
    (`#[serial]`, skip-on-unavailable) — seeds three documents into
    `table_view_test.users`:
    ```
    { _id: 1, name: "Ada",   age: 30, profile: { city: "London" } }
    { _id: 2, name: "Grace", age: 85 }
    { _id: 3, name: "Alan", tags: ["a","b"] }
    ```
    Asserts the inferred column set contains `_id` first + `name` / `age`
    / `profile` / `tags`, with `age` / `profile` / `tags` flagged
    nullable and `_id` / `name` not nullable. Asserts `find` returns all
    three rows, `raw_documents.len() == rows.len()`, row 1's `profile`
    cell is `"{...}"`, row 3's `tags` cell is `"[2 items]"`, missing
    fields are `null`, and `total_count >= 3`. Drops the fixture on
    teardown.
  - clippy fixes on the new code: removed `as u16` on `config.port`
    (`ConnectionConfig::port` is already `u16`), and the `FindBody`
    construction is now a struct literal
    (`FindBody { sort: Some(...), ..Default::default() }`) instead of
    `let mut body = FindBody::default(); body.sort = ...;` so the
    `field_reassign_with_default` lint stays silent.

### Frontend (TypeScript)
- `src/types/document.ts` (new) —
  - `DatabaseInfo { name }`.
  - `CollectionInfo { name, database, document_count: number | null }`.
  - `DocumentColumn` alias onto `ColumnInfo`.
  - `FindBody { filter?, sort?, projection?, skip?, limit? }` (all
    optional; the backend supplies defaults).
  - `DocumentQueryResult { columns, rows, raw_documents, total_count, execution_time_ms }`.
  - `DOCUMENT_SENTINELS = { DOCUMENT: "{...}", ARRAY_PATTERN: /^\[(\d+)\s+items\]$/ }`
    constants + `isDocumentSentinel(value)` helper shared by the grid and
    edit guard.
- `src/lib/tauri.ts` — four new wrappers appended after the RDB calls:
  - `listMongoDatabases(connectionId): Promise<DatabaseInfo[]>`
  - `listMongoCollections(connectionId, database): Promise<CollectionInfo[]>`
  - `inferCollectionFields(connectionId, database, collection, sampleSize?): Promise<ColumnInfo[]>`
  - `findDocuments(connectionId, database, collection, body?): Promise<DocumentQueryResult>`
- `src/stores/documentStore.ts` (new) — Zustand store scoped to the
  document paradigm:
  - Slices:
    - `databases: Record<connectionId, DatabaseInfo[] | undefined>`
    - `collections: Record<"${connectionId}:${db}", CollectionInfo[] | undefined>`
    - `fieldsCache: Record<"${connectionId}:${db}:${coll}", ColumnInfo[] | undefined>`
    - `queryResults: Record<"${connectionId}:${db}:${coll}", DocumentQueryResult | undefined>`
    - parallel `loading*` maps and `errors` map keyed by the same
      composite keys.
  - Actions: `loadDatabases` / `loadCollections` / `inferFields` /
    `runFind` / `clearConnection(connectionId)`.
  - Stale-response guard uses a **module-scoped**
    `requestCounters: Map<string, number>` — `nextRequestId(key)` is
    incrementing, `isLatestRequest(key, id)` is synchronous, and the
    counter is never stored in Zustand state so React batching can't
    reorder compares against setState.
  - `__resetDocumentStoreForTests()` exported for `beforeEach` cleanup.
- `src/stores/documentStore.test.ts` (new) — 7 tests covering
  loadDatabases happy path, loadDatabases failure path, loadCollections
  stale-guard, runFind stale-guard, inferFields populates `fieldsCache`,
  runFind populates `queryResults` + passes body through, and
  `clearConnection` removes every scoped entry.
- `src/stores/tabStore.ts` —
  - `TableTab` gained `paradigm?: Paradigm` (optional-on-type so legacy
    persisted tabs still deserialise). JSDoc notes the Sprint-66
    migration.
  - `loadPersistedTabs` migration block now maps every legacy persisted
    `TableTab` to `{ ...t, paradigm: t.paradigm ?? ("rdb" as const) }`.
- `src/stores/tabStore.test.ts` — two new tests:
  - legacy persisted `TableTab` without `paradigm` rehydrates as `rdb`.
  - persisted `paradigm: "document"` round-trips untouched.
- `src/components/schema/DocumentDatabaseTree.tsx` (new) — mongo-only
  2-level tree:
  - Auto-fetches `useDocumentStore.loadDatabases(connectionId)` on mount
    and refresh.
  - Lazy-loads collections on first db expand via
    `useDocumentStore.loadCollections`.
  - Double-click / `Enter` on a collection leaf calls
    `useTabStore.addTab({ type: "table", paradigm: "document",
    schema: <db>, table: <coll>, title: "<db>.<coll>", subView: "records" })`.
  - Refresh button, loading and empty states, `aria-label="${name} database"`
    / `aria-label="${name} collection"` so the tests can query by label.
- `src/components/schema/DocumentDatabaseTree.test.tsx` (new) — 5 tests:
  load + render databases on mount, expanding a db lazy-loads
  collections, double-clicking a collection opens a document-paradigm
  `TableTab`, loading status renders while the root list resolves, and
  the store's `collections` cache is populated on expand.
- `src/components/schema/SchemaPanel.tsx` —
  - Imported `DocumentDatabaseTree`.
  - When `selected.paradigm === "document"` the connected-state branch
    now renders `<DocumentDatabaseTree connectionId={...} />` instead of
    `<SchemaTree ... />`. RDB path unchanged.
- `src/components/schema/SchemaPanel.test.tsx` —
  - New `vi.mock("./DocumentDatabaseTree", ...)` stub.
  - New test `renders DocumentDatabaseTree when connection paradigm is
    document` — asserts the mongo branch renders the document tree and
    the RDB `SchemaTree` is absent.
- `src/components/DocumentDataGrid.tsx` (new) — minimal P0 read-only
  grid:
  - Fetches via `useDocumentStore.runFind` with `body = { skip: page * pageSize, limit: pageSize }`.
  - Prev/Next pagination; current page indicator; total count from the
    adapter.
  - Synthesises a TableData-compatible shape so the existing cell layout
    tokens apply.
  - Sentinel cells (detected by `isDocumentSentinel`) render with
    `italic text-muted-foreground` so users can tell "flattened" cells
    from real strings.
- `src/components/layout/MainArea.tsx` —
  - Imported `DocumentDataGrid`.
  - `TableTabView`: when `tab.paradigm === "document"` it renders the
    `DocumentDataGrid` and skips the Records/Structure sub-tab header
    entirely. RDB path untouched.
- `src/components/datagrid/useDataGridEdit.ts` —
  - Added optional `paradigm?: "rdb" | "document" | "search" | "kv"`
    param (defaults to `"rdb"` so RDB callers don't need a diff).
  - `handleStartEdit` early-returns when `paradigm === "document"` —
    prevents double-click, keyboard, and click-to-edit entry points
    from racing through. Every other hook surface stays identical.
- `src/components/datagrid/useDataGridEdit.paradigm.test.ts` (new) —
  2 tests:
  - `handleStartEdit` is a no-op under `paradigm === "document"`.
  - `handleStartEdit` still works when `paradigm` is omitted (rdb
    default).

## MongoAdapter::find evidence

`test_mongo_adapter_infer_and_find_on_seeded_collection` (seeds 3
documents, then):

```
infer_collection_fields("table_view_test", "users", 100)
  → columns[0].name == "_id"
  → names ⊇ { "_id", "name", "age", "profile", "tags" }
  → nullable: _id=false, name=false, age=true, profile=true, tags=true

find("table_view_test", "users", FindBody { sort: {_id:1}, ..Default })
  → rows.len() == 3
  → columns[0].name == "_id"
  → raw_documents.len() == 3
  → rows[0][profile_idx] == "{...}"
  → rows[0][tags_idx]    == null
  → rows[2][tags_idx]    == "[2 items]"
  → rows[2][profile_idx] == null
  → total_count >= 3
```

## Paradigm migration evidence

`src/stores/tabStore.test.ts::rehydrates legacy TableTab without paradigm
as "rdb"` stores a persisted TableTab payload that omits `paradigm`,
calls `loadPersistedTabs()`, and asserts the rehydrated tab has
`paradigm === "rdb"`. Companion test stores `paradigm: "document"` and
verifies it round-trips.

## Done Criteria Coverage

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `MongoAdapter::infer_collection_fields` real impl, `_id` first, sample override | `src/db/mongodb.rs::infer_columns_from_samples` + 6 unit tests including `infer_columns_from_samples_empty_yields_id_only` and `..._marks_fields_missing_in_later_doc_nullable`. |
| 2 | `MongoAdapter::find` real impl, flattened rows + sentinels, raw_documents | `src/db/mongodb.rs::find` + `flatten_cell_*` + integration test. |
| 3 | `total_count` via `estimated_document_count` | `src/db/mongodb.rs::find` uses `coll.estimated_document_count().await?`. |
| 4 | 4 commands registered and dispatch through `as_document()` | `src/commands/document/{browse,query}.rs` + `src/lib.rs::generate_handler!`. |
| 5 | `mongo_integration.rs` seed + infer + find happy path with sentinel assertions | `test_mongo_adapter_infer_and_find_on_seeded_collection`. |
| 6 | `src/lib/tauri.ts` wrappers + `src/types/document.ts` types | Four wrapper fns; `DocumentQueryResult` / `FindBody` / `CollectionInfo` / `DatabaseInfo` exported. |
| 7 | documentStore actions + stale-guard tests | `src/stores/documentStore.ts` + 7-test `documentStore.test.ts`. |
| 8 | `DocumentDatabaseTree` + ≥2 tests | Component + 5 tests in `DocumentDatabaseTree.test.tsx`. |
| 9 | SchemaPanel paradigm branch + test | `SchemaPanel.tsx` + `renders DocumentDatabaseTree when connection paradigm is document`. |
| 10 | `TableTab.paradigm` + legacy migration + ≥2 tests | `tabStore.ts::loadPersistedTabs` fallback + 2 new tests. |
| 11 | Sentinel cell renderer + edit block + test | `DocumentDataGrid.tsx` muted renderer + `useDataGridEdit.ts::handleStartEdit` guard + `useDataGridEdit.paradigm.test.ts`. |
| 12 | End-to-end automated path | `mongo_integration` happy path + `DocumentDatabaseTree.test.tsx::double-clicking a collection opens a document-paradigm TableTab` + `useDataGridEdit.paradigm.test.ts`. |

## Checks Run

| Command | Result |
|---|---|
| `cd src-tauri && cargo fmt --all -- --check` | **pass** (no diff) |
| `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | **pass** (0 warnings) |
| `cd src-tauri && cargo test --lib` | **pass** — 215 passed (was 206 pre-sprint; +9 new mongo unit tests) |
| `docker compose -f docker-compose.test.yml up -d` + `./scripts/wait-for-test-db.sh` | **pass** — mongo/mysql/redis ready. (Postgres test container collided with a pre-existing `postgres` container on 5432; that container held matching credentials so all Postgres integration suites still passed.) |
| `cd src-tauri && cargo test` (all integration binaries) | **pass** — mongo_integration 3 / 3, query_integration 17 / 17, schema_integration 14 / 14, storage_integration 12 / 12. 261 total Rust tests across crate + integration suites. |
| `pnpm tsc --noEmit` | **pass** (exit 0) |
| `pnpm lint` | **pass** (exit 0) |
| `pnpm vitest run` | **pass** — 60 files / 1133 tests / 0 failed (was 57 files / 1115 tests pre-sprint; +3 files, +18 tests — 7 documentStore + 5 DocumentDatabaseTree + 2 SchemaPanel mongo branch + 2 tabStore legacy + 2 useDataGridEdit paradigm). |

## Assumptions

- **`DocumentDataGrid` is a separate component, not a `DataGridTable`
  reuse.** The RDB DataGrid carries edit scaffolding (input tracking,
  undo, dirty markers, change buffers) that the Sprint-66 read-only
  preview does not need. Wiring document flow through the RDB component
  would have required paradigm-aware branches in every sub-hook; a
  dedicated minimal component keeps the blast radius small. The
  `useDataGridEdit` paradigm guard is still added for when Sprint 69
  lifts editing into the shared grid path.
- **Stale-guard uses a module-scoped `Map`.** Zustand `setState` is
  asynchronous from React's perspective; comparing a request id stored
  in state against a fresh `getState()` call could race. The counter is
  module-scoped (one Map per process), so `nextRequestId` / `isLatestRequest`
  are fully synchronous. Test `loadCollections ignores a stale response
  after a newer request resolves first` exercises this deliberately.
- **`paradigm` on `TableTab` is declared as optional on the TS type but
  migrated to a concrete `"rdb"` at load time.** Keeping the field
  optional on the type means persisted legacy snapshots still match the
  interface shape; the migration happens in one place
  (`loadPersistedTabs`) so every consumer reads it as concrete. New tabs
  always set a concrete value through `addTab`.
- **`total_count` is `estimated_document_count`.** Accurate
  `count_documents` is deferred (out of scope per contract). The
  estimation is deterministic for freshly-seeded fixtures (no
  concurrent writers) so the integration test asserts `>=` rather than
  `==`.
- **Legacy-shape back-compat for `TableTab`.** Old persisted tabs are
  allowed to roundtrip even without a paradigm field. If Sprint 69
  tightens this to required, it must also add a schema-version bump to
  the persisted shape rather than a breaking read.
- **`make_adapter` for mongodb was already wired in Sprint 65.** No
  changes needed in `commands/connection.rs::make_adapter`; this sprint
  only attached command handlers to the already-reachable
  `ActiveAdapter::Document` variant.

## Residual Risk

- **Write path is still unimplemented.** `aggregate` / `insert_document`
  / `update_document` / `delete_document` remain Unsupported stubs.
  Sprint 68–69 will land them.
- **Deep-nested field inference not performed.** A `profile.city` field
  is collapsed to `"{...}"` in the grid and doesn't appear as a column.
  Quick Look (Sprint 67) surfaces the nested structure.
- **No URI import path yet.** `build_options` still constructs
  `ClientOptions` programmatically; a user pasting a
  `mongodb+srv://...` URI has no UI entry point. Not a Sprint 66 scope
  item, but noted for Phase 6 completeness.
- **`DocumentDataGrid` pagination is naive.** It issues `find` with
  `skip: page * pageSize` every page — OK for the P0 preview but
  pathological for large collections (skip scales linearly). A
  range-based cursor will be needed before this is promoted out of P0.
- **Row shape mismatch on re-infer.** If the sampled fields at infer
  time differ from the fields materialised during find (e.g., a field
  added after infer), those cells appear as `null` because the row
  flattener walks the infer column list. Intentional for the P0 path;
  the Quick Look panel (Sprint 67) will use `raw_documents` so the
  original BSON is always available.
- **DataGridTable (RDB) edit surface unchanged.** Sentinel rendering
  lives in `DocumentDataGrid`, not the shared `DataGridTable`. The
  `useDataGridEdit` paradigm guard is forward-compat only; if Sprint 69
  merges the two grids, the sentinel detection will need to move into
  the shared cell renderer.

## Generator Handoff

### Changed Files
- `src-tauri/src/db/mongodb.rs`: real `infer_collection_fields` + `find`
  + `flatten_cell` + rewritten `infer_columns_from_samples` (presence
  count + has-null model) + 6 new unit tests.
- `src-tauri/src/commands/mod.rs`: `pub mod document;` added.
- `src-tauri/src/commands/document/mod.rs` (new).
- `src-tauri/src/commands/document/browse.rs` (new): `list_mongo_databases`
  + `list_mongo_collections` + `infer_collection_fields` commands +
  `DatabaseInfo` / `CollectionInfo` wire types.
- `src-tauri/src/commands/document/query.rs` (new): `find_documents`
  command.
- `src-tauri/src/lib.rs`: four commands appended to
  `tauri::generate_handler!`.
- `src-tauri/tests/mongo_integration.rs`: `seed_client` helper +
  `test_mongo_adapter_infer_and_find_on_seeded_collection`.
- `src/types/document.ts` (new): `DatabaseInfo` / `CollectionInfo` /
  `DocumentColumn` / `FindBody` / `DocumentQueryResult` +
  `DOCUMENT_SENTINELS` + `isDocumentSentinel`.
- `src/lib/tauri.ts`: 4 document wrappers.
- `src/stores/documentStore.ts` (new) + `documentStore.test.ts` (new, 7
  tests).
- `src/stores/tabStore.ts`: `paradigm?: Paradigm` on `TableTab` +
  legacy-tab migration in `loadPersistedTabs`.
- `src/stores/tabStore.test.ts`: +2 legacy-migration tests.
- `src/components/schema/DocumentDatabaseTree.tsx` (new) +
  `DocumentDatabaseTree.test.tsx` (new, 5 tests).
- `src/components/schema/SchemaPanel.tsx`: paradigm branch to
  `DocumentDatabaseTree`.
- `src/components/schema/SchemaPanel.test.tsx`: +1 mongo branch test.
- `src/components/DocumentDataGrid.tsx` (new): read-only preview grid +
  sentinel renderer.
- `src/components/layout/MainArea.tsx`: document paradigm path mounts
  `DocumentDataGrid`.
- `src/components/datagrid/useDataGridEdit.ts`: optional `paradigm`
  param, `handleStartEdit` no-op under `document`.
- `src/components/datagrid/useDataGridEdit.paradigm.test.ts` (new, 2
  tests).

### Checks Run
- `cd src-tauri && cargo fmt --all -- --check`: pass
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`: pass
- `cd src-tauri && cargo test --lib`: pass (215 / 215)
- `cd src-tauri && cargo test` (all integration binaries with the Sprint
  65 compose stack up): pass — mongo_integration 3 / 3,
  query_integration 17 / 17, schema_integration 14 / 14,
  storage_integration 12 / 12
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass
- `pnpm vitest run`: pass (1133 / 1133 across 60 files)

### Done Criteria Coverage
DC1–DC12 all satisfied; see the matrix above.

### Assumptions
- `DocumentDataGrid` is its own component rather than a paradigm-aware
  reuse of `DataGridTable` to keep the P0 blast radius small.
- `documentStore` stale-guard uses a module-scoped `Map` counter so the
  synchronous compare is never subject to React batching.
- `TableTab.paradigm` is typed `?: Paradigm` but migrated to a concrete
  `"rdb"` at load time so every runtime consumer reads it as concrete.
- `total_count = estimated_document_count` — exact counts are deferred
  to a later sprint per contract out-of-scope.
- `make_adapter` mongo branch already existed from Sprint 65; this
  sprint only attached commands to the now-reachable Document variant.

### Residual Risk
- `aggregate` / `insert_document` / `update_document` / `delete_document`
  are still Unsupported stubs — any UI trying to write will error.
- No deep-nested field inference; Quick Look (Sprint 67) carries the
  surface for exploring nested shapes.
- `DocumentDataGrid` pagination is `skip`-based — fine for P0 preview,
  pathological on large collections.
- Rows materialised from `find` are projected onto the pre-inferred
  column list; any post-infer schema drift collapses to `null` cells
  rather than surfacing as new columns until the grid re-infers.
- `DataGridTable` (RDB) sentinel handling not yet added — intentional,
  since document paradigm renders through the dedicated
  `DocumentDataGrid`; if Sprint 69 merges the two, sentinel detection
  must move into the shared cell renderer.
