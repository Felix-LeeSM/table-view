# Sprint 65 Evaluation — Findings

## Sprint 65 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | MongoAdapter ships with live, verified happy path. `cargo test --test mongo_integration` on a live mongo:7 container returned `list_databases → ["admin", "config", "local"]` and exercised the empty-name guard, post-disconnect ping failure, and `connect → ping → list_databases → list_collections("admin") → disconnect` end-to-end. `build_options` maps every field with typed option assembly (no URI percent-encoding hazard). 6 stubs correctly return `AppError::Unsupported` with method names embedded. Minor: `ping` errors surface as `AppError::Connection` rather than a dedicated `AppError::Database` for driver-level failures, but that's consistent with Postgres. |
| Completeness (25%) | 9/10 | All 12 Done Criteria satisfied. `mongodb = "3"` + `bson = "2"` in `Cargo.toml`; `cargo tree --depth 1` shows `bson v2.15.0` + `mongodb v3.6.0`. `impl DbAdapter for MongoAdapter` (line 130) + `impl DocumentAdapter for MongoAdapter` (line 190). DTO migration complete — `FindBody.filter: bson::Document`, `FindBody.sort/projection: Option<bson::Document>`, `DocumentQueryResult.raw_documents: Vec<bson::Document>`, `DocumentAdapter::insert_document/update_document/aggregate` all take `bson::Document`. Three mongo fields + `#[serde(default)]` present on both `ConnectionConfig` and `ConnectionConfigPublic`. `make_adapter` routes mongodb → `ActiveAdapter::Document(...)`. `ConnectionDialog.tsx` conditional rendering verified. Sprint 64 carry-overs #1 and #2 both resolved (paradigm required on frontend, `ConnectionConfigPublic.paradigm: Paradigm` without `#[serde(default)]`, missing-field payloads now reject). `tests/common/mod.rs` + `tests/mongo_integration.rs` as specified. Mild ding: `DocumentQueryResult.rows` is still typed `Vec<Vec<serde_json::Value>>` — that's explicitly documented as deliberate (grid renderer pipe) and the contract says DTO shape should be "confirmed" for this sprint, so acceptable. |
| Reliability (20%) | 8/10 | Tokio `Mutex` used uniformly for async state. `connect` eagerly pings so failure surfaces before the map receives the client. `disconnect` drops client + default_db. Post-disconnect `ping` correctly fails. Empty-name guard on `list_collections` blocks a class of invalid input. All six Unsupported stubs are individually test-covered. Legacy `ConnectionConfig` round-trip retained (test `connection_config_optional_fields_default_to_none` verifies pre-Sprint-65 JSON still deserializes; `connection_config_preserves_mongo_fields_across_roundtrip` verifies new fields survive). The `ConnectionConfigPublic` wire-break on missing paradigm is tested and documented as intentional. One residual concern: no explicit test that a *serialized* legacy `ConnectionConfigPublic` payload (e.g. export files) still round-trips — but since no persisted data in the repo predates the enum, this is accepted risk per the handoff. |
| Verification Quality (20%) | 9/10 | All 8 required commands pass on this evaluator's machine. Live mongo container produced actual `list_databases` / `list_collections` output. Integration tests ran against a freshly-spun mongo:7 container via docker-compose.test.yml. Postgres integration suite unchanged (14 + 17 passed). Unit tests: 206 lib + 2 mongo_integration. Vitest: 1115 tests across 57 files. `ConnectionDialog.test.tsx` has a dedicated `MongoDB conditional fields` describe block with 4 tests covering hide/show, label relabel, and draft contents (including paradigm = "document"). 14 other frontend test files were updated to carry the required `paradigm: "rdb"` so the tightening holds. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

All four dimensions ≥ 7. No blocker issues.

## Sprint Contract Status (Done Criteria)

- [x] **DC1 Dependencies** — `Cargo.toml` lines 23–24 show `mongodb = "3"` and `bson = "2"`. `cargo tree --depth 1` confirms `├── bson v2.15.0` and `├── mongodb v3.6.0`.
- [x] **DC2 Runtime connect via integration test** — Live mongo:7 container (started via `docker compose -f docker-compose.test.yml up -d mongodb`) and `test_mongo_adapter_connect_ping_list_disconnect_happy_path` passed. Log: `list_databases returned 3 entries: ["admin", "config", "local"]` and `list_collections(admin) returned 2 entries`.
- [x] **DC3 `impl DbAdapter for MongoAdapter`** — `src-tauri/src/db/mongodb.rs:130` — `kind` returns `DatabaseType::Mongodb`; `connect` builds `ClientOptions`, constructs `Client`, runs `admin.ping`, stores state under two `tokio::sync::Mutex`es; `ping` re-runs `admin.ping`; `disconnect` drops both slots.
- [x] **DC4 `impl DocumentAdapter for MongoAdapter`** — `src-tauri/src/db/mongodb.rs:190`. `list_databases` → `Vec<NamespaceInfo>`; `list_collections(db)` validates non-empty, returns `Vec<TableInfo>`. Six remaining methods return `AppError::Unsupported("MongoAdapter::<method> is not implemented until Sprint 66")`, each covered by its own `#[tokio::test]` (`infer_collection_fields_returns_unsupported`, `find_returns_unsupported`, `aggregate_returns_unsupported`, `insert_document_returns_unsupported`, `update_document_returns_unsupported`, `delete_document_returns_unsupported`).
- [x] **DC5 DTO bson migration** — `FindBody.filter: bson::Document` (line 79 of `db/mod.rs`), `FindBody.sort/projection: Option<bson::Document>`, `DocumentQueryResult.raw_documents: Vec<bson::Document>`, `DocumentAdapter::aggregate` takes `Vec<bson::Document>`, `insert_document`/`update_document` take `bson::Document`. `grep 'serde_json::Value' src-tauri/src/db/` shows remaining hits only in `postgres.rs` (unchanged RDB path) and two comments in `db/mod.rs`. No placeholder on the trait surface.
- [x] **DC6 ConnectionConfig extension** — `auth_source: Option<String>`, `replica_set: Option<String>`, `tls_enabled: Option<bool>`, each carrying `#[serde(default)]`. Test `connection_config_optional_fields_default_to_none` proves legacy JSON without these keys deserializes fine; `connection_config_preserves_mongo_fields_across_roundtrip` proves mongo fields survive round-trip.
- [x] **DC7 `make_adapter` factory** — `commands/connection.rs:23` — `DatabaseType::Mongodb => Ok(ActiveAdapter::Document(Box::new(MongoAdapter::new())))`. Unit test `test_make_adapter_mongodb_returns_document_variant` at line 1347; Postgres, MySQL, SQLite, Redis tests also present at 1337/1357/1367/1375.
- [x] **DC8 ConnectionDialog conditional fields** — `ConnectionDialog.tsx:79` (`isMongo` flag), `tsx:415` (Database label becomes `"Database (optional)"` when mongo), `tsx:431–492` (MongoDB Options block). `ConnectionDialog.test.tsx:725` — `describe("MongoDB conditional fields", ...)` with four tests: hidden by default, appears after switching, Database relabel, draft surfaces `db_type: "mongodb"`, `paradigm: "document"`, and all three mongo fields.
- [x] **DC9 Frontend paradigm required** — `src/types/connection.ts:45` — `paradigm: Paradigm;` (no `?`). `grep -rn 'paradigm\?:' src/` returns zero hits (matches only appear in historical sprint-64 docs). `createEmptyDraft()` emits `paradigm: "rdb"`, `draftFromConnection()` propagates `conn.paradigm`, `parseConnectionUrl()` populates `paradigm: paradigmOf(dbType)`.
- [x] **DC10 ConnectionConfigPublic.paradigm typed enum** — `models/connection.rs:45` — `Paradigm` enum `#[serde(rename_all = "lowercase")]`, variants `Rdb/Document/Search/Kv`. `ConnectionConfigPublic.paradigm: Paradigm` (no `#[serde(default)]`). Test `paradigm_serializes_to_expected_lowercase_tags` proves `"rdb"`/`"document"`/`"search"`/`"kv"`. Test `connection_config_public_rejects_payload_without_paradigm_field` proves missing-field deserialization fails (hard tightening).
- [x] **DC11 Test infra** — `tests/common/mod.rs:64` — `DatabaseType::Mongodb` branch with `MONGO_HOST`/`MONGO_PORT`/`MONGO_USER`/`MONGO_PASSWORD`/`MONGO_DATABASE` env reads and `auth_source: Some("admin")` so compose credentials land against the admin DB. New `setup_mongo_adapter()` (line 125) mirrors the Postgres skip pattern with `SKIP: MongoDB database not available` print. `tests/mongo_integration.rs` covers the happy path plus a `ping-without-connect` test that always runs.
- [x] **DC12 Zero regression** — All 8 verification commands pass (see "Verification executed" below).

## Verification executed

| # | Command | Result |
|---|---|---|
| 1 | `cd src-tauri && cargo fmt --all -- --check` | pass (exit 0, no diff) |
| 2 | `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | pass (no warnings) |
| 3 | `cd src-tauri && cargo test --lib` | pass — **206 passed / 0 failed / 0 ignored** |
| 4 | `docker compose -f docker-compose.test.yml up -d mongodb postgres` + `./scripts/wait-for-test-db.sh` (with `PGPORT=55432` to work around a host-side 5432 conflict) | pass — `PostgreSQL is ready. MongoDB is ready. All test databases are ready.` |
| 5 | `cd src-tauri && cargo test --test schema_integration --test query_integration --test mongo_integration` | pass — **14 + 17 + 2 passed / 0 failed**. Mongo log: `list_databases returned 3 entries: ["admin", "config", "local"]`; `list_collections(admin) returned 2 entries`. |
| 6 | `pnpm tsc --noEmit` | pass (exit 0) |
| 7 | `pnpm lint` | pass (exit 0, `eslint .` produced no output) |
| 8 | `pnpm vitest run` | pass — **57 files / 1115 tests / 0 failed** |

Inspection checks also ran:
- `grep -n 'paradigm?:' src/` → 0 hits in `src/`. Historical mentions only in `docs/sprints/sprint-64/`.
- `grep 'impl DocumentAdapter for MongoAdapter' src-tauri/src/db/mongodb.rs` → line 190.
- `grep 'impl DbAdapter for MongoAdapter' src-tauri/src/db/mongodb.rs` → line 130.
- `grep '^(mongodb|bson) = ' src-tauri/Cargo.toml` → lines 23–24.
- `grep -c '#\[test\]|#\[tokio::test\]' src-tauri/src/db/mongodb.rs` → 15 test attributes (new/default kind equivalence, build_options mapping + defaults, four without-connection error-path tests, six Unsupported stub tests, one `find_body_default` invariant, plus `disconnect_without_connection_is_ok`).
- `cargo tree --depth 1 | grep -E "(mongodb|bson)"` → `├── bson v2.15.0`, `├── mongodb v3.6.0`.

## Strengths

1. **Programmatic ClientOptions.** Skipping URI assembly is the right call — it sidesteps percent-encoding bugs entirely, and the `auth_source` fallback (`config.auth_source` → trimmed → `config.database` → `None`/driver default) matches common Mongo UX.
2. **Test granularity on stubs.** The contract asked for "each stub has a unit test"; the generator delivered exactly that (six one-liners each grepping the method name out of the error message) instead of a single combined test.
3. **Live integration test with real assertions.** `test_mongo_adapter_connect_ping_list_disconnect_happy_path` isn't just "is_ok()" — it asserts `admin` is present in the database list, re-tests the empty-name guard in an integration context, confirms post-disconnect `ping` actually errors, and prints evidence that is readable in CI output.
4. **Wire-format tightening is tested on both sides.** `connection_config_public_rejects_payload_without_paradigm_field` locks in the backend break, while `ConnectionDialog.test.tsx` "includes auth_source, replica_set, tls_enabled in the saved draft" pins the frontend's paradigm-on-save behaviour including the `paradigm: "document"` assertion.
5. **No `any` casts, no over-the-wall types.** Frontend `paradigm` tightening threaded through 14 fixture files without a single escape hatch.

## Feedback for Generator / Next sprint

These are not blockers for Sprint 65 — they are follow-ups to tee up for Sprint 66+.

1. **Category: Verification gap — alternate deserialization paths**
   - Current: No test verifies that a persisted legacy `ConnectionConfigPublic` export JSON (pre-Sprint-65 shape, without `paradigm`) surfaces a specific, helpful error message when imported.
   - Expected: A unit test that calls `serde_json::from_str::<ConnectionConfigPublic>` with a pre-Sprint-65 shape and asserts the `serde::de::Error` mentions `paradigm`, so that `ImportExportDialog` can render a migration-friendly message in Sprint 66.
   - Suggestion: Add a test in `models/connection.rs::tests` that asserts `err.to_string().contains("paradigm")`. Cheap, future-proof.

2. **Category: Connection timeout semantics**
   - Current: `build_options` maps `config.connection_timeout` (seconds) to both `connect_timeout` and `server_selection_timeout`. That is reasonable, but the field is unbounded (`u32`) on the frontend.
   - Expected: A test or explicit comment clarifying that a 0-second timeout falls through as "driver default" rather than "fail instantly". Right now the code path sets both to `Duration::from_secs(0)`, which for `server_selection_timeout` is effectively "unreachable-on-first-try".
   - Suggestion: Clamp to a minimum of 1 second in `build_options` or add a regression test with `connection_timeout: Some(0)` pinning the chosen behaviour.

3. **Category: Test infra — `available_dbms` shape**
   - Current: `available_dbms()` silently drops non-Postgres/Mongo variants via `_ => {}`. The helper is `#[allow(dead_code)]` and only used for "future parameterised suites".
   - Expected: Either remove the unused MySQL/Redis/SQLite arms now and add them back when a consumer exists, or add a short test that confirms the function's output structure.
   - Suggestion: Minor. Drop a `println!("probe skipped: {db_type:?}")` in the default arm to avoid silent gaps when the next adapter lands.

4. **Category: UX polish in ConnectionDialog (non-blocking)**
   - Current: The MongoDB Options sub-panel uses `placeholder="admin"` on Auth Source. When the user leaves it blank and the backend falls back to `config.database`, there's no visual hint that the fallback is happening.
   - Expected: A subtle helper text under the field explaining the fallback rule (e.g. "Leave blank to use the database name above").
   - Suggestion: Optional for Sprint 65. Worth considering alongside the Sprint 66 TLS CA-file picker since both are mongo-specific UX polish.

## Residual risk acknowledged from Generator handoff

- Six `DocumentAdapter` methods still stub. Frontend will hit Unsupported walls until Sprint 66 — expected.
- `DocumentDatabaseTree` not yet present — expected (Sprint 66 scope).
- TLS is on/off only — expected.
- `execute_query` mutex hold time — deferred (contract says out of scope).

None of these block PASS.
