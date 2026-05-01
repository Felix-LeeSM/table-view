# Sprint 183 — Handoff

| AC | Subject | Evidence |
|----|---------|----------|
| AC-183-01 | `RdbAdapter::execute_sql_batch` trait method (default `Unsupported`) | `src-tauri/src/db/mod.rs:202-218`. Compile passes (`cargo clippy --all-targets --all-features -- -D warnings`). Test fakes (`FakeCancellableRdb`, `FastFakeRdb`) inherit default fallback automatically. |
| AC-183-02 | `PostgresAdapter::execute_sql_batch` BEGIN/COMMIT/ROLLBACK + cancel | Inherent at `src-tauri/src/db/postgres.rs:604-687`; trait override `:2014-2020`. Verified by AC-183-07a/b unit tests. cancel via `tokio::select!` + RAII Drop on `Transaction`. |
| AC-183-03 | `execute_query_batch` Tauri command | `src-tauri/src/commands/rdb/query.rs:121-198`. Registered in `src-tauri/src/lib.rs:142`. Validates: (a) connection_id non-empty, (b) statements non-empty, (c) each statement non-empty. |
| AC-183-04 | `executeQueryBatch` IPC wrapper | `src/lib/tauri.ts:265-276`. Type: `(string, string[], string) => Promise<QueryResult[]>`. Mirrors existing `executeQuery` shape. |
| AC-183-05 | `useDataGridEdit.handleExecuteCommit` (RDB branch) → batch | `src/components/datagrid/useDataGridEdit.ts:724-820` (paradigm === "rdb" branch). Replaces N × `executeQuery` loop with single `executeQueryBatch`. catch wraps message as `Commit failed — all changes rolled back: <message>`. statementIndex parsed via `/statement (\d+) of \d+ failed/`. |
| AC-183-06 | `EditableQueryResultGrid.handleExecute` → batch | `src/components/query/EditableQueryResultGrid.tsx:199-222`. Single `executeQueryBatch` call. `executeError` set to `Commit failed — all changes rolled back: <message>` on rejection. |
| AC-183-07a | Rust unit test `test_execute_sql_batch_empty_returns_empty_vec` | `src-tauri/src/db/postgres.rs:2333-2342`. `cargo test --lib test_execute_sql_batch` → `2 passed; 0 failed`. |
| AC-183-07b | Rust unit test `test_execute_sql_batch_validation_rejects_empty_statement` | `src-tauri/src/db/postgres.rs:2344-2362`. Same run. Asserts `Validation` error with `"Statement 2 of 2 is empty"` body. |
| AC-183-08a | useDataGridEdit happy-path batch (single call, both stmts) | `src/components/datagrid/useDataGridEdit.commit-error.test.ts` `[AC-183-08a]`. `pnpm vitest run src/components/datagrid/useDataGridEdit.commit-error.test.ts` → 6 passed. Asserts: `mockExecuteQueryBatch` called once with array of 2 stmts, `mockExecuteQuery` not called, fetchData fired once, sqlPreview cleared. |
| AC-183-08b | useDataGridEdit failure (single + 3-stmt rolled-back) | Same file `[AC-183-08b]` (×2 cases). Asserts message matches `/Commit failed — all changes rolled back/`, `not.toMatch(/executed: \d/)`, statementIndex parsed from `"statement 2 of 3 failed: ..."`. |
| AC-183-08c | EditableQueryResultGrid happy + failure | `src/components/query/EditableQueryResultGrid.test.tsx` `[AC-183-08c]` (×2 cases). Asserts single `executeQueryBatch` call with statement array; failure surfaces alert containing both `"permission denied"` and `"all changes rolled back"`. |
| AC-183-08d | EditableQueryResultGrid Cmd+S regression | Same file `[AC-183-08d]`. Cmd+S → SQL preview shows per-statement UPDATE → Execute fires `executeQueryBatch` exactly once. `mockExecuteQuery` not called. |
| AC-183-09 / 09a | Mongo branch unchanged + no batch call on document path | `src/components/datagrid/useDataGridEdit.document.test.ts` `[AC-183-09a]` assertion at line 234. `git diff src/components/datagrid/useDataGridEdit.ts` of the `paradigm === "document"` block (lines 725~763) shows zero changes (only the RDB branch was touched). |

## Check matrix

| Check | Result |
|-------|--------|
| `cargo test --lib` | `326 passed; 0 failed; 2 ignored` |
| `cargo clippy --all-targets --all-features -- -D warnings` | clean |
| `cargo fmt --check` | clean |
| `pnpm vitest run` | `170 files, 2541 tests passed` |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| skip-zero (`it.skip` / `it.todo` / `xit`) | 0 |
| `#[ignore]` net new | 0 |

## Files changed (purpose, one line each)

- `src-tauri/src/db/mod.rs` — add `execute_sql_batch` default trait method.
- `src-tauri/src/db/postgres.rs` — implement `execute_query_batch` (inherent + trait override) + 2 unit tests.
- `src-tauri/src/commands/rdb/query.rs` — add `execute_query_batch` Tauri command with input validation + cancel-token registry hook.
- `src-tauri/src/lib.rs` — register `execute_query_batch` in `tauri::generate_handler!`.
- `src/lib/tauri.ts` — add `executeQueryBatch` IPC wrapper.
- `src/stores/schemaStore.ts` — add `executeQueryBatch` action that delegates to the IPC wrapper.
- `src/components/datagrid/useDataGridEdit.ts` — RDB commit branch now issues a single `executeQueryBatch` call; failure message standardised to "Commit failed — all changes rolled back".
- `src/components/datagrid/useDataGridEdit.commit-error.test.ts` — switch mocks to `executeQueryBatch`, update assertions to new wording, add `[AC-183-08a/b]` cases, refresh static guard markers.
- `src/components/datagrid/useDataGridEdit.validation.test.ts` — add `executeQueryBatch` mock so happy-path commit completes.
- `src/components/datagrid/useDataGridEdit.document.test.ts` — add `executeQueryBatch` mock + `[AC-183-09a]` regression that batch helper is never invoked on the document path.
- `src/components/query/EditableQueryResultGrid.tsx` — `handleExecute` swapped to single-batch call; rolled-back wording.
- `src/components/query/EditableQueryResultGrid.test.tsx` — add `executeQueryBatch` mock, update happy/failure cases (`[AC-183-08c]`), add Cmd+S regression (`[AC-183-08d]`).
- `src/components/rdb/DataGrid.test.tsx` — add `executeQueryBatch` mock + reset-after-each, update commit assertion to count batch call.
- `src/stores/schemaStore.test.ts` — extend the tauri mock with `executeQueryBatch`.
- `docs/sprints/sprint-183/contract.md` — sprint contract.
- `docs/sprints/sprint-183/findings.md` — design rationale, AC→test map, operator runbook, residual risk.
- `docs/sprints/sprint-183/handoff.md` — this file.
