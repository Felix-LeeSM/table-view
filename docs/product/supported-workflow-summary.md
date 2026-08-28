# Supported Workflow Summary

현재 사용자에게 보이는 지원 범위는 active connection profile 과 runtime adapter,
parser/safety 경계, fixture/live evidence 가 함께 갖추어진 범위만을 의미한다.

- Active connection UI/runtime 대상: PostgreSQL, MySQL, MariaDB, SQLite,
  DuckDB, MSSQL catalog/query runtime, MongoDB, Redis, Valkey, Elasticsearch,
  OpenSearch, and Oracle bounded catalog/query/cancel/tabular/edit-row runtime.
- RDBMS workbench: catalog/tree browse, tabular result rendering, raw query path,
  bounded DML/row-edit path, source-specific safety confirmation. PostgreSQL 이
  routine desktop smoke 로 뒷받침되는 주 lane 이고, MySQL/MariaDB 에는 runtime
  smoke baseline 이 있다. SQLite 에도 deterministic file workflow smoke baseline 이 있다.
  DuckDB 는 `.duckdb` Runtime Happy Path smoke 와 registered local file
  analytics Runtime Happy Path smoke/source-scoped evidence/history/privacy
  boundary 를 서로 분리해서 좁게 규정한다.
- SQLite/DuckDB file workflow: local file open/create/browse/query 를 중심으로 한다. SQLite
  는 writable-file DML 과 key-projected row edit, 그리고 엔진이 네이티브로 실행하는
  구조 DDL (테이블 생성/삭제/이름 변경, 컬럼 추가/삭제, 인덱스 생성/삭제) 을 지원한다. DuckDB 는 `.duckdb`
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
  bounded Search DSL safety validation for query/filter/aggs/sort/source/profile
  request shapes, and mapping-aware Search DSL editor completion 을 지원한다.
  Elasticsearch/OpenSearch Runtime Happy Path smoke 는 live runtime evidence 이며,
  live service connect/auth/TLS contract, catalog summary, selected metadata,
  bounded render, delete-by-query preview + live execution, and error surface 를
  검증한다. Search fixture files 는 contract evidence 다. Live `_delete_by_query`
  execution 은 Safe Mode confirm gate 를 통과한 뒤에만 지원하고, actual Search
  index/settings admin execution 은 아직 deferred 상태다. Support closure 는
  Elasticsearch 와 OpenSearch 의 product-specific probe/catalog/completion deltas 를
  서로 분리해서 기록한다.
- MSSQL: runtime catalog/query/edit-row support is active for issue #903. The SQL Server
  profile exposes source-specific SQL-auth/TDS connection test/connect/ping,
  catalog browse/schema/indexes/constraints/relationships, query,
  multi-statement execution, cancellation, tabular result rendering, and
  editRows through the frontend SQL batch path with primary-key projection.
  #907 wires representative Runtime Happy Path smoke for connect, seeded catalog
  browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid
  edit.
  Structured DDL, admin/security/jobs/users/roles, import/export,
  full profiler/activity admin parity, full T-SQL semantic parity, full workbench
  parity, and SQLCMD/meta-command/procedure-body scripting stay out of scope; the
  shared server activity/slow-query (profiler) panels are capability-gated
  auto-polling dashboards with a session-local, non-persistent trend.
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
  users/roles/grants/session/storage, and full workbench
  parity stay unsupported or unclaimed.
  Full admin parity, import/export, full profiler/activity admin parity,
  role/user/permission UI, and broad scripting remain out of scope for both
  enterprise RDBMS profiles; the shared server activity/slow-query (profiler)
  panels are capability-gated auto-polling dashboards with a session-local,
  non-persistent trend, and no activity/slow-query history is persisted to
  disk or DB (ADR 0036/0042).
