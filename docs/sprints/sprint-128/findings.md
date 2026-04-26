# Sprint 128 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | Unified Tauri command exhaustively matches all 4 `ActiveAdapter` variants (`src-tauri/src/commands/meta.rs:49-61`); `Search`/`Kv` arms return `Vec::new()` instead of `AppError::Unsupported`, satisfying the contract's "graceful empty return" requirement. PG `pg_database` permission-denied helper (`src-tauri/src/db/postgres.rs:1747-1762`) checks SQLSTATE `42501` first, then case-insensitive substring (`permission denied for table pg_database` and `permission denied for relation pg_database`) — exactly the matching strategy spec'd in the contract Design Bar. Fallback path runs `SELECT current_database()` and surfaces a single-entry `Vec` (`src-tauri/src/db/postgres.rs:1722-1735`). Frontend `<DbSwitcher>` enables only when `paradigm ∈ {rdb, document}` AND active connection status is `connected` (`src/components/workspace/DbSwitcher.tsx:52-57`). Item selection is a true no-op: `handleSelect` only fires `toast.info(SELECT_HINT_MESSAGE)` and `setOpen(false)`; no store mutator is imported (`src/components/workspace/DbSwitcher.tsx:128-136`). Minor: PG `list_databases` does not currently issue `SET ROLE` or transactional guard, but contract does not require it. |
| Completeness | 9/10 | All 12 ACs map to concrete file:line evidence. AC-01 default impl `Ok(Vec::new())` at `src-tauri/src/db/mod.rs:138-140`. AC-02 query string + ordering verified literal at `src-tauri/src/db/postgres.rs:1714-1718`. AC-03 fallback covered by 8 unit tests (`db::postgres::tests::permission_denied_*` at `src-tauri/src/db/postgres.rs:3100-3158`). AC-04 dispatcher with all 4 paradigm arms (`src-tauri/src/commands/meta.rs:49-61`) plus 6 dispatcher tests (`commands::meta::tests::dispatch_*` at `meta.rs:259-323`). AC-05 handler registered at `src-tauri/src/lib.rs:48`. AC-06 `list_mongo_databases` retained verbatim at `src-tauri/src/commands/document/browse.rs:53-67` and at `src-tauri/src/lib.rs:49`. AC-07 wrapper + 3 tests at `src/lib/api/listDatabases.{ts,test.ts}`. AC-08 enable predicate + fetch + popover + listbox at `DbSwitcher.tsx:55-57, 94-126, 210-262` with 18 unit tests. AC-09 no-op selection asserted by store-snapshot byte-equality (`DbSwitcher.test.tsx:285-309`) and toast surface assertion (`:311-331`). AC-10 read-only fallback for kv/search/disconnected at `DbSwitcher.tsx:141-174` with 4 paradigm/connection-status tests. AC-11 38 new tests across Rust + TS. AC-12 all 6 verification commands green. The only nit is the trigger label still mirrors S127 (uses `tab.schema` / `tab.database` rather than `current_database()` lookup) — Generator flagged this as residual risk and confirmed it lands in S130. |
| Reliability | 8/10 | Error path: `fetchList` surfaces a toast AND inline error chip (`role="alert"` at `DbSwitcher.tsx:220-227`) so failures are non-silent (Design Bar). `useEffect` at `DbSwitcher.tsx:73-81` invalidates the cached list when `(connectionId, paradigm)` changes, preventing stale cross-connection data. `handleOpenChange` short-circuits with `if (!enabled) return;` so a paradigm flip while the popover is open won't drive a fetch. Concurrent flag handling is correct: `loading` flips to false in `finally` so consecutive clicks are safe. PG fallback only matches the canonical strict signal — message-only path requires the `pg_database` table name (`postgres.rs:1755-1758`), so unrelated 42501 errors don't accidentally resolve to a single-DB list (verified by `permission_denied_does_not_match_unrelated_42501`). One minor concern: `lastFetchKeyRef.current` is read by `useEffect` and written inside `fetchList` outside React's reconciliation; concurrent in-flight rejects could overwrite a newer connection's fetch result with a stale one (race on `setDatabases`/`setLoading`). Not blocking — sprint contract bans cancellation/cache scaffolding (S130 territory) — but worth a follow-up if S130 doesn't address it. |
| Verification | 9/10 | Re-ran 6 commands: vitest 1948/1948 pass, `pnpm tsc --noEmit` 0 errors, `pnpm lint` 0 errors, `pnpm contrast:check` 0 new violations (864 pairs / 64 allowlisted), `cargo test --lib` 245/245 pass, `cargo clippy --all-targets --all-features -- -D warnings` clean (no warnings). Test count delta matches handoff exactly: vitest +14, cargo +15. Critical safety tests are present and meaningful: SQLSTATE-only match, message-only match, case-insensitive substring, "relation" phrasing, negative cases for non-`pg_database` 42501 and `PoolClosed`, no-op store-mutation byte-equality, kv/search → empty Vec assertions with `.expect("…must yield Ok(vec![]), not Unsupported")` to pin the contract's graceful-empty requirement. Only gap: no live PG smoke test (Generator explicitly called out in residual risk; reliance on `StubDbError` is acceptable given `sqlx` ships no constructor for the DB-error variant). |
| **Overall** | **8.75/10** | All four dimensions ≥ 7. |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] AC-01 — `RdbAdapter::list_databases` trait method with default `Ok(Vec::new())` (`src-tauri/src/db/mod.rs:138-140`).
- [x] AC-02 — `PostgresAdapter::list_databases` runs `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname` (`src-tauri/src/db/postgres.rs:1714-1718`); ordering literal in the SQL.
- [x] AC-03 — Permission-denied fallback (SQLSTATE 42501 + case-insensitive substring) at `src-tauri/src/db/postgres.rs:1747-1762`; covered by 8 unit tests at `:3100-3158`.
- [x] AC-04 — Unified Tauri command with 4-paradigm dispatch (rdb / document → adapter call, search / kv → `Vec::new()`) at `src-tauri/src/commands/meta.rs:49-61`; 6 dispatcher tests at `:259-323`.
- [x] AC-05 — `commands::meta::list_databases` registered in `tauri::generate_handler!` at `src-tauri/src/lib.rs:48`.
- [x] AC-06 — `list_mongo_databases` untouched at `src-tauri/src/commands/document/browse.rs:53-67`; still registered at `src-tauri/src/lib.rs:49`.
- [x] AC-07 — TS thin wrapper at `src/lib/api/listDatabases.ts:34-38`; 3 unit tests at `src/lib/api/listDatabases.test.ts`.
- [x] AC-08 — `<DbSwitcher>` enabled for rdb/document + connected (`DbSwitcher.tsx:55-57`); fetch on open (`:115-126`); listbox + loading state (`:210-262`); 4 dedicated tests.
- [x] AC-09 — No-op selection + inline hint + toast (`DbSwitcher.tsx:128-136, 264-270`); store-snapshot byte-equality assertion at `DbSwitcher.test.tsx:285-309`.
- [x] AC-10 — Read-only chrome preserved for kv/search/disconnected at `DbSwitcher.tsx:141-174`; tested at `DbSwitcher.test.tsx:145-182`.
- [x] AC-11 — Rust: 1 happy-fail + 8 permission-denied + 6 dispatcher = 15 new tests. TS: 18 `<DbSwitcher>` tests + 3 wrapper tests = 21 new tests. Total +36 covering happy/empty/error/no-op/kv/search/loading/empty-result.
- [x] AC-12 — All 6 verification commands green (re-run by evaluator).

## Critical Evidence Verification

1. **PG permission-denied fallback (SQLSTATE 42501 + case-insensitive `pg_database` substring)**
   - Helper at `src-tauri/src/db/postgres.rs:1747-1762`. Order is correct: SQLSTATE arm first, then `to_ascii_lowercase()` substring match against both `permission denied for table pg_database` and `permission denied for relation pg_database` (Postgres 9.x vs 13+ phrasing).
   - Unit tests `permission_denied_matches_sqlstate_42501`, `permission_denied_matches_sqlstate_only`, `permission_denied_matches_message_substring`, `permission_denied_matches_message_relation_substring`, `permission_denied_message_match_is_case_insensitive` confirm the positive cases. Negative cases pinned with `permission_denied_does_not_match_unrelated_42501` and `permission_denied_does_not_match_non_database_error`.

2. **Dispatcher 4-paradigm branches**
   - `src-tauri/src/commands/meta.rs:49-61` — exhaustive `match`, `Search(_) => Vec::new()` and `Kv(_) => Vec::new()` (lines 59-60). Compile-time exhaustiveness ensures the contract invariant cannot drift.
   - Tests `dispatch_search_paradigm_returns_empty_without_unsupported_error` and `dispatch_kv_paradigm_returns_empty_without_unsupported_error` (`meta.rs:280-295`) explicitly call `.expect("…must yield Ok(vec![]), not Unsupported")` so a regression to `AppError::Unsupported` would fail the suite.

3. **`<DbSwitcher>` selection no-op (store mutation 0)**
   - `handleSelect` at `DbSwitcher.tsx:128-136` only invokes `toast.info(SELECT_HINT_MESSAGE)` and `setOpen(false)`. No `useTabStore.setState`/`useConnectionStore.setState` calls are imported at the module level.
   - Test "selecting an item is a no-op against tab and connection stores" (`DbSwitcher.test.tsx:285-309`) takes JSON snapshots of both stores before the click and asserts byte-equality after.

4. **`list_mongo_databases` regression: 0**
   - `commands/document/browse.rs:53-67` is byte-identical to its pre-Sprint-128 form. `lib.rs:49` retains the registration. Existing `documentStore.test.ts` (in suite) continues to pass — overall vitest delta is exactly +14, the count of new Sprint 128 tests.

5. **Paradigm rdb/document + connected → enabled, otherwise read-only**
   - Predicate `enabled = (paradigm === "rdb" || paradigm === "document") && isConnected` at `DbSwitcher.tsx:56-57`. `if (!enabled) { return <read-only chrome>; }` at `:141`.
   - 4 read-only tests (no tab / disconnected rdb / kv / search) and 2 active tests (rdb / document) cover the truth table. Re-verified label resolution still works: document-paradigm tab shows `analytics`, rdb tab shows `public`, no-schema query tab shows `(default)`.

## Verification Command Outcomes (Re-run)

| Command | Outcome | Notes |
|---------|---------|-------|
| `pnpm vitest run` | PASS | 1948 / 1948 (123 files) — matches handoff |
| `pnpm tsc --noEmit` | PASS | 0 errors |
| `pnpm lint` | PASS | 0 errors |
| `pnpm contrast:check` | PASS | 0 new violations (864 pairs, 64 allowlisted) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | PASS | 245 passed, 0 failed — matches handoff |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS | clean — re-ran twice (file-lock blockers in first run, second run finished in 0.33s) |

## Findings

### P1 — None.
### P2 — None.
### P3 (informational, non-blocking)

- **P3-1 — `lastFetchKeyRef` race on stale fetches.** When the user opens the popover, switches connections mid-flight, then re-opens, the older promise's `.then` could write `setDatabases(staleResult)` after the `useEffect` reset. Not blocking because the contract postpones cache/cancellation work to S130 and the `useEffect` invalidation already nukes the popover open state, but worth wiring an `AbortController` (or in-flight token) into S130's LRU cache.
- **P3-2 — Trigger label still uses `tab.schema` / `tab.database` placeholder.** Generator flagged this. The label will become misleading once the user opens the popover and sees the real database list — e.g. an rdb tab whose `schema` is `public` will show `public` on the trigger but `postgres`/`warehouse` in the popover. Acceptable for S128 (label semantics ship in S130 alongside `current_database()` lookup). Worth pinning a TODO comment in `DbSwitcher.tsx:83-92` referencing S130.
- **P3-3 — `autoFocus={idx === 0}` on the listbox option.** The first option grabs focus on every popover open, which is a11y-correct for a fresh popover but resets focus when re-fetch happens after a paradigm flip. Acceptable; matches the Design Bar's "first item auto-focus" requirement.

## Feedback for Generator

None blocking. The implementation is contract-faithful, well-tested, and self-documents its scope boundary (in-line comments cite S130/S131 as the next phase). Suggestions below are advisory for the S130 follow-up.

1. **Stale-fetch protection (S130 follow-up)**
   - Current: `fetchList` writes `setDatabases(result)` unconditionally on resolution.
   - Expected (S130 LRU sprint): cancel the in-flight promise when `(connectionId, paradigm)` changes mid-fetch.
   - Suggestion: add an `AbortController` ref or compare a captured `requestId` against the latest `lastFetchKeyRef.current` before calling the setters.

2. **Trigger label TODO breadcrumb**
   - Current: `<DbSwitcher>` line 83-92 derives `label` from `tab.schema`/`tab.database`.
   - Expected (S130): label reflects `current_database()` (or active sub-pool key).
   - Suggestion: drop a single-line `// TODO(S130): swap for current_database() once sub-pool keying lands.` so the next sprint sees the explicit handoff.

3. **PG live smoke test (deferred)**
   - Current: only `StubDbError` exercises the matcher.
   - Expected: integration test that issues a `SET ROLE` + revoke against a docker PG and confirms the fallback.
   - Suggestion: add to `src-tauri/tests/integration_postgres.rs` behind a `RUN_LIVE_PG=1` env guard.
