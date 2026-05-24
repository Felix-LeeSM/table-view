# Data Source Extension Architecture

## Purpose

Table View 는 RDBMS client 에서 출발했지만 장기적으로는 local-first data
workbench 여야 한다. PostgreSQL/MySQL/MariaDB/SQLite/DuckDB, MongoDB,
Redis/Valkey, Elasticsearch/OpenSearch 이후 Cassandra, DynamoDB, graph DB,
vector DB 같은 다른 paradigm 을 추가할 때 매번 UI/store/query path 를 새로
갈아엎지 않기 위한 확장 계약을 정의한다.

본 문서는 product roadmap 이 아니라 architecture SOT 다. Roadmap 순서는
`docs/ROADMAP.md`, active 실행 순서는 `docs/PLAN.md` 가 가진다.

## Core Decision

새 data source 는 `DatabaseType` switch 를 늘리는 방식으로 추가하지 않는다.
반드시 아래 네 layer 를 먼저 정의한다.

1. `DataSourceProfile`
2. paradigm-specific adapter contract
3. language / catalog / result envelope
4. safety and capability policy

이 구조로 가면 새 DBMS 추가 작업은 "앱 구조 변경" 이 아니라 "profile +
adapter + renderer 추가" 로 제한된다.

## Why

### 1. Paradigm 이 다르면 좋은 UX 도 다르다

RDBMS 는 table/column/FK/ERD 중심이다. Redis 는 key/type/TTL/streams 중심이고,
Elasticsearch/OpenSearch 는 index/mapping/search hits/aggregations 중심이다.
Cassandra 는 partition key 와 clustering key 중심이며, DynamoDB 는 access
pattern, partition/sort key, GSI/LSI 가 핵심이다. Graph DB 는 node/edge/path
viewer 가 필요하고, vector DB 는 nearest-neighbor search 와 payload filter 가
핵심이다.

모든 것을 RDB grid 에 맞추면 구현은 쉬워 보이지만 사용자 workflow 가 깨진다.

### 2. Capability 없이 `if dbType` 분기는 폭발한다

SQLite 와 DuckDB 는 SQL 을 쓰지만 server DB 가 아니다. Elasticsearch 는 query 는
있지만 SQL DDL 이 아니다. Redis 는 edit 이 있지만 row edit 이 아니다. 기능 버튼과
패널은 `dbType` 이 아니라 capability 를 보고 켜져야 한다.

### 3. Query language 와 result shape 이 독립적이다

SQL, CQL, Cypher, PartiQL, Redis command, OpenSearch DSL, vector filter DSL 은
서로 다른 parser/completion/safety rule 을 가진다. 결과도 tabular, document,
key-value, search hits, graph, vector neighbors 로 나뉜다.

### 4. Safety policy 는 DBMS 별로 다르다

RDBMS 는 destructive DDL/DML preview 가 중요하다. DynamoDB 는 Scan 비용과 hot
partition 이 위험하다. Cassandra 는 partition key 없는 query 가 위험하다.
Elasticsearch 는 wildcard delete/delete-by-query 가 위험하다. Graph DB 는
path explosion 과 detach delete 가 위험하다.

## DataSourceProfile

모든 data source 는 아래 정보를 선언해야 한다.

```ts
interface DataSourceProfile {
  id: DatabaseType;
  paradigm: DataParadigm;
  connectionKind: ConnectionKind;
  languages: QueryLanguageId[];
  catalogModel: CatalogModelKind;
  resultKinds: ResultEnvelopeKind[];
  capabilities: DataSourceCapabilities;
  safetyPolicy: SafetyPolicyId;
}
```

`DatabaseType` 은 identity 이고, `DataParadigm` 은 workbench 선택 기준이다.

## Paradigm Map

| Paradigm | Examples | Primary language | Catalog model | Primary result |
|---|---|---|---|---|
| `rdb` | PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, SQL Server, ClickHouse | SQL | schema/table/view/column/index/constraint/FK | tabular |
| `document` | MongoDB | mongosh/MQL | database/collection/index/validator/view | document, tabular |
| `kv` | Redis, Valkey | redis-command | database/key/type/TTL/stream | key-value, stream |
| `search` | Elasticsearch, OpenSearch | search-dsl | index/mapping/alias/template | searchHits, aggregations |
| `wide-column` | Cassandra, ScyllaDB | CQL | keyspace/table/partitionKey/clusteringKey/materializedView | tabular |
| `cloud-document` | DynamoDB | PartiQL + native API | table/keySchema/GSI/LSI/stream/capacity | document, tabular |
| `graph` | Neo4j, Memgraph | Cypher/GQL/Gremlin | label/relationshipType/property/index | graph, path, tabular |
| `vector` | Qdrant, Milvus, Pinecone | vector-query/filter DSL | collection/vectorSchema/payloadIndex | vectorNeighbors |
| `stream` | Kafka, Redpanda | stream command/API | topic/partition/consumerGroup/schema | records, metrics |

New paradigm 추가는 ADR 이 필요하다.

## Connection Kinds

| Kind | Examples | Required fields |
|---|---|---|
| `server` | PostgreSQL, MySQL, Redis | host, port, auth, TLS |
| `file` | SQLite, DuckDB | file path, read-only flag, permission scope |
| `url` | Elasticsearch/OpenSearch single endpoint | URL, auth mode, TLS |
| `cloud-api` | DynamoDB, Pinecone | region/endpoint, credential reference, profile |
| `cluster` | Cassandra, Elastic cluster | contact points, auth, TLS, topology hints |

Connection forms must be generated from a connection profile, not hard-coded
from `dbType`.

## Capability Profile

Minimum capability groups:

- connection: `test`, `switchDatabase`, `readOnly`, `filePicker`
- query: `query`, `multiStatement`, `cancel`, `explain`
- catalog: `browse`, `schema`, `indexes`, `constraints`, `relationships`
- edit: `editRows`, `editDocuments`, `editKeys`, `bulkWrite`
- DDL: `createTable`, `alterTable`, `createIndex`, `dropObject`
- intelligence: `erd`, `schemaDiff`, `dataCompare`, `columnProfile`
- operations: `activity`, `locks`, `slowQueries`, `stats`, `serverInfo`
- paradigm-specific: `keyBrowser`, `searchDocuments`, `vectorSearch`,
  `accessPatternModeler`, `graphExplorer`, `streamConsumer`

UI policy: a feature is enabled only when the active profile explicitly declares
the capability. Missing capability means disabled/hidden with a clear fallback,
not optimistic runtime failure.

## Adapter Contracts

`RdbAdapter` remains the mature contract for SQL/table/schema/DDL/edit. Redis
now has the first live `KvAdapter` slice for key browsing, value reads, guarded
string writes, TTL mutation, delete plumbing, and bounded stream reads. Valkey
is a protocol-compatible candidate, but parity/support remains unverified until
it has explicit adapter and test evidence. Bounded stream reads can return the
`streamRecords` result envelope, but this does not enable the broader
`streamConsumer` capability; consumer groups, pub/sub, cluster administration,
and module-specific management remain follow-up.
`SearchAdapter` has a live contract/profile slice for Elasticsearch/OpenSearch:
fixture-backed identities, index/alias/mapping/template catalog reads, bounded
Search DSL execution, delete-by-query safety planning, and typed `searchHits`
rendering. Live HTTP catalog/search execution, cluster administration, and
observability are deferred.

Future adapter families:

- `RdbAdapter`: SQL, table browse, DDL, row edit, ERD.
- `DocumentAdapter`: collection browse, document query/edit, index/validator.
- `KvAdapter`: Redis first slice live; Valkey parity and broader KV support follow after explicit verification.
- `SearchAdapter`: index/mapping browse, search, aggregations, document edit.
- `WideColumnAdapter`: keyspace/table browse, CQL, partition-key safety.
- `CloudDocumentAdapter`: table/index/capacity model, native API, PartiQL.
- `GraphAdapter`: graph catalog, Cypher/GQL/Gremlin execution, graph result.
- `VectorAdapter`: collection browse, vector search, payload filters.
- `StreamAdapter`: topic browse, consume/produce, offsets, consumer groups.

## Language Registry

Every query surface must declare a `queryLanguage`, separate from `queryMode`.
`queryMode` is legacy compatibility for old RDB/Mongo tabs and history.

Required language contract:

- parser owner: Rust/WASM or TypeScript fallback
- completion owner and fallback policy
- cursor offset policy
- safety analyzer
- supported / unsupported syntax documented in `docs/query-language-support.md`

Hot-path parser/completion should follow ADR 0045: Rust/WASM language core where
practical, with TypeScript adapters at UI boundaries.

### MongoDB Current Profile

MongoDB is the live `document` source in the profile registry. Its canonical
query language is `mongosh`, its catalog model is `document`, its declared
result envelopes are `document` and grid-compatible `tabular`, and its safety
policy is `document-default`.

Workspace tabs must use `queryLanguage: "mongosh"` for routing metadata. Legacy
`queryMode` may survive only on rehydrated old tabs as `find` or `aggregate`;
history/load paths must not promote method names back into tab routing state.

## Result Envelope

Query execution must return one of the declared result envelopes.

```ts
type ResultEnvelope =
  | { kind: "tabular"; columns: ColumnInfo[]; rows: unknown[][] }
  | { kind: "document"; documents: unknown[] }
  | { kind: "keyValue"; entries: KeyValueEntry[] }
  | { kind: "searchHits"; hits: SearchHit[]; aggregations?: unknown }
  | { kind: "graph"; nodes: GraphNode[]; edges: GraphEdge[] }
  | { kind: "vectorNeighbors"; points: VectorNeighbor[] }
  | { kind: "streamRecords"; records: StreamRecord[] }
  | { kind: "metrics"; values: MetricValue[] };
```

`QueryResultGrid` may render `tabular`, but it must not become the universal
renderer for non-tabular data.

## Schema Graph

ERD must be implemented as reusable `SchemaGraph`, not as a one-off canvas.

`SchemaGraph` should power:

- ERD rendering
- FK navigation
- schema diff
- migration impact analysis
- dependency graph

RDBMS gets full ERD. Document/search/graph/vector paradigms may expose their own
catalog graph, but they are not forced into RDB ERD semantics.

## Adding A New Data Source

Before implementation starts, the phase contract must answer:

1. Which paradigm does it belong to?
2. Does an adapter contract already exist, or is a new adapter ADR needed?
3. What connection kind and fields are required?
4. Which capabilities are supported, unsupported, and deferred?
5. Which query languages are accepted?
6. What catalog model is exposed?
7. What result envelopes can execution return?
8. What safety policies are mandatory?
9. What local fixture, testcontainer, emulator, or cloud-mock strategy verifies it?
10. Which docs are updated: `docs/PLAN.md`, `docs/ROADMAP.md`,
    `docs/query-language-support.md`, and phase docs.

## Anti-Patterns

- Adding a DBMS by only extending `DatabaseType` and switch statements.
- Showing all paradigms through RDB table/grid/ERD metaphors.
- Raw arbitrary script execution without a typed parser/dispatch boundary.
- Feature enablement by `dbType` checks instead of capabilities.
- Persisting file paths, cloud endpoints, or query text without applying the
  query-history privacy policy.

## Current Roadmap Application

Near-term:

1. Current code alignment: wrap existing `DatabaseType`, `Paradigm`,
   `ActiveAdapter`, workspace query state, and query result state in the
   profile/capability/queryLanguage/result-envelope model without changing user
   behavior.
2. Profile foundation: declare profiles for existing PostgreSQL, MySQL,
   MariaDB, SQLite, and MongoDB before adding new DBMS types.
3. Capability migration: move feature enablement from `dbType` switch checks to
   capability lookup, preserving existing UI.
4. Query/result migration: demote legacy `queryMode` to compatibility and add
   `queryLanguage` plus typed result envelopes at boundaries.
5. Adapter normalization: expose current `RdbAdapter` behavior through profile
   capabilities, keep Redis mapped to the live `KvAdapter` slice, and keep
   Search implementation scoped to the live `SearchAdapter` contract slice until
   HTTP catalog/search execution lands.
6. RDBMS parity: MySQL semantic depth, MariaDB, SQLite.
7. DuckDB + file analytics as `rdb` + `file` connection kind.
8. ERD / schema graph on top of RDB catalog data.
9. Redis first slice is live through `KvAdapter`; Valkey parity/support and
   broader KV workflows remain follow-up until explicitly verified.
10. Elasticsearch/OpenSearch live HTTP catalog/search execution, admin, and
    observability on top of the fixture-verified `SearchAdapter` slice.
11. MongoDB full support remains document-paradigm backlog.
12. Cassandra/DynamoDB/graph/vector/stream wait until profile + capability +
   result envelope contracts are implemented.
