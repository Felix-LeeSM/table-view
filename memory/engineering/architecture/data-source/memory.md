---
title: Data source architecture
type: memory
updated: 2026-05-28
surface: src-tauri/src/db/**, src/lib/**, src/types/dataSource*, src/types/queryLanguage*
task: data-source, architecture, adapter, capability
trigger:
  signal: DBMS 추가 / adapter 변경 / capability 변경 / query result envelope 변경
  layer: index
---

# Data Source Architecture

새 data source 는 `DatabaseType` switch 를 늘려 붙이지 않는다. 먼저 profile,
adapter, language/catalog/result, safety/capability contract 를 정의한다.

## Core Contract

모든 source 는 다음을 선언한다.

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

`DatabaseType` 은 identity 다. Workbench 선택과 UI affordance 는
`DataParadigm` + capability 를 본다.

## Layer Rules

1. `DataSourceProfile` 을 먼저 만든다.
2. Existing adapter family 를 재사용하거나 새 adapter contract 를 먼저 정의한다.
3. Query surface 는 `queryLanguage`, catalog model, typed result envelope 로 라우팅한다.
4. Destructive/expensive/privacy-sensitive path 는 safety policy 를 가진다.

Capability 가 없으면 UI 는 hide/disable + fallback 을 보여준다. Runtime optimistic
failure 를 기본 동작으로 만들지 않는다.

## Paradigm Map

| Paradigm | Examples | Primary language | Catalog model | Primary result |
|---|---|---|---|---|
| `rdb` | PostgreSQL, MySQL, MariaDB, SQLite, DuckDB | SQL | schema/table/view/column/index/constraint/FK | tabular |
| `document` | MongoDB | mongosh/MQL | database/collection/index/validator/view | document, tabular |
| `kv` | Redis, Valkey | redis-command | database/key/type/TTL/stream | key-value, stream |
| `search` | Elasticsearch/OpenSearch | search-dsl | index/mapping/alias/template | searchHits, aggregations |
| `wide-column` | Cassandra/ScyllaDB | CQL | keyspace/table/partition/clustering | tabular |
| `cloud-document` | DynamoDB | PartiQL/native API | table/keySchema/GSI/LSI | document, tabular |
| `graph` | Neo4j/Memgraph | Cypher/GQL/Gremlin | label/relationship/property/index | graph, path, tabular |
| `vector` | Qdrant/Milvus/Pinecone | vector-query/filter DSL | collection/vectorSchema/payloadIndex | vectorNeighbors |
| `stream` | Kafka/Redpanda | stream command/API | topic/partition/consumerGroup/schema | records, metrics |

새 paradigm 은 ADR 이 필요하다.

## Adapter Families

- `RdbAdapter`: SQL, table browse, DDL, row edit, ERD.
- `DocumentAdapter`: collection browse, document query/edit, index/validator.
- `KvAdapter`: Redis backend primitives, key browser, and value preview exist.
  Value edit, TTL/write, stream UI, and broader KV/Valkey support require
  follow-up evidence.
- `SearchAdapter`: fixture-backed Search slice. Live HTTP requires explicit connection/auth/catalog/search contracts.
- `WideColumnAdapter`, `CloudDocumentAdapter`, `GraphAdapter`, `VectorAdapter`,
  `StreamAdapter`: future contracts only.

## Result And Graph Rules

Query execution returns a declared envelope: `tabular`, `document`, `keyValue`,
`searchHits`, `graph`, `vectorNeighbors`, `streamRecords`, or `metrics`.
`QueryResultGrid` may render `tabular`; it must not become the universal renderer
for non-tabular data.

ERD work should build reusable `SchemaGraph`, not a one-off canvas. RDBMS gets FK
ERD semantics; other paradigms may expose catalog graphs without pretending to be
RDB schemas.

## Anti-Patterns

- Adding a source only by extending `DatabaseType` and switch statements.
- Showing every paradigm through RDB table/grid/ERD metaphors.
- Arbitrary script execution without typed parser/dispatch.
- Enabling features by `dbType` checks instead of capabilities.
- Persisting file paths, cloud endpoints, or query text without privacy/export policy.

## Related

- [adding data source](adding/memory.md)
- [query language](../query-language/memory.md)
- [fixture strategy](../../conventions/testing-scenarios/fixtures/memory.md)
- [roadmap](../../../../docs/ROADMAP.md)
- [historical snapshot](../../../../docs/archives/design-snapshots/data-source-architecture-2026-05-27.md)
