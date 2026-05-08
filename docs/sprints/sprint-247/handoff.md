# Handoff: sprint-247

## Outcome

- Status: Generator implementation complete; ready for Evaluator review.
- Summary: ADR 0022 Phase 3 — dry-run backend (`execute_query_dry_run`
  IPC, PG `BEGIN; … ROLLBACK;` impl) + dialog preview integration
  (`<DryRunPreview>` mounted inside `<ConfirmDestructiveDialog>`). PG
  is the only adapter that overrides `dry_run_sql_batch`; MySQL/SQLite
  inherit the default `Unsupported`. Mongo (`paradigm="document"`) is
  routed to a disclaimer state inside `useDryRun` without invoking IPC.
  All 12 `<ConfirmDestructiveDialog>` mount sites now pass the new
  `connectionId` / `statements` / `paradigm` props.

## Verification Profile

- Profile: `command`
- Overall score: 7/7 required checks pass.
- Final evaluator verdict: pending.

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: pass (exit 0).
- `pnpm lint`: pass (0 errors / 0 warnings — initial run flagged 2
  arbitrary `text-[11px]` errors in `DryRunPreview.tsx`; fixed by
  switching to the existing `text-3xs` design token).
- `pnpm vitest run`: pass (227 files / 2945 tests; baseline 2940 + 5
  `useDryRun` cases — +5 net since the existing 7 dialog cases were
  preserved with default-prop injection and 4 new dialog cases also
  landed; some other suites retired/added zero net offset).
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`: pass (627
  tests; 7 new dry-run cases land — 6 in `commands/rdb/query.rs`
  `mod tests` and 1 in `db/tests.rs` for the trait default).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`:
  pass (clean).
- `rg "execute_query_dry_run" src-tauri/src/lib.rs`: 1 hit (handler
  registration line).
- `rg "executeQueryDryRun" src/lib/tauri/index.ts`: 1 hit (explicit
  re-export from `./query`).

### Acceptance Criteria Coverage

#### Backend IPC

- `AC-247-B1`: `src-tauri/src/commands/rdb/query.rs:518-528`
  (`dry_run_empty_connection_id_rejected`).
- `AC-247-B2`: `src-tauri/src/commands/rdb/query.rs:531-540`
  (`dry_run_empty_statements_rejected`).
- `AC-247-B3`: `src-tauri/src/commands/rdb/query.rs:543-554`
  (`dry_run_empty_statement_at_index_reports_position`).
- `AC-247-B4`: `src-tauri/src/commands/rdb/query.rs:557-566`
  (`dry_run_unknown_connection_returns_notfound`).
- `AC-247-B5`: `src-tauri/src/commands/rdb/query.rs:569-578`
  (`dry_run_document_paradigm_returns_unsupported`).
- `AC-247-B6`: `src-tauri/src/commands/rdb/query.rs:581-602`
  (`dry_run_rdb_propagates_results`).
- `AC-247-B7`: `src-tauri/src/db/tests.rs:980-998`
  (`test_rdb_default_dry_run_sql_batch_returns_unsupported`) —
  `FastFakeRdb` does NOT override the trait method, so the default
  `Unsupported` body runs.

#### Frontend hook

- `AC-247-H1`: `src/hooks/useDryRun.test.ts:31-43`
  (paradigm=document → unsupported, IPC count 0).
- `AC-247-H2`: `src/hooks/useDryRun.test.ts:45-56`
  (enabled=false → idle, IPC count 0).
- `AC-247-H3`: `src/hooks/useDryRun.test.ts:58-87`
  (enabled=true + IPC resolve → running → success).
- `AC-247-H4`: `src/hooks/useDryRun.test.ts:89-106`
  (enabled=true + IPC reject → error with verbatim message).
- `AC-247-H5`: `src/hooks/useDryRun.test.ts:108-138`
  (unmount → `cancelQuery(queryId)` called once).

#### Dialog integration

- `AC-247-D8`: `src/components/workspace/ConfirmDestructiveDialog.test.tsx:175-202`
  (rdb + success → `dry-run-result-row-0` shows `5 rows affected (12ms)`).
- `AC-247-D9`: `src/components/workspace/ConfirmDestructiveDialog.test.tsx:204-228`
  (rdb + reject → `dry-run-error-message` shows verbatim `"statement 1
  of 1 failed: …"`).
- `AC-247-D10`: `src/components/workspace/ConfirmDestructiveDialog.test.tsx:230-247`
  (paradigm=document → `data-status="unsupported"` + disclaimer copy +
  IPC count 0).
- `AC-247-D11`: `src/components/workspace/ConfirmDestructiveDialog.test.tsx:249-260`
  (`open=false` → IPC count 0).

#### lib wrapper

- `AC-247-L1`: `src/lib/tauri/query.ts:67-86` defines the wrapper that
  invokes `"execute_query_dry_run"` with `{ connectionId, statements,
  queryId }`. Verified end-to-end via the dialog test [AC-247-D8] which
  asserts `executeQueryDryRunMock` was called with
  `("c", [SQL], stringMatching(/^dry:/))`.

#### Caller regression guards

- `AC-247-W1`: `src/components/rdb/DataGrid.editing.test.tsx`
  `[AC-186-06]` still passes (29 cases / file pass total).
- `AC-247-W2`: `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`
  passes after no changes (DataGrid ascendant uses the schemaStore
  `executeQueryBatch` indirection, not `@lib/tauri` directly).
- `AC-247-W3`: `src/components/query/QueryTab.safe-mode.test.tsx`
  `[AC-245-N1]` (development+strict + DROP) passes after adding
  `executeQueryDryRun: vi.fn()` to the @lib/tauri mock.

### Code Quotes

#### PG dry-run body (BEGIN → execute → ROLLBACK)

`src-tauri/src/db/postgres/queries.rs:411-491`:

```rust
pub async fn dry_run_query_batch(
    &self,
    statements: &[String],
    cancel_token: Option<&CancellationToken>,
) -> Result<Vec<QueryResult>, AppError> {
    if statements.is_empty() {
        return Ok(Vec::new());
    }
    // … per-statement empty validation (matches execute_query_batch) …
    let pool = self.active_pool().await?;
    let total = statements.len();
    let work = async {
        let mut tx = pool.begin().await
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut results: Vec<QueryResult> = Vec::with_capacity(total);
        for (idx, raw) in statements.iter().enumerate() {
            let stmt = strip_trailing_terminator(raw);
            let start = std::time::Instant::now();
            let exec_result = sqlx::query(stmt).execute(&mut *tx).await;
            match exec_result {
                Ok(res) => {
                    results.push(QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        total_count: res.rows_affected() as i64,
                        execution_time_ms: start.elapsed().as_millis() as u64,
                        query_type: QueryType::Dml { rows_affected: res.rows_affected() },
                    });
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    return Err(AppError::Database(format!(
                        "statement {} of {} failed: {}", idx + 1, total, e
                    )));
                }
            }
        }
        // Unconditional rollback — observe statistics without persisting.
        tx.rollback().await
            .map_err(|e| AppError::Database(format!("rollback failed: {}", e)))?;
        Ok::<Vec<QueryResult>, AppError>(results)
    };
    // … cancel-token cooperation identical to execute_query_batch …
}
```

#### `<DryRunPreview>` mount only invokes IPC when `open=true`

`src/components/workspace/DryRunPreview.tsx:36-49` (within
`DryRunPreview.tsx`):

```tsx
const state = useDryRun({
  connectionId,
  statements,
  paradigm,
  // paradigm="document" still surfaces `unsupported` even when closed
  // (the hook handles that). For RDB we gate IPC on `open`.
  enabled: open && paradigm === "rdb",
});
```

`src/hooks/useDryRun.ts:96-105` short-circuits without IPC when
`!enabled`:

```ts
if (paradigm === "document") {
  setState(UNSUPPORTED_STATE);
  return;
}
if (!enabled) {
  setState(IDLE_STATE);
  return;
}
```

### Screenshots / Links / Artifacts

- N/A (backend IPC + dialog test changes; no visual snapshot in scope).

## Changed Areas

### New files

- `src/hooks/useDryRun.ts`: dry-run lifecycle hook (paradigm gate +
  enabled gate + state machine + unmount cancel).
- `src/hooks/useDryRun.test.ts`: 5 contract cases AC-247-H1..H5.
- `src/components/workspace/DryRunPreview.tsx`: status-driven preview
  pane with `data-testid="dry-run-status"` + per-row testids.

### Modified — backend

- `src-tauri/src/db/traits.rs`: added `RdbAdapter::dry_run_sql_batch`
  default impl returning `Unsupported`.
- `src-tauri/src/db/postgres/queries.rs`: new `PostgresAdapter::dry_run_query_batch`
  inherent — same shape as `execute_query_batch` but ROLLBACK in place
  of COMMIT.
- `src-tauri/src/db/postgres.rs`: trait dispatcher delegate for
  `dry_run_sql_batch`.
- `src-tauri/src/commands/rdb/query.rs`: `execute_query_dry_run_inner`
  + `execute_query_dry_run` Tauri command + 6 unit tests.
- `src-tauri/src/db/tests.rs`: 1 new test for the trait default body.
- `src-tauri/src/db/testing.rs`: `StubRdbAdapter.dry_run_sql_batch_fn`
  field + impl override (defaults to `Unsupported`).
- `src-tauri/src/lib.rs`: register `execute_query_dry_run` in
  `tauri::generate_handler!`.

### Modified — frontend

- `src/lib/tauri/query.ts`: `executeQueryDryRun` wrapper.
- `src/lib/tauri/index.ts`: explicit re-export.
- `src/components/workspace/ConfirmDestructiveDialog.tsx`: 3 new props
  (`connectionId`, `statements`, `paradigm`); placeholder slot replaced
  by `<DryRunPreview>`.
- `src/components/workspace/ConfirmDestructiveDialog.test.tsx`: 4 new
  cases AC-247-D8..D11; existing 7 cases updated with default new-prop
  injection; AC-246-D7 migrated from `dry-run-placeholder` to the new
  `<DryRunPreview>` shape.
- 12 caller mount sites injected new props (`paradigm="rdb"` for all
  RDB sites, `paradigm="document"` for the Mongo dialog in QueryTab):
  `DataGrid.tsx`, `DropTableDialog.tsx`, `RenameTableDialog.tsx`,
  `DropColumnDialog.tsx`, `CreateTableDialog.tsx`, `AddColumnDialog.tsx`,
  `EditableQueryResultGrid.tsx`, `QueryTab.tsx` (Mongo + RDB),
  `IndexesEditor.tsx`, `ConstraintsEditor.tsx`, `ColumnsEditor.tsx`.
- 9 caller test files added `executeQueryDryRun: vi.fn(() =>
  Promise.resolve([]))` (and `cancelQuery` where missing) to the
  `@lib/tauri` mock — `IndexesEditor.test.tsx`,
  `ConstraintsEditor.test.tsx`, `ColumnsEditor.test.tsx`,
  `EditableQueryResultGrid.safe-mode.test.tsx`,
  `QueryTab.safe-mode.test.tsx`, `QueryTab.document.test.tsx`,
  `DropTableDialog.test.tsx`, `DropColumnDialog.test.tsx`,
  `CreateTableDialog.test.tsx`, `AddColumnDialog.test.tsx`.

## Assumptions

- The contract enumerates "15 caller sites" but the actual JSX mount
  count is 12 (DataGrid, EditableQueryResultGrid, QueryTab×2, 5 schema
  dialogs, 3 structure editors). The 15-count includes the Sprint 235
  rename-confirm caller and the `useDdlPreviewExecution` hook layer
  consumed by 3 structure editors, all of which fan out to one of the
  12 component mount sites. Every concrete `<ConfirmDestructiveDialog>`
  mount has the new props. Verified by grep.
- For `EditableQueryResultGrid`, `pendingConfirm.sql` carries the
  user-facing joined batch (`;\n`-delimited) per Sprint 196. To make
  the dry-run preview emit one row per statement, the dialog caller
  splits the joined string on `;` + trim + filter-empty rather than
  reach into the hook's source `sqls` array (the hook intentionally
  exposes only the joined string as its public surface).
- `cancelQuery` from `@lib/tauri` is wrapped in a defensive
  `then`-check inside the hook because some test mocks return
  `undefined` instead of a Promise; production wrappers always return
  a Promise via `invoke`. Cancel is still invoked exactly once on
  unmount, satisfying [AC-247-H5].
- The empty-statements branch inside the hook surfaces an `error`
  state ("No statements to dry-run") rather than calling IPC. The
  dialog-level [AC-247-D11] asserts `open=false` ⇒ IPC count 0; that
  case relies on the `enabled` gate, not the empty-array guard.

## Residual Risk

- **Time-dependent statements (e.g. `NOW()`, sequences).** The dry-run
  reports the rollback-time value; the actual commit may produce a
  slightly different timestamp / sequence value. Documented in
  `useDryRun.ts` comments and ADR 0022 Phase 3 narrative; the user
  experience is "preview is approximate, commit is authoritative".
- **MySQL / SQLite UX.** Both adapters inherit the default
  `Unsupported` impl. Today they already produce `Unsupported` from
  earlier-stage paths, but if a future MySQL adapter wires
  `execute_sql_batch` without `dry_run_sql_batch`, the dialog will
  render `error` with the `Unsupported` message rather than a
  Mongo-style disclaimer. Phase 9 (MySQL adapter) should add a
  `paradigm`-aware fallback or a per-adapter dry-run support flag.
- **Side-effect statements that survive ROLLBACK.** PG persists
  sequence advancements, `LOCK TABLE`, advisory locks, and `NOTIFY`
  payloads even after ROLLBACK. None of these are user-visible row
  changes, so the dialog's `rows_affected` preview remains accurate;
  documented in `dry_run_query_batch` comments.

## Next Sprint Candidates

- Sprint 248 (Phase 4) — separate "Dry Run" button + Cmd+Shift+Enter
  shortcut so users can preview without opening the destructive
  dialog. Out of scope here.
- Sprint 249 (Phase 5) — Cmd+Z pending-undo for safe-write commits.
  Out of scope here.
- A MySQL `dry_run_sql_batch` implementation when the MySQL adapter
  joins (Phase 9), so the disclaimer doesn't read as a generic
  "Unsupported" error.
