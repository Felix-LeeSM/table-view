# Sprint 131 — Generator Handoff

**Sprint**: Mongo paradigm in-connection DB switch
**Generator**: harness general-purpose agent
**Attempt**: 1
**Branches**: working tree on `main` (no commit)
**Verification profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e static)

## Changed Files

| File | Purpose |
| --- | --- |
| `src-tauri/src/db/mongodb.rs` | Adds `MongoAdapter::active_db` field; lifecycle integration in `connect()` / `disconnect()`; new `switch_active_db` + `current_active_db` inherent methods; `DocumentAdapter::switch_database` override; 3 new unit tests + 1 `#[ignore]` live-Mongo happy-path. |
| `src-tauri/src/db/mod.rs` | Adds `DocumentAdapter::switch_database` trait default (`Err(Unsupported)`) — paradigm symmetry with `RdbAdapter::switch_database` (S130). |
| `src-tauri/src/commands/meta.rs` | Replaces the Document arm placeholder (`Err(Unsupported("…lands in Sprint 131"))`) with `adapter.switch_database(&db_name).await`; updates dispatch tests so the Document arm asserts `Ok(())` on a stub override and propagates an Err from a stub override; adds `switch_database` override on `StubDocumentAdapter`. |
| `src/components/workspace/DbSwitcher.tsx` | `handleSelect` now branches on `paradigm`: `rdb → schemaStore.clearForConnection`, `document → documentStore.clearConnection`. Imports `useDocumentStore`. Adds `paradigm` to the `useCallback` dep list. |
| `src/components/workspace/DbSwitcher.test.tsx` | Resets `useDocumentStore` in `beforeEach`. Adds 3 new scenarios: document paradigm clears `documentStore`, document paradigm leaves `schemaStore` untouched, rdb paradigm leaves `documentStore` untouched. |
| `src/stores/connectionStore.test.ts` | Adds 2 new scenarios: Mongo paradigm connect seeds `activeDb` from `config.database`; Mongo paradigm with empty `database` connects with `activeDb === undefined`. |
| `docs/sprints/sprint-131/handoff.md` | This file. |

`src/stores/connectionStore.ts` already seeded `activeDb` for any paradigm in the existing S130 code (`connectToDatabase` reads `conn?.database` without paradigm gating). Sprint 131 adds the missing test coverage and confirms no behavioural change is required.

## Checks Run

| Command | Result |
| --- | --- |
| `pnpm vitest run` | **pass** — 1986 / 1986 tests across 124 files (above 1981 baseline) |
| `pnpm tsc --noEmit` | **pass** — 0 errors |
| `pnpm lint` | **pass** — 0 errors |
| `pnpm contrast:check` | **pass** — 0 new violations (64 allowlisted) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **pass** — 262 / 262 (2 ignored: live MongoDB happy-path + an existing one) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **pass** — 0 warnings |
| e2e static compile | **pass** — `e2e/` files unchanged, root `tsconfig.json` excludes `e2e/`, `wdio.conf.ts` loads cleanly via `pnpm exec wdio run wdio.conf.ts --spec='nonexistent-…'` (config + types compile, only fails at "spec not found", which is expected). |

## Done Criteria Coverage

| AC | Evidence |
| --- | --- |
| **AC-01** `MongoAdapter` `active_db` field + lifecycle | `src-tauri/src/db/mongodb.rs:97-115` (struct + `new()`); `:200-225` (`connect()` seeds `default_db` + `active_db` from `config.database`); `:228-243` (`disconnect()` resets both). |
| **AC-02** `MongoAdapter::switch_active_db` (validation + connection guard + probe + best-effort fallback + mutate) | `src-tauri/src/db/mongodb.rs:189-244`. Empty/whitespace → `AppError::Validation`; missing client → `AppError::Connection`; `list_database_names()` probe; missing db → `AppError::Database`; probe failure → `warn!` + silent set; success → `info!` + mutate. Tests: `test_switch_active_db_rejects_empty_db_name` (mongodb.rs:1409-1429), `test_switch_active_db_returns_err_when_not_connected` (mongodb.rs:1431-1448), `test_current_active_db_starts_none` (mongodb.rs:1450-1457), live-Mongo happy-path `#[ignore]` (mongodb.rs:1465-1481). |
| **AC-03** `DocumentAdapter::switch_database` trait default + Mongo override | Trait default at `src-tauri/src/db/mod.rs:278-286` (returns `Err(Unsupported(...))`). MongoAdapter override at `src-tauri/src/db/mongodb.rs:262-269` (delegates to `self.switch_active_db`). |
| **AC-04** `meta.rs` Document arm replacement | Document arm at `src-tauri/src/commands/meta.rs:97` is now `ActiveAdapter::Document(adapter) => adapter.switch_database(&db_name).await,`. The S130 placeholder string `"Document paradigm DB switch lands in Sprint 131"` is removed from production code (it remains only in the closed/superseded findings doc). |
| **AC-05** Tauri dispatch tests updated | `switch_dispatch` helper at `src-tauri/src/commands/meta.rs:382-393` mirrors the new production body. Document OK case: `switch_dispatch_document_paradigm_propagates_ok_from_adapter` (`commands/meta.rs:401-414`). Document Err propagation: `switch_dispatch_document_paradigm_propagates_err_from_adapter` (`commands/meta.rs:421-540`). Search/Kv arms still assert `Unsupported` (existing tests retained). |
| **AC-06** `DbSwitcher.handleSelect` paradigm branch | `src/components/workspace/DbSwitcher.tsx:175-191`. RDB → `useSchemaStore.getState().clearForConnection(activeConn.id)`. Document → `useDocumentStore.getState().clearConnection(activeConn.id)`. Tests: `clears the document store for the connection after a successful Mongo switch` (DbSwitcher.test.tsx:412-461), `does NOT clear the schema store on a Mongo paradigm switch` (DbSwitcher.test.tsx:463-498), `does NOT clear the document store on an RDB paradigm switch` (DbSwitcher.test.tsx:500-533). |
| **AC-07** `connectionStore` Mongo paradigm activeDb init | Existing `connectToDatabase` (`src/stores/connectionStore.ts:154-189`) is paradigm-agnostic — it seeds `activeDb` from `conn?.database` for any paradigm. New tests: `seeds activeDb from connection.database for a Mongo paradigm connection` (`connectionStore.test.ts:574-610`), `connectToDatabase omits activeDb when a Mongo connection has no default database` (`connectionStore.test.ts:612-643`). |
| **AC-08** New / updated unit tests (Rust + TS) | Rust: 3 new tests in `mongodb.rs` (incl. 1 `#[ignore]`), 2 new dispatch tests in `meta.rs`. TS: 3 new DbSwitcher scenarios + 2 new connectionStore scenarios. |
| **AC-09** 7 verification commands green | See "Checks Run" above. All 7 pass. |
| **AC-10** No user-visible regression | PG (S130 path): unchanged production code in `commands/meta.rs` Rdb arm, unchanged `PostgresAdapter::switch_active_db`, unchanged `DbSwitcher` rdb branch — only the document branch was added. Mongo: DbSwitcher click now dispatches through the real `MongoAdapter::switch_active_db` rather than `Err(Unsupported(...))`. Search/Kv: unchanged Unsupported error arms. |

## Code Citations

### MongoAdapter `active_db` lifecycle

```rust
// src-tauri/src/db/mongodb.rs:97-115
pub struct MongoAdapter {
    client: Arc<Mutex<Option<Client>>>,
    default_db: Arc<Mutex<Option<String>>>,
    /// Sprint 131 — the database the user has currently "use_db"'d into.
    active_db: Arc<Mutex<Option<String>>>,
}

impl MongoAdapter {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            default_db: Arc::new(Mutex::new(None)),
            active_db: Arc::new(Mutex::new(None)),
        }
    }
```

```rust
// src-tauri/src/db/mongodb.rs:200-243 (connect/disconnect)
let initial = if config.database.trim().is_empty() {
    None
} else {
    Some(config.database.clone())
};
{
    let mut guard = self.default_db.lock().await;
    *guard = initial.clone();
}
{
    let mut guard = self.active_db.lock().await;
    *guard = initial;
}
// disconnect():
let mut active_guard = self.active_db.lock().await;
*active_guard = None;
```

### MongoAdapter::switch_active_db

```rust
// src-tauri/src/db/mongodb.rs:189-244
pub async fn switch_active_db(&self, db_name: &str) -> Result<(), AppError> {
    if db_name.trim().is_empty() {
        return Err(AppError::Validation(
            "Database name must not be empty".into(),
        ));
    }
    let client = self.current_client().await?;
    match client.list_database_names().await {
        Ok(names) => {
            if !names.iter().any(|n| n == db_name) {
                return Err(AppError::Database(format!(
                    "Database '{}' not found on this connection",
                    db_name
                )));
            }
        }
        Err(e) => {
            warn!(
                "Mongo list_database_names probe failed; proceeding with \
                 best-effort switch to '{}': {}",
                db_name, e
            );
        }
    }
    {
        let mut guard = self.active_db.lock().await;
        *guard = Some(db_name.to_string());
    }
    info!("Switched active Mongo db to {}", db_name);
    Ok(())
}
```

### meta.rs Document arm replacement

```rust
// src-tauri/src/commands/meta.rs:96-107
match active {
    ActiveAdapter::Rdb(adapter) => adapter.switch_database(&db_name).await,
    ActiveAdapter::Document(adapter) => adapter.switch_database(&db_name).await,
    ActiveAdapter::Search(_) => Err(AppError::Unsupported(
        "Search paradigm has no per-connection database concept".into(),
    )),
    ActiveAdapter::Kv(_) => Err(AppError::Unsupported(
        "Key-value paradigm has no per-connection database concept".into(),
    )),
}
```

### DbSwitcher paradigm clear branch

```tsx
// src/components/workspace/DbSwitcher.tsx:172-194
try {
  await switchActiveDb(activeConn.id, dbName);
  setActiveDb(activeConn.id, dbName);
  // Sprint 131 — paradigm-aware cache clear.
  if (paradigm === "rdb") {
    useSchemaStore.getState().clearForConnection(activeConn.id);
  } else if (paradigm === "document") {
    useDocumentStore.getState().clearConnection(activeConn.id);
  }
  setOpen(false);
  toast.success(`Switched to "${dbName}".`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  toast.error(`Failed to switch DB: ${message}`);
}
```

## Assumptions

- `list_database_names()` failure is treated as best-effort silent set + `warn!` log per the contract's design bar. The most common failure mode is a user without `listDatabases` privilege; we log via `tracing::warn!` rather than surface a toast so the user can still flip between DBs they can read.
- `current_active_db()` is added as a public accessor mirroring `PostgresAdapter::current_database` even though the brief listed it as "향후 read/write 사이트가 사용 가능"; making it `pub` now keeps Sprint 132's raw-query detection ADR's prep cheap and adds zero cost.
- `documentStore.clearConnection` already drops the connection's databases, collections, fields, and query results (S66). Calling it on a paradigm switch is sufficient for the sidebar to re-fetch against the new active DB without further code in `DocumentDatabaseTree`.
- The Document arm tests use `StubDocumentAdapter` (existing) + a new `ErroringDocumentAdapter` (inline). I added a `switch_database` override to `StubDocumentAdapter` because the trait default returns `Unsupported` and the contract specifically asks the dispatcher to propagate `Ok(())` from the stub.
- Tab autofill for new document tabs (`tab.database = activeDb`) was explicitly **out of scope** for this sprint per the contract's "현재 사용자 시나리오는 collection 더블클릭만 사용" carve-out. No code touched there.

## Residual Risk

- **Live-Mongo happy path** is gated behind `#[ignore]`. Coverage of the actual `list_database_names()` probe + `db_name in names` verification path requires `cargo test -- --ignored` against the docker-compose Mongo fixture. `cargo test --lib` (CI default) skips it.
- The frontend test for the document paradigm switch verifies that `documentStore.clearConnection` is called by inspecting state after the click. If `clearConnection` semantics change (S66+ rule), the test will need to track the change. Mitigated by: explicit test in `documentStore.test.ts` that pins `clearConnection` semantics (existing).
- E2E specs are not part of this sprint's contract but the static compile probe is. The `e2e/` tree is unchanged in this sprint, so any pre-existing static compile warnings (none observed) carry over verbatim.

## Generator Handoff

### Changed Files
- `src-tauri/src/db/mongodb.rs`: MongoAdapter `active_db` field + lifecycle + `switch_active_db` / `current_active_db` + `DocumentAdapter::switch_database` override + tests.
- `src-tauri/src/db/mod.rs`: `DocumentAdapter::switch_database` trait default method.
- `src-tauri/src/commands/meta.rs`: Document arm replaces `Err(Unsupported)` placeholder with `adapter.switch_database(&db_name).await`; dispatch tests updated.
- `src/components/workspace/DbSwitcher.tsx`: `handleSelect` paradigm-aware cache clear (rdb → schemaStore, document → documentStore).
- `src/components/workspace/DbSwitcher.test.tsx`: Document paradigm coverage; cross-paradigm regression guards.
- `src/stores/connectionStore.test.ts`: Mongo paradigm `activeDb` seeding tests.
- `docs/sprints/sprint-131/handoff.md`: This file.

### Checks Run
- `pnpm vitest run`: pass (1986 tests).
- `pnpm tsc --noEmit`: pass.
- `pnpm lint`: pass.
- `pnpm contrast:check`: pass (0 new violations).
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: pass (262 passed, 2 ignored).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: pass.
- e2e static compile probe (`pnpm exec wdio run wdio.conf.ts --spec='nonexistent-s131-probe.ts'`): pass (config+types compile, only "spec not found" runtime).

### Done Criteria Coverage
- AC-01..AC-10: covered. See file:line mapping table above.

### Assumptions
- `list_database_names` permission failure → silent set + `warn!` log (per contract design bar).
- `documentStore.clearConnection` is the right granularity for the paradigm switch (S66 invariant).
- StubDocumentAdapter override of `switch_database` is needed to make the Document OK dispatch test meaningful.

### Residual Risk
- Live-Mongo happy path remains `#[ignore]`-gated.
- Frontend tab-autofill for new document tabs deliberately deferred (contract carve-out).
