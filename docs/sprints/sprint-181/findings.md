# Sprint 181 — Generator Findings

Phase 21 / TablePlus parity #1: result-grid → file export. Single-attempt
implementation. All Required Checks (Verification Plan §1–§8) pass; the
operator browser smoke (§9) is documented as a runbook for replay because
this generator session has no windowed environment.

## Format enum 결정

Wire string is the canonical lowercase form (`"csv" | "tsv" | "sql" | "json"`)
shared across Rust and TypeScript. The Rust enum uses
`#[serde(rename_all = "lowercase")]` so the serde representation matches the
TS literal-union `type ExportFormat`. Test
`test_export_format_serde_lowercase` pins the four wire strings.

`ExportContext` is a `#[serde(tag = "kind")]` discriminated union mirrored on
the TS side as `{ kind: "table" | "collection" | "query"; … }`. That keeps a
single source of truth for surface→format gating without a numeric
discriminator that would drift.

`ExportSummary { rows_written: u64, bytes_written: u64 }` is the only return
shape — no `path` field, because the dialog already gave the path back to
the caller; duplicating it would invite divergence under symlink edge cases.

## 파일명 컨벤션 결정

`buildExportFilename(context, format, now)` — pure function, `now: Date`
injected for deterministic snapshots. Slug rules:

| context.kind | slug                    | example                        |
| ------------ | ----------------------- | ------------------------------ |
| `table`      | `<schema>.<name>`       | `public.users_20260501-…`      |
| `collection` | `<name>`                | `events_20260501-…`            |
| `query`      | literal `query`         | `query_20260501-…`             |

Timestamp is `YYYYMMDD-HHMMSS` (no separators that fight POSIX sandboxes;
hyphen between date and time so the eye still parses it). All four
extensions (`csv` / `tsv` / `sql` / `json`) come from the format enum
directly — no special-case mapping.

## SQL 단일-테이블 추론 알고리즘

Inference happens **in the frontend**, not Rust. `QueryResultGrid` already
calls `parseSingleTableSelect(sql)` (existing helper) for editable-vs
read-only banner. Sprint 181 reuses the same `parsed` result:

```ts
source_table: parsed ? { schema: parsed.schema, name: parsed.table } : null;
const disabledExportFormats: ExportFormat[] = parsed ? [] : ["sql"];
```

Rust `require_sql_source_table()` is a pre-flight that rejects
`Query { source_table: None }` and `Collection { … }` before the file is
opened — defense in depth so a future caller that bypasses the disabled
menu still cannot produce a malformed `INSERT` statement.
`test_sql_source_table_inference_single` and
`test_sql_source_table_inference_multi_disabled` cover both branches.

## Extended JSON 모드 (Relaxed) 선택 이유

Mongo collection JSON export emits **Extended JSON v2 Relaxed** (per BSON
spec). Rationale:

- `mongoimport --jsonArray` defaults to Relaxed; round-trip works.
- Relaxed keeps numeric and date types human-readable for diff/grep, which
  matches the export's primary use case (one-off snapshots, not transport).
- Canonical mode would wrap every number in `{"$numberInt": "…"}`, drowning
  the file in noise for the ~95% of fields that don't need it.

`relax_extended_json` is a tree walk that preserves any `$oid` / `$date` /
`$binary` / `$numberDecimal` keys handed up by the Mongo adapter — it does
not synthesize them. Tests `test_extended_json_objectid_oid_key`,
`test_extended_json_date_and_decimal`, and
`test_extended_json_binary_preserved` close the four-key gate.

## 100k 스트리밍 측정 결과

`test_streaming_100k_rows_writes_all_lines` writes 100,000 rows through
`write_export` to a `tempfile::TempDir`. Pass criteria:

- `summary.rows_written == 100_000`.
- File contains exactly 100,001 `\r\n` occurrences (1 header + 100k rows;
  the trailing CRLF after the final row is what brings the count to
  `n + 1`).

The test verifies the file is written correctly through `BufWriter<File>`
without buffering all rows in a separate intermediate string. **Live RSS
profiling is not part of this test** — runtime memory is bounded by the
serializer's BufWriter (default 8KiB) plus one in-flight row's
`Vec<JsonValue>`, but the test does not measure that. If the next sprint
needs an absolute memory bound, it should add a separate criterion test
under `cargo test --features bench`.

The implementation calls the synchronous core from
`tauri::async_runtime::spawn_blocking` (export.rs:89) so the executor stays
responsive while large files write. The cancellation token is polled via
`check_cancel()` once per row inside the writer loops; this is cooperative
sync polling, not a `tokio::select!` race, because the inner I/O is
blocking.

## Dialog 취소 vs 에러 분기 결정

`runExport` (`src/lib/export/index.ts`) wraps `tauri-plugin-dialog`'s `save`
and dispatches:

| save() returns      | runExport behaviour                              |
| ------------------- | ------------------------------------------------ |
| `string` (path)     | `invoke("export_grid_rows", …)` then success toast |
| `null` (cancel)     | early-return `{ kind: "cancelled" }`, **no toast** |
| invoke rejects      | `toast.error("Export failed: <msg>")` (destructive) |

User-initiated dialog cancel is treated as a successful UX path (silent),
distinct from an Io error which always raises a destructive toast. Tests
`[AC-181-02e] save dialog cancel produces no toast` and
`[AC-181-09a] invoke reject surfaces destructive toast` cover both branches.

## AC → 테스트 매핑

| AC          | Tests                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-181-01   | `ExportButton.test.tsx` — RDB menu items / Mongo menu items / disabled-format aria-disabled                                                       |
| AC-181-02   | `filename.test.ts` — table / collection / query slug + timestamp padding + all-extensions; `ExportButton.test.tsx` — silent cancel                |
| AC-181-03   | `export.rs` — `test_csv_rfc4180_escape`, `test_csv_utf8_bom_prefix`                                                                                |
| AC-181-04   | `export.rs` — `test_tsv_strips_tab_in_cell`                                                                                                        |
| AC-181-05   | `export.rs` — `test_sql_identifier_double_quote_escape`, `test_sql_string_single_quote_escape`, `test_sql_null_literal`, `test_sql_source_table_inference_{single,multi_disabled}`, `test_sql_object_value_cast_to_jsonb` |
| AC-181-06   | `export.rs` — `test_extended_json_objectid_oid_key`, `test_extended_json_date_and_decimal`, `test_extended_json_binary_preserved`                  |
| AC-181-07   | `export.rs` — `test_streaming_100k_rows_writes_all_lines`, `test_export_cancellation_aborts_write`                                                 |
| AC-181-08   | `export.rs` — `test_null_consistent_across_formats`, `test_boolean_serialization`, `test_number_serialization_unquoted`, `test_zero_rows_produces_header_only` |
| AC-181-09   | `ExportButton.test.tsx` — invoke reject → destructive toast                                                                                        |
| AC-181-10   | `DataGrid.test.tsx` / `DocumentDataGrid.test.tsx` / `QueryResultGrid.test.tsx` — `[AC-181-10]` 1-line ExportButton presence guards (3 surfaces)    |

## Evidence index

- Vitest full suite: **2527 / 2527 pass**.
- Vitest export-touched files: filename (5) + ExportButton (6) + 3 surface
  suites (101 total) — all green.
- `cargo test --lib commands::export`: **19 / 19 pass**.
- `pnpm tsc --noEmit`: zero errors.
- `pnpm lint`: zero errors.
- `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings`: zero warnings.
- Static greps (Verification Plan §8) all clean — `data-testid="export-button"`
  + `export_grid_rows` cross-referenced; four Extended JSON keys present;
  `csv = "1"` in Cargo.toml; `unwrap()` zero outside `#[cfg(test)]`;
  `password` zero across export surface.

## Operator runbook (smoke replay)

Verification Plan §9 (`pnpm tauri dev` browser smoke) was not executed in
this generator session. Operator replay steps:

1. `pnpm tauri dev`.
2. PG connection → table view → Export → CSV → save → open in Numbers /
   Excel; verify header row + escape on cells with `,` / `"` / `\n`.
3. Same data → SQL → save → `psql -f <file>` against an empty target
   schema; verify INSERT statements apply.
4. Mongo collection → JSON → save → `mongoimport --jsonArray --file <path>`
   into an empty collection; verify ObjectId / Date / BinData round-trip.
5. JOIN query in QueryResultGrid → open Export menu → SQL row is greyed
   out, tooltip reads "Single-table SELECT only".
6. Any export → click Save dialog Cancel → no toast, no file written.
7. Save to a path under `/` (no permissions) → destructive toast
   "Export failed: …".

## Assumptions

- **Cancellation is cooperative sync polling**, not `tokio::select!`. The
  synchronous file writer runs on `spawn_blocking`; the token is checked
  once per row inside each format's loop. This matches the AC-181-07
  spec's "write loop 즉시 종료" because per-row granularity is well below
  human perception. A `tokio::select!` would require an async writer,
  which the `csv` crate doesn't provide.
- **Partial-file cleanup** runs in the async caller (`export_grid_rows`),
  not the sync core, so the unit test asserts only the error surface; the
  cleanup itself is documented in the operator runbook step 7.
- **`ExportButton` uses Popover**, not DropdownMenu, because the project
  has no DropdownMenu primitive. Items use `role="menuitem"` directly so
  the test queries match TablePlus-equivalent semantics.
- **`getRows` is lazy** (`() => Promise<unknown[][]> | unknown[][]`) so
  paginated surfaces can collect their visible rows on demand. Phase 1
  exports the current page only — full-table fetch is Phase 2 per the
  Out-of-Scope clause.

## Residual risk

- **Memory bound for 100k+ exports is asserted by code shape, not
  measurement.** The streaming test verifies file line count but not RSS.
  If a future ticket needs a hard ceiling, add a `cargo bench` measurement.
- **No e2e coverage.** Per contract Out-of-Scope, e2e is excluded; the
  surface-level Vitest tests + Rust unit tests + manual operator smoke
  are the verification stack.
- **Server-side abort not invoked.** The cancel token drops the in-flight
  Rust loop; if the Rust core was waiting on a slow disk write, the next
  row check is what aborts. Acceptable because exports are local file I/O,
  not a long-running DB query.
