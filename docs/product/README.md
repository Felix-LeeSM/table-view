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
  DuckDB, MongoDB, Redis.
- RDBMS workbench: catalog/tree browse, tabular result rendering, raw query path,
  bounded DML/row-edit path, source-specific safety confirmation. PostgreSQL 이
  routine desktop smoke-backed 주 lane 이고 MySQL 은 runtime smoke baseline 이
  있다. MariaDB/SQLite/DuckDB 는 adapter/unit/integration/fixture evidence 범위로
  좁힌다.
- SQLite/DuckDB file workflow: local file open/create/browse/query 중심. SQLite
  는 writable-file DML 과 key-projected row edit, DuckDB 는 `.duckdb` catalog/read
  query 와 registered local CSV/Parquet/JSON/NDJSON preview slice 를 지원한다.
- MongoDB workflow: whitelisted mongosh/MQL document query/edit/admin slices 와
  destructive Safe Mode path 를 지원한다. arbitrary JavaScript shell 은 지원하지
  않는다.
- Redis workflow: connection/profile, database/key scan, typed value preview, and
  backend guarded KV primitives 가 있다. 현재 product UI claim 은 key browser/value
  preview 로 제한된다.
- Elasticsearch/OpenSearch: embedded fixture-backed Search catalog/mapping/template
  and result rendering contract 만 있다. live HTTP connection/query/admin 은 없다.
- MSSQL/Oracle: declared planned RDBMS identities and static seed contracts only.
  connection UI/runtime/parser/completion support 는 아직 없다.

## Current Support Snapshot

| DBMS | Runtime | Parser / safety | Completion | 현재 판단 |
|---|---|---|---|---|
| PostgreSQL | strong | strong bounded subset | WASM-first + installed-extension-gated packs | 현재 가장 강한 lane 이다. routine desktop smoke 는 connect/browse/edit/query, Explain plan-inspection UI/source-label path, seeded `pgcrypto` installed-extension completion gating, Safe Mode info/warn/destructive confirmation, raw DDL preview, grid-edit preview, and cancellation UI/history/retry behavior 를 증명한다. Cancellation claim 은 query toolbar/API boundary, cancelled history, stale-grid clearing, retry 로 제한된다. full dialect/admin/arbitrary extension semantics, catalog-backed enumeration of every extension symbol, server activity/session management UI 는 보장하지 않음 |
| MySQL | runtime/query/edit/DDL adapter active | bounded parser/Safe Mode slice; constraint conformance version-gated | Rust/WASM MySQL-family vocabulary | connection, browsing, databases/schemas, tables, views, columns, indexes, constraints/FKs, raw query, DML-oriented multi-statement batch, row edit with MySQL-quoted generated SQL/key projection, cancellation, and bounded structured table/index/constraint DDL are active. Routine desktop smoke covers connect, browse seeded table, SELECT result grid, DML batch per-statement result, row edit, cancellation/retry, history/source labels, and result-envelope rendering. CHECK/constraint catalog metadata uses live MySQL `>= 8.0.16` context; older/unknown versions return empty CHECK hints. Stored routine/event bodies, control-flow scripting, `DELIMITER`, and `LOAD DATA` are explicit unsupported editor/backend boundaries. Trigger create/drop and DB-level import/export/dump parity remain unsupported/follow-up |
| MariaDB | MySQL-family adapter reuse with distinct MariaDB identity | MySQL-family parser/Safe Mode path + MariaDB dialect/profile identity | Rust/WASM MySQL-family vocabulary + completion-only MariaDB `RETURNING` delta | runtime adapter path exists through MySQL reuse. CHECK/constraint catalog metadata uses live MariaDB `>= 10.2.1` context. `RETURNING` is not a version-gated runtime support claim; MariaDB-engine routine/default fixture, CI, and live evidence remain known limitations / quality follow-up |
| SQLite | file adapter + read/writable-file DML | bounded parser/Safe Mode guardrails; DDL rejected by adapter | Rust/WASM built-in vocabulary + cached schema objects + sqlite-cli suggestions | user DBMS adapter 는 internal SQLite state 와 분리됨. 쓰기는 writable file 의 DML/PK-projected row edit 로 제한된다. routine desktop E2E, structured DDL UI/runtime parity, unsupported `ALTER TABLE` rebuild, nested JSON edit, sqlite-cli execution, extension/capability semantics 는 unsupported |
| DuckDB | RDBMS file adapter + registered local analytics preview | DuckDB SQL/file analytics guardrails | Rust/WASM DuckDB vocabulary | `rdb` profile + `file` connection kind 로 표현한다. local `.duckdb` file 은 catalog/table read 와 statement-level raw SQL 실행 경로를 지원한다. registered local CSV/Parquet/JSON/NDJSON analytics 는 preview basics 와 source-scoped SELECT backend path evidence 가 있다. Preview public payload 는 source alias, file name, kind, size 만 노출하고 absolute local path 는 노출하지 않는다. extension install/load/helper functions, `COPY`, `ATTACH`/`DETACH`, sensitive external-file capability settings, and arbitrary external-file SQL functions/replacement scans are adapter-blocked. 구조화된 DDL/write UI, file analytics query UI parity/history/import 는 unsupported/follow-up |
| MongoDB | runtime-backed whitelisted document workflow | whitelisted mongosh/MQL | Rust/WASM vocabulary | connection, catalog, document query/edit, bulk/index/validator slices, cancellation, and destructive Safe Mode gates are active for tested whitelist paths. arbitrary JavaScript/shell behavior, version/deployment gates, native document-first panels, and full-support parity remain follow-up |
| Redis | connection/profile + backend KV primitives + key browser/value preview UI | backend KV guardrails only | redis-command profile; parser/completion future-contract | key browser/value preview are live. Backend guarded string set, delete confirmation, TTL expire/persist, and bounded stream read exist as typed IPC primitives. full value editor, TTL/write/stream UI, Redis command query editor, cluster/pubsub/modules/consumer-group management, and Valkey support are follow-up |
| Valkey | unsupported/planned | no active profile/runtime evidence | deferred | Redis compatibility is not assumed. Valkey needs its own profile/capability decision plus fixture or live evidence before support can be claimed |
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
| MySQL | `e2e/fixtures/seed.mysql.sql` | active MySQL smoke seed for connect/browse/query/edit/cancel baseline |
| MariaDB | `e2e/fixtures/seed.mariadb.sql` | explicit MariaDB-family seed contract; no routine/default live-engine claim |
| SQLite | `e2e/fixtures/seed.sqlite.sql` | deterministic local-file seed; no desktop E2E smoke claim |
| DuckDB | `e2e/fixtures/seed.duckdb.sql` | `.duckdb` fixture seed; no desktop E2E smoke claim |
| MongoDB | `e2e/fixtures/seed.mongodb.json` | document fixture used by current MongoDB smoke seed path |
| Redis | `e2e/fixtures/seed.redis.json` | KV/stream fixture inventory for backend/fixture parity; no desktop E2E smoke claim |
| Elasticsearch | `e2e/fixtures/seed.search.elasticsearch.json`, `src-tauri/src/db/search.rs` | embedded Search fixture contract; no live HTTP support |
| OpenSearch | `e2e/fixtures/seed.search.opensearch.json`, `src-tauri/src/db/search.rs` | embedded Search fixture contract; no live HTTP support |
| MSSQL | `e2e/fixtures/seed.mssql.sql` | planned static SQL seed contract only |
| Oracle | `e2e/fixtures/seed.oracle.sql` | planned static SQL seed contract only |
| Valkey and wider candidates | none | no active fixture/live evidence |

## Profile Registry Boundary

`src/types/dataSource.ts` 의 `DATA_SOURCE_PROFILES` 는 모든 `DatabaseType` identity 를
포함한다. Profile 존재는 곧 runtime support claim 이 아니다. 현재 connection dialog
와 runtime connection support 는 `capabilities.connection.test` 가 true 인
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, MongoDB, Redis 로 제한된다.
Valkey 는 아직 active `DatabaseType`/profile/runtime identity 가 없으며 Redis
compatibility evidence 가 쌓이기 전까지 support claim 이 아니다.

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
  connect/disconnect. Preview/query/error payloads expose only public source
  metadata and redact local paths. Grid export is the generic explicit
  save-dialog export of current grid rows, not automatic export of a registered
  local file source; connection export is a separate encrypted-envelope flow and
  does not embed connection passwords.
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
  preview/commit/discard paths. Parser/Safe Mode covers `LIMIT offset,count`,
  `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(...)`; stored routine/event
  bodies, control-flow scripting, `DELIMITER`, and `LOAD DATA` are explicit
  unsupported boundaries. Completion context and full workbench parity remain
  separate promotion gates.
- SQLite is a file-backed DBMS lane. Current support is scoped to file
  create/open/test, read-only mode, catalog/table browse, read queries,
  writable-file DML, transactional DML batch/dry-run, and key-projected row
  edits. SQLite structured DDL, automatic ALTER rebuilds, extension/capability
  semantics, sqlite-cli command execution, nested JSON edits, and routine
  desktop E2E smoke remain future promotion gates.
- Routine runtime smoke currently proves the GitHub Runtime Happy Path for
  PostgreSQL, MySQL, and MongoDB. Other smoke specs or source inventories do not
  widen product support until the CI script and support docs promote them.
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
