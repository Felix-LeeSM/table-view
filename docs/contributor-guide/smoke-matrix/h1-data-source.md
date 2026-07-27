# H1 Data Source Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix records the current data-source architecture smoke boundary. It is
not a product support expansion; product-visible limits remain in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

## PostgreSQL connect -> browse/edit -> query result + Explain + extension completion + Safe Mode confirmation + cancellation + bounded Structure table/index DDL + dense ERD

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

Gap routing:

H2/H4 strongest RDBMS parity lane. Structure DDL smoke covers table creation
plus index creation only, and dense ERD smoke covers local diagram interactions
only, not FK row navigation, roles/users, extensions, profiler, import/export,
or broad admin flows.

## MySQL connect -> browse/edit -> SELECT/CALL/DML batch -> cancellation + history evidence

Current evidence:

- `e2e/smoke/mysql.spec.ts`
- `e2e/fixtures/mysql/query/seed.sql`
- `src-tauri/tests/mysql_integration.rs`
- `src-tauri/tests/cancel_mysql.rs`
- `src/lib/sql/mysqlScriptingBoundary.test.ts`
- `src/components/datagrid/sqlGenerator.test.ts`
- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
- `src/components/query/QueryTab/useQueryExecution.test.tsx`
- `src/features/completion/sql/sqlCompletionContext.test.ts`
- `src/lib/sql/sqlCompletionWasm.test.ts`
- `src/features/completion/sql/sqlHybridCompletionSource.test.ts`
- `src-tauri/sql-parser-core/src/completion/completion_tests.rs`
- `src/components/structure/IndexesEditor.test.tsx`
- `src/components/schema/StructurePanel.triggers.test.tsx`
- `src-tauri/src/commands/rdb/query.rs`

Gap routing:

H2 MySQL runtime-smoke slice plus narrow seeded CALL result rendering, catalog
metadata integration coverage for databases/schemas, tables, views, columns,
indexes, constraints/FKs, live version-gated column CHECK hints, row-edit
generated SQL quoting/key projection and preview/commit/discard coverage,
bounded Structure table/index/FK DDL preview/confirmation/catalog-readback
coverage, catalog-aware completion context evidence, read-only Structure trigger
metadata, and explicit unsupported scripting boundaries. Support-claim closure
is audited under `## MySQL support-claim closure audit` in
[`h2-rdbms-parity.md`](h2-rdbms-parity.md); remaining gaps stay routed as
promotion gates.

## MariaDB connect -> browse/edit -> SELECT/CALL/DML batch -> cancellation + history evidence

Current evidence:

- `e2e/smoke/mariadb.spec.ts`
- `e2e/fixtures/mariadb/query/seed.sql`
- `scripts/e2e-smoke-ci.sh`
- `.github/workflows/e2e-smoke.yml`
- `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
- `src/lib/sql/ddlGenerator.test.ts`
- `src-tauri/tests/mariadb_ddl_preview.rs`

Gap routing:

H2 MariaDB engine baseline proves the same routine connect, seeded table browse,
SELECT result grid, narrow seeded CALL result rendering, DML batch
result-envelope, row edit, cancellation/retry, history/source-label journey, and
bounded Structure table/index/FK DDL preview/execute/catalog-readback against
MariaDB itself. Focused tests prove MySQL-family quoted key-projected row-edit
SQL and export/backend-preview DDL under MariaDB identity. This does not widen
MariaDB-only `RETURNING`, routine/default behavior beyond the seeded CALL probe,
procedure-management, trigger CRUD, completion-runtime, admin/import/export, or
full workbench claims.

## MongoDB connect -> collection edit/query -> query-tab read/safety -> document result

Current evidence:

- `e2e/smoke/mongodb.spec.ts`
- `e2e/smoke/phase-28-slice-A.spec.ts`
- `src/components/query/QueryTab/useQueryExecution.parserDispatch.test.tsx`
- `src/components/query/QueryTab/useQueryExecution.runCommand.test.tsx`
- `src/components/schema/DocumentDatabaseTree.test.tsx`
- `src/components/document/CollectionDdlDialog.test.tsx`
- `src/components/document/__tests__/MongoStructurePanel.test.tsx`
- `src/components/document/__tests__/MongoIndexesPanel.test.tsx`
- `src/components/document/ValidatorPanel.test.tsx`
- `src/components/document/DocumentDataGrid.schema.test.tsx`
- `src/components/document/DocumentDataGrid.test.tsx`
- `src/components/document/DocumentDataGrid.nested.test.tsx`
- `src/components/document/MqlPreviewModal.test.tsx`
- `src/components/document/DocumentDataGrid/DocumentBulkDeleteDialog.test.tsx`
- `src/components/document/DocumentDataGrid/DocumentBulkUpdateDialog.test.tsx`
- `src/components/datagrid/useDataGridEdit.document.test.ts`
- `src/components/layout/MainArea.test.tsx`
- `src/lib/mongo/mongoshParser.test.ts`
- `src/features/completion/mongo/mongoAutocomplete.test.ts`
- `src/features/completion/mongo/useMongoAutocomplete.test.ts`
- `src/stores/documentStore.test.ts`
- `src-tauri/tests/mongo_integration.rs`
- `src-tauri/tests/cancel_mongo.rs`

Gap routing:

MongoDB whitelist lane is current for tested query/edit/catalog/workbench
slices. Runtime smoke covers seeded collection browse, row-edit MQL
preview/execute, query-tab `find` with projection/sort/limit, destructive
`runCommand` confirmation, and cancel/no-mutation re-read. Focused
component/backend tests cover query parser/dispatch, runCommand safety,
catalog/autocomplete, edit/bulk/index/validator, and cancellation below smoke;
fixture inventory alone is not runtime evidence. Query evidence covers find
filter/projection/sort/skip/limit cursor dispatch, aggregate cursor-chain
lowering, scalar/list read routing, unsupported helper/multi-statement
rejection, visible no-IPC parser errors, destructive admin confirmation before
backend safety ack, transaction-helper unsupported messages, catalog-aware
autocomplete for operators/stages/expressions/BSON tags/collections/fields/index
names, unsupported helper non-suggestion, and cancellation. Edit/bulk evidence
covers MQL preview, discard/retry state retention, ordered bulk partial-commit
warnings, deleteMany/updateMany MQL previews, and index/validator paths.
Catalog/workbench evidence covers source metadata badges, unknown-count and
permission fallbacks, structure/index/validator panels, field inference,
destructive collection typing-confirm, and document workbench routing.
Full-support parity, native document-first result panels, and server-version
feature promotion gates remain future lane work.

## Query history source labels across RDB/document journeys

Current evidence:

- `e2e/smoke/history-source-5.spec.ts`

Gap routing:

Keep as regression guard for source attribution.

## Profile/capability/adapter contract registry

Current evidence:

- `src/types/dataSource.test.ts`
- `src/types/adapterConformance.test.ts`
- `src-tauri/tests/backend_adapter_contract_profile.rs`

Gap routing:

Extend same matrix when a DBMS capability is promoted.

## Backend contract common/delta ownership

Current evidence:

- `src/types/adapterContractTestMatrix.ts`
- `src/types/adapterConformance.test.ts`
- `src-tauri/tests/backend_query_result_contract.rs`
- `src-tauri/tests/catalog_explain_contract.rs`
- `src-tauri/tests/backend_safety_capability_contract.rs`

Gap routing:

#765 owns query/result, #766 owns catalog/explain, #767 owns completion
metadata, and #768 owns safety/capability unsupported deltas. Common
expectations stay separate from
DBMS/version/dialect/paradigm/capability/evidence deltas; fixture-only evidence
does not widen support claims.

## Query language owner registry

Current evidence:

- `src/types/dataSource.test.ts`
- `docs/product/query-language-support.md`

Gap routing:

Add active owner metadata before any new runtime-active language.

## Result envelope compatibility

Current evidence:

- `src/types/query.resultEnvelope.test.ts`
- `src/lib/tauri/query.test.ts`

Gap routing:

Backend-native RDBMS envelope wire format is future hardening; wrapper boundary
is current SOT.

## Redis key browser/value preview/edit + bounded command runtime

Current evidence:

- `scripts/e2e-smoke-ci.sh`
- `.github/workflows/e2e-smoke.yml`
- `e2e/fixtures/redis/kv/seed.json`
- `e2e/smoke/redis.spec.ts`
- `src-tauri/src/db/redis/command_parser.rs`
- `src-tauri/src/db/redis/command.rs`
- `src-tauri/tests/redis_integration.rs`
- `src/lib/tauri/kv.test.ts`
- `src/hooks/useRedisKeySuggestions.test.ts`
- `src/features/completion/redis/redisCommandCompletion.test.ts`
- `src/components/query/RedisCommandEditor.test.tsx`
- `src/components/query/QueryTab.dialect.test.tsx`
- `src/components/query/QueryTab/useQueryExecution.kvDispatch.test.tsx`
- `src/components/workspace/KvSidebar.test.tsx`
- `src/components/workspace/KvSidebar.mutations.test.tsx`

Gap routing:

Runtime Happy Path now wires a Redis service and deterministic DB 2 seed for
connect, scan, string preview, `GET`, guarded string overwrite, TTL update, and
exact-key delete. Focused backend evidence covers
read/write/TTL/stream/destructive command classification, bounded command
execution, and exact-key `confirmKey` enforcement for single-key
`DEL`/`PERSIST`. Focused frontend evidence covers bounded
string/hash/list/set/zset mutation controls, selected-key stream start/end/count
controls with refresh/loading/error/table states, expire/persist/delete
preview/confirm semantics, Redis command-name completion for the backend
allowlist with arity/snippet hints, and current-DB key suggestions filtered by
command key type with loading/error fallback. Valkey now has a wired Runtime
Happy Path for connect/scan/preview/GET/HGETALL/XRANGE plus bounded SET/EXPIRE
and destructive/unsupported command guards plus focused backend/component
evidence for direct UTF-8 string-key mutation controls, while full language-core
parser ownership, consumer-group stream UI, broader command families, multi-key
destructive commands, cluster/pubsub/modules/consumer-group flows, and Valkey
hash/list/set/zset writes remain future H5 Redis/Valkey work.

## Elasticsearch/OpenSearch live connection/catalog/query + fixture/live destructive planning + editor completion

Current evidence:

`src-tauri/src/db/search_destructive.rs`, `src-tauri/src/db/search_dsl.rs`,
`src-tauri/src/db/search_http.rs`,
`src-tauri/src/db/search_live_destructive.rs`,
`src-tauri/src/db/search_live_query.rs`, `src-tauri/src/db/search/tests.rs`,
`src-tauri/src/db/search/tests/live_query.rs`,
`src-tauri/src/commands/connection/crud.rs`, `src/types/dataSource.test.ts`,
`src/types/search.ts`, `src/components/connection/ConnectionDialog.test.tsx`,
`src/components/connection/ConnectionDialog.urlInput.test.tsx`,
`e2e/fixtures/elasticsearch/search/seed.json`,
`e2e/fixtures/opensearch/search/seed.json`, `src-tauri/src/commands/search.rs`,
`src/lib/tauri/search.test.ts`, `src/lib/search/searchDslCompletion.ts`,
`src/lib/search/searchDslCompletion.test.ts`, `src/lib/search/searchUiError.ts`,
`src/hooks/useSearchAutocomplete.ts`, `src/hooks/useSearchAutocomplete.test.ts`,
`src/components/workspace/SearchSidebar.test.tsx`,
`src/components/search/SearchIndexDetailPanel.test.tsx`,
`src/components/search/SearchResultView.test.tsx`,
`src/components/search/SearchDeleteByQueryPreviewDialog.test.tsx`,
`src/components/query/QueryTab.search-route.test.tsx`, #497/#506/#898

Gap routing:

Elasticsearch live connection test covers URL/auth/TLS UI, root product/version
detection, and scoped redacted auth/TLS/network/timeout/permission/server/shard
failure surfacing. Live catalog covers indexes, aliases, data streams, mappings,
settings/analyzers, templates, and field paths.
Initial Search workbench load is index-catalog-first: the sidebar shell loads
only index/alias/data-stream summaries, while selected-index detail tabs fetch
mapping/settings/templates/sample documents/field stats only after explicit user
action. Live query covers bounded `_search` dispatch, backend request validation
for `match_all`, `term`, `terms`, `match`, `bool` filter, `range`, `exists`, and
`terms`/`value_count` aggs, sample-doc match_all,
hits/source/fields/highlights/sort/shards/aggs response parsing, scoped/redacted
HTTP error body surfacing, and in-flight cancel token behavior. Delete-by-query
planning covers fixture estimates, live safe `_search` estimates,
raw/destructive target rejection, wildcard target rejection, unsupported body
rejection, scoped/redacted preview errors, and explicit preview-only execution
rejection. Search DSL editor completion covers product-scoped
Elasticsearch/OpenSearch index/alias/data-stream/field/type/sort/source
suggestions plus shared bounded query/aggs/sort/source snippets; completion
remains editor assistance and does not widen runtime smoke. Search live
HTTP/admin promotion remains owned by the Search roadmap/milestone. Actual live
`_delete_by_query` execution, live admin smoke, and global audit/admin/security
dashboards remain outside this scope.

## DuckDB `.duckdb` file workflow and file analytics

Current evidence:

- `e2e/smoke/duckdb.spec.ts`
- `e2e/smoke/duckdb-file-analytics.spec.ts`
- `e2e/fixtures/duckdb/query/seed.sql`
- `scripts/e2e-smoke-ci.sh`
- `src/components/query/DuckdbFileAnalyticsDialog.test.tsx`
- `src/components/query/QueryTab/useQueryExecution.test.tsx`
- `src/components/query/QueryHistoryPanel.per-tab.test.tsx`
- `src/components/shared/QueryHistorySourceBadge.test.tsx`
- `src/lib/tauri/fileAnalytics.test.ts`
- `src-tauri/tests/duckdb_browse_query_adapter.rs`
- `src-tauri/tests/duckdb_file_analytics.rs`
- `src-tauri/src/db/duckdb.rs`

Gap routing:

Runtime E2E smoke covers two separate DuckDB lanes: deterministic `.duckdb`
open/browse/SELECT/history/read-only baseline, and dedicated file analytics
smoke for registered deterministic CSV source -> global editor SELECT -> result
grid -> `FILE` history/source evidence -> no absolute local path in visible UI.
Focused evidence still covers registered-source preview/metadata, source-scoped
SELECT execution, dialog history labeling, fixture inventory, path redaction,
and extension/external-file blocklists. COPY/ATTACH/DETACH, extension
install/load, raw external-file SQL functions, automatic import/export workflow,
structured DDL/write UI, and admin parity remain unpromoted.

## Static DBMS fixture inventory

Current evidence:

- `scripts/fixtures/dbms-seeds.test.ts`
- `e2e/fixtures/**/seed.*`
- `e2e/fixtures/seed.mssql.sql`
- `e2e/fixtures/seed.oracle.sql`
- `e2e/fixtures/valkey.redis-compatibility.json`
- `e2e/fixtures/smoke-routing-decisions.json`

Gap routing:

Fixture existence is contract/evidence inventory only unless the runtime smoke
script wires the matching spec. Valkey's seed is wired into Runtime Happy Path
smoke; its compatibility matrix still only separates proven local-runtime rows
from candidate/rejected command families and is not full compatibility evidence.
Issue #753 keeps fixture tiers and smoke-routing cost/risk rationale in
`e2e/fixtures/smoke-routing-decisions.json`; #870 adds MySQL/MariaDB bounded
Structure table/index/FK DDL smoke impact to those routed rows. Add
DBMS-specific runtime smoke when each remaining parity lane becomes active.

## MySQL/MariaDB/SQLite/DuckDB support claims

Current evidence:

MySQL, MariaDB, SQLite, and DuckDB now have routine runtime smoke baselines plus
focused evidence; MySQL/MariaDB bounded DDL smoke is table/index/FK Structure
flow only, not trigger CRUD or full vendor-workbench parity. SQLite smoke is
limited to file workflow, query/edit, and guardrail evidence. DuckDB `.duckdb`
smoke is limited to open/browse/SELECT/history/read-only evidence; DuckDB file
analytics smoke is limited to registered deterministic CSV source -> global
editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute
local path in visible UI. Those two DuckDB smokes do not promote
COPY/ATTACH/DETACH, extension install/load, raw external-file SQL functions,
automatic import/export workflow, structured DDL/write UI, or admin parity — the
ADR 0051 Stage 2 structural DDL (#1070) is claimed on Rust round-trip evidence,
not on smoke (see [`h3-duckdb-file-analytics.md`](h3-duckdb-file-analytics.md)).

Gap routing:

Add DBMS-specific runtime smoke when each remaining parity lane becomes active.
