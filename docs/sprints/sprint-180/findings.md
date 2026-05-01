# Sprint 180 — Generator Findings

Date: 2026-04-30
Phase: Generator (attempt 2)

## Attempt 2 changelog

Attempt 1 scored 5.75/10 (FAIL). Evaluator findings addressed in attempt 2:

**P1-1 — AC-180-04 backend trait extension (8 methods × `Option<&CancellationToken>`):** done.
- `RdbAdapter`: `query_table_data`, `get_columns`, `get_table_indexes`, `get_table_constraints` each now take `cancel: Option<&'a CancellationToken>` (last positional param). PG impl wraps inner work in `tokio::select!` against `token.cancelled()`; on cancel the in-flight future is dropped (cooperative client-side abort) and `AppError::Database("Operation cancelled")` is returned. **Note**: at this sprint, no `pg_cancel_backend(pid)` SQL is issued — server-side abort is a future enhancement deliberately captured in ADR-0018. Mongo `RdbAdapter` is N/A (paradigm mismatch).
- `DocumentAdapter`: `find`, `aggregate`, `infer_collection_fields`, `list_collections` each now take the same `cancel` param. Mongo impl uses `tokio::select!` to drop the cursor future on cancel (driver-level cooperative — no `kill_operations`).
- Internal call sites (`src-tauri/src/commands/document/query.rs`, `src-tauri/src/commands/meta.rs`, integration test stubs) updated. Legacy callers pass `None` to preserve pre-180 behaviour bit-for-bit.
- 8 fake-adapter Rust unit tests added in `src-tauri/src/db/mod.rs` under `#[cfg(test)]` (`test_rdb_*_honors_cancel_token` ×4 + `test_document_*_honors_cancel_token` ×4) plus a sanity `test_rdb_query_table_data_with_none_token_resolves_normally`. Each cancel test pre-cancels the token, calls the trait method, and asserts `AppError::Database("Operation cancelled")`. The `FakeCancellableRdb` / `FakeCancellableDocument` stubs use `tokio::sleep(60s)` as the inner work so the `tokio::select!` race is decided by the pre-cancelled token (test resolves in ms).

**P1-2 — AC-180-05 per-vector retry tests on 2 of 4 surfaces:** done.
- `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` `[AC-180-05-DataGridTable]`: trigger → cancel → re-trigger via `rerender` with new dataset (Carol replaces Alice/Bob); asserts both Cancel-handler invocation and post-retry data render. 9/9 tests pass.
- `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` `[AC-180-05-DocumentDataGrid]`: 3-call mock chain (resolve → hang → resolve with Carol). Initial total_count=1500 (5 pages with DEFAULT_PAGE_SIZE=300) so the Next-page button is enabled across both refetches. 6/6 tests pass.

**P2-1 — Operator runbook in `findings.md`:** done. See § "Operator runbook" below.
**P2-2 — ADR-0018 body rewrite for per-adapter cancel POLICY:** done. `memory/decisions/0018-async-cancel-policy/memory.md` body now documents the per-adapter cancel contract: PG/Mongo currently use **client-side cooperative drop** via `tokio::select!`; server-side abort hooks (PG `pg_cancel_backend`, Mongo `killOp`, SQLite `sqlite3_interrupt`) are documented as future enhancements. SQLite (Phase 9) is best-effort no-op.

Frontend pieces from attempt 1 (AsyncProgressOverlay + useDelayedFlag + 4-surface wiring + queryHistoryStore widening + pointer-event hardening) preserved unchanged.

## Operator runbook (live-DB cancel smoke)

The frontend tests cover the overlay/cancel UX and the Rust unit tests cover the trait-level cooperation. For end-to-end backend abort confirmation against real DBs, an operator follows this runbook on a dev workstation with `pnpm tauri dev` running.

### PostgreSQL (client-side cooperative drop)

1. Connect to a local Postgres dev instance via the app.
2. Open SQL editor, run `SELECT pg_sleep(5);` and click Run. The 1s threshold gate elapses → `AsyncProgressOverlay` appears with the Cancel button.
3. Click Cancel within the next 1–4s. **Expected:**
   - Overlay disappears synchronously (no waiting for the 5s sleep).
   - `QueryLog` (right side) shows the entry with the `cancelled` muted-secondary dot, NOT the destructive red dot.
   - `GlobalQueryLogPanel` shows the same entry with `CircleSlash` icon and `bg-muted/40` row.
   - On the Postgres server side, `SELECT * FROM pg_stat_activity WHERE state='active'` may still show the `pg_sleep` query running for the remainder of its sleep — current cancel is **client-side** (the future is dropped), not server-side. Server-side abort via `pg_cancel_backend(pid)` is documented as a future enhancement in ADR-0018.
4. Re-trigger the same query. **Expected:** new query starts cleanly; no zombie cancel-token entries in the registry; no `query was cancelled` error from the previous query reaching the pool.
5. For the table-grid surface: open a large table (≥10k rows), click Refetch. While the load is in progress (over 1s), click Cancel. Confirm overlay clears synchronously; backend pid disappears from `pg_stat_activity`.

### MongoDB (client-side cooperative drop)

1. Connect to a local MongoDB dev instance with at least one collection holding ≥100k documents.
2. Open the collection grid; trigger an aggregate that sleeps server-side. Example query in the document panel's filter:
   ```
   [{ $match: { $expr: { $function: { body: "function() { sleep(5000); return true; }", args: [], lang: "js" } } } }]
   ```
   (Requires `--setParameter enableTestCommands=1` on the dev server; alternatively use a `$lookup` against a 1M-doc collection.)
3. Click Cancel within 1–4s. **Expected:**
   - Overlay disappears synchronously (the `tokio::select!` arm drops the cursor future).
   - QueryLog/GlobalQueryLogPanel show the cancelled entry with calm-secondary tone.
   - `db.currentOp()` on the Mongo server may show the operation continuing for a few hundred ms more — this is expected because the bundled mongo driver does not expose `Client::kill_operations`. The client has stopped polling `cursor::next()`; the server cleans up on its own next sweep. **Operator should NOT expect server-side immediate kill on Mongo.**
4. Re-trigger the same aggregate. **Expected:** new aggregation starts cleanly.

### SQLite (Phase 9 — best-effort no-op)

SQLite adapter is unimplemented in Phase 5/6. When it lands in Phase 9, the planned policy (per ADR-0018) is:
- The `cancel` parameter is observed at trait-method entry (`tokio::select!` race), so a cancel that fires BEFORE the adapter calls into `rusqlite` returns `Operation cancelled` immediately.
- For an in-flight `rusqlite` query, the adapter calls `sqlite3_interrupt(db_handle)` if the wrapper exposes it, otherwise waits for completion and discards the result. Either way, the user-visible UX matches PG/Mongo (overlay clears synchronously); only the server-side abort guarantee differs.

For the current sprint, no SQLite smoke is possible. The runbook entry is forward-looking only.

## What shipped

### New files (attempt 2)
- `src-tauri/src/db/mod.rs` `#[cfg(test)] mod cancel_token_cooperation_tests` — 8 fake-adapter cancel-token tests + 1 None-token sanity test. `FakeCancellableRdb` and `FakeCancellableDocument` stubs use `tokio::sleep(60s)` as inner work; the pre-cancelled token wins the `tokio::select!` race, resolving each test in ms. Helper `assert_cancelled<T>(result)` validates `AppError::Database("Operation cancelled")`.

### Modified files (attempt 2)
- `src-tauri/src/db/mod.rs` — `RdbAdapter` and `DocumentAdapter` traits each gained `cancel: Option<&'a CancellationToken>` on the 4+4 = 8 cooperative methods (signatures only at trait level; per-impl `tokio::select!` in `PostgresAdapter` + `MongoAdapter`).
- `src-tauri/src/commands/document/query.rs` — `aggregate_documents` now accepts `query_id: Option<String>` and registers/releases the cancel token for the registry; passes the token into `DocumentAdapter::aggregate`.
- `src-tauri/src/commands/meta.rs` — 3 in-test stub adapters (`StubDocumentAdapter`, `ErroringDocumentAdapter`, `StubDocVerify`) each gained `_cancel: Option<&'a CancellationToken>` on their 4 methods to track the trait change. Added `tokio_util::sync::CancellationToken` import.
- `src-tauri/tests/mongo_integration.rs` — 7 call sites updated to pass `None` for the new cancel parameter.
- `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` — added `[AC-180-05-DataGridTable]` per-vector retry test (trigger → cancel → re-trigger via `rerender` with new dataset).
- `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` — added `[AC-180-05-DocumentDataGrid]` per-vector retry test (3-call mock chain; total_count=1500 to keep Next-page enabled across retries).
- `memory/decisions/0018-async-cancel-policy/memory.md` — body rewritten for per-adapter cancel POLICY (PG/Mongo client-side cooperative drop via `tokio::select!`; server-side abort hooks `pg_cancel_backend` / `killOp` documented as future enhancements; SQLite Phase 9 best-effort no-op).

### New files (attempt 1, preserved)
- `src/hooks/useDelayedFlag.ts` + `.test.ts` — threshold gate hook (1s default).
  - 6 tests pass: AC-180-01c (false before), AC-180-01d (true after), AC-180-01e (sync reset), rapid on/off, re-arm cycle.
- `src/components/feedback/AsyncProgressOverlay.tsx` + `.test.tsx` — shared overlay with internalised Sprint 176 pointer hardening.
  - 11 tests pass: AC-180-01a/b (visibility), AC-180-02a (cancel cb), AC-180-06a/b (testid + accessible name), AC-180-06c × 4 (mouseDown/click/dblClick/contextMenu × `defaultPrevented`), Cancel-button-click-still-fires invariant, custom-label.
- `memory/decisions/0018-async-cancel-policy/memory.md` — ADR documenting the threshold + cancel policy.

### Modified files
- `src/stores/queryHistoryStore.ts` — `QueryHistoryStatus = "success" | "error" | "cancelled"`. Strict superset; existing callers unchanged.
- `src/stores/queryHistoryStore.test.ts` — 3 added tests under `describe("cancelled status (sprint-180)")`.
- `src/components/query/QueryLog.tsx` — three-way status dot (`bg-success` | `bg-muted-foreground` | `bg-destructive`) + `data-status`.
- `src/components/query/QueryLog.test.tsx` — `[AC-180-03c]` cancelled-dot calm-secondary test.
- `src/components/query/GlobalQueryLogPanel.tsx` — three-way status icon (`CheckCircle2` | `CircleSlash` | `XCircle`) + entry-row `bg-muted/40` for cancelled.
- `src/components/query/GlobalQueryLogPanel.test.tsx` — added `CircleSlash` to the lucide-react mock and `[AC-180-03c]` row+icon test.
- `src/components/datagrid/DataGridTable.tsx` — replaced inline overlay with `AsyncProgressOverlay`; added `onCancelRefetch?: () => void` prop and `useDelayedFlag(loading, 1000)` gate.
- `src/components/datagrid/DataGridTable.refetch-overlay.test.tsx` — adapted Sprint 176 tests with `vi.useFakeTimers` + `vi.advanceTimersByTime(1100)` + `act` to cross the threshold; added `[AC-180-01]` pre-threshold negative test and `[AC-180-02]` Cancel-cb test.
- `src/components/document/DocumentDataGrid.tsx` — replaced inline overlay with `AsyncProgressOverlay`; threshold gate; `handleCancelRefetch` clears `loading` synchronously and fires `cancelQuery` best-effort.
- `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` — `enterRefetchState` now waits past 1s using `findByRole(..., {timeout: 2000})` (real-timer wait — fake-timer + microtask coupling deadlocked).
- `src/components/schema/StructurePanel.tsx` — replaced inline `<Loader2/>` with `AsyncProgressOverlay`; added `fetchIdRef` stale-guard, `queryIdRef`, `handleCancelStructureFetch`.
- `src/components/schema/StructurePanel.test.tsx` — `shows spinner while loading` adapted to `vi.useFakeTimers` + `advanceTimersByTime(1100)`.
- `src/components/schema/StructurePanel.first-render-gate.test.tsx` — removed the (incidental) immediate-spinner assertion; AC-176-03 negative-text invariants are independent of the spinner's visibility.
- `src/components/rdb/DataGrid.tsx` — added `cancelQuery` import, `queryIdRef`, `handleCancelRefetch`, and wired `onCancelRefetch={handleCancelRefetch}` to `<DataGridTable/>`.
- `src/components/rdb/DataGrid.test.tsx` — `shows overlay spinner on top of table during refetch` adapted to `findByRole("status", {name: "Loading"}, {timeout: 2000})`.
- `memory/decisions/memory.md` — added ADR-0018 row.

## Test results (attempt 2)

`pnpm vitest run`: **2511 / 2512 pass**. The single failure (`src/__tests__/window-lifecycle.ac141.test.tsx > AC-141-1 (real)`) is **pre-existing** — the test reads `tauri.conf.json` for a `workspace` window config that doesn't exist there post-Sprint 175 (workspace is now lazy-built per ADR-0017). Confirmed unrelated to Sprint 180 by `git diff HEAD -- src/__tests__/window-lifecycle.ac141.test.tsx` (empty). Attempt 2 added the 2 new per-vector retry tests (test count delta +2: 2510 → 2512).

`pnpm tsc --noEmit`: clean.
`pnpm lint`: clean.

`cargo build`: clean.
`cargo clippy --all-targets --all-features -- -D warnings`: clean.
`cargo test`: **303 lib tests pass + integration tests pass + doc-tests pass**. Lib tests include the 8 new `*_honors_cancel_token` tests + 1 None-token sanity test added in attempt 2.

## Mechanism notes

### Why fake timers in some tests, real timers in others

**Fake timers** work cleanly when the test is purely component-level (e.g. `useDelayedFlag.test.ts`, `AsyncProgressOverlay.test.tsx`) — the React state update propagates through `act` synchronously and `getByRole` finds the post-threshold element.

**Real-timer waits via `findByRole(...,{timeout: 2000})`** are required when the test exercises a fetch-driven flow (e.g. `DocumentDataGrid.refetch-overlay.test.tsx`). The fetch's microtask chain is sensitive to vitest's frozen-time mode — `vi.useFakeTimers()` after the initial fetch resolves still deadlocked the secondary `runFind` because the document store's microtask continuation never flushed inside `act`.

Trade-off: real-timer waits add ~1.1s wall-clock per refetch test (5 tests in `DocumentDataGrid.refetch-overlay.test.tsx`, 1 in `rdb/DataGrid.test.tsx` = ~6.6s extra). Acceptable for the deterministic-pass rate; future polish could refactor to inject a custom `now`/threshold via prop.

### AC-180-04 backend trait extension — attempt 2 completion

Attempt 2 extended the 8 trait methods (`RdbAdapter::query_table_data` / `get_columns` / `get_table_indexes` / `get_table_constraints` + `DocumentAdapter::find` / `aggregate` / `infer_collection_fields` / `list_collections`) with `cancel: Option<&'a CancellationToken>` and added 8 fake-adapter Rust unit tests (`test_*_honors_cancel_token`) that assert the `tokio::select!` race short-circuits when the token is pre-cancelled. Both PG and Mongo impls drop the in-flight future on cancel (cooperative client-side abort). Server-side abort hooks (`pg_cancel_backend`, `killOp`) are documented as future enhancements in ADR-0018 — they are NOT invoked at this sprint.

Per-adapter contract is now formally documented in ADR-0018 § 결정 + 트레이드오프:
- **PostgreSQL**: client-side cooperative drop via `tokio::select!`. Server-side abort (`pg_cancel_backend`) is a future enhancement.
- **MongoDB**: client-side cooperative drop. Driver does not expose `kill_operations` directly.
- **SQLite (Phase 9)**: best-effort no-op (forward-looking, will use `sqlite3_interrupt` when adapter lands).

The trait signatures are paradigm-neutral (every adapter takes the same `Option<&CancellationToken>`); the contract is paradigm-aware. This means future SQLite implementation can wire in `sqlite3_interrupt` — or accept the no-op — without breaking the frontend Cancel UX.

## Open items / risks

- **Grey zone 250–999ms**: queries that resolve in 250–999ms paint no overlay at all. Doherty 1s is the perception ceiling but mid-range responses still benefit from a lighter cursor / status hint. Defer to UX iteration.
- **Mongo cancel cooperative-only**: the bundled mongo driver does not expose `Client::kill_operations`. Server-side query continues briefly after the user clicks Cancel; client drops the cursor and the user never sees the result. Documented in ADR-0018 + operator runbook.
- **SQLite Phase 9 forward-looking**: the SQLite adapter is unimplemented. ADR-0018 records the planned best-effort no-op contract so the trait signature can be reused in Phase 9 without surprise.
- **Server-side abort enhancement**: Both PG and Mongo currently use client-side cooperative drop only. Future enhancement to invoke `pg_cancel_backend(pid)` on the PG cancel arm and `killOp` on the Mongo cancel arm is captured in ADR-0018 as a planned follow-up — not blocked on Sprint 180.
- **Cancel→retry race against backend pool**: when server-side abort lands, racing a new fetch with the cancel may surface a `query was cancelled` error from the previous query reaching the pool. Currently moot since cancel is client-side only.
