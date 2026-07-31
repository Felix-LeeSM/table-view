# H3 DuckDB And File Analytics Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the H3 DuckDB/file analytics gate. It records the current
evidence slice and keeps local-file analytics within the existing RDBMS + `file`
connection model until runtime evidence requires a separate paradigm.

## DuckDB modeling boundary

Current evidence:

- `src/types/dataSource.test.ts`
- `docs/ROADMAP.md`
- `docs/product/README.md`

Current gap / routing:

DuckDB remains an `rdb` profile with `file` connection kind; no separate
file-SQL paradigm is introduced.

## `.duckdb` connection, catalog, table read, raw SQL

Current evidence:

- `src-tauri/src/db/duckdb.rs`
- `src-tauri/tests/duckdb_browse_query_adapter.rs`
- `e2e/fixtures/duckdb/query/seed.sql`
- `e2e/smoke/duckdb.spec.ts`

Current gap / routing:

DuckDB now has a deterministic desktop E2E smoke for `.duckdb` open,
catalog/table browse, raw SELECT tabular result/history evidence, writable DML
readback, and read-only write rejection. Native structural DDL (ADR 0051 Stage
2, #1070) is claimed on Rust round-trip evidence
(`src-tauri/src/db/duckdb/ddl.rs`) for table create/drop/rename, column
add/drop/type, and index create/drop; constraint add/drop and identity columns
(Stage 2b) are not claimed, and a DuckDB structured-DDL runtime smoke remains a
separate promotion gate.

## CSV/Parquet/JSON/NDJSON registration and preview

Current evidence:

- `src/types/dataSource.test.ts`
- `src/components/query/DuckdbFileAnalyticsDialog.test.tsx`
- `src/lib/tauri/fileAnalytics.test.ts`
- `src-tauri/tests/duckdb_file_analytics.rs`

Current gap / routing:

Product UI registers active-session local sources and previews rows without
exposing absolute paths. Source-scoped dialog history labeling is covered below;
broader import workflows are not claimed.

## Source metadata/workbench parity

Current evidence:

`src/components/schema/SchemaTree.dbms-shape.test.tsx`,
`src/lib/tauri/fileAnalytics.test.ts`,
`src-tauri/tests/duckdb_file_analytics.rs`, #465

Current gap / routing:

Registered local source aliases, columns, and preview SQL are surfaced in
workbench metadata without exposing absolute local paths. Refresh and disconnect
clear active-session source state.

## Registered-source SELECT workflows

Current evidence:

`src/components/query/DuckdbFileAnalyticsDialog.test.tsx`,
`src/components/query/QueryTab/useQueryExecution.test.tsx`,
`src/components/query/QueryHistoryPanel.per-tab.test.tsx`,
`src/stores/queryHistoryStore.retire.test.ts`,
`src/components/shared/QueryHistorySourceBadge.tsx`,
`src/lib/tauri/fileAnalytics.test.ts`,
`src-tauri/tests/duckdb_file_analytics.rs`,
`e2e/smoke/duckdb-file-analytics.spec.ts`, #468/#875/#877/#879

Current gap / routing:

The dialog can execute source-scoped read-only SELECT against the registered
source alias, the global query editor keeps the normal result surface while the
DuckDB backend can reference registered aliases without source-id plumbing, and
successful dialog/global-editor source queries record the distinct `FILE` /
`file-analytics` history source label. The dedicated file analytics smoke covers
registered deterministic CSV source -> global editor SELECT -> result grid ->
`FILE` history/source evidence -> no absolute local path in visible UI.
Automatic import/export parity is not promoted.

## Local-file privacy and export boundary

Current evidence:

`src-tauri/tests/duckdb_file_analytics.rs`, `docs/product/README.md`,
`docs/product/known-limitations.md`, #468

Current gap / routing:

Public payloads expose alias/file name/kind/size/columns/preview SQL only;
export remains the generic explicit grid export for current rows, not automatic
export of a registered local file source.

## Extension, external-file, and COPY gate

Current evidence:

- `src-tauri/src/db/duckdb.rs`
- `src-tauri/tests/duckdb_browse_query_adapter.rs`
- `src-tauri/tests/duckdb_file_analytics.rs`
- `docs/product/query-language-support.md`

Current gap / routing:

`INSTALL`/`LOAD`, extension helper functions, `COPY`, `ATTACH`/`DETACH`,
sensitive capability settings, replacement scans, and raw external-file
functions are adapter-blocked. Completion remains editor assistance and does not
create runtime support for blocked statements. No DuckDB extension semantic
support is claimed.

## DuckDB test coverage recheck

Current evidence:

`src-tauri/tests/duckdb_browse_query_adapter.rs`,
`src-tauri/tests/duckdb_file_analytics.rs`, `src-tauri/src/db/duckdb.rs`,
`src/types/dataSource.test.ts`, `src/lib/sql/sqlDialectProfile.test.ts`,
`src/lib/sql/sqlDialectKeywords.test.ts`,
`src/features/completion/sql/sqlCompletionRequest.test.ts`,
`src/features/completion/sql/sqlCompletionContext.test.ts`,
`src/lib/sql/sqlCompletionWasm.test.ts`,
`src-tauri/sql-parser-core/src/completion/completion_tests.rs`,
`src/components/query/DuckdbFileAnalyticsDialog.test.tsx`,
`src/components/query/QueryTab/useQueryExecution.test.tsx`,
`src/components/query/QueryHistoryPanel.per-tab.test.tsx`,
`src/components/shared/QueryHistorySourceBadge.test.tsx`,
`src/lib/tauri/fileAnalytics.test.ts`,
`src/components/schema/SchemaTree.dbms-shape.test.tsx`,
`e2e/fixtures/duckdb/query/seed.sql`,
`e2e/fixtures/duckdb/file-analytics/sales.csv`, `e2e/smoke/duckdb.spec.ts`,
`e2e/smoke/duckdb-file-analytics.spec.ts`, #536/#875/#877/#879

Current gap / routing:

Runtime/query/source-equivalent backend coverage maps `.duckdb`
connect/catalog/table read/raw SELECT/result envelope/read-only rejection plus
local source registration, preview, metadata, source-scoped SELECT, global query
backend SELECT by registered alias, global-editor normal-surface
dispatch/history labeling, alias requirement, session clear, path redaction,
input validation, and blocked raw file functions. Parser/safety
unsupported-boundary coverage maps adapter-level blocklists for extension
install/load, `COPY`, `ATTACH`/`DETACH`, sensitive external-file settings,
replacement scans, and raw external-file functions; shared SQL parser/Safe Mode
tests cover generic SQL classification but do not make blocked DuckDB statements
executable. Autocomplete coverage maps DuckDB vocabulary/context requests,
Rust/WASM routing, cached schema objects, and the absence of runtime-blocked
`ATTACH`/`DETACH`/`COPY` suggestions. Fixture/live evidence maps deterministic
DuckDB `.duckdb` fixture generation and deterministic CSV file analytics fixture
separately from their wired Runtime Happy Path smokes. File analytics automatic
import/export parity remains future promotion work.

## Runtime E2E smoke inventory

Current evidence:

This matrix, `e2e/smoke/duckdb.spec.ts`,
`e2e/smoke/duckdb-file-analytics.spec.ts`, `e2e/fixtures/duckdb/query/seed.sql`,
and `e2e/fixtures/duckdb/file-analytics/sales.csv`

Current gap / routing:

Current wired smokes cover create/open a seeded `.duckdb` file, browse table
data, run raw SELECT, verify result/history evidence, reject read-only writes,
and register a deterministic CSV source for global editor SELECT/result
grid/`FILE` history/no-visible-absolute-path evidence. Broader
CSV/Parquet/JSON/NDJSON automatic import/export workflows and blocked
extension/file statements remain future promotion gates.

## DuckDB documentation recheck

Current evidence:

`docs/product/README.md`, `docs/product/query-language-support.md`,
`docs/product/known-limitations.md`, this matrix, `docs/ROADMAP.md`, #535

Current gap / routing:

Final docs recheck confirms product snapshot, runtime/query support, parser/Safe
Mode blocklists, autocomplete limits, known limitations, and test matrix rows
match shipped DuckDB behavior. This is a documentation consistency gate only;
remaining DuckDB implementation/test issues stay open until their own PRs land.
