# Phase 32: Query/Workbench Parity Ladder

## 목표

추가 DBMS runtime 을 승격하기 전에, 현재 지원 DBMS surface 를 하나씩
TablePlus-style query/workbench parity 까지 끌어올린다.

이것은 full admin parity 가 아니다. 다음 항목은 나중에 별도로 선택하지 않는 한
scope 밖이다: role/user/permission UI, extension management UI, schema
diff/migration preview, DB-level backup/restore/import/export, deep
activity/profiler dashboard.

## 고정 순서

1. PostgreSQL.
2. MySQL/MariaDB.
3. SQLite/DuckDB.
4. MongoDB.
5. Elasticsearch/OpenSearch live HTTP.
6. MSSQL enterprise RDBMS lane / Oracle post-connection RDBMS lane.

이 phase 문서에는 implementation sprint sequence 를 배정하지 않는다. Sprint
contract 는 active lane 을 실행 대상으로 선택한 뒤에만 만든다.

## Lane 별 gate

각 lane 은 다음 gap 을 닫아야 한다:

- connect, browse, query, edit, safe commit runtime workflow gap;
- claim 한 syntax surface 의 parser/Safe Mode gap;
- 설치된 extension/plugin/module capability pack 을 포함한 completion gap;
- fixture/CI evidence gap;
- lane core workflow 의 e2e smoke coverage;
- docs/UI 의 support-claim drift;
- dry-run flow 근처의 lightweight EXPLAIN/plan inspection.

## Extension Capability Pack

Extension, plugin, module completion 은 detection 기반 opt-in 으로만 켠다:

1. DBMS 에서 설치된 capability 를 검사한다.
2. 발견된 known capability 에만 curated completion pack 을 켠다.
3. Unknown detected capability 는 detected-but-unpacked 로만 표시한다.
4. 설치되지 않은 capability pack 은 제안하지 않는다.

Initial PostgreSQL packs: `pgcrypto`, `uuid-ossp`, `postgis`, `pgvector`,
`citext`, `hstore`, and `pg_trgm`.

후속 DBMS lane 은 같은 규칙을 SQLite/DuckDB extension, Redis module, Search
plugin 에 적용한다.

## PostgreSQL Lane Shape

PostgreSQL query/workbench parity 를 먼저 닫는다:

- parser/Safe Mode: common no-FROM select, bare function call, selected PL/pgSQL
  boundary, `DO $$ ... $$` handling policy, `MERGE`, extension operator/type
  tolerance 지원;
- completion: server-version/capability-aware candidate, 더 깊은 alias/CTE
  scope, extension pack, catalog-backed function/type/operator;
- edit: 기존 row-edit safety 를 유지하고 unsupported write 는 명시;
- EXPLAIN: dry-run 옆에 `EXPLAIN (FORMAT JSON)` path 와 readable plan view 추가;
- quality: constraint/index live schema graph wiring, visual smoke, e2e smoke,
  result-envelope migration plan.

## 후속 lane

- MySQL/MariaDB: semantic widening, MariaDB engine evidence, dialect delta,
  explain format, routine/trigger read workflow.
- SQLite/DuckDB: file DB write/workbench parity, DuckDB analytics, extension
  detection, `EXPLAIN QUERY PLAN` / DuckDB `EXPLAIN` coverage.
- MongoDB: document-native result workbench, whitelisted read/write explain,
  aggregation/capability gate, transaction/deployment handling.
- Search live HTTP: active runtime parity lane 이 충분히 정리된 뒤 real HTTP
  connection, catalog, query, safety, fixture, e2e 추가.
- MSSQL/Oracle: Search live HTTP 뒤 enterprise RDBMS lane 으로 진행하되 MSSQL
  driver/license 와 Oracle SID/TNS/wallet/TLS plus catalog/query/edit scope, CI
  fixture strategy 를 먼저 lock. Oracle 의 현재 service-name connection-only
  lifecycle 는 이 lane 의 catalog/query/edit claim 이 아니다.
