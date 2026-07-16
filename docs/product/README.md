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
  DuckDB, MSSQL catalog/query runtime, MongoDB, Redis, Valkey, Elasticsearch,
  OpenSearch, and Oracle bounded catalog/query/cancel/tabular/edit-row runtime.
- RDBMS workbench: catalog/tree browse, tabular result rendering, raw query path,
  bounded DML/row-edit path, source-specific safety confirmation. PostgreSQL 이
  routine desktop smoke-backed 주 lane 이고 MySQL/MariaDB 는 runtime smoke
  baseline 이 있다. SQLite 는 deterministic file workflow smoke baseline 이 있다.
  DuckDB 는 `.duckdb` Runtime Happy Path smoke 와 registered local file
  analytics Runtime Happy Path smoke/source-scoped evidence/history/privacy
  boundary 를 분리해서 좁힌다.
- SQLite/DuckDB file workflow: local file open/create/browse/query 중심. SQLite
  는 writable-file DML 과 key-projected row edit, DuckDB 는 `.duckdb`
  catalog/read query 와 registered local CSV/Parquet/JSON/NDJSON preview,
  source-scoped SELECT, global editor SELECT slice 를 지원한다.
- MongoDB workflow: whitelisted mongosh/MQL document query/edit/admin slices 와
  destructive Safe Mode path 를 지원한다. arbitrary JavaScript shell 은 지원하지
  않는다.
- Redis workflow: connection/profile, database/key scan, typed value preview,
  selected-key bounded stream reader, bounded value mutation panel, backend
  guarded KV primitives, selected command allowlist/dispatch with tabular
  result projection, and bounded Redis command vocabulary completion with
  current-DB/type-filtered key suggestions 이 있다.
  Runtime Happy Path smoke covers connect/scan/preview/GET plus guarded string
  write, TTL, and delete controls. Full CLI/admin parity, language-core parser
  ownership, consumer-group stream UI, cluster/pubsub/modules, Valkey full
  compatibility, and multi-key destructive command execution remain follow-up.
- Valkey workflow: connection/profile, database/key scan, typed value preview,
  selected-key bounded stream reads, bounded Redis-compatible command query
  execution, bounded command completion for proven local-runtime rows, and the
  same string plus hash/list/set/zset KvMutationPanel write controls as Redis
  (#1075) are active. Runtime Happy Path smoke covers
  connect/scan/preview/GET/HGETALL/XRANGE plus bounded SET/EXPIRE DML summaries
  with readback/TTL verification and destructive/unsupported command guards.
  Hash/list/set/zset writes and full Redis compatibility are not claimed.
- Elasticsearch/OpenSearch: embedded Search fixture contract plus live Search
  runtime support 가 있다. Search uses an index-catalog-first workbench boundary:
  the initial sidebar loads index/alias/data-stream catalog summaries, while
  mappings/settings/analyzers/templates/field paths, field stats, and samples
  stay selected-index lazy detail fetches. Elasticsearch 는 live HTTP
  root-probe connection test, live catalog, bounded live `_search` query
  dispatch, backend Search DSL validator, Runtime Happy Path smoke, scoped
  redacted HTTP error surfacing, and delete-by-query plan estimates 로
  URL/auth/TLS, product/version detection, query/filter/aggs preflight,
  hits/fields/highlights/sort/aggs response parsing, and live `_delete_by_query`
  execution behind a Safe Mode confirmation 을 지원한다. OpenSearch 는
  URL/auth/TLS live
  root-probe connection test, product/version/distribution detection,
  Elasticsearch endpoint rejection, auth/network error surfacing, and live
  catalog reads for indexes, aliases, data streams, mappings,
  settings/analyzers, composable/legacy templates, field paths, bounded live
  `_search` dispatch, hits/source/fields/highlights/sort/shards/aggs response
  parsing, sample documents, cancellation, scoped redacted HTTP error surfacing,
  bounded Search DSL safety validation for query/filter/aggs/sort/source request
  shapes, and mapping-aware Search DSL editor completion 을 지원한다.
  Elasticsearch/OpenSearch Runtime Happy Path smoke 는 live runtime evidence 이고
  live service connect/auth/TLS contract, catalog summary, selected metadata,
  bounded render, delete-by-query preview + live execution, and error surface 를
  검증한다. Search fixture files 는 contract evidence 다. Live `_delete_by_query`
  execution 은 Safe Mode confirm gate 뒤에서 지원되고, actual Search
  index/settings admin execution 은 deferred 다. Support closure 는
  Elasticsearch 와 OpenSearch product-specific probe/catalog/completion deltas 를
  분리해서 기록한다.
- MSSQL: runtime catalog/query/edit-row support is active for issue #903. The SQL Server
  profile exposes source-specific SQL-auth/TDS connection test/connect/ping,
  catalog browse/schema/indexes/constraints/relationships, query,
  multi-statement execution, cancellation, tabular result rendering, and
  editRows through the frontend SQL batch path with primary-key projection.
  #907 wires representative Runtime Happy Path smoke for connect, seeded catalog
  browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid
  edit.
  Structured DDL, admin/security/jobs/users/roles, import/export,
  profiler/activity dashboards, full T-SQL semantic parity, full workbench
  parity, and SQLCMD/meta-command/procedure-body scripting stay out of scope.
  Parser/completion support is bounded editor assistance only.
- Oracle: bounded catalog/query/cancel/tabular/edit-row runtime support is active
  for issues #905/#906. Its profile exposes source-specific service-name lifecycle,
  catalog metadata browse/schema/indexes/constraints/relationships, query,
  multi-statement SELECT/DML batch execution, cooperative cancellation, and
  tabular table-data rendering, plus key-projected editRows through the frontend
  SQL batch path. Oracle Safe Mode classifies tested SELECT/DML/DDL slices and
  blocks PL/SQL/admin statements outside that boundary; completion remains
  bounded editor assistance only. #907 wires representative Runtime Happy Path
  smoke for service-name connect, seeded catalog browse including routine
  metadata, SELECT/DML, destructive Safe Mode confirmation, cancellation, and
  grid edit. SID, TNS, wallet, TLS, advanced auth,
  switch database, structured DDL, raw DDL/admin, full parser/completion
  promotion, PL/SQL body/package authoring/source, triggers, import/export,
  profiler, activity, users/roles/grants/session/storage, and full workbench
  parity stay unsupported or unclaimed.
  Full admin parity, import/export, profiler/activity, role/user/permission UI,
  and broad scripting remain out of scope for both enterprise RDBMS profiles.

## Current Support Snapshot

| DBMS | Runtime | Parser / safety | Completion | 현재 판단 |
|---|---|---|---|---|
| PostgreSQL | strong | strong bounded subset | WASM-first + installed-extension-gated packs | 현재 가장 강한 lane 이다. routine desktop smoke 는 connect/browse/edit/query, Explain plan-inspection UI/source-label path, seeded `pgcrypto`/`fuzzystrmatch` installed-extension completion gating, Safe Mode info/warn/destructive confirmation, raw DDL preview, grid-edit preview, cancellation UI/history/retry behavior, and bounded Structure table-plus-index DDL preview/execute/history/schema-refresh behavior 를 증명한다. Cancellation claim 은 query toolbar/API boundary, cancelled history, stale-grid clearing, retry 로 제한된다. Structure DDL claim 은 table creation plus index creation only 이며 roles/users, extension management, profiler, import/export, broader admin, and broader structured DDL parity 는 보장하지 않음 |
| MySQL | runtime/query/edit/DDL adapter active | bounded parser/Safe Mode slice; constraint conformance version-gated | Rust/WASM MySQL-family vocabulary + current-catalog schema/table/column/routine suggestions | connection, browsing, databases/schemas, tables, views, columns, indexes, constraints/FKs, raw query, DML-oriented multi-statement batch, row edit with MySQL-quoted generated SQL/key projection, cancellation, and bounded structured table/index/constraint DDL are active. Routine desktop smoke covers connect, browse seeded table, SELECT result grid, narrow seeded `CALL proc(scalar)` result rendering, DML batch per-statement result, row edit, cancellation/retry, history/source labels, result-envelope rendering, and bounded Structure table/index/FK DDL preview/execute/catalog readback. Completion suggestions use the current connection/database catalog and MySQL backtick identifier context, but they do not widen runtime support for stored routine bodies or scripting. CHECK/constraint catalog metadata uses live MySQL `>= 8.0.16` context; older/unknown versions return empty CHECK hints. Stored routine/event bodies, broad CALL expressions, control-flow scripting, `DELIMITER`, and `LOAD DATA` are explicit unsupported editor/backend boundaries. Trigger metadata is read-only in Structure; structured trigger create/drop and DB-level import/export/dump parity remain unsupported/follow-up |
| MariaDB | runtime/query/edit/catalog/DDL adapter active through distinct MariaDB engine smoke | MySQL-family parser/Safe Mode path + MariaDB dialect/profile identity | Rust/WASM MySQL-family vocabulary + version-aware profile/completion MariaDB `RETURNING` delta | connection, seeded table browse, catalog/workbench metadata browse, SELECT result grid, DML batch per-statement result, narrow seeded `CALL proc(scalar)` result rendering, row edit, cancellation/retry, history/source labels, result-envelope rendering, and bounded Structure table/index/FK DDL preview/execute/catalog readback have wired MariaDB Runtime Happy Path evidence. Catalog/workbench coverage includes tables, views, columns, indexes, constraints/FKs, and routine metadata browse through the shared MySQL-family adapter plus MariaDB-specific smoke seed/categories. Row edit has MariaDB-specific hook evidence for quoted key-projected preview/discard/commit SQL, and bounded table/index/constraint DDL has MariaDB-specific export/backend-preview evidence with runtime smoke coverage for the intentional MySQL-family SQL path. CHECK/constraint promotion remains version-gated at MariaDB `>= 10.2.1`. Intentional shared paths are the MySQL-family adapter implementation, CodeMirror dialect, parser/Safe Mode boundary, capability/conformance family, and `mysql-client` completion family. MariaDB autocomplete keeps the `mariadb` profile identity and suppresses `RETURNING` only when known server version context is below `10.0.5`. Focused `mariadb:11` integration verifies the live server version and shows `DELETE ... RETURNING` is server-accepted, but the app exposes it only as a DML envelope with no returned rows and no affected-row count. The app does not claim a MariaDB `RETURNING` runtime/version returned-row gate; raw execution remains server-resolved. MySQL-only evidence does not become a MariaDB runtime/admin/import/export claim without MariaDB-specific tests/docs |
| SQLite | file adapter + read/writable-file DML + bounded structured table creation | bounded parser/Safe Mode guardrails; raw DDL rejected by adapter | Rust/WASM built-in vocabulary + cached schema objects + sqlite-cli suggestions | user DBMS adapter 는 internal SQLite state 와 분리됨. 쓰기는 writable file 의 DML/PK-projected row edit 로 제한된다. GitHub Runtime Happy Path now runs a deterministic SQLite desktop smoke for file create/open, table browse, read query, writable DML, row edit, bounded structured table creation with schema refresh proof, read-only write rejection, and internal app-state DB rejection. raw SQL DDL, unsupported `ALTER TABLE` rebuild, table/index removal or rename, index creation, standalone constraint changes, nested JSON edit, sqlite-cli execution, extension/capability semantics 는 unsupported |
| DuckDB | RDBMS file adapter + registered local analytics query | DuckDB SQL/file analytics guardrails | Rust/WASM DuckDB editor vocabulary + cached schema objects | `rdb` profile + `file` connection kind 로 표현한다. local `.duckdb` file 은 catalog/table read 와 statement-level raw SQL 실행 경로를 지원한다. GitHub Runtime Happy Path now runs separate deterministic DuckDB desktop smokes: `.duckdb` open/catalog/table browse/raw SELECT/history/read-only evidence, and registered deterministic CSV source -> global editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute local path in visible UI. registered local CSV/Parquet/JSON/NDJSON analytics 는 active-session source alias 등록, source metadata/workbench alias 표시, preview, focused dialog/API source-scoped SELECT evidence, global query editor SELECT execution through the normal result surface/backend route against registered aliases without source-id plumbing, and a distinct `FILE` history source label for source-scoped dialog and global-editor source queries 가 있다. 이 evidence 는 automatic import/export parity 로 승격하지 않는다. Public payload 는 source alias, file name, kind, size, columns, preview SQL 만 노출하고 absolute local path 는 노출하지 않는다. Completion 은 editor assistance 이며 runtime support 를 넓히지 않는다. extension install/load/helper functions, `COPY`, `ATTACH`/`DETACH`, sensitive external-file capability settings, and arbitrary external-file SQL functions/replacement scans are adapter-blocked. 구조화된 DDL/write UI and file analytics automatic import/export parity 는 unsupported/follow-up |
| MongoDB | runtime-backed whitelisted document workflow | whitelisted mongosh/MQL | Rust/WASM vocabulary + cached catalog context | connection, source-aware catalog metadata, workbench metadata panels, document query/edit with MQL preview/discard, catalog-aware collection/field/index-name autocomplete, bulk delete/update previews with partial-commit warnings, bulk/index/validator slices, cancellation, destructive collection/admin confirmations, and transaction-helper unsupported gates are active for tested whitelist paths. Runtime Happy Path smoke proves seeded collection browse, row-edit MQL preview/execute, query-tab `find` projection/sort/limit, destructive `runCommand` confirmation, and cancel/no-mutation re-read. Focused component/backend tests cover broader catalog, autocomplete, bulk, index, validator, parser, cancellation, and unsupported-helper gates below smoke. arbitrary JavaScript/shell behavior, unsupported cursor helpers, server-version feature promotion gates, native document-first result panels, and full-support parity remain follow-up |
| Redis | connection/profile + backend KV primitives + key browser/value preview/edit UI + selected-key bounded stream reader + bounded command editor vocabulary/key suggestions | backend KV guardrails plus bounded command allowlist and typed-confirm mutation controls; not language-core parser ownership | TypeScript bounded command vocabulary + current-DB/type-filtered key suggestions | key browser/value preview and selected-key bounded stream reader are live. Runtime Happy Path smoke covers Redis connection, deterministic DB 2 seed/reset, key scan, string value preview, `GET` command result, guarded string overwrite, TTL update, and exact-key delete confirmation. The value panel promotes bounded string/hash/list/set/zset edits plus expire/persist/delete preview/confirm flows, while partial/unsupported surfaces fail visibly. Frontend stream reader evidence covers selected stream start/end/count controls, refresh, loading/error states, and bounded table rendering through `read_kv_stream`. Backend guarded string set, delete confirmation, TTL expire/persist, bounded stream read, selected read/write/TTL/stream command dispatch, tabular projection, and exact-key `confirmKey` enforcement for single-key `DEL`/`PERSIST` have focused IPC/runtime evidence. The Redis command editor suggests the backend allowlist command names with arity hints/snippets plus current-DB key suggestions filtered by command key type. It still does not own full Redis CLI parsing or admin parity. Full CLI/admin parity, consumer-group stream UI, cluster/pubsub/modules/consumer-group management, multi-key destructive commands, broader command coverage, language-core parser/completion ownership, and Valkey command compatibility are follow-up |
| Valkey | KV runtime for connection + key browser/value preview + selected-key stream reader + bounded command query + shared string/hash/list/set/zset KvMutationPanel write controls | Redis-compatible bounded command allowlist and typed confirmation; same write surface as Redis (#1075) | TypeScript proven Valkey command subset + current-DB/type-filtered key suggestions | `valkey` is an active `DatabaseType`/profile identity with server connection kind, product label, KV paradigm, Valkey backend adapter profile, and `redis-command` compatibility target. Connection UI/runtime support is exposed for test/connect/key browse/value preview and selected bounded command query rows through the same Redis command allowlist. Selected stream keys use the same read-only bounded stream reader panel backed by `read_kv_stream`. Mutation controls share the Redis string plus hash/list/set/zset KvMutationPanel write surface (#1075), all routed through the same Safe Mode + ConfirmDestructiveDialog gate, with focused Valkey backend/component evidence. Runtime Happy Path smoke uses `e2e/fixtures/valkey/kv/seed.json` for connect/key scan/value preview, `GET`, `HGETALL`, `XRANGE`, bounded `SET`/`EXPIRE`, and destructive/unsupported guard evidence. Command completion is limited to the proven local Valkey runtime rows plus safe current-keyspace hints. `e2e/fixtures/valkey.redis-compatibility.json` separates proven local-runtime rows from candidate/rejected command families. Valkey collection-write smoke coverage and full Redis compatibility are not claimed |
| Elasticsearch/OpenSearch | Elasticsearch live connection + live catalog + bounded live Search query plus fixture/live delete-by-query safety planning and live `_delete_by_query` execution; OpenSearch live connection + live catalog + bounded live Search query plus fixture/live delete-by-query safety planning and live `_delete_by_query` execution | index-catalog sidebar shell plus selected-index lazy catalog detail and samples for both products; mapping/search guardrails for both products; destructive-plan guardrails for both products | Backend Search DSL validator active; full language-core parser/completion ownership remains future; bounded TypeScript completion is editor assistance for Elasticsearch/OpenSearch catalog and mapping context | Search uses an index-catalog-first workbench boundary: the sidebar shell loads only index/alias/data-stream summaries, and selected-index mappings/settings/analyzers/templates/field stats/sample documents load from detail tabs or explicit actions. Elasticsearch exposes URL/auth/TLS connection UI, a live HTTP root probe that detects product/version/distribution and surfaces scoped redacted auth/TLS/network/timeout/permission/server/shard failures, live catalog reads for indexes, aliases, data streams, mappings, settings/analyzers, templates, and field paths, bounded live `_search` execution with backend validation for `match_all`, `term`, `terms`, `match`, `bool` filters, `range`, `exists`, `terms`/`value_count` aggregations, pagination, `track_total_hits`, bounded field sort, and bounded `_source` filtering plus hits/source/fields/highlights/sort/shards/aggs response parsing, and delete-by-query safety planning that estimates matching documents through a safe `_search` request, then executes a live `_delete_by_query` behind a Safe Mode confirmation (backend IPC chokepoint). OpenSearch exposes URL/auth/TLS connection UI, a live HTTP root probe that verifies OpenSearch product/version/distribution, rejects Elasticsearch endpoints, surfaces scoped redacted auth/TLS/network/timeout/permission/server/shard failures, reads live indexes, aliases, data streams, mappings, settings/analyzers, composable/legacy templates, and field paths, dispatches bounded live `_search` requests through the same validator/result renderer with cancellation and scoped HTTP error handling, and uses the same safe `_search` estimate for delete-by-query preview plans plus the same live `_delete_by_query` execution behind a Safe Mode confirmation. Runtime Happy Path smoke covers representative Elasticsearch and OpenSearch live connect/auth/TLS, catalog metadata, selected-index detail, search/render, delete-plan, live delete-execution, and error-surface workflows. Bounded Search DSL editor completion uses product-scoped catalog/mapping context for index, alias, data stream, field, type, `sort`, and `_source` suggestions plus shared query/aggs/sort/source snippets. Unsupported body keys, unsupported aggregation kinds/options, script sort, broad source options, raw/admin targets, wildcard targets, and destructive/admin APIs reject before live Search dispatch or destructive planning. Search live HTTP/admin promotion remains owned by the Search roadmap/milestone, not non-RDBMS lazy-loading workbench hardening. Broader Search admin APIs (index/settings create/delete), global audit/admin/security dashboards, profile/explain request workflow, and product-specific live deltas beyond these slices are deferred |
| MSSQL | SQL-auth/TDS connection plus catalog/query/cancel/tabular runtime and PK-projected row edit through SQL batch | bounded parser/Safe Mode unsupported-boundary recognition only | bounded editor assistance only | `mssql` is a source-specific profile/dialect identity with SQL Server labels, defaults, URL parsing, and seed/spec inventory. Issue #903 promotes connection test/connect/ping, catalog browse/schema/indexes/constraints/relationships, query, multi-statement execution, cancellation, tabular result rendering, and editRows through the frontend SQL batch path with primary-key projection. #907 adds representative Runtime Happy Path smoke for connect, seeded catalog browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit. `switchDatabase` remains disabled under the current connection contract. Named instances, Windows authentication, Azure AD/authSource modes, structured DDL, admin/security/jobs/users/roles, import/export, profiler/activity, full T-SQL semantic parity, full workbench parity, and sqlcmd/meta-command/procedure-body scripting remain unclaimed. |
| Oracle | service-name lifecycle plus bounded catalog/query/cancel/tabular runtime and PK-projected row edit | bounded static Safe Mode classification only | bounded editor assistance only | `oracle` remains a source-specific profile/dialect identity with Oracle labels, service-name defaults, URL parsing, and seed/spec inventory. #905 promotes lifecycle, catalog metadata, SELECT/DML batch execution, cooperative cancellation, and tabular table-data query. #906 adds key-projected editRows through the frontend SQL batch path, Oracle identifier/literal generation, tested SELECT/DML/DDL Safe Mode classification, and PL/SQL/admin boundary blocks. #907 adds representative Runtime Happy Path smoke for service-name connect, seeded catalog/routine browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit. The runtime still blocks switch database, structured DDL, raw DDL/admin, PL/SQL body/package authoring/source, trigger catalog beyond the bounded catalog smoke path, SID/TNS/wallet/TLS/advanced auth, import/export, profiler/activity, users/roles/grants/session/storage, full workbench parity, and full parser/completion promotion. |
| Cassandra/Scylla, DynamoDB, graph, vector, stream | candidate only | deferred language ids only | deferred | no active `DatabaseType`/profile/runtime/parser/completion, fixture/live evidence, or E2E smoke claim. Workflow value, profile target, connection kind, language owner, catalog model, result envelope, safety policy, fixture strategy, and smoke evidence must be locked before promotion |

## Fixture Coverage Snapshot

Fixture 파일 존재는 support claim 을 넓히지 않는다. 현재 fixture inventory 는
`scripts/fixtures/dbms-seeds.test.ts` 가 검증하고, runtime smoke 는 별도 CI wiring 이
있을 때만 product evidence 로 승격된다. Fixture/test topology SOT 는
`docs/contributor-guide/fixture-test-topology-inventory.md` 와
`memory/engineering/conventions/testing-scenarios/fixtures/memory.md` 가 소유한다.
`docs/archives/audits/refactor-05-support-claims-ledger-2026-06-12.md` 는
2026-06-12 support-claim audit snapshot 이다. 현재 product support SOT 는 이
page, `known-limitations.md`, `query-language-support.md`, and testing matrix 다.

| Source | Fixture asset | Current meaning |
|---|---|---|
| PostgreSQL | `e2e/fixtures/postgresql/query/seed.sql` | GitHub Runtime Happy Path 의 active RDBMS smoke seed |
| MySQL | `e2e/fixtures/mysql/query/seed.sql` | wired Runtime Happy Path seed for the connect/browse/query/edit/cancel baseline plus bounded Structure table/index/FK DDL smoke |
| MariaDB | `e2e/fixtures/mariadb/query/seed.sql` | wired Runtime Happy Path seed for the MariaDB connect/browse/query/edit/cancel baseline plus catalog/workbench probe objects and bounded Structure table/index/FK DDL smoke |
| SQLite | `e2e/fixtures/sqlite/query/seed.sql` | wired Runtime Happy Path seed for deterministic file create/open, table browse, read query, writable DML, row edit, read-only write rejection, and internal app-state DB rejection |
| DuckDB | `e2e/fixtures/duckdb/query/seed.sql`, `e2e/fixtures/duckdb/file-analytics/sales.csv` | wired Runtime Happy Path seeds for separate `.duckdb` open/catalog/table browse/raw SELECT/history/read-only evidence and registered deterministic CSV source -> global editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute local path in visible UI. Broader CSV/Parquet/JSON/NDJSON automatic import/export workflow parity remains future work |
| MongoDB | `e2e/fixtures/mongodb/document/seed.json` | document fixture used by current MongoDB smoke seed path |
| Redis | `e2e/fixtures/redis/kv/seed.json` | wired Runtime Happy Path seed for Redis DB 2 connect/scan/preview/GET plus guarded string write, TTL, and exact-key delete smoke. Broader stream consumer, cluster/pubsub/modules, admin, and Valkey parity remain future work |
| Elasticsearch | `e2e/fixtures/elasticsearch/search/seed.json`, `e2e/smoke/elasticsearch.spec.ts`, `src-tauri/src/db/search.rs`, `src-tauri/src/db/search_destructive.rs`, `src-tauri/src/db/search_dsl.rs`, `src-tauri/src/db/search_http.rs`, `src-tauri/src/db/search_live_destructive.rs`, `src-tauri/src/db/search_live_query.rs` | embedded Search fixture contract plus wired Runtime Happy Path smoke for live HTTP connect/auth/TLS, catalog metadata, bounded Search render, delete-by-query preview planning plus live `_delete_by_query` execution behind a Safe Mode confirmation, and visible error surface; actual live index/settings admin execution deferred |
| OpenSearch | `e2e/fixtures/opensearch/search/seed.json`, `.github/workflows/e2e-smoke.yml`, `scripts/e2e-smoke-ci.sh`, `e2e/fixtures/seed-smoke.ts`, `e2e/smoke/opensearch.spec.ts`, `e2e/smoke/search-runtime-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts`, `src-tauri/src/db/search.rs`, `src-tauri/src/db/search_destructive.rs`, `src-tauri/src/db/search_dsl.rs`, `src-tauri/src/db/search_http.rs`, `src-tauri/src/db/search_live_destructive.rs`, `src-tauri/src/db/search_live_query.rs`, `src-tauri/src/db/search/tests.rs`, `src-tauri/src/db/search/tests/destructive.rs`, `src-tauri/src/db/search/tests/live_query.rs`, `src/lib/search/searchDslCompletion.ts`, `src/lib/search/searchDslCompletion.test.ts`, `src/hooks/useSearchAutocomplete.ts`, `src/hooks/useSearchAutocomplete.test.ts`, `src/components/workspace/SearchSidebar.test.tsx`, `src/components/search/SearchIndexDetailPanel.test.tsx`, `src/components/query/QueryTab.search-route.test.tsx`, `src/types/dataSource.ts` | embedded Search fixture contract plus wired Runtime Happy Path smoke, focused live HTTP connection/catalog/query tests, and mapping-aware TypeScript editor completion for URL/auth/TLS, product/version/distribution detection, Elasticsearch endpoint rejection, auth/network failures, indexes, aliases, data streams, mappings, settings/analyzers, composable/legacy templates, field paths, bounded `_search` dispatch/result rendering, shared DSL parser/safety validation for query/filter/aggs/sort/source shapes, sample documents, cancellation, HTTP error surfacing, safe `_search` delete-by-query preview plan estimates plus live `_delete_by_query` execution behind a Safe Mode confirmation, and product-scoped index/alias/data-stream/field/type/sort/source suggestions; the smoke covers connect/auth/TLS, catalog metadata, selected-index detail, bounded render, delete-plan preview + live delete-execution, and visible error surface, with no actual OpenSearch index/settings admin execution claim |
| MSSQL | `e2e/fixtures/seed.mssql.sql`, `e2e/smoke/mssql.spec.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs`, `src-tauri/tests/mssql_connection_routing.rs` | SQL Server product evidence for connection validation/routing plus bounded catalog/query/cancel/tabular runtime contracts and #907 Runtime Happy Path smoke for connect, seeded catalog browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit. The fixture and smoke path do not claim structured DDL, parser/completion execution, admin, import/export, or full workbench parity. |
| Oracle | `docker-compose.yml`, `scripts/fixtures/oracle.ts`, `scripts/fixtures/oracle.test.ts`, `e2e/fixtures/seed.oracle.sql`, `e2e/smoke/oracle.spec.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` | focused #905/#906 product/backend evidence for service-name lifecycle, bounded catalog/query/cancel/tabular runtime, and key-projected row edit generator/Safe Mode/editor-assistance boundaries, plus #907 Runtime Happy Path smoke for service-name connect, seeded catalog/routine browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit. The fixture boundary is `host:port/serviceName` with default `XEPDB1`; SID, TNS, wallet, TLS, and advanced auth are rejected or unsupported. The smoke path is not product evidence for structured DDL, raw DDL/admin, full parser/completion promotion, PL/SQL body/package work, admin, import/export, or full workbench parity. |
| Valkey | `e2e/fixtures/valkey/kv/seed.json`, `e2e/fixtures/valkey.redis-compatibility.json` | wired Runtime Happy Path seed for Valkey DB 2 connect/scan/preview/GET/HGETALL/XRANGE plus bounded SET/EXPIRE and destructive/unsupported command guards. Focused backend/component evidence covers the shared string plus hash/list/set/zset KvMutationPanel write controls (#1075). The compatibility matrix separates proven local-runtime rows from candidate/rejected command families; Valkey collection-write smoke coverage, broader command families, and full Redis compatibility remain future gates |
| Wider candidates | none | no active fixture/live evidence; future fixture or smoke mentions are promotion inventory only |

## Profile Registry Boundary

`src/types/dataSource.ts` 의 `DATA_SOURCE_PROFILES` 는 모든 `DatabaseType` identity 를
포함한다. Profile 존재는 곧 runtime support claim 이 아니다. 현재 connection dialog
와 runtime connection support 는 `src/types/dataSource.ts` 의
`getConnectionSupportedDatabaseTypes` / `isConnectionSupportedDatabaseType` 이
`capabilities.connection.test` 로 판정한 12개 source 로 제한된다. Legacy
compatibility list 인 `src/features/connection/model.ts` 의
`SUPPORTED_DATABASE_TYPES` 는 같은 12개 allow-list 를 유지해야 한다:
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, MSSQL, Oracle, MongoDB, Redis,
Valkey, Elasticsearch, OpenSearch.

Connection form SOT 는
`src/features/connection/components/ConnectionDialog/ConnectionDialogBody.tsx`
의 `renderDbmsFields` switch 다. PostgreSQL 은 `PgFormFields`, MySQL/MariaDB 는
`MysqlFormFields`, MSSQL 은 `MssqlFormFields`, Oracle 은 `OracleFormFields`,
Elasticsearch/OpenSearch 는 `SearchFormFields`, MongoDB 는 `MongoFormFields`,
Redis/Valkey 는 `RedisFormFields`, SQLite/DuckDB 는 file-form `SqliteFormFields`
를 쓴다. MSSQL/Oracle/Search 는 Pg form reuse claim 을 하지 않는다.

Support audit artifacts are historical inputs only.
`docs/archives/audits/refactor-05-support-claims-ledger-2026-06-12.md` 는
snapshot 으로 보존하고, durable result 는 이 page, `known-limitations.md`,
`query-language-support.md`, `docs/ROADMAP.md`, and symbol/path owners above 로
흡수한다. New claims must update those SOTs directly; line-number references are
not stable SOT.

## Database Scope Semantics

Table View 는 DB/index/database scope 를 paradigm 별로 다르게 노출한다.

- RDB 에서 `connection.switchDatabase` 가 true 인 PostgreSQL, MySQL, MariaDB 는
  toolbar `DbSwitcher` 를 connection-global active database/catalog 로 쓴다.
  SQLite/DuckDB 는 file/session scope 로 고정되고, MSSQL/Oracle 은 현재 bounded
  contract 에서 `switchDatabase` 를 disabled 로 유지한다.
- KV 인 Redis/Valkey 는 toolbar `DbSwitcher` 를 connection-global numeric
  database index 로 쓴다. `switch_active_db` 는 `KvAdapter::switch_database` 로
  dispatch 되고, key scan/value/query/mutation 은 요청이 explicit database 를
  싣지 않으면 active DB 를 따른다.
- MongoDB 는 global `DbSwitcher` 를 쓰지 않는다. Query tab 의 tab-local
  `TabDbChip` binding (`tab.database`) 이 scope 를 소유하므로 한 tab 의 database
  변경이 connection-global state 를 바꾸지 않는다.
- Search 인 Elasticsearch/OpenSearch 는 database switching 을 노출하지 않는다.
  selected index/alias/data stream scope 는 sidebar/query target surface 에서
  정한다.

Disabled switcher copy 는 실제 fixed-scope 이유를 말해야 하며 Redis/Valkey
database switching 이 unsupported 라고 주장하면 안 된다.

## KV Mutation Entry Points

Redis/Valkey workbench 의 key action surface 는 selected-key mutation 과 new-key
creation 을 분리한다. `New key` 는 현재 bounded KV contract 에서 unsupported 로
disabled 유지한다. `Edit` 과 `Delete` 는 selected key 가 로드되고 mutation panel 이
지원하는 type 일 때만 enable 되며, 각각 기존 value mutation preview 와 Safe Mode
delete confirmation path 로 포커스를 보낸다. 따라서 delete 는 local panel input 만의
숨은 기능이 아니라 workbench action 에서 출발해 milestone Safe Mode gate 를 통과한다.
이 key action/value 편집 surface 는 sidebar 하단 inline 이 아니라, key 선택 시 열리는
오른쪽 `kv` paradigm detail tab (`KvKeyDetailPanel`) 이 호스팅한다 — search paradigm
(`SearchIndexDetailPanel`) 과 동일한 구조. sidebar (`KvSidebar`) 는 scan + key 선택만
담당하며, panel mutation (특히 delete) 뒤 list 자동 rescan 은 아직 없어 수동 Scan 이 필요하다.

## Result Copy/Export Semantics

Single-table SELECT grid export 는 기존 `source_table` inference 경로를 유지한다.
Search hits 는 화면에 표시된 hit 를 JSON 으로 copy 하고 CSV/TSV 로 export 할 수
있지만 SQL INSERT 는 disabled reason 을 노출한다. Scalar/list 결과는 표시된 값을
copy 하고 non-empty result 만 CSV/TSV export 를 허용한다. Empty result 는 copy/export
를 disabled reason 과 함께 막는다. Write summary 는 JSON copy 만 지원하고 grid row
export 는 unsupported 로 표시한다.

MSSQL 은 #903 에서 bounded runtime
catalog/query/edit-row slice 로 승격됐다: SQL-auth/TDS connection test/connect/ping,
catalog browse/schema/indexes/constraints/relationships, query, multi-statement,
cancel, tabular result, and editRows through frontend SQL batch with primary-key
projection 는 active capability 다. #907 adds representative Runtime Happy Path
smoke for connect, seeded catalog browse, SELECT/DML, destructive Safe Mode
confirmation, cancellation, and grid edit. Structured DDL,
admin/security/jobs/users/roles, import/export, profiler/activity, full T-SQL
semantics, full workbench parity, sqlcmd/meta-command/procedure-body scripting,
은 claim 하지 않는다. Oracle 은 #905/#906 에서 service-name
lifecycle, catalog metadata, SELECT/DML batch, cooperative cancel, tabular
table-data query, key-projected editRows, bounded static Safe Mode classification,
and bounded editor completion assistance 만 허용한다. #907 adds representative
Runtime Happy Path smoke for service-name connect, seeded catalog/routine browse,
SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit.
SID/TNS/wallet/TLS/advanced
auth, switch database, structured DDL, raw DDL/admin, full parser/completion
promotion, PL/SQL body/package work, triggers beyond the bounded catalog smoke
path, admin, import/export, profiler/activity, users/roles/grants,
session/storage, and full workbench parity 는 claim 하지 않는다.
MSSQL/Oracle 승격은 각 source 의 matching
runtime, contract, docs, smoke evidence 가 같은 PR/linked PR set 에서 닫힐 때만
가능하다.
Shared enterprise abstraction 은 SQL Server auth/TDS/T-SQL contract 와 Oracle
service/SID/TNS/wallet/Oracle SQL contract 를 합쳐 숨기면 안 된다.
Valkey 는 KV runtime slice 이며 `connection.test`, `query.query`,
`catalog.browse`, `edit.editKeys` 가 true 다. KV 사이드바 라우팅은
`paradigm === "kv"` 로 하고 (#1463 에서 redundant 한 `paradigmSpecific.keyBrowser`
flag 는 삭제됨), key 편집은 `edit.editKeys` 로 게이팅한다.
`e2e/fixtures/valkey/kv/seed.json` 는 wired Valkey Runtime Happy Path seed 이고,
`e2e/fixtures/valkey.redis-compatibility.json` 는 proven/candidate/rejected Redis
command-family rows 와 unsupported Redis assumptions 를 고정한다. Focused local
Valkey testcontainer evidence 는 connect/key scan/value preview, selected bounded
command query rows, Redis 와 공유되는 string/hash/list/set/zset KvMutationPanel
write controls (#1075) 까지 support claim 을 넓힌다. `redis-command` 는 bounded
command query target 이며, completion claim 은 proven local-runtime rows 에 제한된다.
Full Redis compatibility claim 은 아니다.

MSSQL 은 #903 에서 catalog/query/cancel/tabular/editRows runtime slice 로 승격됐다.
Oracle 은 #906 에서 key-projected editRows 와 bounded static Safe Mode/editor
assistance 까지 승격됐다. #907 은 두 source 의 bounded Runtime Happy Path smoke
를 추가한다. SQL Server DDL/admin/import/export/full-workbench, full T-SQL
scripting parity 과 Oracle SID/TNS/wallet/advanced auth, structured DDL, raw
DDL/admin, full parser/completion promotion, PL/SQL work 는 각각
source-specific promotion issue 에서 evidence 를 잠근 뒤 capability/profile
claim 을 바꾼다.
Elasticsearch/OpenSearch 는 Search identity, live runtime slice, and separated
fixture contract 를 갖고 있다. Elasticsearch 와 OpenSearch 는 connection dialog 와 backend
`test_connection` 에서 URL/auth/TLS 기반 live HTTP root probe 를 지원하고,
product/version/distribution detection 과 auth/network error surfacing 을 제공한다.
OpenSearch probe 는 Elasticsearch endpoint 를 거부한다. Elasticsearch/OpenSearch
live catalog 는 sidebar 에서 index/alias/data-stream shell 을 보여주고, selected
index tab 에서 명시적으로 선택한 mappings/settings/analyzers/templates/field
stats 를 lazy fetch 한다. OpenSearch detail 은 sample documents 를 지원하고,
query tab 은 selected index/alias target 에 scoped 된 bounded Search DSL 을
live `_search` 로 dispatch 한다. Delete-by-query
safety planning 은 Elasticsearch/OpenSearch 모두 safe `_search` estimate 를
preview plan 으로 보여준 뒤 Safe Mode confirm gate 뒤에서 live `_delete_by_query`
를 실행하며, wildcard/broad target 은 막는다. Search DSL editor
completion 은 Elasticsearch/OpenSearch product identity 를 분리하고 catalog/mapping
context 로 index/alias/data-stream/field/type/sort/source suggestions 를 제공한다.
Elasticsearch/OpenSearch Runtime Happy Path smoke now proves live service
connect/auth/TLS contract, catalog/index detail metadata, bounded search
rendering, delete-by-query safety planning plus live `_delete_by_query`
execution behind a Safe Mode confirmation, and visible error surface.
Elasticsearch live query 는 bounded `_search` dispatch 로 sample documents,
query/filter/aggs preflight, hits/source/fields/highlight/sort,
shards/timeout/total relation/took, aggregations, explain/profile response
payload 를 Search-native renderer 에 연결한다. Delete-by-query safety planning
은 fixture/live 모두 safe `_search` estimate 를 계산해 preview plan 으로
보여준 뒤, Safe Mode confirm gate (backend IPC chokepoint) 를 통과하면 live
`_delete_by_query` 를 실행한다. wildcard/broad target 과 index/settings admin
execution 은 막는다.
Initial sidebar load 는 index-catalog-first shell 이며 search hits,
explain/profile/destructive plan 을 가져오지 않는다. Selected-index
mappings/settings/templates/field stats/samples 는 lazy detail tab 또는 explicit
action 에서만 로드한다. Search live HTTP/admin promotion remains owned by the
Search roadmap/milestone, not non-RDBMS lazy-loading workbench hardening.
Elasticsearch/OpenSearch actual live admin execution, broader observability,
profile/explain request workflow, full language-core parser/completion ownership 은
아직 deferred 다.

Cassandra/Scylla, DynamoDB, graph, vector, stream 은 active `DatabaseType`,
profile, runtime, parser/completion, fixture/live evidence, E2E smoke claim 이
없다. 이 후보들은 `docs/ROADMAP.md` H6 계약과 adding-data-source checklist 를
통과하기 전까지 candidate-only 상태다.

DynamoDB 는 candidate-only `cloud-document` profile target 이다. Promotion 전
계약은 `cloud-api` connection kind, native API-first workflow,
table/keySchema/GSI/LSI catalog, `document`/`tabular` result envelopes,
access-pattern/cost/IAM/credential guardrails, and threat-model handoff before
auth/KDF/ACL/secrets/provider decisions 를 요구한다. `partiql` 은 active parser,
completion, or runtime claim 이 아니라 deferred editor/query-language inventory
다. DynamoDB Local/emulator or bounded mock fixtures are future-only inventory;
이 문단은 active runtime, connection UI, parser/completion, fixture/live
evidence, E2E smoke claim 을 만들지 않는다.

Vector 는 candidate-only `vector` profile target 이다. Promotion 전 계약은
`server` connection kind, cloud providers 에 대한 별도 `cloud-api` profile
decision, future `vector-query` or provider filter DSL, collection/vectorSchema/
payloadIndex catalog, `vectorNeighbors` result envelope, topK/filter/write/delete
guardrails 를 요구한다. Embedded/mock or container fixtures are future-only
inventory. Cloud credential/provider/ACL/secrets/KDF decisions require a
threat-model handoff before implementation. 이 문단은 active runtime, connection
UI, parser/completion, fixture/live evidence, E2E smoke claim 을 만들지 않는다.

Stream 은 candidate-only `stream` profile target 이다. Promotion 전 계약은
`cluster` connection kind, `stream-command` or typed API decision,
topic/partition/consumerGroup/schema catalog, `streamRecords`/`metrics` result
envelope, offset/consumer lag/replay/commit guardrails, produce/admin/destructive
defer 를 요구한다. Kafka 는 future baseline fixture target, Redpanda 는
compatibility delta 이며 둘 다 routine Runtime Happy Path wiring 이 아닌 future
non-routine CI inventory 다. 이 문단은 active runtime, connection UI,
parser/completion, fixture/live evidence, E2E smoke claim 을 만들지 않는다.

## Current Boundaries

- 새 DBMS/runtime promotion 은 기존 지원 DBMS 하나가 데스크톱 DB 클라이언트 수준의
  query/workbench parity lane 을 통과할 때까지 시작하지 않는다.
- Full admin parity 는 staged promotion 대상이다 (#1077, 2026-07-02 owner
  decision): extension management UI, schema diff/migration preview, deep
  activity/profiler dashboards 는 여전히 scope 밖. import/export 는 Stage 1,
  users/roles UI 는 Stage 2 로 승격됐다. Stage 1 의 첫 슬라이스는 SQL-file
  import 이다: query editor 툴바의 "Open SQL File" 이 사용자가 고른 `.sql`
  파일 (16 MiB cap, app-internal path 거부) 을 에디터로 로드한다. 실행은
  기존 Run 경로를 그대로 타서 destructive statement 는 Safe Mode confirm
  게이트를 통과한다 — 즉 자동 실행/자동 import 가 아니다. Stage 2 의 첫
  슬라이스는 read-only users/roles listing 이다: PG 는 `list_database_users`
  가 `pg_roles` (password-masked catalog view — `pg_authid`/`pg_shadow` 는
  참조 안 함) 를 읽어 계정/역할 + 소속 role 을 조회 전용으로 노출한다. PG-first
  parity lane 이라 non-PG RDB 와 non-RDB paradigm 은 backend 에서
  `Unsupported` 로 게이트된다 (frontend 분기 아님). role 생성/변경/삭제 (CRUD)
  는 depth step 후속. CSV/JSON row-level import, profiler dashboard (Stage 3)
  는 후속.
- DuckDB file analytics paths stay in active-session adapter state and clear on
  connect/refresh/disconnect. Source metadata, preview, source-scoped query,
  and error payloads expose only public source metadata and redact local paths.
  The local file query dialog result is modal-local, but successful source
  queries are recorded with the distinct `FILE` history source label. The
  global query editor keeps the normal result surface while the DuckDB backend
  accepts read-only SELECT statements that reference at least one registered
  alias without passing a source id, and those successful source queries also
  record the `FILE` history source label. Grid export is the
  generic explicit save-dialog export of current grid rows, not automatic export
  of a registered local file source; import workflows remain future work, and
  connection export is a separate encrypted-envelope flow that does not embed
  connection passwords or active-session registered file source metadata.
- DuckDB autocomplete is an editor-assistance surface: vocabulary and cached
  schema suggestions do not imply runtime permission for adapter-blocked
  extension, `COPY`, `ATTACH`/`DETACH`, capability-setting, or raw external-file
  statements.
- Runtime/parser/completion/edit/fixture/e2e/support-claim gaps 를 lane 하나씩
  닫는다.
- PostgreSQL is the strongest active query/workbench parity lane. Its current routine
  desktop smoke proves the PostgreSQL connect -> browse/edit -> query journey,
  the Explain plan-inspection UI/source label, seeded `pgcrypto` and
  `fuzzystrmatch` installed-extension completion gating, Safe Mode info/warn/destructive
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
  `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(scalar)`; stored routine/event
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
  only; focused `mariadb:11` integration proves the server-accepted
  `DELETE ... RETURNING` side effect while preserving the no-returned-row and
  no-affected-row-count adapter boundary, so runtime acceptance remains outside
  the app's client-side support claim.
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
  PostgreSQL, MySQL, MariaDB, SQLite, DuckDB `.duckdb`, MongoDB, Redis, Valkey,
  Elasticsearch, OpenSearch, MSSQL, and Oracle. MSSQL/Oracle smoke is bounded to
  representative connect, seeded catalog browse, SELECT/DML, destructive Safe
  Mode confirmation, cancellation, and grid edit paths. Other smoke specs or
  source inventories do not widen product support until the CI script and
  support docs promote them.
- Destructive/security behavior is source-specific. RDB DDL preview/confirm,
  RDB Safe Mode confirmations, MongoDB safety confirmations, Redis typed
  confirmation keys, and fixture/live Search destructive plan estimates exist, but
  Table View does not claim a universal admin/security dashboard, global
  audit log, role/user/permission UI, credential rotation UI, or broad
  dry-run system.
- Cassandra/Scylla, DynamoDB, graph, vector, stream 은 workflow value,
  profile target, capability, parser/completion owner, fixture/live evidence,
  smoke/E2E decision 전 active support 로 승격하지 않는다.
- Cassandra/Scylla candidate contract 는 `wide-column` profile target,
  `cluster` connection kind, CQL future Rust/WASM language-core ownership,
  keyspace/table/partition/clustering catalog, `tabular` result envelope,
  partition-key and expensive-read guardrails 로 제한된다. Future evidence path
  는 Cassandra testcontainer baseline plus Scylla compatibility testcontainer
  delta 이며, 이것은 active runtime/connection UI/parser/completion/smoke claim
  이 아니다.
- Graph candidate contract 는 `graph` profile target, `server` connection kind,
  Cypher-first language route with deferred GQL/Gremlin split,
  labels/relationships/properties/indexes catalog, existing `graph` envelope
  path view plus `tabular` projection 으로 제한된다. Graph-source catalog 는 RDBMS
  ERD/FK `SchemaGraph` 와 별도이며, 새 top-level path envelope 는 ADR 또는
  architecture note 전에는 만들지 않는다. Future evidence path 는
  Neo4j-compatible fixture graph/testcontainer plus traversal/write guardrails
  이며, 이것은 active runtime/connection UI/parser/completion/smoke claim 이
  아니다.
- Vector candidate contract 는 `vector` profile target, `server` connection
  kind, cloud providers 의 별도 `cloud-api` profile decision, future
  `vector-query` or provider filter DSL, collection/vectorSchema/payloadIndex
  catalog, `vectorNeighbors` result envelope 로 제한된다. Future evidence path 는
  topK/filter/write/delete guardrails plus embedded/mock or container fixture
  strategy 이며, cloud credential/provider decisions require threat-model
  handoff before implementation. 이것은 active runtime/connection
  UI/parser/completion/smoke claim 이 아니다.
- Current user-visible support boundaries and unmeasured UI/a11y/perf areas are
  tracked in [`known-limitations.md`](known-limitations.md).

## Related Documents

- [`docs/product/query-language-support.md`](query-language-support.md) — current query-language support boundaries
- [`memory/engineering/architecture/data-source/memory.md`](../../memory/engineering/architecture/data-source/memory.md) — data-source profile/capability architecture
- [`memory/engineering/architecture/data-source/adding/memory.md`](../../memory/engineering/architecture/data-source/adding/memory.md) — contributor checklist for new sources
- [`docs/product/known-limitations.md`](known-limitations.md) — current product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future follow-ups and promotion order
