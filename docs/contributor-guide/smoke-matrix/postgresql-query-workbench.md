# PostgreSQL Query/Workbench Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the PostgreSQL lane inventory for #186/#241. It distinguishes the
current GitHub Runtime Happy Path claim from component, unit, integration, and
future smoke evidence.

## Routine desktop E2E claim

Current evidence:

- `e2e/smoke/postgres.spec.ts`
- `e2e/smoke/postgres-explain.spec.ts`
- `e2e/smoke/postgres-extension-completion.spec.ts`
- `e2e/smoke/postgres-safe-mode.spec.ts`
- `e2e/smoke/postgres-cancellation.spec.ts`
- `e2e/smoke/postgres-structure-ddl.spec.ts`
- `e2e/smoke/erd-dense.spec.ts`
- `e2e/fixtures/postgresql/query/seed.sql`

Current gap / routing:

GitHub Runtime Happy Path proves connect, browse seeded `users`, edit Alice's
`name`, run a SQL preview, verify the updated query result, open an Explain plan
with an Explain history source label, verify seeded `pgcrypto`/`fuzzystrmatch`
installed-extension completion gating, cover Safe Mode info/warn/destructive,
raw DDL preview, grid-edit confirmation paths, cancel/retry a long query,
execute a bounded Structure table-plus-index DDL path, and render a dense ERD on
desktop and narrow viewports on Ubuntu. It does not prove broader structured DDL
flows, broader history-source labeling, FK row navigation through ERD, schema
diff, migration impact, data compare, admin, arbitrary extension semantics, or
profiler/activity scenarios.

## Closure coverage baseline

Current evidence:

- `src-tauri/tests/query_integration.rs`
- `src-tauri/tests/schema_integration.rs`
- `src-tauri/tests/cancel_pg.rs`
- `src-tauri/src/commands/rdb/query.rs`
- `src/lib/sql/sqlSafety.test.ts`
- `src/components/query/QueryTab.safe-mode.test.tsx`
- `src/components/query/QueryTab.warn-dialog.test.tsx`
- `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`
- `src/features/completion/sql/sqlCompletionContext.test.ts`
- `src/features/completion/sql/sqlCompletionRequest.test.ts`
- `src/lib/sql/sqlCompletionWasm.test.ts`
- `src-tauri/sql-parser-core/src/completion/completion_tests.rs`

Current gap / routing:

#528 coverage recheck baseline: runtime/query/edit and source-equivalent backend
paths, parser/Safe Mode unsupported-boundary behavior, completion
vocabulary/context, and fixture/live smoke routing all have mapped evidence.
Fixture inventory remains contract evidence only; it does not widen live runtime
support.

## Runtime query execution

Current evidence:

- `src-tauri/src/db/postgres/queries.rs`
- `src-tauri/src/db/postgres/schema.rs`
- `src-tauri/tests/query_integration.rs`
- `src-tauri/tests/cancel_pg.rs`

Current gap / routing:

SELECT/EXPLAIN result routing, plan-only `EXPLAIN (FORMAT JSON)`, DML batches,
table data, cancellation, and raw-query grid edit are covered below desktop
smoke. psql meta commands, DB-level backup/restore/import/export, and PL/pgSQL
body authoring remain outside current parity claims.

## Catalog/workbench metadata

Current evidence:

- `src-tauri/src/db/postgres/schema.rs`
- `src-tauri/tests/schema_integration.rs`
- `src/components/schema/SchemaTree*`
- `src/components/rdb/DataGrid*`

Current gap / routing:

Schemas, tables, views, functions, types, installed extensions, triggers, stats,
indexes, constraints, FKs, cached metadata, DataGrid, Structure, ERD inputs,
migration impact summaries, and cached read-only schema diff have evidence.
Server activity, profiler, role/user/permission UI, extension management UI,
data compare, and migration/apply execution are future H7/H4-style work.

## Parser and Safe Mode

Current evidence:

- `src-tauri/sql-parser-core/**`
- `src/lib/sql/sqlSafety.test.ts`
- `src/components/query/QueryTab.safe-mode.test.tsx`
- `src/components/query/QueryTab.warn-dialog.test.tsx`
- `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`
- `e2e/smoke/postgres-safe-mode.spec.ts`

Current gap / routing:

Tests cover bounded SQL classification, destructive/warn/info paths, EXPLAIN
inner classification, raw query confirmation, grid edit confirmation, and DDL
preview. Routine smoke covers PostgreSQL info/warn/destructive confirmation plus
raw DDL and grid-edit preview paths. Full PL/pgSQL bodies, broad MERGE variants,
arbitrary nested expressions, and arbitrary extension semantics are not modeled.

## Completion and installed extensions

Current evidence:

- `src-tauri/src/db/postgres/schema.rs`
- `src/features/completion/sql/sqlCompletionContext.test.ts`
- `src/features/completion/sql/sqlCompletionRequest.test.ts`
- `src/lib/sql/sqlCompletionWasm.test.ts`
- `src-tauri/sql-parser-core/src/completion/completion_tests.rs`
- `e2e/smoke/postgres-extension-completion.spec.ts`

Current gap / routing:

Installed extension inventory is consumed before curated extension packs are
enabled. Runtime smoke proves seeded `pgcrypto` enables `GEN_RANDOM_UUID`,
seeded `fuzzystrmatch` enables `LEVENSHTEIN`, absent `uuid-ossp` withholds
`UUID_GENERATE_V4`, and installed-but-unknown `plpgsql` stays unpacked;
completion does not enumerate every extension symbol or make parser/Safe Mode
semantically extension-aware.

## Edit semantics

Current evidence:

- `src/components/datagrid/sqlGenerator.test.ts`
- `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`
- `src/components/query/useRawQueryGridEdit.ts`
- `src-tauri/src/db/postgres/queries.rs`

Current gap / routing:

Key-projected row edits, JSON/array SQL generation, preview/commit/discard, and
Safe Mode confirmation have targeted evidence. Arbitrary query-result mutation
and bulk/admin edit workflows are future work.

## Lightweight Explain path

Current evidence:

- `src-tauri/src/db/postgres/schema.rs`
- `src/lib/api/explain.ts`
- `src/components/query/ExplainViewer.test.tsx`
- `src/components/query/QueryTab.toolbar.test.tsx`
- `src/lib/sql/sqlAst.test.ts`
- `src/lib/sql/sqlSafety.test.ts`
- `e2e/smoke/postgres-explain.spec.ts`

Current gap / routing:

Backend/API/component/parser/safety evidence and routine desktop smoke exist for
lightweight plan inspection. It is not a profiler surface or server activity
dashboard claim.

## Cancellation and long-running query workflow

Current evidence:

- `src-tauri/tests/cancel_pg.rs`
- `src/components/query/QueryTab.execution.test.tsx`
- `src/hooks/useQueryHistory.event-refetch.test.ts`
- `e2e/smoke/postgres-cancellation.spec.ts`

Current gap / routing:

Backend cancellation, query-tab cancelled state/history, same-window history
refresh, stale-grid clearing, and retry are covered. This does not claim server
activity/session management UI.

## Non-routine scenario assets

Current evidence:

- `e2e/smoke/history-source-5.spec.ts`
- `wdio.smoke.conf.ts`

Current gap / routing:

These can inform local/manual regression and future CI wiring. They do not
expand the GitHub Runtime Happy Path unless  invokes
them.
