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
| PostgreSQL | strong | strong | WASM-first | 기준선. query/workbench parity lane 이 현재 우선 후보 |
| MySQL | adapter complete | widening in progress | Rust/WASM vocabulary | adapter 완료. semantic gap 계속 축소 |
| MariaDB | MySQL-adapter reuse | MySQL-family profile + MariaDB delta | Rust/WASM vocabulary | runtime path 존재. MariaDB-engine fixture gap 은 active risk |
| SQLite | file adapter complete | parser/write parity guardrails | Rust/WASM vocabulary | user DBMS adapter 는 internal SQLite state 와 분리됨. DDL UI 는 unsupported |
| DuckDB | file adapter + local analytics preview | DuckDB SQL/file analytics guardrails | Rust/WASM vocabulary | local `.duckdb`/CSV/Parquet/JSON/NDJSON preview/query 지원. DDL/write 는 unsupported |
| MongoDB | partial/full-support backlog | whitelisted mongosh | Rust/WASM vocabulary | whitelist workflow hardening 이후 full-support 재검토 |
| Redis | Redis first slice live | key/type/TTL/stream guardrails | redis-command profile | key browser, value reads, TTL mutation, guarded string writes, bounded stream reads covered. Valkey parity/support unverified |
| Elasticsearch/OpenSearch | fixture-backed Search slice only | index/mapping/search envelope guardrails | bounded fixture DSL only | live connection UI, HTTP catalog/query execution, admin, observability 는 deferred |
| MSSQL/Oracle | unsupported/deferred | declared SQL identity only | deferred | planned RDBMS identities. runtime support 는 없음 |

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

- [`docs/query-language-support.md`](../query-language-support.md) — language and parser support
- [`docs/data-source-architecture.md`](../data-source-architecture.md) — data-source profile/capability architecture
- [`docs/adding-a-data-source.md`](../adding-a-data-source.md) — contributor checklist for new sources
- [`docs/product/known-limitations.md`](known-limitations.md) — current product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future follow-ups and promotion order
