---
title: Data Source Architecture
type: memory
updated: 2026-06-15
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
  backendAdapter: BackendAdapterProfile;
  dialect: DataSourceDialectMetadata;
  fileConnection?: FileConnectionContract;
}
```

`DATA_SOURCE_PROFILES` 는 모든 `DatabaseType` identity 를 포함한다. Profile 존재는
runtime support claim 이 아니다. Connection dialog/runtime 노출은
`capabilities.connection.test` 로 gate 한다.

TS/Rust strict profile parity 는 `tests/fixtures/data-source-profile-parity.report.json`
을 SOT 로 두고 `src/types/dataSourceProfileParity.test.ts` 와
`src-tauri/tests/data_source_profile_parity.rs` 가 검증한다. TS `capabilities` 와
Rust `adapter_contract` 는 runtime/support posture 이며 strict parity field 가 아니다.
Runtime/support posture 는 `src/types/adapterConformance.ts`, Rust profile contract
tests, and `docs/contributor-guide/testing-and-quality.md` evidence rows 가 소유한다.

`DatabaseType` 은 identity 다. Workbench 선택과 UI affordance 는
`DataParadigm` + capability 를 본다. Backend adapter, dialect, file connection
contract 도 profile registry 에서 읽고 ad-hoc `dbType` switch 로 분산하지 않는다.

## Backend Contract Boundary

`src-tauri/src/db/contracts` 는 backend trait/DTO contract import path 다.
`src-tauri/src/db/capabilities` 는 backend capability/profile import path 다.
`src-tauri/src/db/adapters/<dbms>` 는 concrete adapter home 이다. Legacy
`db::<dbms>`, `db::traits`, `db::types` 는 migration 중 shim/re-export 로만 둔다.

Command layer 는 DBMS behavior 를 소유하지 않는다: request validate →
`AppState` active connection resolve → `ActiveAdapter::as_*()?` paradigm gate →
adapter/storage call → `AppError` 반환만 한다.

Adapter trait DTO 는 backend public contract 다. Tauri/store-facing DTO 는
user-facing IPC contract 이며 `camelCase`, compatible default, alias, documented
normalizer 로만 확장한다. Error boundary 는 `AppError` 다. `Cancel` /
`DbMismatch` 는 typed envelope, 다른 variant 는 legacy string compatibility 를
유지한다. Frontend 분기는 `src/lib/tauri/error.ts` normalizer 를 통하고, 테스트는
문자열만 맞추지 말고 variant/envelope 를 단언한다.

Contract/delta test ownership 은 `src/types/adapterContractTestMatrix.ts` 가 고정한다.
Query/result 는 #765, catalog/explain 은 #766, completion metadata 는 #767,
safety/capability unsupported delta 는 #768 이 owner 다. Common expectation 은
DBMS delta 가 아니며, delta 는 DBMS/version/dialect/paradigm/capability/evidence
축과 fixture/live/support-claim boundary 를 명시해야 한다.

## Layer Rules

1. `DataSourceProfile` 을 먼저 만든다.
2. Existing adapter family 를 재사용하거나 새 adapter contract 를 먼저 정의한다.
3. Query surface 는 `queryLanguage`, catalog model, typed result envelope 로 라우팅한다.
4. Destructive/expensive/privacy-sensitive path 는 safety policy 를 가진다.

Capability 가 없으면 UI 는 hide/disable + fallback 을 보여준다. Runtime optimistic
failure 를 기본 동작으로 만들지 않는다.

Current posture summary lives here only as architecture boundary; product wording
and evidence detail live in product/contributor docs.

MSSQL is active for lifecycle, bounded query/result, primary-key row edit,
bounded structured table/index/constraint DDL, catalog/workbench metadata,
representative Runtime Happy Path smoke, live cached catalog-aware completion,
and bounded static parser/Safe Mode metadata. SQL Server TLS-required workflow,
SQLCMD/admin/security/backup/jobs/users/roles, broader auth/encryption, instance
discovery, and full T-SQL semantic parity remain separate contracts.

Oracle is active for service-name lifecycle, bounded query/result/table browse,
primary-key row edit, bounded structured DDL, catalog/workbench metadata
including read-only sequences/synonyms, representative smoke, catalog-aware
completion, and bounded static parser/Safe Mode metadata. Raw DDL/admin,
sequence/synonym DDL/admin, SID/TNS/wallet/TLS, and full PL/SQL executable
semantics remain separate contracts.

Redis and Valkey are active KV profiles with bounded connection/key browse/value
preview and command-query slices. Redis has direct key mutation controls for the
supported panel paths; Valkey keeps direct key mutation controls and full Redis
compatibility unclaimed until Valkey-specific evidence promotes them.

Elasticsearch/OpenSearch are active Search profiles for live HTTP connection,
catalog/index detail, bounded live `_search`, backend Search DSL validation,
Runtime Happy Path smoke, and delete-by-query safety planning. Embedded fixtures
remain contract evidence; actual live `_delete_by_query` and broader admin APIs
remain deferred.

Cassandra/Scylla, DynamoDB, graph, vector, stream 은 workflow value, profile target,
connection kind, language owner, catalog model, result envelope, safety policy,
fixture strategy 가 잠기기 전 active `DatabaseType`/profile/runtime 으로 추가하지
않는다.

## Paradigm Map

| Paradigm         | Examples                                   | Primary language        | Catalog model                                | Primary result           |
| ---------------- | ------------------------------------------ | ----------------------- | -------------------------------------------- | ------------------------ |
| `rdb`            | PostgreSQL, MySQL, MariaDB, SQLite, DuckDB | SQL                     | schema/table/view/column/index/constraint/FK | tabular                  |
| `document`       | MongoDB                                    | mongosh/MQL             | database/collection/index/validator/view     | document, tabular        |
| `kv`             | Redis, Valkey                              | redis-command           | database/key/type/TTL/stream                 | key-value, stream        |
| `search`         | Elasticsearch/OpenSearch                   | search-dsl              | index/mapping/alias/template                 | searchHits, aggregations |
| `wide-column`    | Cassandra/ScyllaDB                         | CQL                     | keyspace/table/partition/clustering          | tabular                  |
| `cloud-document` | DynamoDB                                   | PartiQL/native API      | table/keySchema/GSI/LSI                      | document, tabular        |
| `graph`          | Neo4j/Memgraph                             | Cypher/GQL/Gremlin      | label/relationship/property/index            | graph, path, tabular     |
| `vector`         | Qdrant/Milvus/Pinecone                     | vector-query/filter DSL | collection/vectorSchema/payloadIndex         | vectorNeighbors          |
| `stream`         | Kafka/Redpanda                             | stream command/API      | topic/partition/consumerGroup/schema         | records, metrics         |

새 paradigm 은 ADR 이 필요하다.

## Adapter Families

Backend adapter modules use a progressive topology. `src-tauri/src/db/contracts`
is the canonical trait/DTO contract import path, `src-tauri/src/db/capabilities`
is the backend capability/profile import path, and
`src-tauri/src/db/adapters/<dbms>` is the canonical concrete adapter home.
Legacy `db::<dbms>`, `db::traits`, and `db::types` paths stay as shims/re-exports
until call sites migrate. Move one DBMS per PR; prefer file-backed/local-testable
adapters before server-backed adapters; do not widen runtime support or product
capability claims during topology moves.

- `RdbAdapter`: SQL, table browse, DDL, row edit, ERD.
- `DocumentAdapter`: collection browse, document query/edit, index/validator.
- `KvAdapter`: Redis/Valkey backend primitives support connection/list DB,
  bounded key scan, typed value read, guarded write/delete/TTL paths, bounded
  stream read, and selected command query dispatch. Full CLI/admin parity,
  cluster/pubsub/modules, consumer-group management, broad destructive commands,
  and full Redis compatibility need follow-up evidence.
- `SearchAdapter`: Elasticsearch/OpenSearch support live HTTP connection,
  catalog/index detail, bounded `_search`, Search result envelopes, and
  destructive-plan contracts. Fixture harness remains contract evidence. Actual
  delete-by-query execution, broader admin APIs, observability/profile/explain
  workflows, and product-specific widening need separate promotion gates.
- `WideColumnAdapter`, `CloudDocumentAdapter`, `GraphAdapter`, `VectorAdapter`,
  `StreamAdapter`: future contracts only.

## Result And Graph Rules

Query execution returns a declared envelope: `tabular`, `document`, `keyValue`,
`searchHits`, `graph`, `vectorNeighbors`, `streamRecords`, or `metrics`.
`QueryResultGrid` may render `tabular`; it must not become the universal renderer
for non-tabular data.

ERD work should build reusable `SchemaGraph`, not a one-off canvas. RDBMS gets
relationship semantics from catalog/FK metadata; other paradigms may expose
catalog graphs without pretending to be RDB schemas.

RDB catalog model 의 `index/constraint/FK` 는 target contract 다. schemaStore 의
현재 cache owner 범위는 schemas/tables/views/functions/postgresExtensions/
tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers 다. Production
ERD/`SchemaGraph` input 은 schema/table/column cache 와 cached/fetched explicit
index/constraint cache 를 함께 사용한다. `ColumnInfo` PK/FK/CHECK metadata 는
explicit metadata 가 비어 있을 때 synthetic constraint 보강에 사용한다.

Dependency view and migration impact summaries extend the shared
`SchemaGraph`/catalog input path. Future dense-view work should use the same
path. Duplicate catalog parsing 금지. 현재 FK navigation 은 DataGrid cell/icon
path 이며 ERD interaction claim 이 아니다. Migration export 는
`SchemaTree`/`useMigrationExport` delegate path 이고 `SchemaGraph` dependency/impact surface 가 아니다.

## Anti-Patterns

- Adding a source only by extending `DatabaseType` and switch statements.
- Showing every paradigm through RDB table/grid/ERD metaphors.
- Arbitrary script execution without typed parser/dispatch.
- Enabling features by `dbType` checks instead of capabilities.
- Treating profile presence as runtime support.
- Persisting file paths, cloud endpoints, or query text without privacy/export policy.

## Related

- [adding data source](adding/memory.md)
- [query language](../query-language/memory.md)
- [fixture strategy](../../conventions/testing-scenarios/fixtures/memory.md)
- [roadmap](../../../../docs/ROADMAP.md)
- [historical snapshot](../../../../docs/archives/design-snapshots/data-source-architecture-2026-05-27.md)
