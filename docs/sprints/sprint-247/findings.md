# Findings: sprint-247

## Verification Summary

- Profile: `command`
- Checks run (re-run by evaluator, not trusted from Generator self-report):
  - `pnpm tsc --noEmit` → exit 0 (clean).
  - `pnpm lint` → exit 0 (no eslint output).
  - `pnpm vitest run` → exit 0; **227 files / 2945 tests pass** (matches
    Generator claim).
  - `cargo test --lib --manifest-path src-tauri/Cargo.toml` → exit 0;
    **627 passed; 0 failed; 2 ignored** (matches claim).
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
    → exit 0 (clean).
  - `rg "execute_query_dry_run" src-tauri/src/lib.rs` →
    `commands::rdb::query::execute_query_dry_run,` (1 hit).
  - `rg "executeQueryDryRun" src/lib/tauri/index.ts` →
    `export { executeQueryDryRun } from "./query";` (1 hit).

- Evidence reviewed:
  - PG dry-run body — `src-tauri/src/db/postgres/queries.rs:418-492`.
  - Trait default — `src-tauri/src/db/traits.rs:163-173`.
  - PG trait delegate — `src-tauri/src/db/postgres.rs:159-167`.
  - IPC registration — `src-tauri/src/lib.rs:169`.
  - Command body — `src-tauri/src/commands/rdb/query.rs:202-285`.
  - Backend unit tests — `src-tauri/src/commands/rdb/query.rs:662-752`,
    `src-tauri/src/db/tests.rs:973-986`.
  - Hook contract — `src/hooks/useDryRun.ts:1-170` and
    `src/hooks/useDryRun.test.ts:1-152`.
  - DryRunPreview — `src/components/workspace/DryRunPreview.tsx:1-102`.
  - Dialog integration — `src/components/workspace/ConfirmDestructiveDialog.tsx:1-145`
    and `.test.tsx:1-298`.
  - Caller mounts (12) — DataGrid, EditableQueryResultGrid, QueryTab×2,
    DropTable/Rename/Create/AddColumn/DropColumn dialogs, Indexes/
    Constraints/Columns editors. All carry the new
    `connectionId` / `statements` / `paradigm` props.
  - lib wrapper — `src/lib/tauri/query.ts:71-81`.
  - Out-of-scope diff guards: `git diff` shows `src-tauri/src/commands/
    rdb/query.rs` is **purely additive** (185 insertions, 0 deletions);
    `src/lib/safeMode/decideSafeModeAction.ts` and
    `src/stores/safeModeStore.ts` show **no diff** vs HEAD. `lib.rs`
    diff is +1 line (the new handler), `execute_query_batch`
    registration unchanged.

## Findings

### F-001 (informational) — `execute_query_dry_run_inner` per-statement empty validation has weaker copy than the contract suggests

- Severity: P3 (informational; does not block PASS)
- Repro: read `src-tauri/src/commands/rdb/query.rs:221-229`.
- Expected: contract `[AC-247-B3]` asserts the message must contain
  `"Statement 2 of 3"` — both the command-level guard AND the PG-level
  `dry_run_query_batch` re-validate. Today the test passes because the
  outer command-level guard fires first.
- Actual: PG inherent `dry_run_query_batch` (queries.rs:426-434) ALSO
  validates and returns `"Statement K of N is empty"` — same copy. No
  divergence; no bug.
- Evidence: queries.rs:426-434 vs query.rs:221-229.
- Broken Contract Line: none.
- Suggestion: redundant validation is fine — leave as defense-in-depth.
- Status: closed (no action).

### F-002 (informational) — `useDryRun` empty-statement branch surfaces `error`, not `idle`

- Severity: P3 (informational; documented in handoff Assumptions section)
- Repro: useDryRun.ts:109-116. With `enabled=true` + `paradigm="rdb"` +
  `statements=[]`, hook sets `status: "error", error: "No statements to
  dry-run"`. Outer command guard (statements empty → `Validation`) is
  never reached because the hook short-circuits.
- Expected: contract is silent; the dialog [AC-247-D11] only asserts
  `open=false → IPC count 0`.
- Actual: Default `[AC-246-D7]` (`statements=[]`, `open=true`) produces
  `data-status="error"` and the dialog still mounts the section. Test
  D7 only asserts the section is present + accessible-named "Dry-run
  preview", not its status — so it passes.
- Evidence: useDryRun.ts:109-116; ConfirmDestructiveDialog.test.tsx:173-195.
- Broken Contract Line: none. The contract permits this; handoff
  Assumptions section documents the choice.
- Suggestion: future Phase 4 (separate Dry Run button) may want to
  distinguish "no statements yet" from "IPC failed" — track as residual
  risk only.
- Status: closed (documented).

### F-003 (verified safe) — query_id collision risk between dry-run and commit

- Severity: P3 (verified safe)
- Concern: contract Quality Bar called for `dry:` prefix on dry-run
  query ids to avoid collision with the commit-path token registry.
- Verification: useDryRun.ts:120 mints `dry:${crypto.randomUUID()}` for
  every dry-run; the dialog test [AC-247-D8] asserts the IPC was
  called with `expect.stringMatching(/^dry:/)`.
- Status: closed.

## Pass Checklist

### Backend (cargo)
- `AC-247-B1`: PASS — `dry_run_empty_connection_id_rejected`,
  `src-tauri/src/commands/rdb/query.rs:662-674`.
- `AC-247-B2`: PASS — `dry_run_empty_statements_rejected`, query.rs:676-687.
- `AC-247-B3`: PASS — `dry_run_empty_statement_at_index_reports_position`,
  query.rs:689-701.
- `AC-247-B4`: PASS — `dry_run_unknown_connection_returns_notfound`,
  query.rs:703-713.
- `AC-247-B5`: PASS — `dry_run_document_paradigm_returns_unsupported`,
  query.rs:715-725.
- `AC-247-B6`: PASS — `dry_run_rdb_propagates_results`, query.rs:727-752.
- `AC-247-B7`: PASS — `test_rdb_default_dry_run_sql_batch_returns_unsupported`,
  `src-tauri/src/db/tests.rs:973-986`. `FastFakeRdb` does not override
  the trait, so the default body executes.

### PG dry-run rollback (correctness — most important spot-check)
- ROLLBACK on success path: PASS — `tx.rollback().await` at
  `src-tauri/src/db/postgres/queries.rs:478-480`. **Unconditional** —
  the success branch never calls `tx.commit()`; the function ends with
  rollback then returns `Ok(results)`.
- ROLLBACK on error path: PASS — `let _ = tx.rollback().await;` at
  queries.rs:462 before returning the `"statement K of N failed"` error.
- Empty-input short-circuit: PASS — queries.rs:423-425
  (`if statements.is_empty() { return Ok(Vec::new()); }`) means no
  BEGIN/ROLLBACK round-trip when nothing to do.
- Cancel-token cooperation: PASS — queries.rs:484-491 mirrors
  `execute_query_batch` cancel pattern.
- **Crucially**: grep confirms there is NO `tx.commit()` call anywhere
  in the dry-run body. Diff against `execute_query_batch` (queries.rs:392)
  proves the only flow change is `commit → rollback`.

### Frontend hook (vitest — file passed in CI)
- `AC-247-H1`: PASS — `src/hooks/useDryRun.test.ts:32-44`
  (paradigm=document → `unsupported`, IPC count 0).
- `AC-247-H2`: PASS — useDryRun.test.ts:46-58 (enabled=false → `idle`,
  IPC count 0).
- `AC-247-H3`: PASS — useDryRun.test.ts:60-95 (enabled=true → running
  → success, results populated, queryId matches `/^dry:/`).
- `AC-247-H4`: PASS — useDryRun.test.ts:97-116 (IPC reject → status
  `error`, error message verbatim).
- `AC-247-H5`: PASS — useDryRun.test.ts:118-151 (unmount →
  `cancelQuery(queryId)` called once with the same `dry:<uuid>`).

### Dialog integration (vitest — file passed in CI)
- `AC-246-D1..D7`: PASS (preserved with default new-prop injection).
  Phase 2 invariants intact:
  - "PRODUCTION DATABASE" + "Destructive statement" copy preserved
    (ConfirmDestructiveDialog.tsx:82-86 + test:53-71).
  - "Safe Mode (strict) — non-production" preserved (test:73-89).
  - Confirm button initially enabled (no type-to-confirm regression),
    test:91-107.
  - Enter submits, test:149-171.
  - Placeholder slot replaced by `<DryRunPreview>` (D7 migrated),
    test:173-195.
- `AC-247-D8`: PASS — test:199-235 (rdb + success → row 0 shows
  `5 rows affected (12ms)`, IPC called with payload `("c", [SQL],
  /^dry:/)`).
- `AC-247-D9`: PASS — test:237-260 (rdb + reject → error message shows
  verbatim `"statement 1 of 1 failed: relation \"users\" does not
  exist"`).
- `AC-247-D10`: PASS — test:262-280 (`paradigm="document"` →
  `data-status="unsupported"` + disclaimer copy + IPC count 0).
- `AC-247-D11`: PASS — test:282-297 (`open=false` → IPC count 0).

### lib wrapper
- `AC-247-L1`: PASS — `src/lib/tauri/query.ts:71-81` invokes
  `"execute_query_dry_run"` with payload `{ connectionId, statements,
  queryId }`. `index.ts:?` re-exports verbatim. Coverage via
  AC-247-D8 / AC-247-H3 mock-call assertions.

### Caller regression guards
- `AC-247-W1`: PASS — DataGrid mount carries the 3 new props
  (DataGrid.tsx:631-644). `[AC-186-06]` continues to pass per CI
  vitest 2945/2945.
- `AC-247-W2`: PASS — `useDataGridEdit` `confirmDangerous` path
  unaffected; commit-path uses `executeQueryBatch` indirection through
  `schemaStore`, untouched. Caller test mocks add `executeQueryDryRun`
  where the dialog is mounted (e.g. `EditableQueryResultGrid.safe-mode.test.tsx:39`).
- `AC-247-W3`: PASS — `QueryTab.safe-mode.test.tsx:56` adds the mock;
  `[AC-245-N1]` (dev+strict + DROP) continues to pass.

### Out-of-scope honored (invariants)
- `execute_query_batch` IPC body untouched — `git diff
  src-tauri/src/commands/rdb/query.rs` is purely additive (185
  insertions, 0 deletions; all in `execute_query_dry_run_inner` /
  `execute_query_dry_run` / `mod tests` block). Lib registration adds
  +1 line for the new handler; existing `execute_query_batch` line
  unchanged.
- `decideSafeModeAction` body untouched — `git diff` shows no diff for
  `src/lib/safeMode/decideSafeModeAction.ts`.
- `safeModeStore` untouched — `git diff` shows no diff for
  `src/stores/safeModeStore.ts`.
- No Cmd+Shift+Enter / Cmd+Z / separate "Dry Run" button surfaces
  added — grep confirms.
- Phase 2 invariants preserved (header copy, Yes/No only). No
  type-to-confirm regression. Verified at
  ConfirmDestructiveDialog.tsx:82-86 + test D3 (test:91-107).
- `pendingConfirm` shape preserved across all callers. Each caller
  derives `statements: string[]` externally (e.g.,
  `EditableQueryResultGrid.tsx:440-443` splits the joined batch on
  `";"` rather than reaching into the hook's source `sqls`).

## Missing Evidence

- None for the in-scope checks. All 7 verification checks re-run
  successfully by evaluator (not trusted from self-report).
- Integration test `dry_run_pg_rolls_back` (against a real PG) is
  flagged optional in the contract (Section 14); not present in the
  diff. Acceptable per contract — unit-level dispatch test (AC-247-B6)
  + the trait dispatch test (AC-247-B7) + clippy + 2945 vitest pass
  cover the wiring; only the actual ROLLBACK semantics rely on PG
  semantics that the inherent function inherits from `sqlx`'s tx
  primitives. Marked as residual risk below.

## Residual Risk

- **No live PG integration test for ROLLBACK semantics.** The dry-run
  body's correctness rests on the assumption that `sqlx::Transaction::
  rollback()` actually undoes everything the statements did. If a
  statement issues an implicit-COMMIT (PG only does this for some
  utility commands, not DML / DDL inside a tx), rows could persist.
  This risk is intrinsic to PG semantics and outside the contract's
  in-scope guardrails. Documented in Generator handoff Residual Risk
  section.
- **Time-dependent statements (`NOW()`, sequences, `LOCK TABLE`,
  `NOTIFY`).** Documented in handoff and `dry_run_query_batch` doc
  comments (queries.rs:472-477).
- **MySQL/SQLite UX.** Both inherit the trait default, so the dialog
  surfaces an `error` with `"This adapter does not support dry-run"`.
  Phase 9 (MySQL adapter) should add a paradigm-aware fallback or per-
  adapter support flag. Tracked.
- **`useDryRun` empty-statements branch surfaces `error` instead of
  `idle`.** Cosmetic; documented in F-002.
- **Out-of-tree caller test files.** `DataGrid.editing.test.tsx` does
  not mock `@lib/tauri` (it mocks `@stores/schemaStore` instead). The
  dialog mount in DataGrid only fires when `editState.pendingConfirm`
  is set — the test fixtures don't trigger that path, so the missing
  `executeQueryDryRun` mock is benign. Confirmed by 29/29 cases pass
  in that file (CI green).

## Verdict Summary

PASS. All 7 verification checks succeed. All AC-247-B1..B7, H1..H5,
D8..D11, L1, W1..W3 covered. Phase 2 invariants (Sprint 246) preserved
verbatim. Phase 1 invariants (Sprint 245) preserved verbatim. PG
dry-run body uses `tx.rollback().await` unconditionally on the success
path (queries.rs:478) and on the error path (queries.rs:462) — no
`tx.commit()` anywhere in the dry-run body. IPC handler registered in
`tauri::generate_handler!` (lib.rs:169). lib wrapper re-exported from
`index.ts`. All 12 dialog mount sites carry the 3 new props with
appropriate paradigm gates (Mongo path uses `paradigm="document"`).

## Sprint 247 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | PG dry-run body is **literally** `BEGIN → execute statements → ROLLBACK` (queries.rs:439-481). No `tx.commit()` anywhere in the dry-run path. Error path also rolls back. Trait default returns `Unsupported` (traits.rs:163-173). Command-level paradigm guard via `as_rdb()?` rejects document connections (query.rs:240). All 6 input-validation cases produce the documented error variants. The only correctness gap is the absence of a live-PG integration test for actual ROLLBACK semantics — flagged as residual, not blocking. |
| Completeness | 9/10 | All 11 contract AC bands covered with file:line evidence (B1-B7, H1-H5, D8-D11, L1, W1-W3). All 12 `<ConfirmDestructiveDialog>` mount sites updated with `connectionId` / `statements` / `paradigm` (verified by grep across DataGrid, EditableQueryResultGrid, QueryTab×2, 5 schema dialogs, 3 structure editors). Caller test mocks added in 10 files. New trait method default impl + PG override + IPC + lib wrapper + hook + component + dialog wiring all land atomically. The contract said "15 caller sites" but the JSX mount count is 12; the handoff explicitly disambiguates this (`useDdlPreviewExecution` is a hook-layer indirection, not a JSX mount). Acceptable. |
| Reliability | 9/10 | Hook guards against unmount race (mountedRef + queryId match), stale resolve from prior `enabled=true` pass (queryIdRef === queryId check), and best-effort cancel on unmount (defensive Promise wrapping for test mocks that return `undefined`). Empty-statements branch surfaces `error` rather than spinning forever. queryId is namespaced `dry:<uuid>` so it cannot collide with commit-path tokens. F-002 (empty branch surfaces `error`) is informational; the dialog test D7 still passes because it only asserts the section is mounted. |
| Verification Quality | 9/10 | All 7 required checks re-run by evaluator and pass; Generator self-report matches reality. Test-file:line citations are accurate. `git diff` confirms `execute_query_batch`, `decideSafeModeAction`, and `safeModeStore` are untouched (no inadvertent regression). Phase 2 invariants spot-checked at the dialog source (header copy preserved verbatim at ConfirmDestructiveDialog.tsx:82-86; Yes/No buttons preserved; Enter-submit preserved at .tsx:97-102). The only verification gap is the optional live-PG ROLLBACK integration test — explicitly flagged as optional in the contract. |
| **Overall** | **9.0/10** | All four dimensions ≥ 9. PASS_THRESHOLD (each ≥ 7, overall ≥ 7.0) cleared with margin. |

## Verdict: PASS

## Sprint Contract Status (Done Criteria)

- [x] **Done 1** — Rust trait `RdbAdapter::dry_run_sql_batch` added
  (traits.rs:163-173, default `Unsupported`); PG impl
  `dry_run_query_batch` lands at `postgres/queries.rs:418-492` with
  unconditional `tx.rollback()` (line 478). PG trait dispatcher delegate
  at `postgres.rs:159-167`.
- [x] **Done 2** — Tauri command `execute_query_dry_run` defined at
  `commands/rdb/query.rs:277-285`; registered in
  `lib.rs:169` (`commands::rdb::query::execute_query_dry_run,`).
- [x] **Done 3** — lib wrapper at `lib/tauri/query.ts:71-81`; explicit
  re-export from `index.ts` (1 hit).
- [x] **Done 4** — Hook `useDryRun` at `hooks/useDryRun.ts:67-170` with
  `idle | running | success | error | unsupported` state machine,
  paradigm gate, enabled gate, unmount cancel.
- [x] **Done 5** — Component `<DryRunPreview>` at
  `components/workspace/DryRunPreview.tsx:36-101` with status-driven
  render + `dry-run-status` / `dry-run-result-row-{idx}` /
  `dry-run-error-message` testids.
- [x] **Done 6** — `<ConfirmDestructiveDialog>` props
  (`connectionId`, `statements`, `paradigm`) added at
  `ConfirmDestructiveDialog.tsx:38-69`; placeholder replaced with
  `<DryRunPreview>` mount at line 117-122.
- [x] **Done 7** — All 12 caller JSX mount sites carry the 3 new props
  (verified by grep + visual inspection: DataGrid, EditableQueryResultGrid,
  QueryTab×2, DropTable, RenameTable, CreateTable, AddColumn, DropColumn,
  IndexesEditor, ConstraintsEditor, ColumnsEditor). 10 caller test files
  add `executeQueryDryRun: vi.fn(() => Promise.resolve([]))` mocks.
- [x] **Done 8** — All AC mappings present (see Pass Checklist above).
- [x] **Done 9** — All 7 verification-plan checks pass (see
  Verification Summary).

## Feedback for Generator

1. **Verification Quality (informational)**: The Generator self-report
   said "227 files / 2945 tests" — verified literally accurate. Good
   discipline.
   - Current: handoff cites file:line ranges; evaluator re-ran and
     confirmed.
   - Expected: ditto.
   - Suggestion: keep this pattern in future sprints.

2. **Empty-statements UX (P3, F-002)**: With `enabled=true` +
   `paradigm="rdb"` + `statements=[]`, the hook surfaces
   `status: "error", error: "No statements to dry-run"`.
   - Current: `useDryRun.ts:109-116` returns an `error` state.
   - Expected: this is documented in handoff Assumptions; not a
     contract violation.
   - Suggestion: in Phase 4 (Sprint 248, separate Dry Run button), the
     button should never call the hook with `statements=[]`; if it
     could, treat the empty case as `idle` so the user sees "no
     statements to preview" rather than a red error.

3. **MySQL/SQLite UX (residual risk)**: Today both inherit the trait
   default → user sees `"This adapter does not support dry-run"` in
   the error pane.
   - Current: `Unsupported` surfaces as red text in DryRunPreview's
     error branch via `useDryRun`'s catch block.
   - Expected: contract says this is acceptable for now (out-of-scope
     for Phase 3).
   - Suggestion: when the MySQL adapter joins in Phase 9 (or when
     SQLite's commit path is wired), either implement
     `dry_run_sql_batch` per dialect OR add a per-adapter
     `supports_dry_run` flag that routes to the same disclaimer state
     used for Mongo.

4. **PG-side integration test (residual risk)**: The contract flagged
   the live-PG ROLLBACK integration test as optional. The diff does
   not include one.
   - Current: dispatch + trait default + clippy + vitest are the only
     guards on the actual ROLLBACK semantics.
   - Expected: optional per contract.
   - Suggestion: add a `#[ignore]`-gated integration test in
     `src-tauri/tests/dry_run_pg.rs` that runs against a `DATABASE_URL`
     PG, INSERTs a row in dry-run, asserts row count is unchanged
     post-call. Even ignored-by-default, it's a useful manual check
     before each release.

5. **Sprint 247 contract said "15 caller sites" — actual count is 12
   JSX mounts (informational)**: The handoff disambiguates this
   correctly (the 15 figure includes a hook-layer indirection plus
   non-existent reuse). Future contracts could reconcile the count
   with a literal grep before authoring.
   - Current: "15" in contract Section 10; "12" in handoff
     Assumptions.
   - Expected: match.
   - Suggestion: in Sprint 248 contract, run `rg "<ConfirmDestructiveDialog"
     -l | wc -l` first and use that exact number.
