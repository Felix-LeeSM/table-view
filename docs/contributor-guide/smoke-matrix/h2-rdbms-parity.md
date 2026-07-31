# H2 RDBMS Parity Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the H2 RDBMS parity gate. It separates current remote smoke
evidence from fixture/unit/integration evidence so support claims do not imply
full desktop-client parity for every RDBMS.

## Active parity lane selection

Current evidence:

[`docs/roadmap/h2.md`](../../roadmap/h2.md) 및
[`docs/roadmap/h3.md`](../../roadmap/h3.md) 진행 기준

Current gap / routing:

PostgreSQL remains the strongest lane; MySQL, MariaDB, SQLite, and DuckDB have
narrower wired runtime-smoke baselines. DuckDB file analytics has a dedicated
Runtime Happy Path smoke for registered deterministic CSV source -> global
editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute
local path in visible UI, while broader import/export parity still waits for
source-specific promotion gates.

## PostgreSQL connect -> browse/edit -> query -> Explain -> extension completion -> Safe Mode -> cancellation -> Structure table/index DDL -> dense ERD

Current evidence:

- `e2e/smoke/postgres.spec.ts`
- `e2e/smoke/postgres-explain.spec.ts`
- `e2e/smoke/postgres-extension-completion.spec.ts`
- `e2e/smoke/postgres-safe-mode.spec.ts`
- `e2e/smoke/postgres-cancellation.spec.ts`
- `e2e/smoke/postgres-structure-ddl.spec.ts`
- `e2e/smoke/erd-dense.spec.ts`
- `src-tauri/tests/schema_integration.rs`
- `src-tauri/tests/query_integration.rs`

Current gap / routing:

This remains the strongest RDBMS remote E2E smoke-backed lane today; MySQL and
MariaDB have narrower routine baselines in their own rows. Explain evidence is
plan inspection/source-label only; installed-extension completion smoke covers
seeded `pgcrypto` and `fuzzystrmatch` gating only; Safe Mode smoke covers
info/warn/destructive, raw DDL, and grid-edit preview paths; cancellation smoke
covers the query toolbar UI/API boundary, cancelled history status, stale-grid
clearing, and retry. Structure DDL smoke covers the preview/execute path for one
table plus one index and schema/index refresh proof only. Dense ERD smoke covers
local graph render/search/selection/zoom/fit/screenshot evidence only, not FK
row navigation, schema diff, migration impact, or data compare. Future parity
hardening must add a scoped issue with matching tests and smoke routing before
claims widen.

## RDBMS common history/source attribution

Current evidence:

- `e2e/smoke/history-source-5.spec.ts`
- `e2e/smoke/mysql.spec.ts`
- `e2e/smoke/mariadb.spec.ts`

Current gap / routing:

Cross-source history label regression guard remains separate; MySQL and MariaDB
smoke additionally verify `sidebar-prefetch` and `grid-edit` source badges plus
raw query text evidence for their routine paths.

## MySQL runtime/query/edit/cancel adapter

Current evidence:

- `e2e/smoke/mysql.spec.ts`
- `src-tauri/tests/mysql_integration.rs`
- `src-tauri/tests/cancel_mysql.rs`
- `src/lib/sql/mysqlScriptingBoundary.test.ts`
- `src/components/datagrid/sqlGenerator.test.ts`
- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
- `src/components/query/QueryTab/useQueryExecution.test.tsx`
- `src/components/structure/IndexesEditor.test.tsx`
- `src/components/schema/StructurePanel.triggers.test.tsx`
- `src-tauri/src/commands/rdb/query.rs`
- `e2e/fixtures/mysql/query/seed.sql`

Current gap / routing:

Routine MySQL smoke now covers connect, table browse, SELECT result grid, narrow
seeded `CALL proc(scalar)` result rendering behind WARN preview, DML batch
per-statement result, row edit, cancellation, retry, history/source labels, and
bounded Structure table/index/FK DDL preview/execute/catalog-readback. Focused
row-edit tests cover MySQL backtick generated SQL, primary-key row projection,
JSON/scalar/null coercion, and preview/commit/discard consistency. Focused DDL
tests cover table/index/constraint preview/confirmation and keep structured
trigger create/drop hidden while trigger metadata remains readable.
CHECK/constraint catalog support is gated by detected server version context.
Unsupported scripting boundaries reject stored routine/event bodies, broad CALL
expressions, control-flow fragments, `DELIMITER`, and `LOAD DATA` before
dispatch.

## MySQL autocomplete context

Current evidence:

- `src/features/completion/sql/sqlCompletionContext.test.ts`
- `src/lib/sql/sqlCompletionWasm.test.ts`
- `src/features/completion/sql/sqlHybridCompletionSource.test.ts`
- `src-tauri/sql-parser-core/src/completion/completion_tests.rs`

Current gap / routing:

Focused tests prove current connection/database catalog scoping, schema
inventory serialization across the WASM bridge, schema/table/column/routine
suggestions, schema-qualified object/routine prefixes, and MySQL backtick
replace ranges. These are completion-context evidence only; routine body
authoring, scripting, and completion runtime smoke remain separate promotion
gates.

## MySQL test coverage closure audit

Current evidence:

- `src-tauri/tests/mysql_integration.rs`
- `src-tauri/tests/cancel_mysql.rs`
- `src-tauri/src/db/mysql/queries.rs`
- `src-tauri/src/db/mysql/mutations.rs`
- `src-tauri/src/db/mysql/version.rs`
- `src-tauri/src/db/mysql/checks.rs`
- `src-tauri/sql-parser-core/src/parser/tests.rs`
- `src/lib/sql/mysqlScriptingBoundary.test.ts`
- `src/components/query/QueryTab/useQueryExecution.test.tsx`
- `src/components/datagrid/sqlGenerator.test.ts`
- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
- `src/features/completion/sql/sqlCompletionContext.test.ts`
- `src/lib/sql/sqlCompletionWasm.test.ts`
- `src/features/completion/sql/sqlHybridCompletionSource.test.ts`
- `src-tauri/sql-parser-core/src/completion/completion_tests.rs`
- `e2e/smoke/mysql.spec.ts`
- `e2e/fixtures/mysql/query/seed.sql`

Current gap / routing:

#530 recheck plus the narrow CALL slice maps backend
runtime/query/catalog/cancel coverage, source-equivalent edit/DDL coverage,
parser/safety and unsupported scripting boundary coverage including broad CALL
expression rejection, autocomplete vocabulary/context coverage, and fixture/live
smoke routing. Fixture inventory remains contract evidence only until a spec
exercises it.

## MySQL smoke scenario inventory

Current evidence:

`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix

Current gap / routing:

Covered baseline: connect, browse seeded table, SELECT, narrow seeded CALL
result rendering, DML batch, row edit, cancellation, source labels, tabular
result evidence, bounded Structure table/index/FK DDL
preview/execute/catalog-readback, and explicit unsupported scripting guardrails.
Remaining promotion slices: broader tables/views/functions/procedures browse,
routine behavior beyond the seeded CALL probe, structured trigger CRUD decision,
admin/import/export, and vendor-workbench parity.

## MySQL support-claim closure audit

Current evidence:

`docs/product/README.md`, `docs/product/query-language-support.md`,
`docs/product/known-limitations.md`, this matrix, `docs/ROADMAP.md`

Current gap / routing:

#447/#529/#530 baseline plus #870/#872: current MySQL claims stay limited to the
wired runtime-smoke baseline, narrow seeded CALL result rendering, bounded
Structure table/index/FK DDL smoke, and focused unit/integration/component/core
evidence. Fixture-only inventory, catalog-aware completion suggestions, profile
metadata, and focused tests do not become full workbench, admin/import/export,
routine-body, scripting, trigger CRUD, or completion-runtime claims.

## MariaDB engine baseline and identity/delta evidence

Current evidence:

- `e2e/smoke/mariadb.spec.ts`
- `e2e/fixtures/mariadb/query/seed.sql`
- `.github/workflows/e2e-smoke.yml`
- `src/types/dataSource.test.ts`
- `src-tauri/tests/backend_adapter_contract_profile.rs`
- `src/lib/sql/sqlDialectProfile.test.ts`
- `src/features/completion/sql/sqlCompletionRequest.test.ts`
- `src-tauri/tests/mariadb_returning_runtime.rs`

Current gap / routing:

#448 baseline plus #870/#871/#872: MariaDB keeps distinct identity/profile, has
a wired MariaDB engine Runtime Happy Path slice with narrow seeded CALL result
rendering, and keeps `RETURNING` as a profile/completion/server-resolved
boundary rather than a returned-row runtime claim. The runtime smoke proves the
common connect/browse/query/edit/cancel/history/result-envelope journey plus
bounded Structure table/index/FK DDL preview/execute/catalog-readback, not
broader MariaDB-only syntax or admin/workbench parity. The focused `mariadb:11`
integration separately verifies live version context and characterizes
`DELETE ... RETURNING` as server-accepted with no returned rows and no
affected-row count from the shared adapter.

## MariaDB MySQL-family reuse audit

Current evidence:

- `src/types/dataSource.test.ts`
- `src/types/adapterConformance.test.ts`
- `src/lib/sql/sqlDialectProfile.test.ts`
- `src/features/completion/sql/sqlCompletionRequest.test.ts`
- `src-tauri/tests/backend_adapter_contract_profile.rs`
- `src-tauri/src/commands/connection.rs`
- `src-tauri/src/db/mysql/**`

Current gap / routing:

#450 locks the intentional shared path inventory: `MysqlAdapter::new_mariadb()`
dispatch, shared `src-tauri/src/db/mysql/**` catalog/query/edit/cancel
implementation, MySQL CodeMirror/parser/Safe Mode/completion family, and shared
capability/conformance family. It also keeps MariaDB deltas explicit: `mariadb`
identity/dialect, MariaDB version evidence for CHECK/constraint catalog
promotion, and profile/completion `RETURNING`. MySQL-only evidence does not
unlock MariaDB support claims without MariaDB-specific evidence.

## MariaDB `RETURNING` parser/Safe Mode/runtime boundary

Current evidence:

- `src-tauri/sql-parser-core/src/parser/tests.rs`
- `src/lib/sql/sqlSafety.test.ts`
- `src/lib/sql/sqlSafety.ast-write.test.ts`
- `src-tauri/tests/mariadb_returning_runtime.rs`
- `docs/product/query-language-support.md`
- `docs/product/known-limitations.md`

Current gap / routing:

#451/#871 decision: the app does not add a MariaDB `RETURNING` runtime/version
returned-row support gate. Parser/Safe Mode recognition is structural only;
supported DML shapes keep existing INSERT info, bounded UPDATE/DELETE warn, and
WHERE-less UPDATE/DELETE danger behavior. Focused `mariadb:11` runtime
characterization verifies current server acceptance for `DELETE ... RETURNING`
while the shared adapter returns a DML envelope with no returned rows and no
affected-row count.

## MariaDB autocomplete delta parity

Current evidence:

- `src/features/completion/sql/sqlCompletionRequest.test.ts`
- `src/features/completion/sql/sqlCodeMirrorCompletionAdapter.test.ts`
- `src/lib/sql/sqlCompletionWasm.test.ts`
- `src-tauri/sql-parser-core/src/completion/completion_tests.rs`

Current gap / routing:

#454 proves MariaDB completion requests preserve `mariadb` identity with the
shared MySQL family/`mysql-client` shell, carry server version context across
the WASM boundary, share MySQL-family functions, and gate the `RETURNING`
suggestion at known MariaDB versions below `10.0.5`. This is a keyword-level
editor-assistance gate, not statement-specific runtime acceptance evidence.

## MariaDB smoke scenario inventory

Current evidence:

`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix

Current gap / routing:

Covered baseline: connect, browse seeded table, catalog/workbench metadata
browse, SELECT, narrow seeded CALL result rendering, DML batch, row edit,
cancellation, source labels, tabular result evidence, and bounded Structure
table/index/FK DDL preview/execute/catalog-readback against MariaDB. Focused
evidence also covers row-edit SQL parity, export/backend-preview DDL for the
intentional MySQL-family path, and `mariadb:11` `DELETE ... RETURNING`
server-resolved/no-returned-row adapter characterization. Remaining promotion
slices: routine default/body behavior beyond the seeded CALL probe, MariaDB
`RETURNING` returned-row runtime support if promoted, completion-runtime smoke,
trigger CRUD, admin/import/export, and broader vendor-workbench parity.

## MariaDB catalog/workbench metadata parity

Current evidence:

- `e2e/fixtures/mariadb/query/seed.sql`
- `e2e/smoke/mariadb.spec.ts`
- `e2e/smoke/mysql-family-baseline.ts`
- `src/components/schema/SchemaTree.dbms-shape.test.tsx`
- `src/types/adapterConformance.test.ts`
- `src-tauri/src/db/mysql/schema.rs`

Current gap / routing:

#452 covers MariaDB tables/views/columns/indexes/constraints/FKs/routine
metadata through a MariaDB-specific live smoke probe plus no-schema workbench
auto-load coverage. CHECK constraint hints remain version-gated at MariaDB
`>= 10.2.1`; routine metadata browse and the seeded CALL probe do not claim
procedure body authoring/management or broad runtime routine semantics.

## MariaDB row edit and bounded DDL parity

Current evidence:

- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
- `src/lib/sql/ddlGenerator.test.ts`
- `src/lib/sql/ddlGenerator.ts`
- `src/hooks/useMigrationExport.ts`
- `src-tauri/tests/mariadb_ddl_preview.rs`
- `e2e/smoke/mariadb.spec.ts`

Current gap / routing:

#453 plus the MariaDB Runtime Happy Path cover MySQL-family quoted key-projected
row-edit preview/discard/commit under MariaDB connection identity plus bounded
table/index/constraint DDL export/backend-preview and Structure table/index/FK
smoke evidence. Trigger create/drop, procedure body management, DB-level
import/export, admin, and full vendor-workbench parity remain separate promotion
gates.

## MariaDB support-claim closure audit

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix

Current gap / routing:

#455 ties the MariaDB product snapshot, query-language boundary, known
limitations, and testing matrix together before milestone closure. MariaDB
claims are separated from MySQL inheritance: live engine smoke covers the
routine baseline, focused tests cover shared-path deltas, and remaining
MariaDB-only runtime/admin/import/export/completion-runtime work stays routed as
future promotion slices.

## MariaDB documentation recheck

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix

Current gap / routing:

#531 verifies the touched MariaDB docs agree on shipped behavior: product
snapshot, runtime/query support, parser/Safe Mode structure, autocomplete
evidence, known limitations, and test matrix rows all distinguish live evidence
from fixture-only or completion-only evidence.

## MariaDB test coverage recheck

Current evidence:

- `e2e/smoke/mariadb.spec.ts`
- `src-tauri/tests/mariadb_ddl_preview.rs`
- `src-tauri/tests/mariadb_returning_runtime.rs`
- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
- `src/lib/sql/ddlGenerator.test.ts`
- `src-tauri/sql-parser-core/src/parser/tests.rs`
- `src/lib/sql/sqlSafety.test.ts`
- `src/features/completion/sql/sqlCompletionRequest.test.ts`
- `src/features/completion/sql/sqlCodeMirrorCompletionAdapter.test.ts`
- `src/lib/sql/sqlCompletionWasm.test.ts`
- `src-tauri/sql-parser-core/src/completion/completion_tests.rs`

Current gap / routing:

#532 plus #871 recheck maps runtime/query/edit and source-equivalent paths,
parser/Safe Mode unsupported-boundary behavior, autocomplete vocabulary/context
behavior, the focused MariaDB `RETURNING` server-resolved/no-returned-row
boundary, and fixture/live smoke routing before parity closure. Fixture
inventory remains contract evidence only until a spec exercises it.

## SQLite file DBMS read/write boundary

Current evidence:

`e2e/smoke/sqlite.spec.ts`, `e2e/fixtures/sqlite/query/seed.sql`,
`src-tauri/tests/sqlite_connection_command.rs`,
`src-tauri/tests/sqlite_browse_query_adapter.rs`,
`src-tauri/tests/workspace_sqlite_only.rs`, #456

Current gap / routing:

Runtime smoke now covers file create/open, browse, read query, writable DML, row
edit, read-only write rejection, and internal app-state DB rejection. DDL UI
parity, raw DDL, ALTER rebuild, and extension semantics remain unsupported.

## SQLite documentation recheck

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #533

Current gap / routing:

Final docs recheck confirms the product snapshot, query-language support, known
limitations, and testing matrix match shipped SQLite behavior. Runtime smoke,
parser/Safe Mode, autocomplete, DDL rejection, extension-boundary, and
fixture-only evidence remain separated.

## SQLite test coverage recheck

Current evidence:

`src-tauri/tests/sqlite_connection_command.rs`,
`src-tauri/tests/sqlite_browse_query_adapter.rs`,
`src-tauri/src/db/adapters/sqlite/queries_tests.rs`,
`src-tauri/src/db/adapters/sqlite/batch_tests.rs`,
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

Final test recheck maps SQLite runtime/query/edit backend coverage,
source-equivalent row-edit and unsupported-boundary coverage, shared parser/Safe
Mode coverage, autocomplete vocabulary/context/real-WASM coverage, and
fixture/live smoke routing before parity closure. Fixture-only and
completion-only evidence remain non-runtime support claims.

## SQLite support-claim closure audit

Current evidence:

`docs/ROADMAP.md`, `docs/product/README.md`,
`docs/product/query-language-support.md`, `docs/product/known-limitations.md`,
this matrix, #462

Current gap / routing:

Final support-claim audit confirms product docs and evidence docs agree on
file-backed SQLite runtime/query/edit support, deterministic Runtime Happy Path
coverage, unsupported DDL/ALTER/nested JSON/sqlite-cli execution/extension
semantics, fixture-only evidence boundaries, and DuckDB/file analytics
separation.

## DuckDB `.duckdb` runtime smoke

Current evidence:

`e2e/smoke/duckdb.spec.ts`, `e2e/fixtures/duckdb/query/seed.sql`,
`src-tauri/tests/duckdb_browse_query_adapter.rs`,
#463

Current gap / routing:

Runtime smoke now covers deterministic `.duckdb` open, catalog/table browse, raw
SELECT tabular result/history evidence, writable DML readback, and read-only
write rejection. Native structural DDL (table create/drop/rename, column
add/drop/type, index create/drop) landed as ADR 0051 Stage 2 (#1070) with Rust
round-trip evidence in `src-tauri/src/db/duckdb/ddl.rs`; a DuckDB structured-DDL
runtime smoke, constraint add/drop + identity columns (Stage 2b), DuckDB
extension semantics, and file analytics automatic import/export remain separate
H3 promotion gates.

## RDBMS conformance/capability gate

Current evidence:

- `src/types/adapterConformance.test.ts`
- `src/types/dataSourceVersionCapabilities.test.ts`
- `src-tauri/tests/backend_adapter_contract_profile.rs`

Current gap / routing:

Version-aware capability checks must be supplied with server version context
before product claims use gated behavior.
