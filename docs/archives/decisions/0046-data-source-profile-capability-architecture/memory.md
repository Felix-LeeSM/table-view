---
id: 0046
title: data source extension — profile, capability, language, result envelope
status: Accepted
date: 2026-05-22
---

**결정**: Table View 의 장기 DBMS 확장은 `DatabaseType` switch 추가가 아니라
`DataSourceProfile + capability profile + language registry + result envelope`
구조를 기준으로 한다. RDBMS/DuckDB 는 기존 `RdbAdapter` 를 확장해 진행하되,
Redis/Valkey, Elasticsearch/OpenSearch, Cassandra/Scylla, DynamoDB, graph DB,
vector DB, stream source 는 각 paradigm adapter contract 와 workbench renderer 를
먼저 정의한 뒤 active implementation 으로 승격한다.

**이유**:

1. Paradigm 별 사용자 workflow 가 다르다. RDBMS 는 table/FK/ERD, Redis 는
   key/type/TTL, Search 는 index/mapping/search hits, Cassandra 는 partition
   key, DynamoDB 는 access pattern/GSI/LSI, graph DB 는 node-edge, vector DB 는
   nearest-neighbor + payload filter 가 핵심이다.
2. `if dbType` 분기는 DBMS 추가마다 UI/store/query/safety path 를 오염시킨다.
   Capability 가 있어야 feature enable/disable 이 명시된다.
3. Query language 와 result shape 이 독립적이다. SQL, CQL, Cypher, PartiQL,
   Redis command, Search DSL, vector filter DSL 은 parser/completion/safety 를
   따로 가진다. 결과도 tabular/document/key-value/searchHits/graph/vector 로
   나뉜다.
4. Safety policy 가 DBMS 별로 다르다. RDB destructive preview, Cassandra
   partition-key guard, DynamoDB scan/billing guard, Search wildcard delete guard,
   graph path explosion guard 를 한 SQL Safe Mode 로 흡수할 수 없다.

**구조**:

- `DataSourceProfile`: identity, paradigm, connection kind, languages, catalog
  model, result kinds, capabilities, safety policy.
- `CapabilityProfile`: UI feature gating 의 source. 없는 capability 는 hidden 또는
  disabled with explanation.
- `LanguageRegistry`: `queryMode` 대신 `queryLanguage` 를 기준으로 parser,
  completion, safety analyzer 를 선택한다. Hot path 는 ADR 0045 의 Rust/WASM
  boundary 를 따른다.
- `ResultEnvelope`: `tabular`, `document`, `keyValue`, `searchHits`, `graph`,
  `vectorNeighbors`, `streamRecords`, `metrics`.
- `SchemaGraph`: ERD 전용 canvas 가 아니라 FK navigation, schema diff,
  migration impact analysis 까지 공유하는 graph model.

**트레이드오프**:

- **+** DuckDB/file analytics 이후 Redis/Search/graph/vector 추가가 profile +
  adapter 작업으로 제한된다.
- **+** UI 가 RDB 은유에 갇히지 않고 paradigm-specific workbench 를 가질 수 있다.
- **+** unsupported feature 를 runtime error 가 아니라 capability 로 드러낼 수 있다.
- **-** 초기에는 profile/capability/result envelope 를 깔아야 하므로 단일 DBMS
  하나를 빠르게 붙이는 것보다 느리다.
- **-** adapter contract 수가 늘어난다. 새 paradigm 은 ADR 없이 추가하지 않는다.

**적용 순서**:

1. RDBMS parity + DuckDB/file analytics 는 `RdbAdapter` spine 에서 진행.
2. 새 DBMS phase 전 `docs/data-source-architecture.md` 의 10개 질문을 phase
   contract 에 답한다.
3. Redis/Valkey 전 `KvAdapter`, Elasticsearch/OpenSearch 전 `SearchAdapter` 를
   marker trait 에서 실제 contract 로 승격한다.
4. Cassandra/DynamoDB/graph/vector/stream 은 profile/capability/result envelope
   구현 뒤 backlog 에서 active 로 승격한다.

**관련**:

- `docs/data-source-architecture.md`
- `docs/ROADMAP.md`
- ADR 0010 — paradigm-aware UI staged evolution.
- ADR 0045 — language completion profile + WASM hot-path boundary.
