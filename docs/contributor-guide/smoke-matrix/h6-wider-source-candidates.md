# H6 Wider Source Candidate Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the H6 planned/candidate claim gate. It separates current E2E
evidence from focused connection/query evidence and future source-specific smoke
so MSSQL/Oracle and wider candidates do not look broader than implemented.

## Current desktop E2E claim

Current evidence:

- `e2e/smoke/postgres.spec.ts`
- `e2e/smoke/postgres-safe-mode.spec.ts`
- `e2e/smoke/mysql.spec.ts`
- `e2e/smoke/mariadb.spec.ts`
- `e2e/smoke/sqlite.spec.ts`
- `e2e/smoke/duckdb.spec.ts`
- `e2e/smoke/duckdb-file-analytics.spec.ts`
- `e2e/smoke/mongodb.spec.ts`
- `e2e/smoke/redis.spec.ts`
- `e2e/smoke/valkey.spec.ts`
- `e2e/smoke/elasticsearch.spec.ts`
- `e2e/smoke/opensearch.spec.ts`
- `e2e/smoke/mssql.spec.ts`
- `e2e/smoke/oracle.spec.ts`

Current gap / routing:

Current E2E smoke proves PostgreSQL, MySQL, MariaDB, SQLite, DuckDB `.duckdb`,
DuckDB file analytics, MongoDB, Redis, Valkey, Elasticsearch, OpenSearch, MSSQL,
and Oracle journeys. MySQL/MariaDB CALL evidence is limited to the seeded narrow
routine result path. MSSQL/Oracle smoke is bounded to representative connect,
seeded catalog browse, SELECT/DML, destructive Safe Mode confirmation,
cancellation, and grid edit paths. H6 adds no Cassandra/Scylla, DynamoDB, graph,
vector, or stream runtime E2E claim.

## MSSQL runtime/smoke guardrail

Current evidence:

`src/types/dataSource.ts`, `src/types/connection.ts`,
`src/types/adapterConformance.test.ts`,
`src/components/rdb/DataGrid.editing.test.tsx`,
`src-tauri/tests/backend_adapter_contract_profile.rs`,
`.github/workflows/e2e-smoke.yml`,
`e2e/fixtures/seed.mssql.sql`, `e2e/smoke/mssql.spec.ts`, `docs/ROADMAP.md`,
`docs/product/README.md`, `docs/product/query-language-support.md`,
`docs/product/known-limitations.md`, #903/#907

Current gap / routing:

`mssql` keeps source-specific profile/dialect identity, SQL Server
labels/defaults, URL parsing, and seed/spec inventory. It has bounded
connection/catalog/query/cancel/tabular/edit-row runtime support plus
representative Runtime Happy Path smoke for connect, seeded catalog browse,
SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit.
Structured DDL, admin/security/jobs/users/roles, import/export,
profiler/activity, full T-SQL semantics, SQLCMD/procedure scripting, full
parser/completion promotion, and full workbench parity remain unsupported or
unclaimed until separate evidence lands.

## Oracle runtime/smoke guardrail

Current evidence:

`docker-compose.yml`,
`src/types/dataSource.ts`,
`src/types/connection.ts`, `src/types/adapterConformance.test.ts`,
`src/components/rdb/DataGrid.editing.test.tsx`,
`src-tauri/tests/backend_adapter_contract_profile.rs`,
`src/lib/sql/oracleSafety.test.ts`,
`src/components/datagrid/sqlGenerator.dialects.test.ts`,
`.github/workflows/e2e-smoke.yml`,
`e2e/fixtures/seed.oracle.sql`, `e2e/smoke/oracle.spec.ts`, `docs/ROADMAP.md`,
`docs/product/README.md`, `docs/product/query-language-support.md`,
`docs/product/known-limitations.md`, #905/#906/#907

Current gap / routing:

`oracle` now has a bounded catalog/query/cancel/tabular/edit-row runtime slice
for service-name connections plus representative Runtime Happy Path smoke for
service-name connect, seeded catalog/routine browse, SELECT/DML, destructive
Safe Mode confirmation, cancellation, and grid edit. It enables lifecycle,
catalog metadata, SELECT/DML batch execution, cooperative cancellation, tabular
table-data query, key-projected editRows through the frontend SQL batch path,
tested SELECT/DML/DDL Safe Mode classification, and bounded editor assistance.
The wrapper still blocks switch database, structured DDL, raw DDL/admin, PL/SQL
body/package authoring/source, and trigger catalog beyond the bounded catalog
smoke path. SID, TNS, wallet, TLS, advanced auth, full parser/completion
promotion, admin/import/export/full workbench, and broader Oracle semantics
remain unsupported or unclaimed until separate evidence lands.

## Wider source candidate common gate

Current evidence:

- `docs/ROADMAP.md`
- `docs/product/README.md`
- `docs/product/known-limitations.md`
- `docs/product/query-language-support.md`
- `memory/engineering/architecture/data-source/memory.md`

Current gap / routing:

Candidates have no active `DatabaseType`/profile/runtime/parser/completion, no
fixture/live evidence, and no E2E smoke claim. Fixture, smoke, parser,
completion, or profile mentions for Cassandra/Scylla, DynamoDB, graph, vector,
and stream are future inventory only. Promotion PRs must add workflow value,
profile target, connection kind, language owner, catalog model, result envelope,
safety policy, fixture strategy, conformance scope, docs, and source-specific
smoke before support claims widen.

## Wide-column candidate smoke inventory

Current evidence:

[`docs/roadmap/h6.md`](../../roadmap/h6.md) 진행 기준

Current gap / routing:

Cassandra/Scylla need future smoke for cluster connection,
keyspace/table/partition/clustering catalog, bounded CQL reads/writes,
partition-key and expensive-read guardrails, and tabular result rendering.
Future evidence path is a Cassandra testcontainer baseline plus a Scylla
testcontainer compatibility delta before any Scylla claim; this is inventory
only, not active runtime, parser/completion, fixture/live, or E2E support.

## Cloud-document candidate smoke inventory

Current evidence:

[`docs/roadmap/h6.md`](../../roadmap/h6.md) 진행 기준

Current gap / routing:

DynamoDB needs future smoke for a `cloud-api` contract, table/keySchema/GSI/LSI
catalog, native API-first item/query path, `document`/`tabular` result
rendering, item preview/edit boundaries, access-pattern/cost/IAM/credential
guardrails, and threat-model handoff before auth/KDF/ACL/secrets/provider
decisions. PartiQL stays deferred inventory, and DynamoDB Local/emulator or
bounded mock evidence is future-only, not active runtime, parser/completion,
fixture/live, or E2E support.

## Graph candidate smoke inventory

Current evidence:

[`docs/roadmap/h6.md`](../../roadmap/h6.md) 진행 기준

Current gap / routing:

Graph sources need future smoke for server connection,
labels/relationships/properties/indexes catalog, Cypher-first route, deferred
GQL/Gremlin split, existing graph envelope path views, tabular projections,
traversal/write guardrails, and Neo4j-compatible fixture graph/testcontainer
evidence. RDBMS `SchemaGraph` remains separate from the graph-source catalog.

## Vector candidate smoke inventory

Current evidence:

[`docs/roadmap/h6.md`](../../roadmap/h6.md) 진행 기준

Current gap / routing:

Vector sources need future smoke for a `server` contract,
collection/vectorSchema/payloadIndex catalog, future `vector-query` or provider
filter DSL, bounded topK and metadata filter execution, vectorNeighbors
rendering, write/delete guardrails, and embedded/mock or container fixture
evidence. Cloud providers require a separate `cloud-api` profile decision and
threat-model handoff before credential/provider choices. This is inventory only,
not active runtime, parser/completion, fixture/live, or E2E support.

## Stream candidate smoke inventory

Current evidence:

[`docs/roadmap/h6.md`](../../roadmap/h6.md) 진행 기준

Current gap / routing:

Stream sources need future smoke for cluster connection,
topic/partition/consumerGroup/schema catalog, bounded consume/read behavior,
streamRecords/metrics rendering, offset/consumer lag/replay/commit guardrails,
and produce/admin/destructive gating. Produce/admin support stays deferred.
Kafka is the future baseline fixture target and Redpanda is a compatibility
delta; both are future non-routine CI inventory, not routine Runtime Happy Path
wiring or an active E2E smoke claim.
