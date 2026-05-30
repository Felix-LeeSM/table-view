# Testing And Quality Follow-Ups

This page collects developer-facing verification gaps and quality follow-ups.
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../product/known-limitations.md). Future
sequencing lives in [`docs/ROADMAP.md`](../ROADMAP.md). The retired risk register
is archived at
[`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

## Backend And Integration Coverage

| Area | Follow-up |
|---|---|
| Tauri commands | Add mock coverage for async connection commands such as connect, disconnect, and keep-alive behavior. |
| Integration skip policy | Normalize skip behavior between query and schema integration tests. |
| Docker-backed integration | Document or automate local DB service bootstrap for schema integration tests. |
| MariaDB fixture | Add a MariaDB engine fixture smoke, or keep public support claims narrowed. |

## Local Development And CI

| Area | Follow-up |
|---|---|
| Local DB ports | Make local DB service ports deterministic or self-allocating instead of relying on partial env override. |
| macOS smoke | Keep macOS E2E deferred until tauri-driver WKWebView support or an alternate mac smoke path exists. |
| Right-click E2E | Add an alternate context-menu trigger or wait for tauri-driver W3C Actions support. |
| E2E isolation | Reset fixtures before each smoke instead of relying on one reused app instance. |
| Link checker | Add an internal-doc link checker after archive routing settles. |
| Dependency security | Track `hickory-proto` advisory exposure through `mongodb 3.6.0`; remove deny ignore when MongoDB dependency updates make it possible. |

## H1 Data Source Smoke Matrix

This matrix records the current data-source architecture smoke boundary. It is
not a product support expansion; product-visible limits remain in
[`docs/product/known-limitations.md`](../product/known-limitations.md).

| Claim / journey | Current evidence | Gap routing |
|---|---|---|
| PostgreSQL connect -> browse/edit -> query result | `e2e/smoke/postgres.spec.ts`, `src-tauri/tests/schema_integration.rs`, `src-tauri/tests/query_integration.rs` | H2 one-DBMS parity hardening. |
| MongoDB connect -> collection edit/query -> document result | `e2e/smoke/mongodb.spec.ts`, `e2e/smoke/phase-28-slice-A.spec.ts`, `src-tauri/tests/mongo_integration.rs` | MongoDB whitelist/full-support lane after RDBMS parity. |
| Query history source labels across RDB/document journeys | `e2e/smoke/history-source-5.spec.ts` | Keep as regression guard for source attribution. |
| Profile/capability/adapter contract registry | `src/types/dataSource.test.ts`, `src/types/adapterConformance.test.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` | Extend same matrix when a DBMS capability is promoted. |
| Query language owner registry | `src/types/dataSource.test.ts`, `docs/product/query-language-support.md` | Add active owner metadata before any new runtime-active language. |
| Result envelope compatibility | `src/types/query.resultEnvelope.test.ts`, `src/lib/tauri/query.test.ts` | Backend-native RDBMS envelope wire format is future hardening; wrapper boundary is current SOT. |
| Redis key browser/value preview | `src-tauri/tests/redis_integration.rs`, `src/lib/tauri/kv.test.ts`, `src/components/workspace/KvSidebar.test.tsx` | Runtime E2E smoke remains future H5 Redis/Valkey work. |
| Elasticsearch/OpenSearch fixture-backed search | `src/lib/tauri/search.test.ts`, `src/components/search/SearchResultView.test.tsx` | Live HTTP smoke waits for Search promotion. |
| DuckDB file analytics | `src/lib/tauri/fileAnalytics.test.ts`, DuckDB unit/integration coverage near `src-tauri/src/db/duckdb*` | Runtime E2E smoke and broader file analytics query UI remain routed through the H3 matrix below. |
| MySQL/MariaDB/SQLite support claims | Unit/integration tests under `src-tauri/tests/*integration.rs`, `src/types/dataSource.test.ts`, dialect/parser tests | Add DBMS-specific runtime smoke when each parity lane becomes active. |

## H2 RDBMS Parity Smoke Matrix

This matrix is the H2 RDBMS parity gate. It separates current remote smoke
evidence from fixture/unit/integration evidence so support claims do not imply
full desktop-client parity for every RDBMS.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| Active parity lane selection | `docs/ROADMAP.md` H2 진행 기준 | PostgreSQL is the active lane; MySQL/MariaDB/SQLite/DuckDB wait until the lane gate passes. |
| PostgreSQL connect -> browse/edit -> query -> history | `e2e/smoke/postgres.spec.ts`, `src-tauri/tests/schema_integration.rs`, `src-tauri/tests/query_integration.rs` | This is the only RDBMS remote E2E smoke-backed lane today. Broader Explain/parity hardening stays in the PostgreSQL milestone. |
| RDBMS common history/source attribution | `e2e/smoke/history-source-5.spec.ts` | Cross-source history label regression guard only; it is not DBMS parity proof. |
| MySQL runtime/query/edit/cancel adapter | `src-tauri/tests/mysql_integration.rs`, `src-tauri/tests/cancel_mysql.rs`, `src/lib/sql/mysqlScriptingBoundary.test.ts`, `e2e/fixtures/seed.mysql.sql` | No MySQL runtime E2E smoke yet. Version-aware CHECK/constraint catalog support is gated by server version context. |
| MySQL smoke scenario inventory | `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, this matrix | Required smoke before promotion: connect, browse tables/views/functions/procedures, SELECT/DML batch, row edit, cancellation, unsupported `DELIMITER`/`LOAD DATA`, bounded DDL, version-gated constraints. |
| MariaDB identity/delta evidence | `src/types/dataSource.test.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs`, `src/lib/sql/sqlDialectProfile.test.ts`, `src/lib/sql/sqlCompletionRequest.test.ts`, `e2e/fixtures/seed.mariadb.sql` | MariaDB keeps distinct identity/profile and completion-only `RETURNING` delta. No MariaDB live-engine CI gate yet. |
| MariaDB smoke scenario inventory | `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, this matrix | Required smoke before promotion: MySQL-family baseline plus MariaDB engine fixture, routine/default evidence, version-gated CHECK/constraint behavior, and explicit `RETURNING` runtime decision. |
| SQLite file DBMS read/write boundary | `src-tauri/tests/sqlite_connection_command.rs`, `src-tauri/tests/sqlite_browse_query_adapter.rs`, `src-tauri/tests/workspace_sqlite_only.rs`, `e2e/fixtures/seed.sqlite.sql` | No SQLite runtime E2E smoke yet. DDL UI parity, raw DDL, ALTER rebuild, and extension semantics remain unsupported. |
| RDBMS conformance/capability gate | `src/types/adapterConformance.test.ts`, `src/types/dataSourceVersionCapabilities.test.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` | Version-aware capability checks must be supplied with server version context before product claims use gated behavior. |

## PostgreSQL Query/Workbench Smoke Matrix

This matrix is the PostgreSQL lane inventory for #186/#241. It distinguishes the
current GitHub Runtime Happy Path claim from component, unit, integration, and
future smoke evidence.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| Routine desktop E2E claim | `scripts/e2e-smoke-ci.sh`, `e2e/smoke/postgres.spec.ts`, `e2e/fixtures/seed.sql` | GitHub Runtime Happy Path proves connect, browse seeded `users`, edit Alice's `name`, run a SQL preview, and verify the updated query result on Ubuntu. It does not prove Explain UI, extension completion, Safe Mode dialogs, DDL structure flows, history-source labeling, cancellation, ERD, admin, or profiler scenarios. |
| Runtime query execution | `src-tauri/src/db/postgres/queries.rs`, `src-tauri/tests/query_integration.rs`, `src-tauri/tests/cancel_pg.rs` | SELECT/EXPLAIN result routing, DML batches, table data, cancellation, and raw-query grid edit are covered below desktop smoke. psql meta commands, DB-level backup/restore/import/export, and PL/pgSQL body authoring remain outside current parity claims. |
| Catalog/workbench metadata | `src-tauri/src/db/postgres/schema.rs`, `src-tauri/tests/schema_integration.rs`, `src/components/schema/SchemaTree*`, `src/components/rdb/DataGrid*` | Schemas, tables, views, functions, types, installed extensions, triggers, stats, indexes, constraints, FKs, cached metadata, DataGrid, Structure, and ERD inputs have evidence. Server activity, profiler, role/user/permission UI, extension management UI, schema diff, migration impact, and data compare are future H7/H4-style work. |
| Parser and Safe Mode | `src-tauri/sql-parser-core/**`, `src/lib/sql/sqlSafety.test.ts`, `src/components/query/QueryTab.safe-mode.test.tsx`, `src/components/query/QueryTab.warn-dialog.test.tsx`, `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` | Tests cover bounded SQL classification, destructive/warn/info paths, EXPLAIN inner classification, raw query confirmation, grid edit confirmation, and DDL preview. Full PL/pgSQL bodies, broad MERGE variants, arbitrary nested expressions, and arbitrary extension semantics are not modeled. |
| Completion and installed extensions | `src-tauri/src/db/postgres/schema.rs`, `src/lib/sql/sqlCompletionContext.test.ts`, `src/lib/sql/sqlCompletionRequest.test.ts`, `src/lib/sql/sqlCompletionWasm.test.ts`, `src-tauri/sql-parser-core/src/completion/completion_tests.rs` | Installed extension inventory is consumed before curated extension packs are enabled. Unknown installed extensions are detected-but-unpacked; completion does not enumerate every extension symbol or make parser/Safe Mode semantically extension-aware. |
| Edit semantics | `src/components/datagrid/sqlGenerator.test.ts`, `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`, `src/components/query/useRawQueryGridEdit.ts`, `src-tauri/src/db/postgres/queries.rs` | Key-projected row edits, JSON/array SQL generation, preview/commit/discard, and Safe Mode confirmation have targeted evidence. Arbitrary query-result mutation and bulk/admin edit workflows are future work. |
| Lightweight Explain path | `src-tauri/src/db/postgres/schema.rs`, `src/lib/api/explain.ts`, `src/components/query/ExplainViewer.test.tsx`, `src/lib/sql/sqlAst.test.ts`, `src/lib/sql/sqlSafety.test.ts` | Backend/API/component/parser/safety evidence exists for lightweight plan inspection. There is no routine desktop E2E claim, profiler surface, or server activity dashboard claim. |
| Non-routine scenario assets | `e2e/smoke/history-source-5.spec.ts`, `wdio.smoke.conf.ts` | These can inform local/manual regression and future CI wiring. They do not expand the GitHub Runtime Happy Path unless `scripts/e2e-smoke-ci.sh` invokes them. |

## H3 DuckDB And File Analytics Smoke Matrix

This matrix is the H3 DuckDB/file analytics gate. It records the current
evidence slice and keeps local-file analytics within the existing RDBMS + `file`
connection model until runtime evidence requires a separate paradigm.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| DuckDB modeling boundary | `src/types/dataSource.test.ts`, `docs/ROADMAP.md`, `docs/product/README.md` | DuckDB remains an `rdb` profile with `file` connection kind; no separate file-SQL paradigm is introduced. |
| `.duckdb` connection, catalog, table read, raw SQL | `src-tauri/src/db/duckdb.rs`, `src-tauri/tests/duckdb_browse_query_adapter.rs`, `e2e/fixtures/seed.duckdb.sql` | There is no desktop E2E smoke for DuckDB yet; current support is unit/integration/fixture-backed. |
| CSV/Parquet/JSON/NDJSON registration and preview | `src/types/dataSource.test.ts`, `src/lib/tauri/fileAnalytics.test.ts`, `src-tauri/tests/duckdb_file_analytics.rs` | Product UI remains preview-first. Broader file analytics query UI parity, history, and import workflows are not claimed. |
| Source-scoped SELECT backend wrapper | `src/lib/tauri/fileAnalytics.test.ts`, `src-tauri/tests/duckdb_file_analytics.rs` | The backend can execute source-scoped read-only SELECT, but the query editor/history workflow is not promoted to parity. |
| Local-file privacy and export boundary | `src-tauri/tests/duckdb_file_analytics.rs`, `docs/product/known-limitations.md` | Public payloads expose alias/file name/kind/size only; export remains the generic explicit grid export for current rows. |
| Extension, external-file, and COPY gate | `src-tauri/src/db/duckdb.rs`, `src-tauri/tests/duckdb_file_analytics.rs`, `docs/product/query-language-support.md` | `INSTALL`/`LOAD`, extension helper functions, `COPY`, `ATTACH`/`DETACH`, sensitive capability settings, replacement scans, and raw external-file functions are adapter-blocked. No DuckDB extension semantic support is claimed. |
| Runtime E2E smoke inventory | This matrix and `e2e/fixtures/seed.duckdb.sql` | Required before future E2E promotion: create/open a seeded `.duckdb` file, browse schema/table, run raw SELECT, register local CSV/Parquet/JSON/NDJSON, preview rows without path exposure, reject blocked extension/file statements, and verify no automatic history/import/export claim. |

## H4 RDBMS Intelligence Smoke Matrix

This matrix is the H4 ERD/SchemaGraph gate. It separates current unit/component
evidence from future desktop smoke so reusable graph claims do not imply
dependency view, migration impact, or dense-view E2E coverage.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| Schema metadata cache owner | `src/stores/schemaStore.ts`, `src/stores/schemaStore.tableMetadataCache.test.ts`, `src/stores/schemaStore.clearForConnection.test.ts` | Current cache owner range is schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers. New catalog metadata must define cache ownership before UI claim promotion. |
| Production ERD graph input | `src/components/schema/SchemaErdPanel.tsx`, `src/components/schema/SchemaErdPanel.test.tsx`, `src/lib/schemaGraphSnapshot.ts`, `src/lib/schemaGraphSnapshot.test.ts` | ERD uses schema/table/column cache plus cached/fetched explicit index/constraint metadata for visible tables. `ColumnInfo` PK/FK/CHECK metadata remains a synthetic fallback when explicit metadata is absent. |
| Reusable SchemaGraph extraction and FK semantics | `src/lib/schemaGraph.ts`, `src/lib/schemaGraph.test.ts`, `src/lib/schemaGraphRelationships.ts`, `src/lib/schemaGraphRelationships.test.ts` | RDB catalog/FK semantics are current scope. Other paradigms may expose catalog graphs later, but must not pretend to be RDB schemas. |
| ERD renderer local interactions | `src/components/schema/SchemaErdRenderer.test.tsx`, `src/components/schema/SchemaErdLayout.ts` | Table cards, FK edges, search, select, zoom, fit, focus, and highlight are local diagram interactions. There is no desktop/narrow screenshot smoke claim today. |
| FK row navigation boundary | `src/components/datagrid/DataGridTable.fk-navigation.test.tsx`, `src/components/datagrid/DataGridTable.parseFkReference.test.ts` | FK row navigation remains the DataGrid foreign-key cell/icon path. ERD interactions are not FK row navigation claims. |
| Future dependency/migration/schema diff/data compare surfaces | `docs/ROADMAP.md`, `memory/engineering/architecture/data-source/memory.md` | Future surfaces must reuse `SchemaGraph`/catalog input and avoid duplicate catalog parsing before support claims widen. |
| Runtime E2E smoke inventory | This matrix and current ERD component evidence | Required before future E2E promotion: open a seeded RDBMS schema, open ERD, verify table nodes, FK edges, search, selection, zoom, fit, and narrow viewport behavior, confirm metadata fetch stability, and confirm no FK row-navigation claim through ERD. |

## H5 Non-RDBMS Smoke Matrix

This matrix is the H5 non-RDBMS claim gate. It separates current evidence from
future promotion scenarios so Document/KV/Search support claims do not imply
full first-class parity.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| MongoDB connection/catalog/query/edit workflow | `e2e/smoke/mongodb.spec.ts`, `e2e/smoke/phase-28-slice-A.spec.ts`, `src-tauri/tests/mongo_integration.rs`, `src/lib/tauri/document.ts` | MongoDB is the only H5 source with current desktop E2E smoke. Full-support parity, native document-first panels, and version/deployment gates remain future lane work. |
| MongoDB whitelist and safety boundary | `src/lib/mongo/mongoshAst.test.ts`, `src/lib/mongo/mongoSafety.test.ts`, `src/components/query/QueryTab.warn-dialog.test.tsx`, `src-tauri/tests/cancel_mongo.rs` | Arbitrary JavaScript, shell helpers, multiple statements, and cross-db shell navigation are unsupported. Transaction-style paths on unsupported standalone deployments must fail clearly rather than silently commit partial work. |
| Redis backend KV first slice | `src-tauri/src/db/redis/mod.rs`, `src-tauri/src/db/redis/tests.rs`, `src-tauri/tests/redis_integration.rs`, `src/lib/tauri/kv.test.ts` | Backend evidence covers database/key scan, typed value reads, guarded string set, delete confirmation, TTL expire/persist, and bounded stream read. No Redis desktop E2E smoke is claimed today. |
| Redis visible UI journey | `src/components/workspace/KvSidebar.test.tsx`, `src/lib/tauri/kv.test.ts` | Product UI claim is key browser/value preview only. Full value editor, TTL/write controls, stream consumer UI, and Redis command query editor require new UI smoke before promotion. |
| Valkey support claim | `docs/product/README.md`, `docs/product/known-limitations.md`, `docs/ROADMAP.md` | No active profile/runtime/fixture/live evidence exists. Future promotion must add Valkey identity/capability contracts plus Redis-compatibility or delta evidence before support is claimed. |
| Search fixture-backed contract | `src-tauri/src/db/search.rs`, `src-tauri/tests/fixture_harness.rs`, `src/lib/tauri/search.test.ts`, `src/components/search/SearchResultView.test.tsx`, `src/components/query/QueryTab.search-route.test.tsx` | Elasticsearch/OpenSearch are fixture-backed only. Live HTTP connection, catalog/search execution, response parsing, admin APIs, and observability are not claimed. |
| Elasticsearch/OpenSearch product delta | `src-tauri/src/models/search.rs`, `src-tauri/src/db/search.rs`, `src-tauri/tests/backend_adapter_contract_profile.rs` | Shared Search contract and product deltas must stay separated. Live promotion requires product/version detection, auth/TLS, API endpoint differences, and failure/observability smoke. |
| Non-RDBMS E2E inventory | This matrix and current E2E smoke set | Required future Redis smoke: connect, scan keys, select typed value, switch DB, and prove guarded write/delete/TTL paths remain behind explicit controls. Required future Search smoke: connect with auth/TLS, list indexes/mappings/templates, run bounded search, render search hits, preview destructive delete-by-query plan, and verify error/observability surfaces. |

## H6 Wider Source Candidate Smoke Matrix

This matrix is the H6 planned/candidate claim gate. It separates current E2E
evidence from future source-specific smoke so MSSQL/Oracle and wider candidates
do not look runtime-active before implementation.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| Current desktop E2E claim | `e2e/smoke/postgres.spec.ts`, `e2e/smoke/mongodb.spec.ts`, `e2e/smoke/phase-28-slice-A.spec.ts` | Current E2E smoke proves PostgreSQL and MongoDB journeys only. H6 adds no MSSQL, Oracle, Cassandra/Scylla, DynamoDB, graph, vector, or stream runtime E2E claim. |
| MSSQL planned identity contract | `src/types/connection.ts`, `src/types/dataSource.ts`, `src/types/dataSourceRuntime.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs`, `docs/ROADMAP.md` | No SQL Server connection UI, runtime adapter, T-SQL parser/completion claim, catalog/query/edit smoke, or live evidence. Required future smoke before promotion: connect with chosen auth/encryption/instance contract, browse databases/schemas/tables/views/procedures, run bounded SELECT/DML batch, cancel query, row-edit with key projection, verify Safe Mode/destructive previews, and capture SQL Server fixture/live evidence. |
| Oracle planned identity contract | `src/types/connection.ts`, `src/types/dataSource.ts`, `src/types/dataSourceRuntime.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs`, `docs/ROADMAP.md` | No Oracle connection UI, runtime adapter, Oracle SQL/PL/SQL parser/completion claim, catalog/query/edit smoke, or live evidence. Required future smoke before promotion: connect through the chosen service/SID/wallet/TNS contract, browse schemas/tables/views/sequences/packages/synonyms, run bounded SELECT/DML batch, cancel query, row-edit with key projection, verify Safe Mode/destructive previews, and capture Oracle fixture/live evidence. |
| Wider source candidate common gate | `docs/ROADMAP.md`, `docs/product/README.md`, `docs/product/query-language-support.md`, `memory/engineering/architecture/data-source/memory.md` | Candidates have no active `DatabaseType`/profile/runtime. Promotion PRs must add workflow value, profile target, connection kind, language owner, catalog model, result envelope, safety policy, fixture strategy, conformance scope, docs, and source-specific smoke before support claims widen. |
| Wide-column candidate smoke inventory | `docs/ROADMAP.md` H6 진행 기준 | Cassandra/Scylla need future smoke for cluster connection, keyspace/table/partition/clustering catalog, bounded CQL reads/writes, partition/expensive-read guardrails, result rendering, and fixture/live evidence. |
| Cloud-document candidate smoke inventory | `docs/ROADMAP.md` H6 진행 기준 | DynamoDB needs future smoke for cloud/local connection contract, table/keySchema/GSI/LSI catalog, PartiQL or native API query path, item preview/edit boundaries, access-pattern/cost guardrails, and local emulator or bounded mock evidence. |
| Graph candidate smoke inventory | `docs/ROADMAP.md` H6 진행 기준 | Graph sources need future smoke for connection, label/relationship/property catalog, chosen Cypher/GQL/Gremlin language route, graph/path/tabular result rendering, destructive traversal/write guardrails, and fixture graph evidence. |
| Vector candidate smoke inventory | `docs/ROADMAP.md` H6 진행 기준 | Vector sources need future smoke for connection, collection/vectorSchema/payloadIndex catalog, bounded vector query/filter execution, vectorNeighbors rendering, write/delete guardrails, and embedded/mock or container fixture evidence. |
| Stream candidate smoke inventory | `docs/ROADMAP.md` H6 진행 기준 | Stream sources need future smoke for connection, topic/partition/consumerGroup/schema catalog, bounded consume/produce or read-only decision, offset/consumer/destructive guardrails, records/metrics rendering, and Kafka/Redpanda fixture evidence. |

## H7 Ops, Security, And Reliability Smoke Matrix

This matrix is the H7 gate-alignment record. It separates the current automated
gate surface from future ops/security/a11y/perf work so docs do not imply
routine coverage that is not wired into CI or hooks.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| PR/main CI gate surface | `.github/workflows/ci.yml`, `.github/workflows/e2e-smoke.yml` | Blocking remote checks are Frontend Checks, Rust Unit And Storage Tests, Integration Tests (Docker), and Runtime Happy Path. Theme contrast is advisory. Link checking, full a11y, perf, dependency-security CI, and platform runtime smoke are not routine blocking checks. |
| Local pre-push routing | `.githooks/pre-push`, `lefthook.yml`, `scripts/hooks/pre-push-path-router.sh`, `scripts/hooks/test-pre-push-path-router.sh` | Pre-push always runs signed-commit and TDD-cycle checks, then routes by outgoing path. Docs-only skips TS/Rust; frontend or Rust paths run the matching stack; workflow/unknown paths run full checks. Hook bypass remains forbidden by git policy and dangerous-bash guards. |
| Runtime Happy Path E2E | `.github/workflows/e2e-smoke.yml`, `scripts/e2e-smoke-ci.sh`, `e2e/smoke/postgres.spec.ts`, `e2e/smoke/mongodb.spec.ts` | The remote runtime gate builds the app on Ubuntu and executes PostgreSQL and MongoDB smoke specs only. `wdio.smoke.conf.ts` can discover more smoke specs, but `scripts/e2e-smoke-ci.sh` must wire a spec before it becomes part of the routine remote gate. |
| Non-routine E2E smoke specs | `e2e/smoke/history-source-5.spec.ts`, `e2e/smoke/phase-28-slice-A.spec.ts`, `e2e/reset-to-default-audit.e2e.ts` | These are scenario inventory or local/manual regression assets unless a workflow/script invokes them. They do not currently expand the Runtime Happy Path claim. |
| Destructive/admin operation safety | `src-tauri/src/commands/rdb/ddl.rs`, `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`, `src-tauri/src/commands/document/**`, `src-tauri/src/db/kv_trait.rs`, `src-tauri/src/db/search.rs`, `docs/product/query-language-support.md` | Current safety is source-specific: RDB DDL preview/confirm, RDB Safe Mode confirmation paths, Mongo safety confirmation, Redis typed confirmation keys, and fixture-backed Search destructive plans. There is no universal dry-run, admin audit log, role/user/permission UI, or security dashboard claim. |
| Credential and local-first privacy | `memory/engineering/architecture/state-management/memory.md`, `docs/product/README.md`, `docs/product/known-limitations.md`, `src-tauri/tests/keyring_new_user.rs` | Sensitive state stays local-first and connection export omits passwords; DuckDB file analytics public payloads redact absolute paths. Credential rotation, keyring diagnostics, broad key lifecycle smoke, and multi-user security flows are future work. |
| Security decision process | `.agents/skills/grill-with-memory/SKILL.md` | Password, credential, encryption, KDF, file-sharing, ACL, code-signing, supply-chain, or multi-user decisions need a threat-model handoff before option grilling. H7 does not lock new security architecture by documentation-only claim. |
| Dependency security | `src-tauri/deny.toml`, `scripts/hooks/pre-push-path-router.sh`, `docs/archives/risks/active-risk-register-2026-05-27.md` | `cargo deny check` runs on local Rust/full pre-push routes. It is not currently a PR/main GitHub Actions gate. Tracked advisory ignores remain bounded follow-ups, including `hickory-proto` through `mongodb 3.6.0` and `rsa 0.9` through `sqlx-mysql`. |
| A11y | Component tests using roles/labels and `.github/workflows/ci.yml` advisory contrast step | Routine VoiceOver/NVDA, focus-order, and 72-theme strict WCAG gates are not wired. Promote from the follow-up table only when a feature lane gives the check a concrete owner and budget. |
| Performance | `src-tauri/tests/snapshot_perf.rs`, targeted component perf smoke tests, `docs/product/known-limitations.md` | Snapshot and component-level perf checks do not equal routine SchemaTree/DataGrid FPS or latency gates. Promote FPS/latency budgets only with reproducible fixture size, runtime cost, and failure triage. |
| Link checking | This page, `docs/ROADMAP.md` | No internal-doc link checker is wired today. Add one only after archive routing settles and ownership is clear. |
| Platform smoke | `.github/workflows/e2e-smoke.yml`, `.github/workflows/ci.yml` | Runtime Happy Path is Ubuntu/Linux only. Rust unit/storage CI runs on macOS, but macOS desktop runtime smoke and Windows runtime smoke are deferred. |
| E2E isolation | `scripts/e2e-smoke-ci.sh`, `e2e/fixtures/seed-smoke.ts` | The current script seeds once and runs each wired spec with its own app data directory. Per-spec database fixture reset remains future work before broadening the smoke suite. |

## Frontend Test Quality

| Area | Follow-up |
|---|---|
| CSS assertions | Prefer role, label, or behavior assertions over class-name assertions. |
| Shortcut tests | Move Mod-Enter coverage toward browser/smoke coverage or a stable keymap seam. |
| Over-mocking | Reduce `MainArea` child over-mocking so prop contract drift is visible. |
| Theme icons | Use accessible labels or visual smoke for icon distinction instead of SVG-shape assertions. |
| Test data shape | Reuse production types/builders rather than duplicating `ConnectionConfigLike` shapes. |
| Drag and drop | Add behavior-level DnD coverage for dragged connection state. |

## Refactor Follow-Up

The code smell audit Part A candidates remain archived at
[`docs/archives/audits/code-smell-audit-2026-05-15.md`](../archives/audits/code-smell-audit-2026-05-15.md).
Promote candidates into sprint contracts only when they intersect current
feature work or remove active maintenance cost.
