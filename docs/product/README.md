# Product State

현재 제품 상태와 지원 범위를 기록한다. 미래 목표와 승격 후보는
[`docs/ROADMAP.md`](../ROADMAP.md) 를 본다.

## Product Goal

기존 데스크톱 DB 클라이언트 사용자가 핵심 워크플로우를 잃지 않고 Table View 로
전환할 수 있어야 한다.

핵심 워크플로우: 연결 -> 탐색 -> 조회/쿼리 -> 편집 -> 안전한 검토/커밋.

## Current Support Snapshot

| DBMS | Runtime | Parser / safety | Completion | 현재 판단 |
|---|---|---|---|---|
| PostgreSQL | strong | strong bounded subset | WASM-first | 현재 가장 강한 lane 이지만 full dialect/admin/arbitrary extension semantics 보장은 아님. query/workbench parity lane 이 현재 우선 후보 |
| MySQL | adapter complete | widening in progress | Rust/WASM vocabulary | adapter 완료. semantic gap 계속 축소 |
| MariaDB | MySQL-adapter reuse | MySQL-family profile + MariaDB delta | Rust/WASM vocabulary | runtime path 존재. MariaDB-engine fixture gap 은 known limitation / quality follow-up |
| SQLite | file adapter + SELECT/DML | bounded parser/Safe Mode guardrails; DDL rejected by adapter | Rust/WASM built-in vocabulary + cached schema objects | user DBMS adapter 는 internal SQLite state 와 분리됨. 쓰기는 writable file 의 DML/PK-projected row edit 로 제한되며 DDL UI/runtime DDL parity, unsupported `ALTER TABLE` rebuild, extension gates 는 unsupported |
| DuckDB | file adapter + local analytics preview | DuckDB SQL/file analytics guardrails | Rust/WASM vocabulary | local `.duckdb` raw SQL 실행과 CSV/Parquet/JSON/NDJSON preview 경로 지원. 구조화된 DDL/write UI 와 file analytics query UI parity 는 unsupported |
| MongoDB | partial/full-support backlog | whitelisted mongosh | Rust/WASM vocabulary | whitelist workflow hardening 이후 full-support 재검토 |
| Redis | connection/profile + backend KV primitives + key browser/value preview | backend guardrails only | redis-command profile | key browser/value preview 는 live. value edit/TTL/write/stream UI 와 Valkey parity/support 는 follow-up |
| Elasticsearch/OpenSearch | fixture-backed Search slice only | index/mapping/search envelope guardrails | bounded fixture DSL only | live connection UI, HTTP catalog/query execution, admin, observability 는 deferred |
| MSSQL/Oracle | unsupported/deferred | declared SQL identity only | deferred | planned RDBMS identities. runtime support 는 없음 |

## Profile Registry Boundary

`src/types/dataSource.ts` 의 `DATA_SOURCE_PROFILES` 는 모든 `DatabaseType` identity 를
포함한다. Profile 존재는 곧 runtime support claim 이 아니다. 현재 connection dialog
와 runtime connection support 는 `capabilities.connection.test` 가 true 인
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, MongoDB, Redis 로 제한된다.

MSSQL/Oracle 은 capability-empty declared RDB identities 다. Elasticsearch/OpenSearch
는 Search identity 와 fixture-backed contract 만 갖고 있으며 live HTTP connection,
catalog/query execution, admin/observability 는 아직 deferred 다.

## Current Boundaries

- 새 DBMS/runtime promotion 은 기존 지원 DBMS 하나가 데스크톱 DB 클라이언트 수준의
  query/workbench parity lane 을 통과할 때까지 시작하지 않는다.
- Full admin parity 는 scope 밖이다: role/user/permission UI, extension management
  UI, schema diff/migration preview, DB-level backup/restore/import/export, deep
  activity/profiler dashboards.
- Runtime/parser/completion/edit/fixture/e2e/support-claim/lightweight
  EXPLAIN gaps 를 lane 하나씩 닫는다.
- Cassandra/DynamoDB/graph/vector/stream 은 profile/capability/fixture decision 전
  active support 로 승격하지 않는다.
- Current user-visible support boundaries and unmeasured UI/a11y/perf areas are
  tracked in [`known-limitations.md`](known-limitations.md).

## Related Documents

- [`docs/product/query-language-support.md`](query-language-support.md) — current query-language support boundaries
- [`memory/engineering/architecture/data-source/memory.md`](../../memory/engineering/architecture/data-source/memory.md) — data-source profile/capability architecture
- [`memory/engineering/architecture/data-source/adding/memory.md`](../../memory/engineering/architecture/data-source/adding/memory.md) — contributor checklist for new sources
- [`docs/product/known-limitations.md`](known-limitations.md) — current product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future follow-ups and promotion order
