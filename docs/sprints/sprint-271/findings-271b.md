# Sprint 271b Evaluation Findings

**Slice scope**: query data + dry-run guard (`query_table_data` + `execute_query_dry_run`).
**Date**: 2026-05-13
**Verification profile**: `mixed`.

## Gate Results (all 6 re-run)

| # | Gate | Result | Output |
|---|---|---|---|
| 1 | `cargo fmt --check` | PASS | clean |
| 2 | `cargo clippy --all-targets --all-features -- -D warnings` | PASS | clean (cached) |
| 3 | `cargo test --lib` | PASS | **695 passed**, 0 failed, 2 ignored (matches Generator claim: 689 → 695, +6 net) |
| 4 | `pnpm tsc --noEmit` | PASS | clean |
| 5 | `pnpm lint` | PASS | eslint 0 errors |
| 6 | `pnpm vitest run --no-file-parallelism` | PASS | **3243 passed**, 264 files (matches Generator claim: 3238 → 3243, +5 net) |

Backend delta `+6` is correct: 3 dry-run tests + 3 table-data tests added (the
audit table in the evidence packet claims 3 cases per command).

## Byte-equivalence Audit

Reference: `src-tauri/src/commands/rdb/query.rs:83-92` (Sprint 266
`execute_query_inner` mismatch guard).

```rust
if let Some(expected) = expected_database {
    let actual = adapter.current_database().await?.unwrap_or_default();
    if actual != expected {
        release_cancel_token(state, &cancel_handle).await;
        return Err(AppError::DbMismatch {
            expected: expected.to_string(),
            actual,
        });
    }
}
```

| Site | Lines | Lock scope | unwrap_or_default? | DbMismatch shape | Pre-trait order | Cancel-token release before return |
|---|---|---|---|---|---|---|
| `execute_query_dry_run_inner` | 301–310 | inside `active_connections.lock().await` (L289) | YES | `AppError::DbMismatch { expected: expected.to_string(), actual }` | YES — before `adapter.dry_run_sql_batch` | YES — `release_cancel_token(state, &cancel_handle).await` at L304 |
| `query_table_data_inner` | 442–451 | inside `active_connections.lock().await` (L430) | YES | identical | YES — before `adapter.query_table_data` | YES — `release_cancel_token(state, &cancel_handle).await` at L445 |

Both sites are **textually identical** to the Sprint 266 reference at
L83-92 byte-for-byte (only differing in the trait method invoked
afterward). Lock acquisition holds the `MutexGuard` returned by
`state.active_connections.lock().await`; the probe runs inside the same
`{...}` block before the trait dispatch — matches Sprint 267 invariant.

`git diff main -- src-tauri/src/commands/rdb/query.rs` confirms the
only hunks touching production code are inside
`execute_query_dry_run_inner` (L257, 289–310, 345–355) and
`query_table_data_inner` / `query_table_data` (L419, 431–451, 490, 504).
`execute_query_inner`, `execute_query`, `execute_query_batch_inner`,
`execute_query_batch`, `cancel_query_inner`, `cancel_query` have **zero
production-code diff** — Sprint 266 + cancel_query byte-equivalent
invariant holds.

## Cancel-token release-on-mismatch coverage

Generator claim: "≥1 of the 6 new tests verifies the cancel-token
release-on-mismatch path." Verified — both commands have one:

- `execute_query_dry_run_mismatch_releases_cancel_token`
  (query.rs:1021-1036) — registers `"qd-mismatch"`, mismatch returns,
  asserts `!tokens.contains_key("qd-mismatch")` with a debug print of
  remaining keys on failure.
- `query_table_data_mismatch_releases_cancel_token`
  (query.rs:1152-1179) — same shape on `"qtd-mismatch"`. The comment
  flags this as "the core of this sprint" because
  `query_table_data_inner` registers the cancel handle BEFORE the lock
  acquisition, so the release-before-early-return ordering is genuinely
  load-bearing here (not just defensive).

Both also have a no-dispatch sentinel (panic in the stub trait closure)
on the mismatch case — guard regression would fail loud.

## TS wrapper signatures

`src/lib/tauri/query.ts`:

- `queryTableData` (L15-37) — optional last-positional
  `expectedDatabase?: string`, forwarded as
  `expectedDatabase: expectedDatabase ?? null` (L35). JSDoc references
  Sprint 271b (L7-14).
- `executeQueryDryRun` (L103-115) — same shape, same JSDoc reference
  (L97-102).

Existing callers that omit the arg compile unchanged. AC-271-03
satisfied.

## Caller forwarding

- `useQueryExecution` (L991-996) — forwards `workspaceDb ?? undefined`
  to `executeQueryDryRun` (4th positional). Catch (L1023-1038) parses
  with `parseDbMismatch`, fires `syncMismatchedActiveDb`, surfaces
  toast.warning ("Re-run the dry-run if needed.") — Sprint 269 toast
  reuse. AC-271-04 + AC-271-05 satisfied.
- `DataGrid` (L209-258) — fetchData catch (L236-253) parses mismatch
  message, fires `syncMismatchedActiveDb` and toast.warning ("Re-open
  the table to refresh."). The store-level `queryTableData` in
  `schemaStore.ts` (L396-424) forwards `db` as `expectedDatabase` but
  deliberately does NOT call `handleDbMismatch` so DataGrid's catch
  owns the surface (single Retry-toast site for user-initiated
  row-fetch). AC-271-04 + AC-271-05 satisfied.

## Frontend test coverage

`src/components/rdb/DataGrid.dbMismatch.test.tsx` (NEW, 3 cases):

1. **Mismatch case** (L167-197) — `mockQueryTableData` throws Sprint
   266 wire format → asserts `verifyActiveDb("conn1")`,
   `setActiveDb("conn1", "db2")`, `clearForConnection("conn1")`,
   `toast.warning(...db2...)`. inline alert also asserted via
   `findByRole("alert")`.
2. **Non-mismatch case** (L199-213) — generic `"Connection refused"` →
   asserts NO sync helper / toast invocation. Crucial silent-path
   regression guard.
3. **Happy path** (L215-222) — default fixture renders rows; no sync
   / no toast.

`src/components/query/QueryTab/useQueryExecution.dry-run.test.ts`:

- 2 existing IPC assertions updated for new positional `"db1"`
  (L182-187, L254-259).
- 2 new cases added:
  - L298-325 — `database: "myDb"` override → asserts `expectedDatabase
    = "myDb"` forwarded.
  - L327-367 — mismatch end-to-end: mocked reject → `failQuery` +
    `verifyActiveDb("conn1")` + `toast.warning`.

`src/stores/schemaStore.test.ts` (L266-279) — single `queryTableData`
delegation assertion updated for the new positional. No rewrite.

`src/components/query/QueryTab.toolbar.test.tsx` (L262-265, AC-248-T4)
— same positional update.

AC-271-06 + AC-271-07 satisfied.

## Quality bar checks

- **No `any`** on changed TS surfaces — grep clean across `query.ts`,
  `DataGrid.tsx`, `DataGrid.dbMismatch.test.tsx`, `useQueryExecution.ts`,
  `schemaStore.ts`.
- **No `console.log`** shipped — grep clean.
- **No `unwrap()`** in production Rust — all `.unwrap()` matches in
  `query.rs` (lines 631, 719, 838, 889, 987, 1107, 1210, 1249) sit
  inside `#[cfg(test)] mod tests` (starts L513). Production paths use
  `?` + `unwrap_or_default()`.
- **Sprint 271 annotation** on every new test section — `// ── Sprint
  271b ...` headers at query.rs:993, 1112 + JSDoc references in
  `query.ts` + DataGrid.dbMismatch.test.tsx:1 + dry-run.test.ts
  L298, L327.

## Generator decisions — verdict

1. **Helper NOT hoisted**: ACCEPTED. The cancel-token release-on-mismatch
   ordering differs from schema.rs's pattern (which does not have a
   per-call cancel token registered before the lock). Hoisting would
   require a cancel-aware helper variant — not worth the abstraction.
   Generator's rationale is sound.
2. **DataGrid passive Retry toast on every mismatch**: ACCEPTED.
   DataGrid's only entry points (open-table click, refresh-data event,
   FK navigation) are all user-initiated. Sprint 269 contract permits
   passive toast (no Retry button) since the surface lacks a
   ref-backed lexical-statement equivalent.
3. **Dry-run passive toast (no Retry button)**: ACCEPTED.
   `useQueryExecution`'s dry-run path is invoked via lexical
   statement, not a ref-backed re-invocable handle. A Retry button
   would require either a separate "re-run dry-run" capture surface
   (out of scope) or a generic event re-dispatch (premature
   abstraction). Toast copy ("Re-run the dry-run if needed.") clearly
   signals user action.
4. **`workspaceDb` empty-string concern**: ACCEPTED. `seedWorkspace`
   defaults `activeDb` to `DEFAULT_TEST_DB === "db1"`
   (`workspaceStoreTestHelpers.ts:13`); `workspaceDb` never resolves
   to `""` in the tests. Production code would similarly route through
   `useWorkspaceStore.activeDb`, which is enforced non-empty by the
   workspace-init flow. No false-positive mismatch path.

## Scorecard

| Dimension | Score | Justification |
|-----------|-------|---------------|
| **Correctness** | 9/10 | Probe blocks byte-identical to Sprint 266 reference; cancel-token release ordering preserved on early return; both new tests assert release-on-mismatch via positive registry probe; Sprint 266 commands + cancel_query untouched (verified via `git diff`). |
| **Completeness** | 9/10 | All 2 commands in slice scope migrated; all 4 caller sites updated (`schemaStore.queryTableData`, `useQueryExecution` dry-run, `DataGrid` row-fetch, plus the 3 existing-test positional updates); audit-table reconciled. JSDoc + Sprint id present on all changes. |
| **Reliability** | 8/10 | Catch paths surface user-initiated toasts only; silent-path regression guarded by `non-mismatch errors do NOT trigger sync` test in DataGrid; cancel token registry stays clean on mismatch. One minor gap — toast copy is passive (no Retry button) for both surfaces, but this is documented and justified. |
| **Verification Quality** | 9/10 | 6 gates all PASS with reproduced counts (cargo 695, vitest 3243); byte-equivalence verified via file:line citation; cancel-token release tested by both Rust + TS layers; `git diff` confirms zero Sprint 266 / cancel_query diff. |
| **Code Quality** | 9/10 | No `any`, no `console.log`, no production `unwrap()`; Sprint 271 annotation on every new test; JSDoc preserved on TS wrappers; rationale comments at probe sites explicitly cite the Sprint 266 reference (`execute_query_inner:83–92`). |
| **Overall** | **8.8/10** | |

## Verdict

**PASS.**

All 5 dimensions ≥ 7. No P1/P2 findings open. Slice 271b is ready to
land as its own commit; Generator may proceed to slice 271c (DDL,
11 commands).

## Handoff inputs for Generator (slice 271c)

- Sprint 266 byte-equivalent probe block remains the reference (no
  helper extraction needed for 271c either — DDL commands likely have
  the same cancel-token-aware ordering question; re-evaluate per file).
- For DDL, the `*Request` struct gets `#[serde(default)] expected_database:
  Option<String>` per AC-271-08 sub-slicing pin; the TS wrapper threads
  the field through the request payload (NOT a positional arg).
- Retry toast: DDL is universally user-initiated (dialog confirm), so
  the Sprint 269 Retry button (full re-invocation via a stored ref)
  IS reasonable to wire — unlike 271b's lexical-statement surfaces.
  Consider matching `useQueryExecution`'s ref-backed `runRdbSingleNow`
  pattern if a DDL driver already has a re-invocable handle.
