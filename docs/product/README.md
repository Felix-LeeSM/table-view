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
  DuckDB, MongoDB, Redis, Valkey.
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
- Elasticsearch/OpenSearch: embedded fixture-backed Search catalog/mapping/template
  and result rendering contract 만 있다. live HTTP connection/query/admin 은 없다.
- MSSQL/Oracle: declared planned RDBMS identities and static seed contracts only.
  connection UI/runtime/parser/completion support 는 아직 없다.

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
| Elasticsearch/OpenSearch | fixture-backed Search slice only | index/mapping/search envelope guardrails | bounded fixture DSL only | fixture identity/catalog/mapping/template/search result and destructive plan contracts exist. live connection UI, HTTP auth/TLS, catalog/query execution, admin APIs, observability, and product-specific live deltas are deferred |
| MSSQL | planned declared RDBMS identity only | no active T-SQL parser/runtime safety claim | deferred | `mssql` profile/dialect identity exists as capability-empty `declared-rdb`. Static SQL seed contract exists for future promotion, but connection UI, runtime query/catalog/edit, SQL Server auth/TLS/encryption/instance behavior, runtime fixture, and live evidence are not implemented |
| Oracle | planned declared RDBMS identity only | no active Oracle SQL/PL/SQL parser/runtime safety claim | deferred | `oracle` profile/dialect identity exists as capability-empty `declared-rdb`. Static SQL seed contract exists for future promotion, but connection UI, runtime query/catalog/edit, service/SID/wallet/TNS behavior, runtime fixture, and live evidence are not implemented |
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
| Elasticsearch | `e2e/fixtures/seed.search.elasticsearch.json`, `src-tauri/src/db/search.rs` | embedded Search fixture contract; no live HTTP support |
| OpenSearch | `e2e/fixtures/seed.search.opensearch.json`, `src-tauri/src/db/search.rs` | embedded Search fixture contract; no live HTTP support |
| MSSQL | `e2e/fixtures/seed.mssql.sql` | planned static SQL seed contract only |
| Oracle | `e2e/fixtures/seed.oracle.sql` | planned static SQL seed contract only |
| Valkey | `e2e/fixtures/seed.valkey.json`, `e2e/fixtures/valkey.redis-compatibility.json` | wired Runtime Happy Path seed for Valkey DB 2 connect/scan/preview/GET/HGETALL/XRANGE plus bounded SET/EXPIRE and destructive/unsupported command guards. The compatibility matrix separates proven local-runtime rows from candidate/rejected command families; direct mutation controls, broader command families, and full Redis compatibility remain future gates |
| Wider candidates | none | no active fixture/live evidence |

## Profile Registry Boundary

`src/types/dataSource.ts` 의 `DATA_SOURCE_PROFILES` 는 모든 `DatabaseType` identity 를
포함한다. Profile 존재는 곧 runtime support claim 이 아니다. 현재 connection dialog
와 runtime connection support 는 `capabilities.connection.test` 가 true 인
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, MongoDB, Redis, Valkey 로 제한된다.
Valkey 는 KV runtime slice 이며 `connection.test`, `query.query`,
`catalog.browse`, `paradigmSpecific.keyBrowser` 가 true 다.
`e2e/fixtures/seed.valkey.json` 는 wired Valkey Runtime Happy Path seed 이고,
`e2e/fixtures/valkey.redis-compatibility.json` 는 proven/candidate/rejected Redis
command-family rows 와 unsupported Redis assumptions 를 고정한다. Focused local
Valkey testcontainer evidence 는 connect/key scan/value preview 와 selected bounded
command query rows 까지 support claim 을 넓힌다. `redis-command` 는 bounded command
query target 이며, completion claim 은 proven local-runtime rows 에 제한된다. Full
Redis compatibility/direct mutation claim 은 아니다.

MSSQL 과 Oracle 은 별도의 capability-empty declared RDB identities 다.
Elasticsearch/OpenSearch 는 Search identity 와 fixture-backed contract 만 갖고
있으며 live HTTP connection, catalog/query execution, admin/observability 는 아직
deferred 다.

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
  confirmation keys, and fixture-backed Search destructive plans exist, but
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
