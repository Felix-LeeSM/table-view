# Sprint 65 — Generator Handoff (Phase 6 plan B)

## Scope recap
Deliver the first document-paradigm adapter (`MongoAdapter`) behind the
Sprint 63/64 paradigm traits. Only the lifecycle + namespace-enumeration
slice is implemented fully (`connect / disconnect / ping`, `list_databases`,
`list_collections`). The remaining six `DocumentAdapter` methods (`find`,
`aggregate`, `insert_document`, `update_document`, `delete_document`,
`infer_collection_fields`) return `AppError::Unsupported` stubs and are
exercised individually by unit tests. The sprint also pays off two Sprint 64
carry-over feedback items: the frontend `paradigm` field is tightened from
optional to required, and the backend `ConnectionConfigPublic.paradigm`
becomes a typed `Paradigm` enum. Three MongoDB-specific optional fields
(`auth_source`, `replica_set`, `tls_enabled`) land on both `ConnectionConfig`
shapes with `#[serde(default)]` back-compat and render conditionally in
`ConnectionDialog`.

## Changed Files

### src-tauri (Rust)
- `src-tauri/Cargo.toml` — added `mongodb = "3"` and `bson = "2"` dependencies.
- `src-tauri/src/models/connection.rs` —
  - new `Paradigm` enum (`Rdb`, `Document`, `Search`, `Kv`) with
    `#[serde(rename_all = "lowercase")]`, re-exported from `models/mod.rs`.
  - `DatabaseType::paradigm(&self) -> Paradigm` (return type tightened from
    `&'static str`).
  - `ConnectionConfig` gained `auth_source: Option<String>`,
    `replica_set: Option<String>`, `tls_enabled: Option<bool>`, all annotated
    with `#[serde(default)]` so pre-Sprint-65 `connections.json` files keep
    deserializing.
  - `ConnectionConfigPublic.paradigm: Paradigm` (was `String` + `#[serde(default)]`);
    `From<&ConnectionConfig>` now seeds it via `c.db_type.paradigm()`.
  - `ConnectionConfigPublic` also gained the three mongo optional fields
    with the same `#[serde(default)]` guard and propagation in `From`.
  - Unit tests: paradigm-mapping coverage, serialization asserts `"paradigm":"rdb"`
    / `"paradigm":"document"` (literal enum lowercase), and
    `connection_config_public_rejects_payload_without_paradigm_field`
    asserting a missing `paradigm` now fails to deserialize (breaking
    wire-format change relative to Sprint 64, intentional and documented
    in the test body).
- `src-tauri/src/db/mod.rs` —
  - new `pub mod mongodb;` exposing `MongoAdapter`.
  - `DocumentId::Raw` retyped from `serde_json::Value` to `bson::Bson`;
    `FindBody.filter/sort/projection` retyped to
    `bson::Document`/`Option<bson::Document>` (with `#[serde(default)]` on
    `filter` so an empty body is interpreted as "no filter").
  - `DocumentQueryResult.raw_documents: Vec<bson::Document>`.
  - `DocumentAdapter` method signatures now take `bson::Document` for
    aggregate pipelines, insert payloads, and update patches — no
    `serde_json::Value` placeholders remain on the trait surface.
  - Existing dummy-adapter test rebuilt on top of `bson::Document`.
- `src-tauri/src/db/mongodb.rs` (new) — `MongoAdapter` struct + impls.
  - `Arc<Mutex<Option<Client>>>` + `Arc<Mutex<Option<String>>>` (default_db)
    state mirrors `PostgresAdapter`'s locking pattern.
  - `build_options(&ConnectionConfig) -> ClientOptions` assembles options
    **programmatically** (no URI string) so passwords never need percent-encoding.
    Maps `auth_source` (falling back to `config.database` when credentials
    are supplied but `auth_source` is blank), `replica_set`,
    `tls_enabled`, and `connection_timeout` (feeds both `connect_timeout`
    and `server_selection_timeout`).
  - `connect` probes with `admin.ping` so failures surface eagerly rather
    than lazily on the next operation; `disconnect` drops the client to
    release pooled sockets.
  - `list_databases` → `Vec<NamespaceInfo>` via `Client::list_database_names`.
  - `list_collections(db)` validates non-empty name, then maps
    `database.list_collection_names()` into `TableInfo { name, schema: db, row_count: None }`.
  - Six Unsupported stubs, each mentioning the method name in the error
    message for easier trace-reading.
  - `#[cfg(test)] mod tests` — 13 test cases: kind + Default equivalence,
    `build_options` mapping (credential/repl_set/TLS/timeouts), `build_options`
    defaults (all None), no-connection ping/list_databases error shape,
    `list_collections` empty-name validation, the six Unsupported stubs,
    `FindBody::default` invariant.
- `src-tauri/src/commands/connection.rs` —
  - `make_adapter` gained a `DatabaseType::Mongodb => ActiveAdapter::Document(Box::new(MongoAdapter::new()))`
    branch; everything else still returns `AppError::Unsupported`.
  - Import-export `ConnectionConfig` struct literal gained the three new
    mongo option fields.
  - `ConnectionConfigPublic { ... }` test struct-literals (4 occurrences
    + sample fixtures) now use `paradigm: Paradigm::Rdb` and set the three
    mongo fields to `None`.
  - Five new unit tests (`test_make_adapter_postgres_returns_rdb_variant`,
    `..._mongodb_returns_document_variant`, `..._mysql_returns_unsupported`,
    `..._sqlite_...`, `..._redis_...`).
- `src-tauri/src/storage/mod.rs` — `sample_connection` fixture gained the
  three mongo fields (set to `None`).
- `src-tauri/src/db/postgres.rs` — `sample_config` test fixture gained the
  three mongo fields (set to `None`). **No non-test code changed.**
- `src-tauri/tests/common/mod.rs` —
  - imports `MongoAdapter` + `DbAdapter`.
  - `test_config` gained a `DatabaseType::Mongodb` branch
    (`MONGO_HOST`/`MONGO_PORT`/`MONGO_USER`/`MONGO_PASSWORD`/`MONGO_DATABASE`
    env overrides; `auth_source: Some("admin")` so the compose credentials
    authenticate against the default admin DB).
  - new `setup_mongo_adapter()` helper mirroring `setup_adapter`'s
    skip-on-unavailable pattern (prints `"SKIP: MongoDB database not available"`
    and returns `None`).
  - `available_dbms()` probes MongoDB in addition to Postgres.
  - Both setup helpers now carry `#[allow(dead_code)]` so cargo's
    per-test-crate dead-code warnings stay silent.
- `src-tauri/tests/mongo_integration.rs` (new) — two integration tests:
  - `test_mongo_adapter_connect_ping_list_disconnect_happy_path`
    (`#[serial]`): after skip check, asserts ping OK, `list_databases`
    non-empty and contains `admin`, `list_collections("admin")` OK,
    `list_collections("")` rejects with `"Database name"` in the message,
    clean disconnect OK, post-disconnect ping errors.
  - `test_mongo_adapter_ping_without_connect_returns_error`: always runs;
    asserts an un-connected adapter surfaces `Err` on `ping` instead of
    panicking.
- `src-tauri/tests/storage_integration.rs` — `sample_connection` fixture
  gained the three mongo fields.

### Frontend (TypeScript)
- `src/types/connection.ts` —
  - `paradigm: Paradigm` on `ConnectionConfig` tightened from optional to
    **required** (Sprint 64 carry-over #1).
  - `auth_source?: string | null`, `replica_set?: string | null`,
    `tls_enabled?: boolean | null` added as optional fields (mirrors the
    backend `#[serde(default)]` shape).
  - `createEmptyDraft()` now emits `paradigm: "rdb"`.
  - `draftFromConnection()` propagates `paradigm` plus the three mongo
    fields from the source `ConnectionConfig`.
  - `parseConnectionUrl()` now populates `paradigm: paradigmOf(dbType)` on
    the returned `Partial<ConnectionDraft>`.
- `src/types/connection.test.ts` —
  - existing postgresql/mysql parse assertions updated to include
    `paradigm: "rdb"` in the expected object.
  - new `createEmptyDraft` paradigm test.
  - new `parseConnectionUrl` paradigm-tagging tests for mongodb (→ `document`)
    and redis (→ `kv`).
- `src/components/connection/ConnectionDialog.tsx` —
  - `paradigmOf` imported alongside existing helpers.
  - `handleDbTypeChange` now also updates `paradigm: paradigmOf(dbType)`.
  - local `isMongo = form.db_type === "mongodb"` derived flag.
  - Database field label becomes `"Database (optional)"` and placeholder
    switches to `"Leave blank to default"` when Mongo is selected.
  - new conditional block (`{isMongo && …}`) renders three controls inside
    a framed "MongoDB Options" sub-panel: an `Auth Source` text input, a
    `Replica Set` text input, and an `Enable TLS` checkbox. Empty strings
    are coerced to `null` on save so the backend's
    `Option<String>::is_none()` treatment matches the UX expectation.
- `src/components/connection/ConnectionDialog.test.tsx` —
  - `makeConnection` factory gained `paradigm: "rdb"`.
  - new `describe("MongoDB conditional fields", …)` group — 4 tests:
    fields hidden for postgresql, fields appear after switching to mongodb,
    Database label becomes "(optional)" for mongo, saved draft surfaces
    `db_type: "mongodb"`, `paradigm: "document"`, and the three mongo
    fields exactly as set.
- 14 other frontend test files received `paradigm: "rdb"` in their local
  `ConnectionConfig`/`ConnectionDraft` fixture literals so `pnpm tsc --noEmit`
  stays clean under the required-paradigm change:
  - `src/components/layout/TabBar.test.tsx`
  - `src/components/schema/SchemaTree.test.tsx`
  - `src/components/layout/Sidebar.test.tsx`
  - `src/components/connection/ConnectionGroup.test.tsx`
  - `src/components/connection/ConnectionItem.test.tsx`
  - `src/stores/connectionStore.test.ts` (multiple occurrences + the
    inline `draft` literal in `delegates testConnection` and the inline
    `updateConnection` payload in `updates connection`)
  - `src/lib/connectionColor.test.ts`
  - `src/components/layout/MainArea.test.tsx`
  - `src/components/schema/SchemaPanel.test.tsx`
  - `src/components/shared/QuickOpen.test.tsx`
  - `src/components/query/GlobalQueryLogPanel.test.tsx`
  - `src/components/connection/ConnectionList.test.tsx`
  - `src/components/connection/ImportExportDialog.test.tsx`

## MongoAdapter option mapping (evidence)

The `build_options_maps_fields_to_client_options` test in
`src-tauri/src/db/mongodb.rs` exercises each field:

```
host/port         → ServerAddress::Tcp { host: "localhost", port: Some(27017) }
user+password     → Credential { username: Some("u"), password: Some("p"), source: Some("admin") }
auth_source: "admin" overrides config.database as the credential source
replica_set: rs0  → repl_set_name: Some("rs0")
tls_enabled: true → Tls::Enabled(TlsOptions::default())
connection_timeout: 5 → connect_timeout + server_selection_timeout = Duration::from_secs(5)
```

The companion `build_options_defaults_when_mongo_specific_fields_missing`
test asserts that all four option fields collapse to `None` when the input
config has no credentials, no replica set, no TLS flag, and no timeout —
proving the `#[serde(default)]` safety net reaches the driver intact.

## Paradigm enum wire-format evidence

`src-tauri/src/models/connection.rs` unit test
`connection_config_public_serializes_paradigm_for_postgres`:

```rust
let public = ConnectionConfigPublic::from(&conn);   // db_type = Postgresql
assert_eq!(public.paradigm, Paradigm::Rdb);
let json = serde_json::to_string(&public).unwrap();
assert!(json.contains("\"paradigm\":\"rdb\""));
```

The mongodb counterpart asserts `"paradigm":"document"`. The
`connection_config_public_rejects_payload_without_paradigm_field` test
confirms the tightening:

```rust
let raw = r#"{ "id": "c1", … /* no paradigm field */ }"#;
assert!(serde_json::from_str::<ConnectionConfigPublic>(raw).is_err());
```

## Sprint 64 carry-over resolution
- **Feedback #1 — frontend `paradigm` optional → required.** Done. 14
  downstream fixtures updated, `createEmptyDraft` + `draftFromConnection`
  + `parseConnectionUrl` all propagate the tag, and `ConnectionDialog`
  tracks the field as the user flips `db_type`.
- **Feedback #2 — `ConnectionConfigPublic.paradigm: String` → typed enum.**
  Done. Enum is `#[serde(rename_all = "lowercase")]` so the wire shape
  (`"rdb" | "document" | "search" | "kv"`) matches the frontend
  `Paradigm` string-literal union exactly.

## Checks Run

| Command | Result |
|---|---|
| `cd src-tauri && cargo fmt --all -- --check` | **pass** (no diff) |
| `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | **pass** (0 warnings) |
| `cd src-tauri && cargo test --lib` | **pass** — 206 passed / 0 failed (was 184 pre-sprint; +22 new unit tests) |
| `cd src-tauri && cargo test --test schema_integration --test query_integration --test storage_integration` | **pass** — 14 + 17 + 12 passed / 0 failed |
| `cd src-tauri && cargo test --test mongo_integration` | **pass** — 2 / 2 (live Mongo 7 container via docker-compose.test.yml) |
| `pnpm tsc --noEmit` | **pass** (exit 0) |
| `pnpm lint` | **pass** (exit 0) |
| `pnpm vitest run` | **pass** — 57 files / 1115 tests / 0 failed (was 1108 pre-sprint; +7 new tests) |

## Done Criteria Coverage

1. **MongoAdapter exists and implements `DbAdapter + DocumentAdapter`.** `src-tauri/src/db/mongodb.rs` with the lifecycle + 2 list methods fully wired and the 6 remaining methods returning `AppError::Unsupported`.
2. **Lifecycle + list_databases + list_collections proven.** Integration test `tests/mongo_integration.rs::test_mongo_adapter_connect_ping_list_disconnect_happy_path` exercises the full happy path against the mongo:7 compose container and passes.
3. **Unsupported stubs covered by unit tests.** Six `*_returns_unsupported` tests in `db/mongodb.rs::tests`.
4. **Mongo fields on `ConnectionConfig`.** `auth_source`, `replica_set`, `tls_enabled` added with `#[serde(default)]`; verified by `build_options_defaults_when_mongo_specific_fields_missing`.
5. **`make_adapter` routes mongodb → Document variant.** Verified by `test_make_adapter_mongodb_returns_document_variant`.
6. **Frontend conditional UI.** `ConnectionDialog` renders auth_source / replica_set / TLS only when `db_type === "mongodb"`, and the `Database` field label becomes "(optional)". Covered by 4 new tests under `"MongoDB conditional fields"`.
7. **`paradigm` required on frontend.** `ConnectionConfig.paradigm: Paradigm` (no `?`). `grep -n 'paradigm?:' src/types/connection.ts` returns 0.
8. **`Paradigm` enum on backend.** `ConnectionConfigPublic.paradigm: Paradigm` with lowercase serde; missing-field payloads now error out.
9. **Test infra.** `tests/common/mod.rs` has the `Mongodb` config + `setup_mongo_adapter`; `tests/mongo_integration.rs` has the integration test with the documented skip-on-unavailable pattern.
10. **Regression suite.** All 8 verification commands above pass. Postgres integration suite: 14 + 17 + 12 passing (0 regressions).

## Assumptions

- **Programmatic `ClientOptions` over URI parsing.** The contract leaves the
  construction style open. Building options field-by-field avoids forcing
  percent-encoding on users with `@`/`:`/`/` in passwords and keeps the
  TLS/replica-set/auth-source toggles typed instead of stringly. The
  downside is that future connection-string imports (if Sprint 66+ adds
  URI paste support) will need `ClientOptions::parse` routing; the current
  shape doesn't preclude that.
- **Auth source fallback to `config.database`.** When `auth_source` is
  blank and the user has filled in `database`, the database name is used
  as the credential source. This preserves the pre-Sprint-65 "database is
  auth DB" intuition while letting Mongo users override explicitly. If
  both are empty, no source is set and the driver defaults to `admin`.
- **`list_collections` returns `TableInfo { table_type: never set }`.**
  The existing `TableInfo` struct only has `name`, `schema`, `row_count`.
  Collections surface as `TableInfo { name: <coll>, schema: <db>, row_count: None }`
  so the downstream schema panels (Sprint 66+) can reuse the RDB tree UI
  without a parallel `CollectionInfo` type.
- **`DocumentId::Raw` uses `bson::Bson`.** `bson::Bson` is the natural
  "anything goes" escape hatch for non-`{Number, String}` `_id` shapes,
  and round-trips cleanly through `serde_json` via the bson crate's
  relaxed/canonical extended JSON support when serialized to the
  frontend.
- **`FindBody.filter: bson::Document` defaults to empty.** An empty
  document is the "no filter" contract MongoDB itself uses, so
  `#[serde(default)]` lets the frontend omit the field for unfiltered
  `find` calls without a sentinel value.
- **Sprint 64 feedback wire break is intentional.** Payloads that were
  still missing `paradigm` (the `#[serde(default)]` escape hatch added in
  Sprint 64) now fail to deserialize. The Sprint 65 contract explicitly
  requires tightening, and no persisted data in the codebase carries the
  old shape (every `ConnectionConfigPublic` producer sets the field), so
  this is an "emit once, consume always" change.
- **Test helper `setup_adapter` / `setup_mongo_adapter` dead-code lints.**
  Both helpers live in `tests/common/mod.rs` and aren't used by every
  integration test binary. `#[allow(dead_code)]` on both silences the
  per-binary warnings that the new mongo_integration crate exposed,
  without changing the helpers' public surface.

## Residual Risk

- **Mongo write-path is entirely unimplemented.** All six non-listing
  DocumentAdapter methods are stubs. Frontend has no document grid yet;
  any UI that eventually builds `find`/`aggregate` payloads will be
  writing against an `AppError::Unsupported` wall until Sprint 66 lands
  the query/mutation implementations.
- **No MongoDB UI tree yet.** `ConnectionDialog` surfaces the options and
  `make_adapter` routes to `MongoAdapter`, but the schema-tree sidebar
  still assumes the RDB tree shape. Selecting a mongo connection in the
  sidebar will drive the existing tree into an empty state until Sprint
  66 introduces a document tree.
- **`list_collections` empty-name guard is the only validation.** The
  adapter trusts MongoDB to validate collection names on subsequent
  operations. Sprint 66's `find`/`aggregate` implementations should add
  per-operation validation (or route through the bson document builder
  which already enforces key constraints) before the surface is exposed
  to end users.
- **TLS options are defaulted.** `Tls::Enabled(TlsOptions::default())`
  uses the system CA bundle with hostname verification on. Users on
  self-signed replica sets will need a follow-up UI (CA file picker,
  `allow_invalid_certificates`) that Sprint 65 intentionally doesn't
  deliver.

## Generator Handoff

### Changed Files
- `src-tauri/Cargo.toml`: +`mongodb = "3"`, +`bson = "2"`.
- `src-tauri/src/models/connection.rs`: `Paradigm` enum; `DatabaseType::paradigm` return type; three mongo fields on `ConnectionConfig` + `ConnectionConfigPublic`; serde tests.
- `src-tauri/src/models/mod.rs`: re-export `Paradigm`.
- `src-tauri/src/db/mod.rs`: `DocumentAdapter` DTOs retyped to `bson::Document`/`bson::Bson`; `mod mongodb;` registered.
- `src-tauri/src/db/mongodb.rs` (new): `MongoAdapter` + 13 unit tests.
- `src-tauri/src/db/postgres.rs`: test-fixture only — three mongo fields on `sample_config`.
- `src-tauri/src/commands/connection.rs`: `make_adapter` gained the mongodb branch; sample fixtures + `ConnectionConfigPublic` literals updated; five new `make_adapter` dispatch tests.
- `src-tauri/src/storage/mod.rs`: test-fixture only — three mongo fields on `sample_connection`.
- `src-tauri/tests/common/mod.rs`: `Mongodb` variant + `setup_mongo_adapter`; `available_dbms` extended; `#[allow(dead_code)]` on both setup helpers.
- `src-tauri/tests/mongo_integration.rs` (new): two integration tests.
- `src-tauri/tests/storage_integration.rs`: three mongo fields in `sample_connection`.
- `src/types/connection.ts`: `paradigm: Paradigm` required; three mongo optional fields; `createEmptyDraft` / `draftFromConnection` / `parseConnectionUrl` propagate paradigm.
- `src/types/connection.test.ts`: paradigm assertions + mongo/redis paradigm tests.
- `src/components/connection/ConnectionDialog.tsx`: conditional mongo fields + paradigm sync in `handleDbTypeChange`.
- `src/components/connection/ConnectionDialog.test.tsx`: `paradigm: "rdb"` in factory + 4 new mongo conditional-fields tests.
- 13 other frontend test files: `paradigm: "rdb"` added to local fixtures.

### Checks Run
- `cd src-tauri && cargo fmt --all -- --check`: pass
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`: pass
- `cd src-tauri && cargo test --lib`: pass (206/206)
- `cd src-tauri && cargo test --test schema_integration --test query_integration --test storage_integration`: pass (14 + 17 + 12)
- `cd src-tauri && cargo test --test mongo_integration`: pass (2/2, live mongo:7 container)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass
- `pnpm vitest run`: pass (1115/1115)

### Done Criteria Coverage
DC1–DC10 all satisfied; see the matrix above.

### Assumptions
- Programmatic `ClientOptions` over URI parsing.
- `auth_source` falls back to `config.database` when both credentials are
  set and `auth_source` is blank.
- `list_collections` surfaces mongo collections as `TableInfo` (schema =
  db name) so the RDB schema tree UI can be reused unchanged in Sprint 66.
- `DocumentId::Raw` uses `bson::Bson`; `FindBody.filter` is a
  `bson::Document` defaulting to empty.
- Sprint 64's `#[serde(default)]` escape hatch on `paradigm` is
  intentionally removed — payloads without `paradigm` now fail to
  deserialize.
- `#[allow(dead_code)]` on `setup_adapter` + `setup_mongo_adapter`
  silences per-test-crate warnings without changing surface.

### Residual Risk
- Six DocumentAdapter methods are Unsupported stubs — any consumer
  driving `find`/`aggregate`/CRUD will hit an immediate error until
  Sprint 66.
- The schema-tree sidebar still assumes the RDB shape; selecting a mongo
  connection drives it into an empty state.
- TLS is "on or off" only — no CA-file or `allow_invalid_certificates`
  switch yet, which self-signed replica sets will need.
- `list_collections` guards only the empty-name case; per-operation
  validation for the remaining methods lands with the Sprint 66
  implementations.
