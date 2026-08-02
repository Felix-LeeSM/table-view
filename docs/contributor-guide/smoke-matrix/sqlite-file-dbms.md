# SQLite File DBMS Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the SQLite file-DBMS lane inventory for #196/#242/#457/#458/#459/#461/#533/#534/#462.
It separates current unit/integration/fixture evidence from the deterministic
SQLite desktop smoke now wired into the GitHub Runtime Happy Path.

## Routine desktop E2E claim

Current evidence:

`e2e/smoke/sqlite.spec.ts`,
`e2e/fixtures/sqlite/query/seed.sql`, #456

Current gap / routing:

GitHub Runtime Happy Path now runs a SQLite desktop smoke for deterministic file
create/open, table browse, read query, writable DML, row edit, read-only write
rejection, and internal app-state DB rejection. The structured DDL #1804 opened
in the adapter is not in this smoke, and extension-boundary non-claims stay
routed to #460/#461, rather than broadening it.

## File connection lifecycle

Current evidence:

- `src-tauri/table-view-core/src/db/adapters/sqlite/connection.rs`
- `src-tauri/tests/sqlite_connection_command.rs`
- `src/features/connection/components/forms/SqliteFormFields.test.tsx`
- `src/types/dataSource.test.ts`

Current gap / routing:

Absolute file paths, create-new-file, read-only mode, no host requirement,
file-picker capability, and internal app-state DB rejection have evidence.
Server auth, switch-database, and multi-namespace flows are not SQLite claims.

## Query and writable-file DML

Current evidence:

`src-tauri/table-view-core/src/db/adapters/sqlite/queries.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/batch.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/queries_tests.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/batch_tests.rs`,
`src-tauri/tests/sqlite_browse_query_adapter.rs`, #458

Current gap / routing:

Read queries, writable-file DML, transactional DML batches, dry-run rollback,
cancellation, and read-only/DDL/batch-failure error normalization have adapter
evidence. Raw SQL DDL is rejected by the adapter.

## Catalog/workbench browse

Current evidence:

`src-tauri/table-view-core/src/db/adapters/sqlite/connection.rs`,
`src-tauri/tests/sqlite_browse_query_adapter.rs`,
`src/components/schema/SchemaTree.dbms-shape.test.tsx`,
`src/components/schema/SchemaTree.rowcount.test.tsx`, #457

Current gap / routing:

Current evidence covers `main`, flat table browsing, exact row counts, columns,
FKs, indexes, views, and view columns. Schemas, functions, triggers, full
constraints, table stats parity, and richer admin/workbench surfaces remain
future work.

## Row edit semantics

Current evidence:

`src/types/dataSource.ts`, `src/components/datagrid/sqlGenerator.test.ts`,
`src/components/datagrid/useDataGridEdit.safe-mode.test.ts`,
`src-tauri/table-view-core/src/db/adapters/sqlite/queries.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/connection_tests.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/queries_tests.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/batch_tests.rs`, #459

Current gap / routing:

SQLite row writes are scoped to writable files and key/projected row identity.
Identifier quoting, scalar row write SQL, preview/commit/discard confirmation
paths, pending edit errors, and read-only write rejection have coverage. Nested
JSON edits, arbitrary query-result mutation, and bulk/admin edit workflows are
not supported.

## DDL and unsupported ALTER behavior

Current evidence:

`src-tauri/table-view-core/src/db/adapters/sqlite/mod.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/ddl.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/queries_tests.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/batch_tests.rs`,
`src-tauri/tests/sqlite_browse_query_adapter.rs`,
`docs/product/known-limitations.md`, #460

Current gap / routing:

Raw SQL DDL is rejected by the SQLite query adapter. Structured DDL is bounded
by what SQLite performs natively (#1804): `create_table` / `create_table_plan`,
`drop_table`, `rename_table`, `add_column`, `drop_column`, `create_index` and
`drop_index` build and run their statement for writable files, and `alter_table`
carries column adds and drops. `add_constraint` / `drop_constraint` return
explicit `Unsupported`, and so does an `alter_table` change that edits a
column's type, nullability or default — SQLite expresses those only by
rebuilding the table, which is a future ADR-backed implementation decision.

The per-action `ddl.*` capability flags in `src/types/dataSource.ts` still claim
`createTable` alone, so the standalone Structure and schema-tree entry points for
the newly opened operations stay hidden until the capability flip lands. Index
creation is already reachable and needs no flip: the Create Table dialog's
Indexes tab has no capability gate of its own, so it opens with the dialog that
`createTable` allows, and its rows reach the adapter, which now creates them in
the same transaction as the table instead of rejecting the plan. The tab offers
PostgreSQL's hash/gin/gist methods to every engine, so only a btree row (the
default) succeeds here; the others are refused before the file is touched and
fail the whole plan.

## Completion and extension boundary

Current evidence:

`src-tauri/sql-parser-core/src/completion/completion_tests.rs`,
`src/features/completion/sql/sqlCompletionContext.test.ts`,
`src/features/completion/sql/sqlCompletionRequest.test.ts`,
`src/lib/completion/coreContract.ts`, `docs/product/query-language-support.md`,
#461

Current gap / routing:

SQLite keyword/function vocabulary, cached table/column catalog context, and
sqlite-cli dot-command suggestions have evidence. Dot commands carry
non-executable completion metadata and are not executed.
JSON1/FTS/RTREE/loadable-extension semantics are not detected, consumed from
extension inventory, gated, dispatched, or semantically validated client-side.

## Documentation recheck

Current evidence:

`docs/product/README.md`, `docs/product/query-language-support.md`,
`docs/product/known-limitations.md`, `docs/ROADMAP.md`, #533

Current gap / routing:

Product-visible SQLite docs now agree that runtime support is the wired file
smoke plus adapter evidence, parser/Safe Mode remains bounded, sqlite-cli dot
commands are non-executable completion vocabulary, and extension/capability,
rebuild-only ALTER, constraint DDL, and nested JSON support stay unsupported or
future. Most of the structured DDL the adapter gained in #1804 is not yet a
product-visible claim: the `ddl.*` capability flags still expose table creation
alone. The one part that is already product-visible is index creation inside the
Create Table dialog, whose Indexes tab has no capability gate of its own.

## Test coverage recheck

Current evidence:

`src-tauri/tests/sqlite_connection_command.rs`,
`src-tauri/tests/sqlite_browse_query_adapter.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/queries_tests.rs`,
`src-tauri/table-view-core/src/db/adapters/sqlite/batch_tests.rs`,
`src/components/datagrid/sqlGenerator.test.ts`,
`src/components/datagrid/useDataGridEdit.safe-mode.test.ts`,
`src-tauri/sql-parser-core/src/parser/tests.rs`,
`src/lib/sql/sqlSafety.test.ts`,
`src-tauri/sql-parser-core/src/completion/completion_tests.rs`,
`src/features/completion/sql/sqlCompletionContext.test.ts`,
`src/features/completion/sql/sqlCompletionRequest.test.ts`,
`src/lib/sql/sqlWasmArtifact.test.ts`,
`e2e/smoke/sqlite.spec.ts`, #534

Current gap / routing:

Runtime/query/edit, source-equivalent row edits, shared parser/Safe Mode
classification, adapter-level unsupported DDL/read-only/internal-state
guardrails, autocomplete vocabulary/context/real-WASM behavior, and fixture/live
smoke routing all have mapped evidence.

## Support-claim closure audit

Current evidence:

`docs/product/README.md`, `docs/product/query-language-support.md`,
`docs/product/known-limitations.md`, `docs/ROADMAP.md`, #462

Current gap / routing:

Product-visible support claims match this evidence map: SQLite support is
file-backed DBMS runtime/query/edit plus deterministic file smoke and bounded
structured table creation with its indexes, not admin or vendor CLI parity. The
adapter reaches further than that claim after #1804 (see the routing section
above) — for every surface but the Create Table dialog's ungated Indexes tab it
is the capability flags, not the adapter, that the product claim tracks. DuckDB/file analytics remains a separate H3 lane,
and fixture-only inventory does not become live runtime evidence.

## Fixture inventory

Current evidence:

- `e2e/fixtures/sqlite/query/seed.sql`
- `e2e/fixtures/seed.mssql.sql`
- `e2e/fixtures/seed.oracle.sql`

Current gap / routing:

SQLite fixtures are deterministic local files; nothing validates their presence
or path before a run. MSSQL fixture rows stay bounded to the promoted runtime and #907
smoke slice. Oracle fixture rows now pin the #905/#906 service-name
catalog/query/cancel/tabular/edit-row runtime boundary plus #907 representative
smoke (`host:port/serviceName`, default `XEPDB1`) while rejecting
SID/TNS/wallet/advanced-auth fixture assumptions. Fixture existence alone does
not widen support; Oracle structured DDL/full parser-completion/PLSQL claims
remain absent until matching source-specific evidence lands.

## DuckDB separation

Current evidence:

- `docs/ROADMAP.md`
- `docs/product/query-language-support.md`
- `docs/product/known-limitations.md`

Current gap / routing:

DuckDB/file analytics remains in the H3 matrix; SQLite fixture/smoke inventory
must not widen DuckDB claims.
