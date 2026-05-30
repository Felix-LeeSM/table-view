# Table View 장기 로드맵

## 목적

미래 목표와 다음 승격 후보를 관리하는 전략 문서다. 현재 제품 상태는
`docs/product/README.md` 가 SOT이고, `docs/PLAN.md` 는 이 파일로 들어오는
호환 인덱스다.

본 문서는 sprint 번호를 배정하지 않는다. Implementation sprint 번호는
`docs/sprints/sprint-N/` 에서 배정한다. 기본은 실행 직전 배정이지만, 사용자가
sequencing 을 명시 요청하면 별도 sprint contract queue 에 번호와 의존성을 먼저
잡을 수 있다.

## 북극성

기존 데스크톱 DB 클라이언트 사용자가 핵심 워크플로우를 잃지 않고 Table View 로
전환할 수 있어야 한다.

핵심 워크플로우:

1. 연결
2. 탐색
3. 조회/쿼리
4. 편집
5. 안전한 검토/커밋
6. 문제가 생겼을 때 서버 상태 확인

전략 제약:

- Local-first desktop app. Credentials, history, settings, app state 는 사용자가
  명시적으로 export 하지 않는 한 로컬에 남긴다.
- RDBMS parity 를 먼저 닫는다: PostgreSQL, MySQL, MariaDB, SQLite, 그 다음
  DuckDB/file analytics.
- 기존 지원 DBMS 하나를 데스크톱 DB 클라이언트 수준의 query/workbench parity 까지 끌어올리는
  동안 추가 DBMS/runtime 승격은 시작하지 않는다. Full admin parity 는 scope 밖이고,
  작업은 DBMS lane 하나씩 진행한다. Active parity lane 이 끝날 때까지 Search 는
  fixture-backed 로 유지하고, MSSQL/Oracle 은 planned identity 로만 유지한다.
- Cassandra/Scylla, DynamoDB, graph DB, vector DB, stream source 는 workflow 와
  adapter contract 가 명확해질 때까지 candidate paradigm 으로만 둔다.
- SQL/mongosh completion/parser vocabulary 는 Rust/WASM 이 소유한다. TypeScript
  fallback mirror 는 compatibility 용도다.
- 위험한 write 는 preview, Safe Mode, 명시 confirmation 을 통과한다.
- 완료/비활성 planning 은 `docs/archives/` 로 이동한다. `docs/PLAN.md` 는
  roadmap/product 인덱스로만 유지한다.

## 지평 순서

| 지평 | 목표 | 이 순서인 이유 | 종료 신호 |
|---:|---|---|---|
| H1 | 현재 코드 -> data-source architecture 정렬 | RDBMS + DuckDB + Redis/Search/Graph/Vector 확장을 그냥 붙이면 switch sprawl 이 커진다. 추가 기능 전 기존 코드를 새 구조에 넣어야 한다. | 현재 `DatabaseType`/`Paradigm`/`ActiveAdapter`/workspace query/result path 가 profile, capability, query language, result envelope 로 감싸지고 사용자 회귀가 없다. |
| H2 | RDBMS parity | 현재 아키텍처가 가장 강한 영역이고, 사용자에게 보이는 gap 이 기존 DB 클라이언트 전환 blocker 다. | DBMS 하나씩 query/workbench parity gate 를 통과한 뒤 다음 DBMS/runtime 승격을 시작한다. |
| H3 | DuckDB + file analytics | Local-first file analytics 는 새 paradigm 없이 RDBMS 작업을 확장한다. | `.duckdb` raw SQL, registered local CSV/Parquet/JSON/NDJSON preview basics, source-scoped SELECT evidence, and documented file privacy/export boundary 가 green 이다. |
| H4 | RDBMS intelligence | ERD 와 향후 schema diff/data compare/migration preview 는 shared `SchemaGraph`/catalog input path 를 확장해 재사용한다. Duplicate catalog parsing 은 만들지 않는다. | Production ERD 는 schema/table/column cache 와 cached/fetched explicit index/constraint metadata 를 함께 쓰는 reusable `SchemaGraph` 를 사용한다. Dependency view, migration impact analysis, dense-view screenshot smoke 는 H4 matrix 의 future promotion gate 로 라우팅돼 있다. |
| H5 | First-class non-RDBMS | Redis/Valkey, Elasticsearch/OpenSearch, MongoDB 가 가장 명확한 non-RDBMS 사용자 workflow 를 덮는다. | MongoDB 는 whitelisted document workflow 로, Redis 는 backend KV first slice + key browser/value preview 로, Valkey 는 planned/unverified 로, Elasticsearch/OpenSearch 는 fixture-backed Search slice 로 support claim 이 정렬돼 있다. Search live HTTP 는 active parity lane 을 약화시키지 않고 promotion gate 를 통과할 때까지 deferred 다. |
| H6 | 더 넓은 paradigm | Cassandra, DynamoDB, graph DB, vector DB, stream source 는 active work 전 명확한 workflow proof 가 필요하다. | MSSQL/Oracle 은 planned RDBMS identity 계약으로, wider source 는 candidate-only 계약으로 정렬된다. Profile target, connection kind, language, catalog model, result envelope, safety policy, fixture strategy 가 문서화되고 runtime support claim 은 생기지 않는다. |
| H7 | 운영, 보안, 신뢰성 | 넓은 source support 는 관찰 가능하고 안전하며 반복 검증 가능해야 한다. | 현재 CI/hook/E2E/security/a11y/perf claim 과 future gate routing 이 실제 설정에 맞게 정렬된다. 새 routine gate 는 owner/runtime cost/actionability 가 잠긴 뒤에만 승격한다. |

## H1 완료 기준

H1 data-source architecture 정렬은 현재 기준선으로 닫는다. 종료 신호는 다음
SOT와 regression guard가 함께 소유한다.

| Gate | Current owner |
|---|---|
| Profile/capability foundation | `src/types/dataSource.ts`, `src/types/dataSource.test.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` |
| Adapter contract normalization | `src/types/adapterConformance.ts`, `src-tauri/src/models/data_source.rs`, `src-tauri/src/db/active.rs` |
| Query language ownership | `src/types/queryLanguage.ts`, `docs/product/query-language-support.md`, `memory/engineering/architecture/query-language/memory.md` |
| Result envelope boundary | `src/types/query.ts`, `src/types/query.resultEnvelope.test.ts`, `src/lib/tauri/query.ts` |
| Product/support claim boundary | `docs/product/README.md`, `docs/product/known-limitations.md`, `memory/engineering/architecture/data-source/memory.md` |
| Smoke/verification matrix | `docs/contributor-guide/testing-and-quality.md` |

남은 작업은 H1 gate 미완료가 아니라 다음 lane 의 깊이 작업이다. Server-native
result envelope wire format, `useQueryExecution` decomposition, DBMS별 live smoke
확대는 H2/H3/H5 quality follow-up 으로 라우팅한다.

## H2 진행 기준

H2 RDBMS parity 는 **PostgreSQL lane 을 먼저 선택**한다. 이 lane 이
runtime/parser/Safe Mode/completion/edit/fixture/E2E/support-claim gate 를
통과하기 전까지 MySQL/MariaDB/SQLite/DuckDB 를 full parity lane 으로
승격하지 않는다. MySQL/MariaDB/SQLite 작업은 현재 claim 정합성, typed capability
gate, fixture/smoke evidence routing 으로 제한한다.

| Gate | Current owner | H2 boundary |
|---|---|---|
| Active lane selection | `docs/ROADMAP.md`, #185 | PostgreSQL first. Full admin parity is out of scope. |
| RDBMS common smoke matrix | `docs/contributor-guide/testing-and-quality.md`, #240 | Current remote E2E smoke proves PostgreSQL only; other RDBMS lanes use unit/integration/fixture evidence until promoted. |
| MySQL version-aware capability gate | `src/types/dataSourceVersionCapabilities.ts`, `src/types/adapterConformance.ts`, #221 | CHECK/constraint catalog claim is enabled only with server version context (`>= 8.0.16`). |
| MariaDB delta/evidence gate | `src/types/dataSourceRuntime.ts`, `src/lib/sql/sqlDialectProfile.ts`, `src/types/adapterConformance.ts`, #222 | MariaDB keeps identity/profile and completion-only `RETURNING` delta; runtime support remains server-resolved until engine evidence is promoted. |
| MySQL/MariaDB support claim SOT | `docs/product/README.md`, `docs/product/known-limitations.md`, `docs/product/query-language-support.md`, #207 | Shared MySQL-family behavior and MariaDB-specific deltas are separated. |
| RDBMS docs-code consistency | `docs/product/**`, #198 | Product-visible claims stay narrower than implemented/evidenced behavior. |

H2 umbrella closure does not mean every RDBMS has full desktop-client parity. It
means the current support claims, capability gates, and smoke routing are aligned
so the next implementation lane can proceed without widening unsupported claims.

### PostgreSQL query/workbench parity lane

PostgreSQL lane closure for #186/#241 means the current claim, smoke, and gap
inventory is explicit enough to choose the next implementation slice. It does
not mean Table View has full PostgreSQL admin parity, arbitrary dialect
semantics, or a broad desktop E2E suite.

| Gate | Current owner | PostgreSQL boundary |
|---|---|---|
| Runtime execution | `src-tauri/src/db/postgres/queries.rs`, `src-tauri/src/db/postgres/schema.rs`, `src-tauri/tests/query_integration.rs`, `src-tauri/tests/cancel_pg.rs` | Connection, table data, raw SELECT/EXPLAIN row results, plan-only `EXPLAIN (FORMAT JSON)`, DML batches, query cancellation, and raw-query grid edit paths are active. psql meta-command execution, DB-level backup/restore/import/export, and PL/pgSQL body authoring are not parity claims. |
| Catalog/workbench | `src-tauri/src/db/postgres/schema.rs`, `src-tauri/tests/schema_integration.rs`, `src/components/schema/**`, `src/components/rdb/**` | Schemas, tables, views, functions, types, installed extensions, triggers, table stats, indexes, constraints, FKs, cached metadata, DataGrid, Structure, and ERD inputs have current evidence. Server activity, profiler, full stats dashboards, role/user/permission UI, extension management UI, schema diff, migration impact, and data compare stay future work. |
| Parser and Safe Mode | `src-tauri/sql-parser-core/**`, `src/lib/sql/sqlSafety.test.ts`, `src/components/query/QueryTab.safe-mode.test.tsx`, `src/components/query/QueryTab.warn-dialog.test.tsx`, `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`, `e2e/smoke/postgres-safe-mode.spec.ts` | The current subset classifies tested SQL slices, destructive/warn/info statements, bounded writes, raw query confirmations, grid edit confirmations, DDL preview, and EXPLAIN inner statements. Routine desktop smoke now covers PostgreSQL info/warn/destructive confirmation, raw DDL preview/confirm, and grid-edit preview/confirm paths. Full PL/pgSQL bodies, broad MERGE variants, arbitrary function-expression semantics, and arbitrary extension semantics are not modeled. |
| Completion and extensions | `src-tauri/src/db/postgres/schema.rs`, `src/lib/sql/sqlCompletionContext.ts`, `src/lib/sql/sqlCompletionWasm.test.ts`, `src-tauri/sql-parser-core/src/completion/**`, `e2e/smoke/postgres-extension-completion.spec.ts` | Installed extension inventory is fetched and passed to completion before curated known extension packs are enabled. Runtime smoke seeds `pgcrypto`, proves `pg_extension` detection, surfaces `GEN_RANDOM_UUID`, withholds absent `uuid-ossp` candidates, and keeps unknown installed extensions detected-but-unpacked. Completion must not invent extension symbols or imply parser/Safe Mode semantic validation. |
| Edit semantics | `src/components/datagrid/**`, `src/components/query/EditableQueryResultGrid*`, `src/components/datagrid/sqlGenerator.test.ts`, `src-tauri/src/db/postgres/queries.rs` | Row edits require key/projected identity and keep preview/commit/discard plus Safe Mode confirmation paths. Arbitrary query result mutation, bulk admin workflows, and full desktop-client edit parity stay future work. |
| Lightweight Explain | `src-tauri/src/db/postgres/schema.rs`, `src/lib/api/explain.ts`, `src/components/query/ExplainViewer.test.tsx`, `src/components/query/QueryTab.toolbar.test.tsx`, `src/lib/sql/sqlAst.test.ts`, `e2e/smoke/postgres-explain.spec.ts` | Lightweight plan inspection exists through backend, API, parser, safety, component, and routine desktop smoke evidence. It is not a full profiler/activity dashboard. |
| Cancellation workflow | `src-tauri/tests/cancel_pg.rs`, `src/components/query/QueryTab.execution.test.tsx`, `src/hooks/useQueryHistory.event-refetch.test.ts`, `e2e/smoke/postgres-cancellation.spec.ts` | Query toolbar cancellation reaches the backend token, renders a cancelled state without stale grid results, records cancelled tab history, and supports a clean retry. It is not a server activity/session dashboard or arbitrary backend session-management claim. |
| Fixture and E2E smoke | `e2e/fixtures/seed.sql`, `e2e/smoke/postgres.spec.ts`, `e2e/smoke/postgres-safe-mode.spec.ts`, `e2e/smoke/postgres-explain.spec.ts`, `e2e/smoke/postgres-extension-completion.spec.ts`, `e2e/smoke/postgres-cancellation.spec.ts`, `scripts/e2e-smoke-ci.sh` | Runtime Happy Path currently proves PostgreSQL connect -> browse seeded `users` -> edit -> query result, Safe Mode info/warn/destructive confirmation, raw DDL preview, grid-edit confirmation, Explain plan-inspection/source-label, installed-extension-gated completion for seeded `pgcrypto`, and query cancellation UI/history/retry behavior on Ubuntu. It does not cover structured DDL flows, broader history-source labeling, ERD, admin, arbitrary extension semantics, or profiler/activity scenarios. |
| Test coverage closure baseline | `docs/contributor-guide/testing-and-quality.md`, `src-tauri/tests/query_integration.rs`, `src-tauri/tests/schema_integration.rs`, `src-tauri/tests/cancel_pg.rs`, `src-tauri/src/commands/rdb/query.rs`, `src/lib/sql/sqlSafety.test.ts`, `src/lib/sql/sqlCompletionContext.test.ts`, `src/lib/sql/sqlCompletionRequest.test.ts`, `src/lib/sql/sqlCompletionWasm.test.ts`, `src-tauri/sql-parser-core/src/completion/completion_tests.rs` | #528 recheck maps runtime/query/edit or source-equivalent backend tests, parser/safety and unsupported-boundary tests, autocomplete vocabulary/context tests, fixture/live evidence, and smoke routing. Fixture-only evidence remains non-runtime evidence until the CI smoke script wires it. |
| Support claim SOT | `docs/product/README.md`, `docs/product/query-language-support.md`, `docs/product/known-limitations.md` | Product-visible PostgreSQL claims must stay narrower than the evidence above until new implementation slices add matching tests and smoke routing. |

### SQLite file DBMS parity lane

SQLite lane closure for #196/#242 means the file-DBMS write/parity,
extension-boundary, and smoke inventory is explicit. It does not mean SQLite has
structured DDL parity, automatic ALTER rebuilds, extension capability semantics,
or a routine desktop E2E smoke path.

| Gate | Current owner | SQLite boundary |
|---|---|---|
| File connection contract | `src/types/dataSource.ts`, `src/types/dataSource.test.ts`, `src-tauri/src/db/sqlite/connection.rs`, `src-tauri/tests/sqlite_connection_command.rs`, `src/components/connection/forms/SqliteFormFields.test.tsx` | SQLite is a file-backed RDBMS with absolute-path validation, create-new-file support, read-only mode, and internal app-state DB rejection. It has no server host/auth, switch-database, or multi-namespace parity claim. |
| Runtime query/write path | `src-tauri/src/db/sqlite/queries.rs`, `src-tauri/src/db/sqlite/batch.rs`, `src-tauri/src/db/sqlite/queries_tests.rs`, `src-tauri/src/db/sqlite/batch_tests.rs`, `src-tauri/tests/sqlite_browse_query_adapter.rs` | Read queries and writable-file DML run through the SQLite adapter. Multi-statement DML batches are transactional, dry-run rolls back, cancellation is wired, and read-only files reject writes. Raw SQL DDL is adapter-rejected today. |
| Catalog/workbench | `src-tauri/src/db/sqlite/connection.rs`, `src-tauri/tests/sqlite_browse_query_adapter.rs`, `src/components/schema/SchemaTree.dbms-shape.test.tsx`, `src/components/schema/SchemaTree.rowcount.test.tsx` | Current catalog evidence covers `main`, flat table browsing, exact row counts, columns, FKs, indexes, views, and view columns. Schemas, functions, triggers, full constraints, table stats parity, and richer admin/workbench surfaces are not claimed. |
| Edit semantics | `src/types/dataSource.ts`, `src/components/datagrid/sqlGenerator.test.ts`, `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`, `src-tauri/src/db/sqlite/queries.rs` | Row edit support is scoped to writable files and key/projected row identity. SQLite identifier quoting and scalar row writes have evidence; nested JSON edits, arbitrary query-result mutation, bulk/admin edit workflows, and read-only writes are outside current support. |
| DDL and ALTER rebuild | `src-tauri/src/db/sqlite.rs`, `src-tauri/src/db/sqlite/queries_tests.rs`, `src-tauri/src/db/sqlite/batch_tests.rs`, `docs/product/known-limitations.md` | Structured DDL UI/runtime parity is disabled for SQLite. Unsupported ALTER behavior is explicit rejection; automatic rebuild strategy requires a future ADR-backed implementation slice. |
| Parser, Safe Mode, and completion | `src-tauri/sql-parser-core/src/completion/completion_tests.rs`, `src/lib/sql/sqlCompletionRequest.test.ts`, `src/lib/sql/sqlSafety.test.ts`, `docs/product/query-language-support.md` | Completion exposes SQLite keywords/functions and sqlite-cli dot-command vocabulary as suggestions. Parser/Safe Mode remain bounded SQL support; sqlite-cli dot commands are not executed, and extension/capability semantics are not validated client-side. |
| Fixture and smoke | `e2e/fixtures/seed.sqlite.sql`, `scripts/fixtures/**`, `scripts/e2e-pre-smoke-release-gate.ts`, `scripts/e2e-smoke-ci.sh` | SQLite has deterministic fixture files and pre-smoke fixture validation, but Runtime Happy Path does not run a SQLite desktop spec today. Future promotion needs a wired smoke for file create/open, browse, read query, writable DML/row edit, read-only rejection, DDL rejection, extension-boundary non-claim, and app-state DB rejection. |
| DuckDB separation | `docs/ROADMAP.md`, `docs/product/query-language-support.md`, `docs/product/known-limitations.md` | DuckDB/file analytics stays in the H3 lane. SQLite parity work must not widen DuckDB file analytics claims. |

## H3 진행 기준

H3 DuckDB/file analytics 는 **local-first file analytics 를 RDBMS + `file`
connection kind 안에서 닫는 정합성 gate**다. DuckDB 를 별도 file-SQL paradigm 으로
승격하지 않고, `.duckdb` raw SQL, registered local file preview, source-scoped
SELECT evidence, extension/external-file blocklist, privacy/export boundary 를 현재
지원 claim 에 맞춘다.

| Gate | Current owner | H3 boundary |
|---|---|---|
| DuckDB profile/modeling | `src/types/dataSource.ts`, `src/types/dataSource.test.ts` | DuckDB is `rdb` + `file`; profile presence does not imply full write/DDL/admin parity. |
| `.duckdb` raw SQL path | `src-tauri/src/db/duckdb.rs`, `src-tauri/tests/duckdb_browse_query_adapter.rs` | Statement-level raw SQL and table reads are active; structured DDL/write UI parity is not claimed. |
| File analytics preview basics | `src/lib/tauri/fileAnalytics.test.ts`, `src-tauri/tests/duckdb_file_analytics.rs` | CSV/Parquet/JSON/NDJSON registration and preview are active-session local-file flows. |
| Source-scoped SELECT wrapper | `src-tauri/tests/duckdb_file_analytics.rs` | Backend read-only SELECT evidence exists; full query editor parity, history, and import workflows are not claimed. |
| Extension/external-file gate | `src-tauri/src/db/duckdb.rs`, `docs/product/query-language-support.md` | Extension install/load, extension helper functions, `COPY`, `ATTACH`/`DETACH`, sensitive capability settings, replacement scans, and raw external-file functions are adapter-blocked. |
| Smoke/verification matrix | `docs/contributor-guide/testing-and-quality.md` | No DuckDB desktop E2E smoke is claimed today; future E2E promotion must cover the matrix before support claims widen. |

H3 umbrella closure means DuckDB/file analytics support claims, runtime gates, and
verification routing are aligned. It does not mean DuckDB has full desktop-client
parity or extension semantics.

## H4 진행 기준

H4 RDBMS intelligence 는 ERD/schema graph claim 과 검증 라우팅을 현재 구현
상태에 맞추는 정합성 gate 다. Production ERD 는 schema-store cache 와
cached/fetched explicit index/constraint metadata 를 `SchemaGraph` input 으로
쓴다. Future dependency view, migration impact, schema diff, data compare 는
이 shared graph/catalog path 를 재사용해야 하며 duplicate catalog parsing 은
만들지 않는다.

| Gate | Current owner | H4 boundary |
|---|---|---|
| Schema metadata cache | `src/stores/schemaStore.ts`, `src/stores/schemaStore.tableMetadataCache.test.ts`, `src/stores/schemaStore.clearForConnection.test.ts` | schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers 가 current cache owner 범위다. |
| Production ERD graph input | `src/components/schema/SchemaErdPanel.tsx`, `src/lib/schemaGraphSnapshot.ts`, `src/components/schema/SchemaErdPanel.test.tsx`, `src/lib/schemaGraphSnapshot.test.ts` | Visible-table indexes/constraints are fetched when missing and passed into `SchemaGraph`; `ColumnInfo` PK/FK/CHECK metadata remains a synthetic fallback. |
| Reusable graph model | `src/lib/schemaGraph.ts`, `src/lib/schemaGraphRelationships.ts`, `src/components/schema/SchemaErdLayout.ts`, `src/components/schema/SchemaErdRenderer.test.tsx` | Graph extraction, relationship normalization, layout/search/selection, and renderer controls are reusable beyond one visual panel. |
| FK navigation boundary | `src/components/datagrid/DataGridTable.fk-navigation.test.tsx`, `docs/product/known-limitations.md` | Current FK row navigation is the DataGrid cell/icon path. ERD selection/search/zoom/focus/highlight are local diagram interactions, not row navigation claims. |
| Future intelligence surfaces | `memory/engineering/architecture/data-source/memory.md`, this roadmap | Dependency view, migration impact, schema diff, and data compare must extend `SchemaGraph`/catalog input before product claim promotion. |
| Smoke/verification matrix | `docs/contributor-guide/testing-and-quality.md` | No ERD desktop/narrow screenshot E2E smoke is claimed today; future promotion requires the H4 smoke inventory. |

H4 umbrella closure means ERD/SchemaGraph support claims, reusable graph ownership,
and smoke routing are aligned. It does not mean dependency view, migration impact,
schema diff, data compare, or dense-view E2E smoke has shipped.

## H5 진행 기준

H5 non-RDBMS 는 **Document/KV/Search claim 을 현재 구현과 증거에 맞추는 정합성
gate**다. H5 closure 는 non-RDBMS 전체 first-class parity ship 을 뜻하지 않는다.

| Gate | Current owner | H5 boundary |
|---|---|---|
| MongoDB whitelist workflow | `src/types/dataSource.ts`, `src/lib/mongo/**`, `src-tauri/tests/mongo_integration.rs`, `e2e/smoke/mongodb.spec.ts` | Connection, catalog, whitelisted query/edit/bulk/index/validator slices, cancellation, and destructive Safe Mode gates are current support. Arbitrary JavaScript, shell helpers, multiple statements, cross-db shell navigation, version/deployment gates, and native document-first panels remain unsupported. Standalone transaction-style paths must fail clearly instead of silently committing partial work. |
| Redis KV first slice | `src-tauri/src/db/redis/**`, `src-tauri/tests/redis_integration.rs`, `src/lib/tauri/kv.ts`, `src/components/workspace/KvSidebar.tsx` | Backend KV primitives cover database/key scan, typed value reads, guarded string set, delete confirmation, TTL expire/persist, and bounded stream read. Product UI claim remains key browser/value preview; full value editor, TTL/write/stream UI, Redis command query editor, cluster/pubsub/modules/consumer-group flows are future work. |
| Valkey delta | `docs/product/README.md`, `docs/product/known-limitations.md` | No active `DatabaseType`, profile, runtime, fixture, or live evidence exists. Redis compatibility is a future hypothesis, not a support claim. |
| Search fixture slice | `src-tauri/src/db/search.rs`, `src-tauri/src/db/fixtures.rs`, `src-tauri/tests/fixture_harness.rs`, `src/lib/tauri/search.ts`, `src/components/search/SearchResultView.tsx` | Elasticsearch/OpenSearch fixture-backed identity/catalog/mapping/template/search result and destructive plan contracts exist. Live HTTP connection is unsupported. |
| Search live HTTP promotion | `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, `docs/contributor-guide/testing-and-quality.md` | Future promotion must cover connection UI, auth/TLS, product/version/distribution detection, catalog/search execution and response parsing, admin destructive policy, observability/error surface, CI fixture/live smoke, and active RDBMS lane freeze. |
| Non-RDBMS smoke matrix | `docs/contributor-guide/testing-and-quality.md` | Current desktop E2E claim covers MongoDB only. Redis and Search E2E scenarios are inventoried as future promotion gates; Valkey has no smoke claim. |

H5 umbrella closure means support claims, runtime contracts, and smoke routing are
aligned for non-RDBMS sources. It does not mean Valkey runtime support, Redis full
UI/editor parity, Search live HTTP, or MongoDB full-support parity has shipped.

## H6 진행 기준

H6 wider source 는 **planned/candidate contract 정합성 gate**다. MSSQL/Oracle 은
이미 `DatabaseType`/profile identity 가 있는 planned RDBMS 이고, Cassandra/Scylla,
DynamoDB, graph, vector, stream 은 아직 active `DatabaseType`/profile/runtime 이
없는 candidate 다. H6 closure 는 어떤 새 runtime support 도 출시하지 않는다.

| Gate | Current owner | H6 boundary |
|---|---|---|
| MSSQL planned RDBMS identity | `src/types/connection.ts`, `src/types/dataSource.ts`, `src/types/dataSourceRuntime.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` | `mssql` has `server` connection kind, `sql` language, `rdb` catalog, `tabular` result, `rdb-default` safety, and `declared-rdb` backend identity. Capabilities are empty; connection UI, runtime query/catalog/edit, T-SQL parser/completion, SQL Server auth/TLS/encryption/instance behavior, and live evidence are not claimed. |
| Oracle planned RDBMS identity | `src/types/connection.ts`, `src/types/dataSource.ts`, `src/types/dataSourceRuntime.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` | `oracle` has `server` connection kind, `sql` language, `rdb` catalog, `tabular` result, `rdb-default` safety, and `declared-rdb` backend identity. Capabilities are empty; connection UI, runtime query/catalog/edit, Oracle SQL/PL/SQL parser/completion, service/SID/wallet/TNS behavior, and live evidence are not claimed. |
| Wider candidate workflow proof | `memory/engineering/architecture/data-source/memory.md`, `memory/engineering/architecture/data-source/adding/memory.md`, this roadmap | Promotion requires workflow value, profile target, connection kind, language, catalog model, result envelope, safety policy, fixture strategy, conformance scope, and docs/memory routing before implementation. |
| Candidate source contract inventory | this roadmap, `docs/product/README.md`, `docs/product/query-language-support.md` | Candidate targets are inventoried below. They are profile targets, not active profile entries. |
| Parser/completion/runtime non-claim | `docs/product/query-language-support.md`, `docs/product/known-limitations.md` | Deferred language ids do not create active parser, completion, connection, query, catalog, edit, or E2E claims. Runtime changes must land in later source-specific PRs with matching smoke evidence. |
| H6 smoke matrix | `docs/contributor-guide/testing-and-quality.md` | Current E2E smoke proves PostgreSQL and MongoDB journeys only. MSSQL/Oracle and wider candidates have future smoke inventories, not current desktop E2E claims. |

Candidate target inventory:

| Candidate | Profile target | Connection kind | Language | Catalog model | Result envelope | Safety / fixture plan |
|---|---|---|---|---|---|---|
| Cassandra/Scylla | `wide-column` | `cluster` | `cql` | keyspace/table/partition/clustering | `tabular` | partition and expensive-read guardrails; Cassandra/Scylla fixture or testcontainer |
| DynamoDB | `cloud-document` | `cloud-api` | `partiql` or native API decision | table/keySchema/GSI/LSI | `document`, `tabular` | access-pattern and cost guardrails; DynamoDB Local/emulator or bounded mock |
| Graph | `graph` | `server` | Cypher/GQL/Gremlin decision | label/relationship/property/index | `graph`, `path`, `tabular` | destructive traversal/write guardrails; fixture graph |
| Vector | `vector` | `server`; cloud providers need separate `cloud-api` profile decision | `vector-query` or provider filter DSL | collection/vectorSchema/payloadIndex | `vectorNeighbors` | bounded search/write/delete guardrails; embedded/mock or container fixture |
| Stream | `stream` | `cluster` | `stream-command` or API decision | topic/partition/consumerGroup/schema | `streamRecords`, `metrics` | offset/consumer/destructive guardrails; Kafka/Redpanda fixture |

Promotion order for wider candidates is decided by workflow value and contract
readiness: clear user workflow first, then adapter-family fit, language/core
ownership, fixture/live evidence, and safety risk. Candidate rows do not imply
implementation order.

H6 umbrella closure means planned/candidate support claims, contracts, and smoke
routing are aligned. It does not mean MSSQL, Oracle, Cassandra/Scylla, DynamoDB,
graph, vector, or stream runtime support has shipped.

## H7 진행 기준

H7 운영/보안/신뢰성은 **자동 gate 와 support claim 을 실제 설정에 맞추는 정합성
gate**다. H7 closure 는 a11y/perf/link-check/platform smoke 가 routine blocking
gate 로 새로 승격됐다는 뜻이 아니다. 새 gate 는 active feature lane 을 실제로 막고,
owner 와 runtime cost 가 명확하며, failure triage 경로가 있을 때만 승격한다.

| Gate | Current owner | H7 boundary |
|---|---|---|
| PR/main CI gates | `.github/workflows/ci.yml`, `.github/workflows/e2e-smoke.yml` | Remote blocking checks are Frontend Checks, Rust Unit And Storage Tests, Integration Tests (Docker), and Runtime Happy Path. Theme contrast is advisory. Link-check, full a11y, perf, and cross-platform runtime smoke are not routine blocking gates. |
| Local hook gates | `.githooks/*`, `lefthook.yml`, `scripts/hooks/pre-push-path-router.sh`, `memory/workflow/git-policy/memory.md` | Pre-push always checks signed commits and TDD-cycle, then routes outgoing paths: docs-only skips TS/Rust; frontend/Rust paths run their stacks; workflow or unknown paths run full checks. Hook bypass, unsigned commits, pull/reset recovery hazards, and force-push remain forbidden by policy/hook. |
| Runtime E2E smoke | `scripts/e2e-smoke-ci.sh`, `wdio.smoke.conf.ts`, `e2e/smoke/postgres.spec.ts`, `e2e/smoke/postgres-safe-mode.spec.ts`, `e2e/smoke/postgres-explain.spec.ts`, `e2e/smoke/postgres-extension-completion.spec.ts`, `e2e/smoke/postgres-cancellation.spec.ts`, `e2e/smoke/mongodb.spec.ts` | GitHub Runtime Happy Path builds the app on Ubuntu and executes the wired PostgreSQL and MongoDB smoke specs only. Other specs under `e2e/smoke/**` are not automatically part of the remote runtime gate unless the smoke script wires them. |
| Security/destructive policy | `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, `.agents/skills/grill-with-memory/SKILL.md` | Current destructive protections are source-specific preview/confirm/Safe Mode/typed confirmation paths. There is no universal admin/security dashboard, role/user/permission UI, credential rotation UI, or global audit-log claim. Security-impacting decisions follow the grill-with-memory threat-model handoff before option selection. |
| Credential/privacy boundary | `memory/engineering/architecture/state-management/memory.md`, `docs/product/README.md`, `docs/product/known-limitations.md` | Table View remains local-first. Connection export omits passwords, imported connections require password re-entry, and local file analytics public payloads redact absolute paths. Broader credential/key lifecycle smoke is future work. |
| A11y/perf/link-check/platform smoke | `docs/contributor-guide/testing-and-quality.md`, `.github/workflows/ci.yml` | Existing component/unit checks and advisory theme contrast do not equal routine screen-reader, FPS/latency, link-check, macOS runtime, or Windows runtime gates. Promote only when a lane needs a concrete owner and budget. |

H7 umbrella closure means ops/security/reliability documentation, smoke matrices,
and known limitations no longer overstate the current automated gate surface. It
does not mean all H7 implementation gaps have shipped.

## 트랙 맵

| 트랙 | 장기 방향 | 현재 기준 |
|---|---|---|
| Data-source architecture | 새 DBMS/support surface 는 profile, capability, adapter, language, catalog, result envelope, safety contract 를 통해 들어온다. | `memory/engineering/architecture/data-source/memory.md`, `memory/engineering/architecture/data-source/adding/memory.md`, ADR 0046 |
| RDBMS runtime | 불확실한 paradigm 을 넓히기 전에 PostgreSQL, MySQL, MariaDB, SQLite, DuckDB/file analytics support 를 강하게 만든다. | `docs/product/README.md`, historical phase notes in `docs/archives/phases/retired/phase-18.md` and `docs/archives/phases/retired/phase-19.md` |
| Non-RDBMS runtime | Redis/Valkey 와 MongoDB 는 runtime slice 가 있다. Elasticsearch/OpenSearch 는 live HTTP 전까지 fixture-backed 다. Cassandra/Scylla, DynamoDB, graph, vector, stream 은 gated candidate 다. 새 runtime promotion 은 active one-DBMS parity lane 뒤로 둔다. | `memory/engineering/architecture/data-source/memory.md`, `docs/phases/phase-28.md` |
| Language core | 가능한 범위에서 Rust/WASM 이 hot-path parse/completion vocabulary, context routing, capability gate 를 소유한다. | `memory/engineering/architecture/query-language/memory.md`, ADR 0045, `docs/product/query-language-support.md`, `docs/archives/phases/completed/phase-31.md` |
| Query editor | Query surface 는 legacy `queryMode` 가 아니라 `queryLanguage` 와 workbench paradigm 으로 고른다. | `memory/engineering/architecture/data-source/memory.md`, `docs/phases/phase-28.md` Slice A |
| Data editing | Preview/commit/discard, bulk operation, paradigm 별 edit semantics. | completed Phases 22-23, Phase 28 |
| Schema / DDL | RDB DDL parity 는 대부분 닫혔고, ERD/schema graph 가 다음 reusable intelligence layer 다. | completed Phases 24-27, `memory/engineering/architecture/data-source/memory.md` |
| Operations | Core parity 이후 Explain/activity/stats/server info/profiler surface 를 다룬다. | `docs/product/known-limitations.md`, `docs/contributor-guide/testing-and-quality.md` |
| Security | Credential/key handling, role/user management, auth mechanism expansion, destructive action policy. | `.agents/skills/grill-with-memory/SKILL.md`, `docs/contributor-guide/testing-and-quality.md` |
| App state | SQLite-backed durable app state, query history, settings, keyring, cross-window sync. | `memory/engineering/architecture/state-management/memory.md` |
| Quality | CI, E2E smoke, perf/a11y baseline, testing reliability, refactor backlog burn-down. | `docs/contributor-guide/testing-and-quality.md`, `docs/archives/audits/code-smell-audit-2026-05-15.md` |

## Open Follow-Up Queue

Open risks are no longer tracked in a standalone active risk register. Route each
item to the document that owns the decision:

- Product-visible support boundaries and known limitations:
  [`docs/product/known-limitations.md`](product/known-limitations.md).
- Developer-facing verification gaps:
  [`docs/contributor-guide/testing-and-quality.md`](contributor-guide/testing-and-quality.md).
- Historical risk IDs and prior register snapshots:
  [`docs/archives/risks/active-risk-register-2026-05-27.md`](archives/risks/active-risk-register-2026-05-27.md).

Near-term follow-up groups:

| Group | Follow-up |
|---|---|
| RDBMS parity | Keep PostgreSQL as the first query/workbench parity lane until a focused implementation slice promotes the next PostgreSQL gap with matching tests and smoke routing. Keep SQLite file-DBMS work scoped to writable-file DML, PK row edits, explicit DDL rejection, and future smoke promotion until structured DDL/ALTER rebuild and extension semantics have their own implementation evidence. Keep MySQL/MariaDB version-aware feature gates on the server-version-aware conformance path, and add operation-level UI/runtime consumers only with matching evidence. Add MariaDB engine fixture evidence or keep support claims narrowed. |
| Query language widening | Widen SQL/Mongo client semantic support by tested slices: broader MySQL/MariaDB routine expressions, SQLite extension/capability semantics, server-version/capability gates, Mongo version/deployment gates, and extension-aware completion packs. DuckDB extension install/load and external-file capability settings are currently blocked by adapter gates; future DuckDB extension support needs detected capability evidence before completion/runtime claims widen. PostgreSQL completion packs must consume installed extension inventory before enabling curated extension-specific candidates. |
| Query/result boundary | Keep typed envelopes as the UI-facing boundary. Future hardening can make backend RDBMS IPC emit native `tabular` envelopes instead of normalizing legacy `QueryResult` at the Tauri wrapper. |
| ERD/schema graph | 현재 schemaStore cache owner 범위는 schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers 이다. Production ERD/`SchemaGraph` input 은 schema/table/column cache 와 cached/fetched explicit index/constraint metadata 를 함께 쓰며, column-level FK info 는 synthetic fallback 으로 남아 있다. FK navigation 은 현재 DataGrid cell/icon path 이며 ERD interaction claim 이 아니다. Follow-up 은 shared `SchemaGraph`/catalog input path 를 확장해 dependency view, migration impact analysis, schema diff, data compare, dense-view screenshot smoke 를 연결하는 것이다. Duplicate catalog parsing 금지. |
| Redis/Valkey | Redis first slice is backend KV primitives plus key browser/value preview UI. Define contracts and evidence for full value editor, TTL/write/stream UI, Redis command query editor, cluster, pub/sub, modules, consumer-group management, and Valkey-specific profile/runtime/fixture/live evidence before broader support claims. |
| MongoDB | Keep support to tested whitelisted document workflows. Future widening needs version/deployment gates and safe native document-first panels; arbitrary JavaScript/shell behavior remains unsupported unless a new decision changes the policy. |
| Search | Keep Elasticsearch/OpenSearch fixture-backed. Promote live HTTP only after connection UI, auth/TLS, product/version detection, catalog/search execution, response parsing, admin/destructive policy, observability/error surface, and product-specific delta contracts are explicit. |
| MSSQL/Oracle | Keep both as capability-empty declared RDBMS identities. Future promotion must split SQL Server and Oracle connection/auth/dialect/catalog/safety contracts and add fixture/live evidence before any support claim widens. |
| Wider source candidates | Keep Cassandra/Scylla, DynamoDB, graph, vector, and stream as candidate-only. Do not add active profile/runtime/parser/completion claims until workflow value and the full adding-data-source contract are locked. |
| Security / ops policy | Keep destructive/admin/security claims source-specific until a threat-model handoff and source-specific implementation own preview/confirm/dry-run/auditability. Users/roles/auth mechanism UI waits until source order is clear. |
| Quality gates | Promote a11y, perf, E2E isolation, link checking, dependency security CI, and platform smoke gaps from `testing-and-quality.md` only when they block an active feature lane and have owner/runtime-cost/triage paths. |
| Refactor backlog | Promote code-smell audit candidates only when they intersect active feature work or remove current maintenance cost. Near-term candidates: move runtime-like lib/hook store orchestration into `src/lib/runtime/**`, replace legacy direct `setState` with store actions, and clean up dialog layout/preset drift without reintroducing the retired preset mandate. |

## 순서 규칙

1. 새 partial workflow 를 추가하기 전에 눈에 보이는 미완성 workflow 를 먼저 닫는다.
2. connect/browse/query 만 노출하는 runtime 을 하나 더 붙이는 것보다, 기존 runtime
   깊이를 우선한다.
3. Runtime promotion freeze: Search live HTTP, MSSQL, Oracle, 기타 새 DBMS lane 은
   현재 지원 DBMS 하나가 query/workbench parity lane 을 통과할 때까지 기다린다.
4. Query/workbench parity 범위는 SQL/MQL execution, parser/Safe Mode, completion,
   edit semantics, fixtures, e2e, support claim, dry-run 근처의 lightweight
   EXPLAIN/plan inspection 이다. Full admin surface 는 별도 선택 전까지 scope 밖이다.
5. Extension/plugin/module completion 은 detected capability pack 을 쓴다. DB 에서
   설치된 extension/module/plugin 을 발견하고, 발견된 known capability 에만 curated
   completion pack 을 켠다. Unknown capability 는 suggestion 을 지어내지 않고
   detected-but-unpacked 로 표시한다.
6. Parser/Safe Mode/completion support 는 명시돼야 한다. 현재 product-facing
   unsupported boundary 는 `docs/product/query-language-support.md` 에 둔다.
7. 새 DBMS 는 구현 시작 전
   `memory/engineering/architecture/data-source/adding/memory.md` 를 만족해야 한다.
8. 새 long-lived state 는 다음을 정의해야 한다:
   - source of truth
   - durability
   - privacy/export behavior
   - reset-to-default affordance
   - cross-window sync behavior
9. Shared UI 를 바꾸는 feature work 는 그 surface 를 공유하는 모든 paradigm 에 대한
   regression scope 를 포함해야 한다.
10. 완료/비활성 planning 은 archive 로 이동한다. `docs/PLAN.md` 는
   roadmap/product 인덱스로만 유지한다.

## 결정 게이트

Roadmap item 을 active implementation 으로 승격하기 전 필요한 것:

| Gate | 필요 산출물 |
|---|---|
| 사용자 논의 | 구현 시작 전 scope, order, non-goal 합의. |
| SOT check | `docs/product/README.md`, `docs/product/known-limitations.md`, `memory/engineering/**`, contributor docs 를 업데이트하거나 변경 없음으로 선언. |
| Follow-up check | 현재 제한은 product, 미래 work item 은 roadmap, 구조 제약은 `memory/engineering/architecture`, 개발/운영 제약은 `memory/engineering` 또는 contributor docs, 과거 사건은 archives 로 라우팅한다. |
| Contract check | 코딩 전 acceptance criteria 와 verification command 를 확정. |
| Architecture check | 지속 결정 변경 또는 이전 방향 뒤집기일 때만 ADR 필요. |
| Archive check | 오래된 draft/spec docs 는 archive 로 이동하거나 historical context 로 link. |

## 열린 질문

| 영역 | 질문 | 결정 전 기본값 |
|---|---|---|
| MariaDB | MySQL adapter reuse 를 단순하게 유지할 수 있나? | Dialect flag 로 reuse. Evidence 있을 때만 split. |
| SQLite DBMS | Unsupported `ALTER TABLE` 을 disable 할지 auto-rebuild 할지? | ADR 이 rebuild 를 선택하기 전까지 disable + tooltip. |
| DuckDB | File analytics 를 RDBMS 로 볼지 separate file-sql paradigm 으로 볼지? | Evidence 가 split 을 요구하기 전까지 RDBMS + `file` connection kind. |
| Redis/Search | Redis full UI/editor parity 와 Search live HTTP 를 언제 승격할 수 있나? | Active one-DBMS parity lane 이후만. 그 뒤 Search live HTTP 가 MSSQL/Oracle 보다 먼저 온다. |
| 더 넓은 paradigm | Cassandra/DynamoDB/graph/vector/stream 중 무엇을 먼저 승격하나? | H6 기본값은 candidate-only. Workflow value, contract readiness, fixture/live evidence, safety risk 가 분명해질 때까지 승격 금지. |
| App state | State-management migration 은 언제 재개하나? | DB support 작업이 storage/schema surface 와 충돌하지 않을 때. |
| Security | Users/roles/auth mechanism UI 는 언제 추가하나? | RDBMS/DuckDB/non-RDBMS source order 가 명확해진 뒤. |

## 승격 후보

다음 작업을 고를 때 이 목록과 `docs/phases/phase-32.md` 부터 본다. Active lane 이
선택되기 전까지 sprint sequence 를 새로 만들지 않는다.

다음 승격 후보 순서:

1. One-DBMS query/workbench parity ladder. 지원 DBMS lane 하나만 골라
   runtime/parser/completion/edit/fixture/e2e/support-claim gap 을 닫고 다음 lane 을
   고른다. 고정 lane 순서: PostgreSQL -> MySQL/MariaDB -> SQLite/DuckDB -> MongoDB.
2. PostgreSQL query/workbench parity hardening.
3. MySQL-family semantic widening + MariaDB engine evidence/delta hardening.
4. SQLite DBMS write/parity + DuckDB file analytics hardening.
5. MongoDB whitelist/full-support parity hardening.
6. RDBMS ERD / `SchemaGraph`.
7. Redis/Valkey parity hardening.
8. Elasticsearch/OpenSearch live HTTP promotion.
9. MSSQL + Oracle enterprise RDBMS lane.

이 순서를 바꾸면 이 파일을 업데이트한다. 현재 제품 상태가 달라지는 변경이면
`docs/product/README.md` 도 함께 업데이트한다.
