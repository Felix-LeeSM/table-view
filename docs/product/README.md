# Product State

현재 제품 상태와 지원 범위를 기록한다. 미래 목표와 승격 후보는
[`docs/ROADMAP.md`](../ROADMAP.md) 를 본다.

## Product Goal

기존 데스크톱 DB 클라이언트 사용자가 핵심 워크플로우를 잃지 않고 Table View 로
전환할 수 있어야 한다.

핵심 워크플로우: 연결 -> 탐색 -> 조회/쿼리 -> 편집 -> 안전한 검토/커밋.

## Supported Workflow Summary

현재 사용자-visible 지원은 active connection profile, runtime adapter, parser/safety
경계, fixture/live evidence 가 같이 있는 범위만 의미한다.

- Active connection UI/runtime 대상: PostgreSQL, MySQL, MariaDB, SQLite,
  DuckDB, MongoDB, Redis, Valkey, Elasticsearch, OpenSearch, MSSQL, Oracle.
- RDBMS workbench: catalog/tree browse, tabular result rendering, raw query path,
  bounded DML/row-edit path, source-specific safety confirmation. PostgreSQL 이
  routine desktop smoke-backed 주 lane 이고 MySQL/MariaDB 는 runtime smoke
  baseline 이 있다. SQLite 는 deterministic file workflow smoke baseline 이 있다.
  DuckDB 는 `.duckdb` Runtime Happy Path smoke 와 registered local source
  preview/query/history/privacy focused evidence 를 분리해서 좁힌다.
- SQLite/DuckDB file workflow: local file open/create/browse/query 중심. SQLite
  는 writable-file DML 과 key-projected row edit, DuckDB 는 `.duckdb` catalog/read
  query 와 registered local CSV/Parquet/JSON/NDJSON preview/source-scoped SELECT
  slice 를 지원한다.
- MongoDB workflow: whitelisted mongosh/MQL document query/edit/admin slices 와
  destructive Safe Mode path 를 지원한다. arbitrary JavaScript shell 은 지원하지
  않는다.
- Redis workflow: connection/profile, database/key scan, typed value preview,
  bounded value mutation panel, backend guarded KV primitives, selected command
  allowlist/dispatch with tabular result projection, and bounded Redis command
  vocabulary completion with current-DB/type-filtered key suggestions 이 있다.
  Runtime Happy Path smoke covers connect/scan/preview/GET plus guarded string
  write, TTL, and delete controls. Full CLI/admin parity, language-core parser
  ownership, stream consumer UI, cluster/pubsub/modules, Valkey full
  compatibility, and multi-key destructive command execution remain follow-up.
- Valkey workflow: connection/profile, database/key scan, typed value preview,
  bounded Redis-compatible command query execution, and bounded command
  completion for proven local-runtime rows are active. Runtime Happy Path smoke
  covers connect/scan/preview/GET/HGETALL/XRANGE plus bounded SET/EXPIRE DML
  summaries with readback/TTL verification and destructive/unsupported command
  guards. Key mutation panel controls and full Redis compatibility are not
  claimed.
- Elasticsearch/OpenSearch: embedded fixture-backed Search admin/result
  contract 가 있다. Elasticsearch 는 live HTTP root-probe connection test,
  live catalog, bounded live `_search` query dispatch, backend Search DSL
  validator, Runtime Happy Path smoke, and delete-by-query plan estimates 로
  URL/auth/TLS, product/version detection, indexes, aliases, data streams,
  mappings/settings/analyzers/templates/field paths, query/filter/aggs
  preflight, hits/fields/highlights/sort/aggs response parsing, and
  destructive confirmation gate 를 지원한다. OpenSearch 는 URL/auth/TLS live
  root-probe connection test, product/version/distribution detection,
  Elasticsearch endpoint rejection, auth/network error surfacing, and live
  catalog reads for indexes, aliases, data streams, mappings,
  settings/analyzers, composable/legacy templates, field paths, bounded live
  `_search` dispatch, hits/source/fields/highlights/sort/shards/aggs response
  parsing, sample documents, cancellation, HTTP error surfacing, bounded Search
  DSL safety validation for query/filter/aggs/sort/source request shapes, and
  mapping-aware Search DSL editor completion 을 지원한다.
  Elasticsearch/OpenSearch Runtime Happy Path smoke 는 live runtime evidence 이고
  Search fixture files 는 contract evidence 다. Actual live `_delete_by_query`
  execution and actual Search admin execution 은 deferred 다. Support closure 는
  Elasticsearch 와 OpenSearch product-specific probe/catalog/completion deltas 를
  분리해서 기록한다.
- MSSQL: SQL authentication connection UI/runtime probe, SQL Server version
  detection through `SERVERPROPERTY`, and a bounded SELECT/DML query runtime are
  active. Catalog/workbench metadata covers databases, schemas, tables, views,
  procedures/functions, columns, indexes, constraints, and FKs. The runtime
  returns the shared tabular result envelope and supports DML batch commit/dry-run
  plus cancellation/error surfacing. Row edit is active for primary-key-projected
  table data only: generated SQL uses bracket identifiers, preview/discard/commit
  uses the shared batch path, dry-run rolls back, commit failures roll back the
  transaction, and no-PK tables can be browsed but not edited. T-SQL editor
  completion uses the live
  cached catalog for database/schema/table/view/procedure/column suggestions
  where metadata is loaded, plus curated vocabulary and bracket identifier
  quoting. Bounded static parser/Safe Mode metadata is active as editor/safety
  assistance. Structured table/index/constraint DDL preview/execute is active for
  the bounded adapter path. Runtime Happy Path smoke now covers the representative
  SQL Server connect/catalog browse/SELECT/DML/row-edit/Safe Mode confirmation
  path through the wired MSSQL smoke; the seed fixture alone is contract evidence,
  not a live runtime claim. TLS-required workflow evidence,
  SQLCMD/admin/security/backup/jobs/users/roles support, and full T-SQL semantic
  parity remain deferred.
- Oracle: service-name connection UI/runtime probe plus bounded SELECT query
  runtime, transactional DML batch commit/dry-run, cancellation/error surfacing,
  tabular result envelopes, table-data browse, primary-key-scoped row edit, and
  catalog/workbench metadata browse are active.
  Catalog metadata covers the current service/database, schemas, tables, views,
  columns, indexes, constraints/FKs, routines/packages, and read-only
  sequences/synonyms through the shared RDB model, with safe-empty behavior for
  metadata-denied dictionary reads.
  Catalog-aware SQL editor autocomplete is active as editor assistance where
  live cached metadata is loaded. It suggests schemas, tables/views, columns,
  packages, sequences, synonyms, and Oracle sequence members from the catalog;
  empty or metadata-denied catalog state falls back to no catalog suggestions.
  Oracle completion has no extra server-version gate today: capability-sensitive
  package/sequence/synonym suggestions appear only when those catalog kinds are
  detected. Bounded static parser/Safe Mode classifies common SELECT/DML/DDL
  slices and blocks PL/SQL package/admin paths. No-PK Oracle tables can be
  browsed but row edit controls stay disabled. Bounded structured table/index/
  constraint DDL preview/execute is active through the Structure DDL path; raw
  DDL/admin execution remains blocked. SID, TNS alias, wallet/TLS,
  sequence/synonym DDL/admin workflows, runtime fixture/live
  evidence, desktop E2E, and full PL/SQL executable semantics remain deferred.

## Current Support Snapshot

| DBMS | Runtime | Parser / safety | Completion | 현재 판단 |
|---|---|---|---|---|
| PostgreSQL | strong | strong bounded subset | WASM-first + installed-extension-gated packs | 현재 가장 강한 lane 이다. routine desktop smoke 는 connect/browse/edit/query, Explain plan-inspection UI/source-label path, seeded `pgcrypto` installed-extension completion gating, Safe Mode info/warn/destructive confirmation, raw DDL preview, grid-edit preview, and cancellation UI/history/retry behavior 를 증명한다. Cancellation claim 은 query toolbar/API boundary, cancelled history, stale-grid clearing, retry 로 제한된다. full dialect/admin/arbitrary extension semantics, catalog-backed enumeration of every extension symbol, server activity/session management UI 는 보장하지 않음 |
| MySQL | runtime/query/edit/DDL adapter active | bounded parser/Safe Mode slice; constraint conformance version-gated | Rust/WASM MySQL-family vocabulary + current-catalog schema/table/column/routine suggestions | connection, browsing, databases/schemas, tables, views, columns, indexes, constraints/FKs, raw query, DML-oriented multi-statement batch, row edit with MySQL-quoted generated SQL/key projection, cancellation, and bounded structured table/index/constraint DDL are active. Routine desktop smoke covers connect, browse seeded table, SELECT result grid, DML batch per-statement result, row edit, cancellation/retry, history/source labels, and result-envelope rendering. Completion suggestions use the current connection/database catalog and MySQL backtick identifier context, but they do not widen runtime support for stored routine bodies or scripting. CHECK/constraint catalog metadata uses live MySQL `>= 8.0.16` context; older/unknown versions return empty CHECK hints. Stored routine/event bodies, control-flow scripting, `DELIMITER`, and `LOAD DATA` are explicit unsupported editor/backend boundaries. Trigger metadata is read-only in Structure; structured trigger create/drop and DB-level import/export/dump parity remain unsupported/follow-up |
| MariaDB | runtime/query/edit/catalog/DDL adapter active through distinct MariaDB engine smoke | MySQL-family parser/Safe Mode path + MariaDB dialect/profile identity | Rust/WASM MySQL-family vocabulary + version-aware profile/completion MariaDB `RETURNING` delta | connection, seeded table browse, catalog/workbench metadata browse, SELECT result grid, DML batch per-statement result, row edit, cancellation/retry, history/source labels, and result-envelope rendering have wired MariaDB Runtime Happy Path evidence. Catalog/workbench coverage includes tables, views, columns, indexes, constraints/FKs, and routine metadata browse through the shared MySQL-family adapter plus MariaDB-specific smoke seed/categories. Row edit has MariaDB-specific hook evidence for quoted key-projected preview/discard/commit SQL, and bounded table/index/constraint DDL has MariaDB-specific export/backend-preview evidence. CHECK/constraint promotion remains version-gated at MariaDB `>= 10.2.1`. Intentional shared paths are the MySQL-family adapter implementation, CodeMirror dialect, parser/Safe Mode boundary, capability/conformance family, and `mysql-client` completion family. MariaDB autocomplete keeps the `mariadb` profile identity and suppresses `RETURNING` only when known server version context is below `10.0.5`. The app does not claim a MariaDB `RETURNING` runtime/version gate; raw execution remains server-resolved. MySQL-only evidence does not become a MariaDB runtime/admin/import/export claim without MariaDB-specific tests/docs |
| SQLite | file adapter + read/writable-file DML | bounded parser/Safe Mode guardrails; DDL rejected by adapter | Rust/WASM built-in vocabulary + cached schema objects + sqlite-cli suggestions | user DBMS adapter 는 internal SQLite state 와 분리됨. 쓰기는 writable file 의 DML/PK-projected row edit 로 제한된다. GitHub Runtime Happy Path now runs a deterministic SQLite desktop smoke for file create/open, table browse, read query, writable DML, row edit, read-only write rejection, and internal app-state DB rejection. structured DDL UI/runtime parity, unsupported `ALTER TABLE` rebuild, nested JSON edit, sqlite-cli execution, extension/capability semantics 는 unsupported |
| DuckDB | RDBMS file adapter + registered local analytics query | DuckDB SQL/file analytics guardrails | Rust/WASM DuckDB editor vocabulary + cached schema objects | `rdb` profile + `file` connection kind 로 표현한다. local `.duckdb` file 은 catalog/table read 와 statement-level raw SQL 실행 경로를 지원한다. GitHub Runtime Happy Path now runs a deterministic DuckDB desktop smoke for `.duckdb` open, catalog/table browse, raw SELECT tabular result/history evidence, and read-only write rejection. registered local CSV/Parquet/JSON/NDJSON analytics 는 active-session source alias 등록, source metadata/workbench alias 표시, preview, focused dialog/API source-scoped SELECT evidence, and a distinct `FILE` history source label for source-scoped dialog queries 가 있다. 이 focused evidence 는 Runtime Happy Path smoke 나 global query editor/import/export parity 로 승격하지 않는다. Public payload 는 source alias, file name, kind, size, columns, preview SQL 만 노출하고 absolute local path 는 노출하지 않는다. Completion 은 editor assistance 이며 runtime support 를 넓히지 않는다. extension install/load/helper functions, `COPY`, `ATTACH`/`DETACH`, sensitive external-file capability settings, and arbitrary external-file SQL functions/replacement scans are adapter-blocked. 구조화된 DDL/write UI, file analytics import/export/global query editor parity 는 unsupported/follow-up |
| MongoDB | runtime-backed whitelisted document workflow | whitelisted mongosh/MQL | Rust/WASM vocabulary + cached catalog context | connection, source-aware catalog metadata, workbench metadata panels, document query/edit with MQL preview/discard, catalog-aware collection/field/index-name autocomplete, bulk delete/update previews with partial-commit warnings, bulk/index/validator slices, cancellation, destructive collection/admin confirmations, and transaction-helper unsupported gates are active for tested whitelist paths. Runtime Happy Path smoke proves seeded collection browse, row-edit MQL preview/execute, query-tab `find` projection/sort/limit, destructive `runCommand` confirmation, and cancel/no-mutation re-read. Focused component/backend tests cover broader catalog, autocomplete, bulk, index, validator, parser, cancellation, and unsupported-helper gates below smoke. arbitrary JavaScript/shell behavior, unsupported cursor helpers, server-version feature promotion gates, native document-first result panels, and full-support parity remain follow-up |
| Redis | connection/profile + backend KV primitives + key browser/value preview/edit UI + bounded command editor vocabulary/key suggestions | backend KV guardrails plus bounded command allowlist and typed-confirm mutation controls; not language-core parser ownership | TypeScript bounded command vocabulary + current-DB/type-filtered key suggestions | key browser/value preview are live. Runtime Happy Path smoke covers Redis connection, deterministic DB 2 seed/reset, key scan, string value preview, `GET` command result, guarded string overwrite, TTL update, and exact-key delete confirmation. The value panel promotes bounded string/hash/list/set/zset edits plus expire/persist/delete preview/confirm flows, while partial/unsupported surfaces fail visibly. Backend guarded string set, delete confirmation, TTL expire/persist, bounded stream read, selected read/write/TTL/stream command dispatch, tabular projection, and exact-key `confirmKey` enforcement for single-key `DEL`/`PERSIST` have focused IPC/runtime evidence. The Redis command editor suggests the backend allowlist command names with arity hints/snippets plus current-DB key suggestions filtered by command key type. It still does not own full Redis CLI parsing or admin parity. Full CLI/admin parity, stream consumer UI, cluster/pubsub/modules/consumer-group management, multi-key destructive commands, broader command coverage, language-core parser/completion ownership, and Valkey command compatibility are follow-up |
| Valkey | KV runtime for connection + key browser/value preview + bounded command query | Redis-compatible bounded command allowlist and typed confirmation; key mutation panel remains off | TypeScript proven Valkey command subset + current-DB/type-filtered key suggestions | `valkey` is an active `DatabaseType`/profile identity with server connection kind, product label, KV paradigm, Valkey backend adapter profile, and `redis-command` compatibility target. Connection UI/runtime support is exposed for test/connect/key browse/value preview and selected bounded command query rows through the same Redis command allowlist. Runtime Happy Path smoke uses `e2e/fixtures/seed.valkey.json` for connect/key scan/value preview, `GET`, `HGETALL`, `XRANGE`, bounded `SET`/`EXPIRE`, and destructive/unsupported guard evidence. Command completion is limited to the proven local Valkey runtime rows plus safe current-keyspace hints. `e2e/fixtures/valkey.redis-compatibility.json` separates proven local-runtime rows from candidate/rejected command families. Direct key mutation controls and full Redis compatibility are not claimed |
| Elasticsearch/OpenSearch | Elasticsearch live connection + live catalog + bounded live Search query plus fixture/live delete-by-query safety planning; OpenSearch live connection + live catalog + bounded live Search query plus fixture/live delete-by-query safety planning | index-catalog sidebar shell plus selected-index lazy catalog detail and samples for both products; mapping/search guardrails for both products; destructive-plan guardrails for both products | Backend Search DSL validator active; full language-core parser/completion ownership remains future; bounded TypeScript completion is editor assistance for Elasticsearch/OpenSearch catalog and mapping context | Elasticsearch exposes URL/auth/TLS connection UI, a live HTTP root probe that detects product/version/distribution and surfaces network/auth failures, live catalog reads for indexes, aliases, data streams, mappings, settings/analyzers, templates, and field paths, bounded live `_search` execution with backend validation for `match_all`, `term`, `terms`, `match`, `bool` filters, `range`, `exists`, `terms`/`value_count` aggregations, pagination, `track_total_hits`, bounded field sort, and bounded `_source` filtering plus hits/source/fields/highlights/sort/shards/aggs response parsing, and delete-by-query safety planning that estimates matching documents through a safe `_search` request before requiring explicit target confirmation for execution intent. OpenSearch exposes URL/auth/TLS connection UI, a live HTTP root probe that verifies OpenSearch product/version/distribution, rejects Elasticsearch endpoints, surfaces auth/network failures, reads live indexes, aliases, data streams, mappings, settings/analyzers, composable/legacy templates, and field paths, dispatches bounded live `_search` requests through the same validator/result renderer with cancellation and HTTP error handling, and uses the same safe `_search` estimate + exact-target confirmation gate for delete-by-query safety plans. Runtime Happy Path smoke covers representative Elasticsearch and OpenSearch live connect/catalog/search/render/delete-plan workflows. Bounded Search DSL editor completion uses product-scoped catalog/mapping context for index, alias, data stream, field, type, `sort`, and `_source` suggestions plus shared query/aggs/sort/source snippets. Unsupported body keys, unsupported aggregation kinds/options, script sort, broad source options, raw/admin targets, and destructive/admin APIs reject before live Search dispatch. Actual live `_delete_by_query` execution, broader Search admin APIs, observability, profile/explain request workflow, and product-specific live deltas beyond these slices are deferred |
| MSSQL | bounded SQL Server auth/query/catalog/edit/DDL runtime + Runtime Happy Path smoke | bounded static T-SQL parser/Safe Mode metadata plus representative runtime safety smoke | catalog-aware T-SQL editor assistance | `mssql` profile/dialect identity exists with Lifecycle, RelationalCatalog, RelationalQuery, and RelationalSchemaMutation backend capability plus primary-key-scoped row-edit support. Connection UI/runtime test covers SQL authentication, TCP/TDS login, timeout-bounded `SERVERPROPERTY('ProductVersion')` probe, and live testcontainer evidence. Query runtime supports bounded SELECT tabular envelopes plus DML/DDL execution, transactional DML batches, cancellation, and server error surfacing. Catalog/workbench metadata covers databases, schemas, tables, views, procedures/functions, columns, indexes, constraints, and FK references consumed by SchemaTree/DataGrid contracts. Row edit uses bracket-quoted T-SQL generated from primary-key projection; no-PK tables can be browsed but edit controls stay disabled, and write batches use preview/discard/commit plus transactional rollback on dry-run/failure. Structured table/index/constraint DDL preview/execute is active for bounded adapter plans with bracket identifiers and transactional execution where a live connection is open. Runtime Happy Path smoke covers MSSQL connect, seeded `dbo` table/view/procedure browse, `SELECT TOP`, DML preview/execute/readback, destructive confirmation, and grid-edit SQL preview/commit; the fixture seed alone is not live runtime evidence. Editor completion uses the live cached catalog for database/schema/table/view/procedure/column suggestions where metadata is loaded, plus curated T-SQL keywords/functions and bracket identifier quoting as editor assistance only. Static parser/Safe Mode covers bounded `SELECT TOP`, bracket identifiers, `N'...'` strings, common DML, bounded DDL, and warn/danger metadata for unsupported SQL Server scripting/admin boundaries. TLS-required workflow, SQLCMD/admin/security/backup/jobs/users/roles support, broader SQL Server instance/auth behavior, and full T-SQL semantic completion remain follow-up |
| Oracle | bounded service-name connection/query/catalog/edit/DDL metadata runtime | bounded static Oracle SQL parser/Safe Mode boundary; no runtime safety claim | catalog-aware Oracle SQL editor assistance | `oracle` profile/dialect identity exists with Lifecycle, RelationalCatalog, RelationalQuery, and RelationalSchemaMutation backend capability. Connection UI/runtime test covers Host/Port/User/Password/Service name through the backend Oracle lifecycle adapter. Query runtime supports bounded SELECT tabular envelopes, transactional DML batch commit/dry-run, cancellation, server error surfacing, table-data browse, and primary-key-scoped row edit with Oracle quoted identifiers and no all-column WHERE fallback. Structured table/index/constraint DDL preview/execute is active through the bounded Structure DDL path; raw DDL/admin execution stays blocked. Catalog/workbench metadata covers current service/database, schemas, tables, views, columns, indexes, constraints/FKs, routines/packages, and read-only sequences/synonyms through the shared RDB model, with safe-empty behavior for metadata-denied dictionary reads. Editor completion uses live cached catalog metadata for schema/table/view/column/package/sequence/synonym suggestions, Oracle sequence members for detected sequence objects, selected Oracle SQL keywords/functions, and bind placeholders. There is no extra Oracle server-version completion gate today; capability-sensitive suggestions stay tied to detected catalog kinds, and empty or denied catalog state yields no catalog suggestions. Static parser/Safe Mode evidence classifies bounded SELECT/DML/DDL slices and marks PL/SQL package/admin paths unsupported. Static SQL seed contract remains future promotion evidence. SID, TNS alias, wallet/TLS, sequence/synonym DDL/admin workflows, runtime fixture/live evidence, desktop E2E, and full PL/SQL executable semantics are not implemented |
| Cassandra/Scylla, DynamoDB, graph, vector, stream | candidate only | deferred language ids only | deferred | no active `DatabaseType`/profile/runtime identity. Workflow value, profile target, connection kind, language owner, catalog model, result envelope, safety policy, fixture strategy, and smoke evidence must be locked before promotion |

## Fixture Coverage Snapshot

Fixture 파일 존재는 support claim 을 넓히지 않는다. 현재 fixture inventory 는
`scripts/fixtures/dbms-seeds.test.ts` 가 검증하고, runtime smoke 는 별도 CI wiring 이
있을 때만 product evidence 로 승격된다.

| Source | Fixture asset | Current meaning |
|---|---|---|
| PostgreSQL | `e2e/fixtures/seed.sql` | GitHub Runtime Happy Path 의 active RDBMS smoke seed |
| MySQL | `e2e/fixtures/seed.mysql.sql` | wired Runtime Happy Path seed for the connect/browse/query/edit/cancel baseline |
| MariaDB | `e2e/fixtures/seed.mariadb.sql` | wired Runtime Happy Path seed for the MariaDB connect/browse/query/edit/cancel baseline plus catalog/workbench probe objects |
| SQLite | `e2e/fixtures/seed.sqlite.sql` | wired Runtime Happy Path seed for deterministic file create/open, table browse, read query, writable DML, row edit, read-only write rejection, and internal app-state DB rejection |
| DuckDB | `e2e/fixtures/seed.duckdb.sql` | wired Runtime Happy Path seed for `.duckdb` open, catalog/table browse, raw SELECT result/history evidence, and read-only write rejection. Registered local CSV/Parquet/JSON/NDJSON source preview/query remains focused evidence outside this fixture smoke |
| MongoDB | `e2e/fixtures/seed.mongodb.json` | document fixture used by current MongoDB smoke seed path |
| Redis | `e2e/fixtures/seed.redis.json` | wired Runtime Happy Path seed for Redis DB 2 connect/scan/preview/GET plus guarded string write, TTL, and exact-key delete smoke. Broader stream consumer, cluster/pubsub/modules, admin, and Valkey parity remain future work |
| Elasticsearch | `e2e/fixtures/seed.search.elasticsearch.json`, `e2e/smoke/elasticsearch.spec.ts`, `src-tauri/src/db/search.rs`, `src-tauri/src/db/search_destructive.rs`, `src-tauri/src/db/search_dsl.rs`, `src-tauri/src/db/search_http.rs`, `src-tauri/src/db/search_live_destructive.rs`, `src-tauri/src/db/search_live_query.rs` | embedded Search fixture contract plus wired Runtime Happy Path smoke for live HTTP connection/catalog/query support with bounded Search DSL request validation and live delete-by-query safety planning; actual live admin execution deferred |
| OpenSearch | `e2e/fixtures/seed.search.opensearch.json`, `.github/workflows/e2e-smoke.yml`, `scripts/e2e-smoke-ci.sh`, `e2e/fixtures/seed-smoke.ts`, `e2e/smoke/opensearch.spec.ts`, `e2e/smoke/search-runtime-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts`, `src-tauri/src/db/search.rs`, `src-tauri/src/db/search_destructive.rs`, `src-tauri/src/db/search_dsl.rs`, `src-tauri/src/db/search_http.rs`, `src-tauri/src/db/search_live_destructive.rs`, `src-tauri/src/db/search_live_query.rs`, `src-tauri/src/db/search/tests.rs`, `src-tauri/src/db/search/tests/destructive.rs`, `src-tauri/src/db/search/tests/live_query.rs`, `src/lib/search/searchDslCompletion.ts`, `src/lib/search/searchDslCompletion.test.ts`, `src/hooks/useSearchAutocomplete.ts`, `src/hooks/useSearchAutocomplete.test.ts`, `src/components/workspace/SearchSidebar.test.tsx`, `src/components/search/SearchIndexDetailPanel.test.tsx`, `src/components/query/QueryTab.search-route.test.tsx`, `src/types/dataSource.ts` | embedded Search fixture contract plus wired Runtime Happy Path smoke, focused live HTTP connection/catalog/query tests, and mapping-aware TypeScript editor completion for URL/auth/TLS, product/version/distribution detection, Elasticsearch endpoint rejection, auth/network failures, indexes, aliases, data streams, mappings, settings/analyzers, composable/legacy templates, field paths, bounded `_search` dispatch/result rendering, shared DSL parser/safety validation for query/filter/aggs/sort/source shapes, sample documents, cancellation, HTTP error surfacing, safe `_search` delete-by-query plan estimates with exact-target confirmation gates, and product-scoped index/alias/data-stream/field/type/sort/source suggestions; no actual OpenSearch admin execution claim |
| MSSQL | `e2e/fixtures/seed.mssql.sql`, `.github/workflows/e2e-smoke.yml`, `scripts/e2e-smoke-ci.sh`, `e2e/fixtures/seed-smoke.ts`, `e2e/smoke/mssql.spec.ts`, `src-tauri/tests/mssql_connection_routing.rs`, `src-tauri/src/db/mssql/tests.rs`, `src-tauri/src/db/mssql/ddl_tests.rs`, `src-tauri/tests/backend_adapter_contract_profile.rs` | wired Runtime Happy Path smoke seed/spec for SQL Server connection, seeded `dbo` table/view/procedure browse, `SELECT TOP` result rendering, DML preview/execute/readback, destructive confirmation, and primary-key row-edit preview/commit. Focused backend tests continue to cover TCP/TDS login, `SERVERPROPERTY` version probe, bounded SELECT tabular envelope, table data read, DML batch commit/dry-run rollback/failure rollback, server error surfacing, query cancellation, catalog/workbench metadata for databases/schemas/tables/views/procedures/functions/columns/indexes/constraints/FKs, structured table/index/constraint DDL preview evidence, and capability/conformance boundaries. The fixture asset is seed/contract evidence until wired by this smoke path |
| Oracle | `e2e/fixtures/seed.oracle.sql` | planned static SQL seed contract only. Service-name connection and bounded query runtime evidence live in focused backend/profile tests, not this fixture, live evidence, or Runtime Happy Path smoke. Catalog-aware editor autocomplete evidence lives in focused profile/context/WASM/core tests and does not make the fixture a runtime evidence source |
| Valkey | `e2e/fixtures/seed.valkey.json`, `e2e/fixtures/valkey.redis-compatibility.json` | wired Runtime Happy Path seed for Valkey DB 2 connect/scan/preview/GET/HGETALL/XRANGE plus bounded SET/EXPIRE and destructive/unsupported command guards. The compatibility matrix separates proven local-runtime rows from candidate/rejected command families; direct mutation controls, broader command families, and full Redis compatibility remain future gates |
| Wider candidates | none | no active fixture/live evidence |

## Profile Registry Boundary

`src/types/dataSource.ts` 의 `DATA_SOURCE_PROFILES` 는 모든 `DatabaseType` identity 를
포함한다. Profile 존재는 곧 runtime support claim 이 아니다. 현재 connection dialog
와 runtime connection support 는 `capabilities.connection.test` 가 true 인
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, MongoDB, Redis, Valkey,
Elasticsearch, OpenSearch, MSSQL, Oracle 로 제한된다. MSSQL 의 active slice 는 SQL
authentication connection test, SQL Server `SERVERPROPERTY` version probe, bounded
SELECT/DML query runtime, table data browse, transactional DML batch support,
primary-key-projected row edit, bounded structured table/index/constraint DDL,
and catalog/workbench metadata browse for
databases/schemas/tables/views/procedures/functions/columns/indexes/constraints/FKs
이다. Runtime Happy Path smoke 는 wired MSSQL smoke 로 connect/catalog browse/SELECT/DML/
row edit/Safe Mode confirmation 대표 경로를 증명한다. fixture file 만으로는
runtime claim 을 넓히지 않는다. Bounded editor completion 은 curated T-SQL vocabulary,
live cached catalog database/schema/table/view/procedure/column suggestions, and
bracket identifier quoting 으로 제한된다. bounded static parser/Safe Mode metadata 는
editor/safety assistance 로 active 이고, TLS-required workflow/SQLCMD/admin/
security/backup/jobs/users/roles 는 follow-up 이다.
Valkey 는 KV runtime slice 이며 `connection.test`, `query.query`,
`catalog.browse`, `paradigmSpecific.keyBrowser` 가 true 다.
`e2e/fixtures/seed.valkey.json` 는 wired Valkey Runtime Happy Path seed 이고,
`e2e/fixtures/valkey.redis-compatibility.json` 는 proven/candidate/rejected Redis
command-family rows 와 unsupported Redis assumptions 를 고정한다. Focused local
Valkey testcontainer evidence 는 connect/key scan/value preview 와 selected bounded
command query rows 까지 support claim 을 넓힌다. `redis-command` 는 bounded command
query target 이며, completion claim 은 proven local-runtime rows 에 제한된다. Full
Redis compatibility/direct mutation claim 은 아니다.

MSSQL 은 connection plus bounded query runtime support, primary-key-scoped row edit,
bounded structured table/index/constraint DDL, bounded editor completion,
catalog/workbench metadata browse, bounded static parser/Safe Mode metadata,
representative runtime smoke 로 승격됐지만, TLS/admin/full-T-SQL claim 은 아직 없다. Oracle 은
service-name connection, bounded query runtime, table-data browse,
primary-key-scoped row edit, catalog/workbench metadata, bounded static editor
completion, bounded structured table/index/constraint DDL, and bounded static
parser/Safe Mode 로 승격됐지만 sequence/synonym DDL/admin workflow,
runtime smoke/live/E2E claim 은 아직 없다.
Elasticsearch/OpenSearch 는 Search identity 와 fixture-backed admin contract 를
갖고 있다. Elasticsearch 와 OpenSearch 는 connection dialog 와 backend
`test_connection` 에서 URL/auth/TLS 기반 live HTTP root probe 를 지원하고,
product/version/distribution detection 과 auth/network error surfacing 을 제공한다.
OpenSearch probe 는 Elasticsearch endpoint 를 거부한다. Elasticsearch/OpenSearch
live catalog 는 sidebar 에서 index/alias/data-stream shell 을 보여주고, selected
index tab 에서 명시적으로 선택한 mappings/settings/analyzers/templates/field
stats 를 lazy fetch 한다. OpenSearch detail 은 sample documents 를 지원하고,
query tab 은 bounded Search DSL 을 live `_search` 로 dispatch 한다. Delete-by-query
safety planning 은 Elasticsearch/OpenSearch 모두 safe `_search` estimate 와
acknowledged-risk/exact-target confirmation gate 를 사용한다. Search DSL editor
completion 은 Elasticsearch/OpenSearch product identity 를 분리하고 catalog/mapping
context 로 index/alias/data-stream/field/type/sort/source suggestions 를 제공한다.
Elasticsearch/OpenSearch Runtime Happy Path smoke now proves live service
connect, catalog/index detail, bounded search rendering, and delete-by-query
safety planning. Elasticsearch live query 는 bounded `_search` dispatch 로 sample documents,
query/filter/aggs preflight, hits/source/fields/highlight/sort,
shards/timeout/total relation/took, aggregations, explain/profile response
payload 를 Search-native renderer 에 연결한다. Delete-by-query safety planning
은 fixture/live 모두 query estimate 를 계산하고, execution intent 에는
acknowledged risk 와 exact expected target confirmation 을 요구한다. 이 plan 은
safe `_search` estimate 경로를 쓰며 live `_delete_by_query` execution 은 보내지
않는다.
Initial sidebar load 는 search hits, explain/profile/destructive plan 을 가져오지
않는다. Elasticsearch/OpenSearch actual live admin execution, observability,
profile/explain request workflow, full language-core parser/completion ownership 은
아직 deferred 다.

Cassandra/Scylla, DynamoDB, graph, vector, stream 은 active `DatabaseType`,
profile, runtime, parser/completion, fixture/live evidence 가 없다. 이 후보들은
`docs/ROADMAP.md` H6 계약과 adding-data-source checklist 를 통과하기 전까지
candidate-only 상태다.

## Current Boundaries

- 새 DBMS/runtime promotion 은 기존 지원 DBMS 하나가 데스크톱 DB 클라이언트 수준의
  query/workbench parity lane 을 통과할 때까지 시작하지 않는다.
- Full admin parity 는 scope 밖이다: role/user/permission UI, extension management
  UI, schema diff/migration preview, DB-level backup/restore/import/export, deep
  activity/profiler dashboards.
- DuckDB file analytics paths stay in active-session adapter state and clear on
  connect/refresh/disconnect. Source metadata, preview, source-scoped query,
  and error payloads expose only public source metadata and redact local paths.
  The local file query dialog result is modal-local, but successful source
  queries are recorded with the distinct `FILE` history source label. This is
  not a promotion to the global query editor or import workflow. Grid export is
  the generic explicit save-dialog export of current grid rows, not automatic
  export of a registered local file source; connection export is a separate
  encrypted-envelope flow and does not embed connection passwords.
- DuckDB autocomplete is an editor-assistance surface: vocabulary and cached
  schema suggestions do not imply runtime permission for adapter-blocked
  extension, `COPY`, `ATTACH`/`DETACH`, capability-setting, or raw external-file
  statements.
- Runtime/parser/completion/edit/fixture/e2e/support-claim gaps 를 lane 하나씩
  닫는다.
- PostgreSQL is the strongest active query/workbench parity lane. Its current routine
  desktop smoke proves the PostgreSQL connect -> browse/edit -> query journey,
  the Explain plan-inspection UI/source label, seeded `pgcrypto`
  installed-extension completion gating, Safe Mode info/warn/destructive
  confirmation, raw DDL preview, grid-edit preview paths, and cancellation
  UI/history/retry behavior. Cancellation does not imply a server
  activity/session management dashboard. Structured DDL flows, broader
  history-source coverage, ERD, admin, arbitrary extension semantics, and
  profiler/activity scenarios need separate promotion before product claims
  widen.
- MySQL has a narrower routine runtime-smoke baseline for connect, seeded table
  browse, SELECT, DML batch, row edit, cancellation/retry, history/source labels,
  and tabular result rendering. Catalog metadata now covers databases/schemas,
  tables, views, columns, indexes, constraints/FKs, and live version-gated
  column CHECK hints. Row-edit generated SQL uses MySQL backtick identifier
  quoting, primary-key row projection, and covered JSON/scalar/null coercion for
  preview/commit/discard paths. Structured DDL evidence is bounded to
  table/index/constraint preview/confirmation; Structure trigger create/drop
  remains hidden for MySQL because the supported trigger path is raw SQL.
  Parser/Safe Mode covers `LIMIT offset,count`,
  `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(...)`; stored routine/event
  bodies, control-flow scripting, `DELIMITER`, and `LOAD DATA` are explicit
  unsupported boundaries. Completion uses the current catalog as editor
  assistance only; completion runtime smoke, broader workbench breadth, and full
  admin/import/export parity remain separate promotion gates.
- MariaDB now has its own routine runtime-smoke baseline for connect, seeded
  table browse, catalog/workbench metadata browse, SELECT, DML batch, row edit,
  cancellation/retry, history/source labels, and tabular result rendering
  against the MariaDB engine fixture. Catalog/workbench evidence covers
  tables/views/columns/indexes/constraints/FKs/routine metadata browse; row edit
  and bounded table/index/constraint DDL have focused MariaDB-specific tests for
  the intentional MySQL-family path. CHECK constraint hints stay gated on MariaDB
  `>= 10.2.1` version context. MariaDB autocomplete keeps the keyword-level
  `RETURNING` suggestion for unknown versions and known versions at
  `>= 10.0.5`, and suppresses it for known older versions. This does not widen
  MariaDB-only
  runtime claims such as `RETURNING`, procedure-management/body authoring,
  trigger CRUD, admin/import/export, or completion-runtime support. `RETURNING`
  is currently profile/completion plus structural parser/Safe Mode evidence
  only; runtime acceptance remains outside the app's client-side support claim.
- SQLite is a file-backed DBMS lane. Current support is scoped to file
  create/open/test, read-only mode, catalog/table browse, read queries,
  writable-file DML, transactional DML batch/dry-run, and key-projected row
  edits. GitHub Runtime Happy Path now runs deterministic SQLite desktop smoke
  for file create/open, table browse, read query, writable DML, row edit,
  read-only write rejection, and internal app-state DB rejection. SQLite
  structured DDL, automatic ALTER rebuilds, extension/capability semantics,
  sqlite-cli command execution, and nested JSON edits remain future promotion
  gates.
- Routine runtime smoke currently proves the GitHub Runtime Happy Path for
  PostgreSQL, MySQL, MariaDB, SQLite, DuckDB `.duckdb`, MongoDB, Redis, and
  Valkey. Other smoke specs or source inventories do not widen product support
  until the CI script and support docs promote them.
- Destructive/security behavior is source-specific. RDB DDL preview/confirm,
  RDB Safe Mode confirmations, MongoDB safety confirmations, Redis typed
  confirmation keys, and fixture/live Search destructive plan estimates exist, but
  Table View does not claim a universal admin/security dashboard, global
  audit log, role/user/permission UI, credential rotation UI, or broad
  dry-run system.
- Cassandra/Scylla, DynamoDB, graph, vector, stream 은 workflow value,
  profile target, capability, fixture/live evidence decision 전 active support 로
  승격하지 않는다.
- Current user-visible support boundaries and unmeasured UI/a11y/perf areas are
  tracked in [`known-limitations.md`](known-limitations.md).

## Related Documents

- [`docs/product/query-language-support.md`](query-language-support.md) — current query-language support boundaries
- [`memory/engineering/architecture/data-source/memory.md`](../../memory/engineering/architecture/data-source/memory.md) — data-source profile/capability architecture
- [`memory/engineering/architecture/data-source/adding/memory.md`](../../memory/engineering/architecture/data-source/adding/memory.md) — contributor checklist for new sources
- [`docs/product/known-limitations.md`](known-limitations.md) — current product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future follow-ups and promotion order
