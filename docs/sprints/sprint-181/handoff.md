# Sprint 181 — Generator Handoff

Single-attempt delivery of Phase 21 / TablePlus parity #1 (CSV / TSV / SQL
INSERT / JSON export across three result-grid surfaces).

## Changed Files

- `src-tauri/Cargo.toml` — added `csv = "1"` (Burntsushi crate). No other
  dependency added.
- `src-tauri/Cargo.lock` — lockfile delta for the new crate.
- `src-tauri/src/commands/export.rs` (new) — `export_grid_rows` Tauri
  command + sync `write_export` core + format writers + 19
  `#[cfg(test)] mod tests` cases. Cancellation flows through the
  `state.query_tokens` registry from Sprint 180.
- `src-tauri/src/commands/mod.rs` — `pub mod export;`.
- `src-tauri/src/lib.rs` — handler list extended with
  `commands::export::export_grid_rows`.
- `src/lib/tauri.ts` — `ExportFormat` / `ExportContext` / `ExportSummary`
  types + `exportGridRows(...)` IPC wrapper.
- `src/lib/export/filename.ts` (new) — pure `buildExportFilename` helper.
- `src/lib/export/filename.test.ts` (new) — 5 cases tagged `[AC-181-02a..d]`.
- `src/lib/export/index.ts` (new) — `runExport` orchestrator (save dialog
  → invoke → toast). Re-exports types + filename helper.
- `src/components/shared/ExportButton.tsx` (new) — Popover-based menu;
  `role="menuitem"` + `aria-disabled` + tooltip for ungated SQL on
  multi-source SELECT.
- `src/components/shared/ExportButton.test.tsx` (new) — 6 cases tagged
  `[AC-181-01a..c]`, `[AC-181-02e]`, `[AC-181-09a]`, plus the
  no-password invariant assertion.
- `src/components/rdb/DataGrid.tsx` — toolbar slot mounting
  `<ExportButton context={{ kind: "table", … }}>`.
- `src/components/document/DocumentDataGrid.tsx` — toolbar slot mounting
  `<ExportButton context={{ kind: "collection", … }}>`.
- `src/components/query/QueryResultGrid.tsx` — toolbar slot mounting
  `<ExportButton context={{ kind: "query", source_table: parsed?... }}>`
  with `disabledFormats={parsed ? [] : ["sql"]}`.
- `src/components/rdb/DataGrid.test.tsx` — 1-line `[AC-181-10]` regression
  guard appended to "renders column headers and data rows".
- `src/components/document/DocumentDataGrid.test.tsx` — 1-line `[AC-181-10]`
  regression guard appended to the namespace-and-rows render test.
- `src/components/query/QueryResultGrid.test.tsx` — 1-line `[AC-181-10]`
  regression guard appended to the SELECT result render test.
- `docs/sprints/sprint-181/contract.md` — sprint contract (created earlier
  this session).
- `docs/sprints/sprint-181/findings.md` (new) — Generator findings (this
  sprint's reasoning + AC→test map + evidence index + operator runbook).
- `docs/sprints/sprint-181/handoff.md` (this file) — sprint deliverable.

## Checks Run

| Command                                                                                                                                | Result |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm vitest run src/lib/export src/components/shared/ExportButton.test.tsx src/components/rdb/DataGrid.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/query/QueryResultGrid.test.tsx` | pass — `[AC-181-0X]` cases visible, 116 total in scope |
| `pnpm vitest run` (full)                                                                                                               | **2527 / 2527 pass** |
| `pnpm tsc --noEmit`                                                                                                                    | pass (zero errors) |
| `pnpm lint`                                                                                                                            | pass (zero errors) |
| `cargo build --manifest-path src-tauri/Cargo.toml`                                                                                     | pass (clean compile) |
| `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings`                                        | pass (zero warnings) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::export`                                                                | **19 / 19 pass** |
| `grep -nE 'data-testid="export-button"\|export_grid_rows' src/components/shared/ExportButton.tsx src/lib/tauri.ts`                     | pass — both anchors present |
| `grep -nE '"\$oid"\|"\$date"\|"\$binary"\|"\$numberDecimal"' src-tauri/src/commands/export.rs`                                          | pass — all 4 keys present |
| `grep -nE 'csv = "1"' src-tauri/Cargo.toml`                                                                                            | pass — dep added |
| `grep -RnE 'unwrap\(\)' src-tauri/src/commands/export.rs` (outside `#[cfg(test)]`)                                                       | pass — 0 |
| `grep -RnE 'password' src/components/shared/ExportButton.tsx src/lib/export/ src-tauri/src/commands/export.rs`                          | pass — 0 |
| `git diff src/types/connection.ts`                                                                                                     | pass — empty (Paradigm invariant) |
| `git diff src-tauri/src/commands/rdb/query.rs`                                                                                         | pass — empty (`cancel_query` wire signature unchanged) |

## Done Criteria Coverage

| AC          | Status | Evidence |
| ----------- | ------ | -------- |
| AC-181-01   | pass   | `[AC-181-01a]` RDB → CSV/TSV/SQL menu items / `[AC-181-01b]` Mongo → JSON/CSV/TSV / `[AC-181-01c]` disabled SQL aria-disabled — `src/components/shared/ExportButton.test.tsx`. |
| AC-181-02   | pass   | `[AC-181-02a..d]` filename slug × 3 contexts + timestamp padding + all-format extensions — `src/lib/export/filename.test.ts`. `[AC-181-02e]` save dialog cancel produces no toast — `src/components/shared/ExportButton.test.tsx`. |
| AC-181-03   | pass   | `test_csv_rfc4180_escape` (comma/quote/CRLF cells) + `test_csv_utf8_bom_prefix` (first 3 bytes `EF BB BF`) — `src-tauri/src/commands/export.rs`. |
| AC-181-04   | pass   | `test_tsv_strips_tab_in_cell` — tab/newline collapsed to space, `\t` separator + `\n` terminator. |
| AC-181-05   | pass   | `test_sql_identifier_double_quote_escape`, `test_sql_string_single_quote_escape`, `test_sql_null_literal`, `test_sql_source_table_inference_single`, `test_sql_source_table_inference_multi_disabled`, `test_sql_object_value_cast_to_jsonb`. Frontend `parseSingleTableSelect` drives `disabledFormats` — `src/components/query/QueryResultGrid.tsx:213-215`. |
| AC-181-06   | pass   | `test_extended_json_objectid_oid_key`, `test_extended_json_date_and_decimal`, `test_extended_json_binary_preserved` — all four Relaxed-mode keys round-trip via `relax_extended_json` tree walk. |
| AC-181-07   | pass   | `test_streaming_100k_rows_writes_all_lines` — 100k rows × 2 cols → 100,001 CRLF count + `rows_written == 100_000`. `test_export_cancellation_aborts_write` — pre-cancelled token → `Err("cancelled")`. Sync core runs on `tauri::async_runtime::spawn_blocking`; partial file removed in async caller (`export.rs:119`). |
| AC-181-08   | pass   | `test_null_consistent_across_formats` (CSV/TSV/SQL fixture × null), `test_boolean_serialization`, `test_number_serialization_unquoted`, `test_zero_rows_produces_header_only`. |
| AC-181-09   | pass   | `[AC-181-09a]` invoke reject → destructive toast with error message — `src/components/shared/ExportButton.test.tsx`. Dialog cancel branch is the silent counterfactual at `[AC-181-02e]`. |
| AC-181-10   | pass   | 1-line ExportButton presence assertion appended to one render test in each surface suite — `DataGrid.test.tsx`, `DocumentDataGrid.test.tsx`, `QueryResultGrid.test.tsx`. No existing assertion modified; surface suites pass 101/101. |

## Assumptions

- **Cancellation is per-row sync polling**, not `tokio::select!`. The `csv`
  crate is sync; we call `write_export` on `spawn_blocking` and check the
  token once per row. This is well below human perception and matches
  AC-181-07's "write loop 즉시 종료" intent. Documented in `findings.md`.
- **Partial-file cleanup** runs in the async caller (`export_grid_rows`),
  not in the sync core; the unit test asserts only the error surface.
- **JSON export is Mongo-only**. The Rust core rejects `Json` for non-
  Collection contexts (`export.rs:141-145`). The frontend menu enforces
  the same constraint via `FORMATS_BY_KIND`, so this is defense-in-depth.
- **`ExportButton` uses Radix Popover**, not DropdownMenu, because the
  project has no DropdownMenu primitive. Menu items use `role="menuitem"`
  directly.
- **Source-table inference happens in the frontend.** `QueryResultGrid`
  already calls `parseSingleTableSelect(sql)` for the editable banner;
  Sprint 181 reuses that result for both `source_table` payload and the
  `disabledFormats` gate. Rust enforces the same constraint pre-flight via
  `require_sql_source_table()`.

## Residual Risk

- **Operator browser smoke (Verification Plan §9) NOT performed in this
  sandbox** — `pnpm tauri dev` requires a windowed environment. The
  frontend behaviour is fully exercised by Vitest; the export core by
  cargo unit tests. `findings.md` § "Operator runbook" lists the 7 manual
  steps for replay against live PG / Mongo / dialog cancel / permission-
  denied paths.
- **100k streaming test verifies file shape, not RSS.** Memory bound is
  asserted by code structure (`BufWriter<File>` + per-row iteration with
  no full-buffer accumulation), not measurement. If a future sprint needs
  a hard ceiling, add a `cargo bench` measurement.
- **Server-side abort not invoked** — N/A for export (local file I/O, not
  a DB query). The cancel token aborts the in-flight Rust loop within one
  row's worth of write time.
- **No e2e coverage** per contract Out-of-Scope. The verification stack is
  Vitest + cargo unit tests + operator manual smoke.
