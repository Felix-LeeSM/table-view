# Sprint 128 Handoff — `list_databases` meta command + `<DbSwitcher>` activation

## Goal

Backend unified `list_databases(connection_id)` Tauri command + frontend
`<DbSwitcher>` enable + fetch on click. Selection itself remains a no-op
(scheduled for S130/S131).

## Changed Files

### Backend (Rust)

- `src-tauri/src/db/mod.rs` — added `RdbAdapter::list_databases` trait
  method with default impl `Ok(Vec::new())` so non-PG RDBs (SQLite/MySQL,
  Phase 9) compile without overrides.
- `src-tauri/src/db/postgres.rs` — added inherent
  `PostgresAdapter::list_databases()` (queries `pg_database`, with
  `current_database()` fallback for SQLSTATE 42501 / message-substring
  permission denial), the `is_pg_database_permission_denied` helper, the
  `RdbAdapter::list_databases` trait override, and 9 unit tests
  (happy-path-without-pool + 8 fallback-detection cases including the
  `StubDbError` shim that satisfies `sqlx::error::DatabaseError`).
- `src-tauri/src/commands/meta.rs` — new module hosting the unified
  `list_databases` Tauri command + 6 dispatcher unit tests covering the
  4-paradigm branch matrix (rdb/document/search/kv) plus the
  `not_connected` helper.
- `src-tauri/src/commands/mod.rs` — register `pub mod meta`.
- `src-tauri/src/lib.rs` — register `commands::meta::list_databases` in
  `tauri::generate_handler![…]` (placed immediately above the
  `list_mongo_databases` line so the related entries cluster).

### Frontend (TypeScript)

- `src/lib/api/listDatabases.ts` — new thin invoke wrapper for the unified
  command. Returns `DatabaseInfo[]` (re-using the Mongo-shaped type from
  `@/types/document`).
- `src/lib/api/listDatabases.test.ts` — 3 unit tests (happy/empty/reject).
- `src/components/workspace/DbSwitcher.tsx` — promoted from a static
  read-only badge to a paradigm-aware popover. Enabled when paradigm is
  `rdb` or `document` AND the active tab's connection is connected.
  Click → fetch via `listDatabases` → popover with `<button role="option">`
  rows (no-op `onClick` + toast hint + always-visible inline hint chip).
- `src/components/workspace/DbSwitcher.test.tsx` — rewritten test suite
  (18 tests) covering the read-only fallback matrix (no-tab / disconnected
  / kv / search), the active flow (rdb + connected and document +
  connected), fetch on click, loading state, error rendering, empty
  result, and two no-op assertions (snapshot-equality on
  `useTabStore`/`useConnectionStore` + toast surface).
- `src/components/workspace/WorkspaceToolbar.test.tsx` — single test
  updated to the new `active database switcher` role/label for the
  document-paradigm + connected scenario; read-only path tests preserved
  verbatim.

## Checks Run

| Command | Outcome |
|---------|---------|
| `pnpm vitest run` | **passed** — 1948 / 1948 (was 1934, +14 new tests across `DbSwitcher.test.tsx` and `listDatabases.test.ts`) |
| `pnpm tsc --noEmit` | **passed** — 0 errors |
| `pnpm lint` | **passed** — 0 errors |
| `pnpm contrast:check` | **passed** — 0 new violations (864 pairs, 64 allowlisted) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **passed** — 245 / 245 (Sprint 128 added: `db::postgres::tests::list_databases_without_connection_fails`, 8 × `permission_denied_*`, 6 × `commands::meta::tests::dispatch_*` + `not_connected_helper_uses_appropriate_variant`) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **passed** |
| e2e static compile | **no regression** — `pnpm tsc --noEmit` covers the `e2e/*.spec.ts` files in the project's tsconfig program; no e2e file references `<DbSwitcher>` so no runtime spec touched. |

## Acceptance Criteria Coverage

| AC | Evidence |
|----|----------|
| AC-01 `RdbAdapter::list_databases` trait method, default `Ok(vec![])` | `src-tauri/src/db/mod.rs:138` (trait default impl) — `Box::pin(async { Ok(Vec::new()) })` |
| AC-02 `PostgresAdapter::list_databases` query + ordering | `src-tauri/src/db/postgres.rs:1708-1736` — `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname` |
| AC-03 PG permission-denied fallback (SQLSTATE 42501 + message substring) | `src-tauri/src/db/postgres.rs:1747-1763` (`is_pg_database_permission_denied`); fallback path uses `SELECT current_database()` at `src-tauri/src/db/postgres.rs:1725-1734`. Tests at `src-tauri/src/db/postgres.rs:3097-3160` (8 cases). |
| AC-04 Unified Tauri command with 4-paradigm dispatch | `src-tauri/src/commands/meta.rs:40-66` (rdb / document / Search → `Vec::new()` / Kv → `Vec::new()`); dispatcher tests at `src-tauri/src/commands/meta.rs:271-335`. |
| AC-05 `tauri::generate_handler![…]` registration | `src-tauri/src/lib.rs:48` — `commands::meta::list_databases` |
| AC-06 `list_mongo_databases` regression: 0 | `src-tauri/src/commands/document/browse.rs:53-67` (untouched), `src-tauri/src/lib.rs:49` (entry retained); existing `documentStore.test.ts` mocks `tauri.listMongoDatabases` and still passes. |
| AC-07 TS thin wrapper + unit tests | `src/lib/api/listDatabases.ts:33-37` (wrapper), `src/lib/api/listDatabases.test.ts:1-44` (3 tests). |
| AC-08 `<DbSwitcher>` active for rdb/document + connected, click → fetch + popover | `src/components/workspace/DbSwitcher.tsx:55-67` (enable predicate), `src/components/workspace/DbSwitcher.tsx:94-112` (fetch), `src/components/workspace/DbSwitcher.tsx:177-285` (popover + listbox + loading state). Tests: `src/components/workspace/DbSwitcher.test.tsx:188-201` (rdb), `:203-209` (document), `:204-227` (fetch on click), `:229-251` (loading state). |
| AC-09 No-op selection + inline hint | `src/components/workspace/DbSwitcher.tsx:128-137` (`handleSelect` only triggers `toast.info(SELECT_HINT_MESSAGE)` and `setOpen(false)`, no store mutation). Hint chip rendered at `src/components/workspace/DbSwitcher.tsx:267-273`. Tests: `src/components/workspace/DbSwitcher.test.tsx:285-308` (snapshot equality on both stores), `:310-329` (toast surface), `:331-341` (inline hint visible). |
| AC-10 kv/search paradigm and disconnected → read-only chrome preserved | `src/components/workspace/DbSwitcher.tsx:140-174` (`if (!enabled) { return <read-only>; }`). Tests: `src/components/workspace/DbSwitcher.test.tsx:145-154` (rdb disconnected), `:156-167` (kv connected), `:169-181` (search connected). |
| AC-11 New unit/integration tests | Rust `commands::meta::tests::dispatch_*` (5 paradigm tests + helper test = 6) + `db::postgres::tests::list_databases_without_connection_fails` + 8 `permission_denied_*`. TS `DbSwitcher.test.tsx` (18 tests, including the no-op + toast assertion pair). |
| AC-12 All 6 verification commands green | See Checks Run table above. |

## PG Permission Fallback — Code Evidence

`src-tauri/src/db/postgres.rs:1747-1763`:

```rust
fn is_pg_database_permission_denied(err: &sqlx::Error) -> bool {
    if let sqlx::Error::Database(db_err) = err {
        if let Some(code) = db_err.code() {
            if code.as_ref() == "42501" {
                return true;
            }
        }
        let msg = db_err.message().to_ascii_lowercase();
        if msg.contains("permission denied for table pg_database")
            || msg.contains("permission denied for relation pg_database")
        {
            return true;
        }
    }
    false
}
```

Match order matches the contract: SQLSTATE first, message substring (case-insensitive)
second. The fallback query lives in
`PostgresAdapter::list_databases` at `src-tauri/src/db/postgres.rs:1722-1734`:

```rust
match primary {
    Ok(rows) => Ok(rows.into_iter().map(|(name,)| SchemaInfo { name }).collect()),
    Err(err) if is_pg_database_permission_denied(&err) => {
        let current: (String,) = sqlx::query_as("SELECT current_database()")
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(vec![SchemaInfo { name: current.0 }])
    }
    Err(err) => Err(AppError::Database(err.to_string())),
}
```

## Unified Command — Paradigm Dispatch Code Evidence

`src-tauri/src/commands/meta.rs:40-66`:

```rust
#[tauri::command]
pub async fn list_databases(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let connections = state.active_connections.lock().await;
    let active = connections
        .get(&connection_id)
        .ok_or_else(|| not_connected(&connection_id))?;

    let namespaces = match active {
        ActiveAdapter::Rdb(adapter) => adapter.list_databases().await?,
        ActiveAdapter::Document(adapter) => adapter.list_databases().await?,
        // Phase 7/8 paradigms — graceful empty list (contract requirement).
        ActiveAdapter::Search(_) => Vec::new(),
        ActiveAdapter::Kv(_) => Vec::new(),
    };

    Ok(namespaces
        .into_iter()
        .map(|n| DatabaseInfo { name: n.name })
        .collect())
}
```

All four `ActiveAdapter` variants are matched explicitly — `Search` and
`Kv` return an empty list rather than throwing `AppError::Unsupported`,
which is the contract's "graceful empty return" requirement. The
`commands::meta::tests::dispatch_search_paradigm_returns_empty_without_unsupported_error`
and `dispatch_kv_paradigm_returns_empty_without_unsupported_error` tests
pin this behavior with `.expect("…must yield Ok(vec![]), not Unsupported")`.

## Item-Selection No-op — Code Evidence

`src/components/workspace/DbSwitcher.tsx:128-137`:

```tsx
const handleSelect = useCallback(() => {
  // Sprint 128 — selection is intentionally a no-op. S130/S131 wire the
  // real swap (PG sub-pool / Mongo `use_db`); until then we surface a
  // toast hint so the user understands the click was registered. No
  // store mutation happens here; the unit test asserts that
  // `useTabStore.getState()` is byte-identical before/after the click.
  toast.info(SELECT_HINT_MESSAGE);
  setOpen(false);
}, []);
```

The handler imports zero store-mutation methods — it only touches local
component state (`setOpen`) and the toast queue. Test
`DbSwitcher.test.tsx:285-308` snapshots `useTabStore.getState()` and
`useConnectionStore.getState()` to JSON before the click and asserts the
post-click snapshots are byte-identical.

## Frontend Fetch on Click — Code Evidence

`src/components/workspace/DbSwitcher.tsx:115-126` (popover's
`onOpenChange` handler triggers the fetch only when the picker is
becoming visible and the trigger is enabled):

```tsx
const handleOpenChange = useCallback(
  (next: boolean) => {
    if (!enabled) return;
    setOpen(next);
    if (next) {
      // Click marks the start of a fresh fetch — Sprint 128's contract
      // explicitly bans an LRU cache, so every popover open re-fetches.
      void fetchList();
    }
  },
  [enabled, fetchList],
);
```

`fetchList` (`DbSwitcher.tsx:94-112`) calls
`listDatabases(activeConn.id)`, drives `loading` / `errorMessage` /
`databases` state, and surfaces a toast on failure (the inline error chip
in the popover renders the same message — design bar requires
non-silent failure).

## Assumptions

1. **`pg_database` permission-denied detection** uses
   `sqlx::Error::Database` for the SQLSTATE arm and case-insensitive
   substring on the canonical Postgres message
   (`permission denied for table pg_database` and the newer
   `permission denied for relation pg_database`). Custom drivers/locales
   that strip both signals would still fail loud (no silent fallback).
2. **`DatabaseInfo` wire shape reuse** — the existing Mongo-specific
   `DatabaseInfo { name: String }` (`commands/document/browse.rs:20`) is
   re-used by the unified command. The TS side keeps importing
   `@/types/document::DatabaseInfo`. This avoids a duplicate
   `MetaDatabaseInfo` type for an identical shape.
3. **`StubDbError`** in the postgres unit tests implements
   `sqlx::error::DatabaseError` directly (since sqlx doesn't ship a
   constructor for the error variant). The shim is exercised only from
   `cfg(test)` and only for the `code()` / `message()` arms the matcher
   inspects.
4. **`<DbSwitcher>` re-fetches on every popover open** (no LRU cache —
   contract forbids it for S128). Sprint 130 introduces caching alongside
   the actual sub-pool implementation.
5. **Connection-paradigm change invalidates cache** — the `useEffect` at
   `DbSwitcher.tsx:75-87` resets `databases`/`errorMessage`/`open` when
   the active tab swaps to a different `(connectionId, paradigm)` pair,
   so a stale list never bleeds across connections.
6. **`autoFocus={idx === 0}`** on the first popover option satisfies the
   contract's "first item auto-focus" a11y bar. Esc-to-close inherits
   from Radix's `<Popover>` primitive.

## Residual Risk

- **No live PG smoke test** — the permission-denied fallback is only
  validated against `StubDbError`. Real-world Postgres connections still
  surface a SQLSTATE 42501 string; the matcher is intentionally
  conservative (SQLSTATE *or* one of two message substrings) so cloud-PG
  variants we haven't sampled may slip through. Mitigation: the message
  substring branch covers both "table" and "relation" phrasings (Postgres
  9.x vs 13+).
- **Trigger label still mirrors S127 placeholder** — the toolbar still
  shows the active tab's `schema`/`database` field as the label, not the
  result of `current_database()`. Sprint 130 swaps this to the real
  current-DB lookup once sub-pool keying lands.
- **Auto-focusing the first option via `autoFocus`** can cause a small
  layout shift in extreme cases (long DB names in a narrow viewport) —
  acceptable here because the popover anchors `align="start"` and uses a
  fixed `min-w-[8rem]` trigger so the popover width is determined by
  content, not by trigger width.
- **No e2e spec updated for the new active behavior** — Sprint 133 covers
  e2e additions per the contract's out-of-scope list. The unit-test
  coverage on the no-op selection (`useTabStore`/`useConnectionStore`
  byte-equality) plus the toast assertion is the regression net until
  S133 lands.
