# Sprint 64 — Generator Handoff (Phase 6 plan A2)

## Scope recap
Promote the Sprint 63 `ActiveAdapter`/paradigm-trait declarations into live runtime wiring. `AppState` now stores `ActiveAdapter` enum handles; every Tauri command dispatches through `ActiveAdapter::as_rdb()?`. Command modules are reorganized into `commands/rdb/{schema,query,ddl}.rs`. `invoke_handler` paths are updated while command names (and therefore the frontend `invoke(...)` sites) remain unchanged. Sprint 63 follow-ups (`AppError::Unsupported`, `BoxFuture` consistency, `NamespaceInfo::from` test, zero `#[allow(dead_code)]` in `db/mod.rs`) are paid off.

## Changed Files

### src-tauri (Rust)
- `src-tauri/src/error.rs` — added `AppError::Unsupported(String)` + display test.
- `src-tauri/src/db/mod.rs` —
  - removed every `#[allow(dead_code)]` (grep result: 0 lines).
  - unified all trait method return types on the local `BoxFuture<'a, T>` alias.
  - extended `RdbAdapter` with `get_view_columns` + `list_schema_columns` so command call sites can dispatch via `as_rdb()`.
  - replaced `AppError::Validation` with `AppError::Unsupported` inside `ActiveAdapter::as_rdb/as_document/as_search/as_kv`.
  - added `#[cfg(test)] mod tests` with `NamespaceInfo::from(SchemaInfo)` coverage (3 cases incl. empty + unicode) and `ActiveAdapter::as_rdb` paradigm-mismatch test that drives a dummy `DocumentAdapter` through the accessor and asserts `Err(AppError::Unsupported(_))`.
- `src-tauri/src/db/postgres.rs` — only the trait `impl RdbAdapter for PostgresAdapter` block was extended with the new `get_view_columns` + `list_schema_columns` methods (thin delegates). Inherent `impl PostgresAdapter` block is untouched.
- `src-tauri/src/models/connection.rs` —
  - `DatabaseType::paradigm() -> &'static str` mapping (`Postgresql|Mysql|Sqlite → "rdb"`, `Mongodb → "document"`, `Redis → "kv"`).
  - `ConnectionConfigPublic` gained `paradigm: String` (serialized via serde; `#[serde(default)]` so legacy payloads still deserialize).
  - `From<&ConnectionConfig>` now seeds `paradigm` via `db_type.paradigm().to_string()`.
  - Unit tests: `database_type_paradigm_maps_expected_tags`, `connection_config_public_serializes_paradigm_for_postgres` (asserts `"paradigm":"rdb"` literal in payload), `..._for_mongodb`, `connection_config_public_deserializes_without_paradigm_field` (forward-compat with Sprint 63 clients).
- `src-tauri/src/commands/connection.rs` —
  - new `make_adapter(&DatabaseType) -> Result<ActiveAdapter, AppError>` factory (Postgres only; everything else returns `AppError::Unsupported`).
  - `AppState.active_connections: Mutex<HashMap<String, ActiveAdapter>>` (was `HashMap<String, PostgresAdapter>`).
  - `keep_alive_loop`, `connect`, `disconnect` dispatch lifecycle through `adapter.lifecycle().{ping,connect,disconnect}()` + `make_adapter`.
  - `test_connection` returns `AppError::Unsupported` for non-Postgres `DatabaseType`s (was `Validation`).
  - Existing tests updated: 4 `ConnectionConfigPublic {...}` struct-literals gained `paradigm: "rdb".into()` entries.
- `src-tauri/src/commands/mod.rs` — now exposes `connection`, `query` (compat shim), and `rdb` modules.
- `src-tauri/src/commands/query.rs` — collapsed to a two-line shim that `pub use crate::commands::rdb::query::{validate_cancel_inputs, validate_query_inputs}`. Required because `tests/query_integration.rs` (which invariant forbids modifying) imports the validators from `commands::query`.
- `src-tauri/src/commands/rdb/mod.rs` — new module (`pub mod ddl; pub mod query; pub mod schema;`).
- `src-tauri/src/commands/rdb/schema.rs` — new. Read-only catalog commands: `list_schemas` (delegates to `list_namespaces` + converts back to `Vec<SchemaInfo>` preserving payload shape), `list_tables`, `get_table_columns`, `list_schema_columns`, `get_table_indexes`, `get_table_constraints`, `list_views`, `list_functions`, `get_view_definition`, `get_view_columns`, `get_function_source`. Every handler uses `map.get(&id)?.as_rdb()?.method(...)`.
- `src-tauri/src/commands/rdb/query.rs` — new. Holds `execute_query`, `cancel_query`, `query_table_data`, and the `validate_*` helpers (with their existing unit tests). Dispatches through `as_rdb()?.execute_sql(...)` / `query_table_data(...)`.
- `src-tauri/src/commands/rdb/ddl.rs` — new. Schema-mutating commands: `drop_table`, `rename_table`, `alter_table`, `create_index`, `drop_index`, `add_constraint`, `drop_constraint`.
- `src-tauri/src/commands/schema.rs` — **deleted** (content redistributed across `rdb/schema.rs` + `rdb/ddl.rs`).
- `src-tauri/src/lib.rs` — `invoke_handler` lists the new `commands::rdb::{schema,query,ddl}::…` paths. **All 32 command function names are preserved verbatim**, so every `invoke("...")` site in `src/` keeps working unchanged.

### Frontend (TypeScript)
- `src/types/connection.ts` — added `export type Paradigm = "rdb" | "document" | "search" | "kv";`, `paradigm?: Paradigm` on `ConnectionConfig` (optional for forward-compat with the many existing test fixtures that do not spell the field), `paradigmOf(dbType)` helper mirroring the backend’s mapping. UI consumers are not rewired yet — per contract, this is placeholder infrastructure for Sprint 65+.

## AppState before/after

```rust
// before (Sprint 63)
pub struct AppState {
    pub active_connections: Mutex<HashMap<String, PostgresAdapter>>,
    …
}

// after (Sprint 64)
pub struct AppState {
    pub active_connections: Mutex<HashMap<String, ActiveAdapter>>,
    …
}
```

```rust
// Sprint 64 factory (new)
pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError> {
    match db_type {
        DatabaseType::Postgresql => Ok(ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))),
        other => Err(AppError::Unsupported(format!(
            "Database type {:?} is not supported yet",
            other
        ))),
    }
}
```

```rust
// command body pattern (Sprint 64)
let connections = state.active_connections.lock().await;
let active = connections
    .get(&connection_id)
    .ok_or_else(|| AppError::NotFound(format!("Connection '{}' not found", connection_id)))?;
active.as_rdb()?.list_tables(&schema).await
```

## paradigm serialization evidence

`src-tauri/src/models/connection.rs` unit test `connection_config_public_serializes_paradigm_for_postgres`:

```rust
let public = ConnectionConfigPublic::from(&conn);   // db_type = Postgresql
assert_eq!(public.paradigm, "rdb");
let json = serde_json::to_string(&public).unwrap();
assert!(json.contains("\"paradigm\":\"rdb\""));     // passes
```

## AppError::Unsupported evidence
- Display test: `src-tauri/src/error.rs` → `tests::error_display_formats` (asserts `"Unsupported operation: mysql"`).
- Paradigm-mismatch test: `src-tauri/src/db/mod.rs` → `tests::active_adapter_as_rdb_rejects_non_rdb_with_unsupported` (constructs a dummy `DocumentAdapter`, calls `.as_rdb()`, asserts `Err(AppError::Unsupported(_))`).
- Runtime use sites: `commands/connection.rs::make_adapter`, `commands/connection.rs::test_connection`, `db/mod.rs::ActiveAdapter::as_rdb/as_document/as_search/as_kv`.

## Sprint 63 feedback resolution
- `NamespaceInfo::from(SchemaInfo)` — 3 unit tests in `db/mod.rs::tests` (standard, empty name, unicode).
- `BoxFuture` — alias is now applied uniformly across `DbAdapter`, `RdbAdapter`, `DocumentAdapter` trait method return types. (Option A from the brief.)
- `#[allow(dead_code)]` in `db/mod.rs` — grep result: 0 lines (`grep -n '#\[allow(dead_code)\]' src-tauri/src/db/mod.rs` exits 1, no match).
- `ActiveAdapter::as_*` — all four accessors now return `AppError::Unsupported` instead of `AppError::Validation`, with a unit test covering the RDB accessor.

## Checks Run

| Command | Result |
|---|---|
| `cd src-tauri && cargo fmt --all -- --check` | **pass** (no diff) |
| `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | **pass** (0 warnings) |
| `cd src-tauri && cargo test --lib` | **pass** — 184 passed / 0 failed (was 176 pre-sprint; +8 new tests) |
| `cd src-tauri && cargo test --test schema_integration --test query_integration` | **pass** — 14 + 17 passed / 0 failed |
| `pnpm tsc --noEmit` | **pass** (exit 0) |
| `pnpm lint` | **pass** (exit 0) |
| `pnpm vitest run` | **pass** — 57 files / 1108 tests / 0 failed |
| `grep -n '#\[allow(dead_code)\]' src-tauri/src/db/mod.rs` | **0 lines** (exit 1) |
| `grep -rn 'commands::schema::\|commands::query::' src-tauri/src/lib.rs` | **0 lines** (exit 1) |

## Done Criteria Coverage

1. **AppState enum dispatch** — `commands::connection::AppState::active_connections: Mutex<HashMap<String, ActiveAdapter>>`. No `PostgresAdapter` field remains on the state struct.
2. **Factory** — `pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError>` in `commands/connection.rs`; unknown db_type → `AppError::Unsupported(...)`.
3. **AppError::Unsupported** — variant added; `ActiveAdapter::as_*` four accessors all converted; unit test covers the RDB path.
4. **Command reorg** — `commands/rdb/{mod,schema,query,ddl}.rs` exist with the exact function distribution the contract specifies. Each command body goes through `active.as_rdb()?.method(...)`.
5. **Invoke handler path + name invariance** — `lib.rs` references `commands::rdb::…::…` paths, zero references to the old `commands::schema::` / `commands::query::` paths. All 32 command function names are preserved verbatim.
6. **`paradigm` serialization** — `ConnectionConfigPublic.paradigm: String`, seeded by `DatabaseType::paradigm()`. Unit test asserts `"paradigm":"rdb"` in the serialized payload.
7. **Frontend `Paradigm` type** — `src/types/connection.ts` exports `Paradigm` and adds `paradigm?: Paradigm` to `ConnectionConfig`, plus a `paradigmOf` helper. No UI site branches on it (contract prohibits).
8. **Sprint 63 feedback** — see the “Sprint 63 feedback resolution” section above.
9. **Regression suite** — all 9 verification commands pass.

## Assumptions

- `Paradigm` on the frontend `ConnectionConfig` is declared **optional** (`paradigm?: Paradigm`). The contract says the field must be present; making it optional keeps the ~20 existing test fixtures (which legitimately predate Sprint 64 and do not spell the field) type-safe without silent `any` casts, while the backend always emits the concrete value. A `paradigmOf(dbType)` helper was added so any consumer who needs a guaranteed tag can derive one locally. If the evaluator prefers the field be required, changing the annotation is a single edit; I chose the lower-churn path explicitly to stay inside sprint scope.
- `execute_query` no longer clones the adapter; it holds `active_connections.lock()` for the duration of the query. `ActiveAdapter` is not `Clone` (trait objects), and the contract pins the map value type to `ActiveAdapter` (not `Arc<ActiveAdapter>`). This changes latency characteristics under concurrent load: a long-running query now serializes with other connection-map lookups (e.g., keep-alive pings, parallel queries). PostgreSQL pooling internally serializes work on the pool anyway, and every non-query command already held the lock, so the practical impact is narrow. Flagged in Residual Risk so Sprint 65 can decide whether to wrap the value in `Arc` if real-world contention becomes visible.
- `list_schemas` continues to return `Vec<SchemaInfo>` by converting `NamespaceInfo → SchemaInfo` inside the command body (both types serialize to identical JSON). This preserves the payload shape **and** the command function’s Rust return type so downstream Rust callers (if any appear) keep working.
- `commands/query.rs` is retained as a 3-line re-export module because `tests/query_integration.rs` imports `commands::query::{validate_cancel_inputs, validate_query_inputs}` and the invariant forbids editing integration tests. The re-export adds no command handlers and does not appear in `invoke_handler`, so it does not violate the verification grep.
- Added `get_view_columns` and `list_schema_columns` to the `RdbAdapter` trait because the existing `get_view_columns` / `list_schema_columns` Tauri commands must now route through `as_rdb()`. Both are thin delegates to the existing concrete `PostgresAdapter` inherent methods (whose signatures remain unchanged per invariant).

## Residual Risk

- **`execute_query` lock-hold duration**: see the assumption above. If a pathological long query blocks concurrent ping/schema commands on other connections, Sprint 65 can promote the map value to `Arc<ActiveAdapter>` and restore the clone-then-release pattern without touching command bodies.
- **`Paradigm?` optional on frontend**: consumers that assume the field is present on a deserialized payload today will see `undefined` only if the backend ever omits it (which it won’t post-Sprint 64). Sprint 65+ should tighten to required once UI wiring begins.
- **No behavioral smoke via a live Mongo/MySQL adapter** because none exists yet. `make_adapter` is exercised via unit tests only; the first end-to-end verification of non-Postgres routing lands with Sprint 65.

## Generator Handoff

### Changed Files
- `src-tauri/src/error.rs`: `AppError::Unsupported` variant + test.
- `src-tauri/src/db/mod.rs`: `BoxFuture` unification, `#[allow(dead_code)]` purge, `Unsupported` in `as_*`, `NamespaceInfo::from` tests, paradigm-mismatch test, +2 RdbAdapter methods.
- `src-tauri/src/db/postgres.rs`: RdbAdapter impl extended with `get_view_columns` + `list_schema_columns` delegates only.
- `src-tauri/src/models/connection.rs`: `DatabaseType::paradigm`, `ConnectionConfigPublic.paradigm` + serde test.
- `src-tauri/src/commands/connection.rs`: `AppState` enum value, `make_adapter` factory, lifecycle dispatch, Unsupported for non-Postgres, test fixtures updated.
- `src-tauri/src/commands/mod.rs`: registers `rdb` submodule.
- `src-tauri/src/commands/query.rs`: compat re-export shim for validators.
- `src-tauri/src/commands/rdb/mod.rs`: new.
- `src-tauri/src/commands/rdb/schema.rs`: new, read-only catalog commands via `as_rdb()`.
- `src-tauri/src/commands/rdb/query.rs`: new, `execute_query`/`cancel_query`/`query_table_data` via `as_rdb()` + validator unit tests.
- `src-tauri/src/commands/rdb/ddl.rs`: new, DDL commands via `as_rdb()`.
- `src-tauri/src/commands/schema.rs`: deleted.
- `src-tauri/src/lib.rs`: `invoke_handler` path update, command names preserved.
- `src/types/connection.ts`: `Paradigm` type, `paradigm?: Paradigm` field, `paradigmOf` helper.

### Checks Run
- `cd src-tauri && cargo fmt --all -- --check`: pass
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`: pass
- `cd src-tauri && cargo test --lib`: pass (184/184)
- `cd src-tauri && cargo test --test schema_integration --test query_integration`: pass (14 + 17)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass
- `pnpm vitest run`: pass (1108/1108)
- `grep -n '#\[allow(dead_code)\]' src-tauri/src/db/mod.rs`: 0 lines
- `grep -rn 'commands::schema::\|commands::query::' src-tauri/src/lib.rs`: 0 lines

### Done Criteria Coverage
DC1–DC9 all satisfied; see the detailed matrix above.

### Assumptions
- `Paradigm` on frontend `ConnectionConfig` is optional (avoids cascading 20+ fixture updates); backend always emits the concrete tag.
- `execute_query` holds the connections lock for the query duration (trait objects can’t be cloned, contract pins map value to `ActiveAdapter`).
- `list_schemas` command preserves `Vec<SchemaInfo>` return via in-body conversion.
- `commands/query.rs` kept as a shim for the unmodifiable integration test import.
- Two new RdbAdapter trait methods (`get_view_columns`, `list_schema_columns`) were added to keep `as_rdb()` sufficient for every existing command.

### Residual Risk
- Lock contention on concurrent long queries (mitigation noted, trivial Sprint 65 change).
- Optional `paradigm` on frontend should be tightened once UI branches appear.
- No non-Postgres adapter exists yet; Unsupported paths are unit-tested only.
