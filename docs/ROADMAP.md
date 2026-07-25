# Table View 장기 로드맵

## 목적

미래 목표와 다음 승격 후보를 관리하는 전략 문서다. 현재 제품 상태는
`docs/product/README.md` 가 SOT이고, `docs/PLAN.md` 는 이 파일로 들어오는
호환 인덱스다.

본 문서는 sprint 번호를 배정하지 않는다. Implementation sprint 번호는
`docs/sprints/sprint-N/` 에서 배정한다. 기본은 실행 직전 배정이지만, 사용자가
sequencing 을 명시 요청하면 별도 sprint contract queue 에 번호와 의존성을 먼저
잡을 수 있다.

## 북극성

기존 데스크톱 DB 클라이언트 사용자가 핵심 워크플로우를 잃지 않고 Table View 로
전환할 수 있어야 한다.

핵심 워크플로우:

1. 연결
2. 탐색
3. 조회/쿼리
4. 편집
5. 안전한 검토/커밋
6. 문제가 생겼을 때 서버 상태 확인

전략 제약:

- Local-first desktop app. Credentials, history, settings, app state 는 사용자가
  명시적으로 export 하지 않는 한 로컬에 남긴다.
- RDBMS parity 를 먼저 닫는다: PostgreSQL, MySQL, MariaDB, SQLite, 그 다음
  DuckDB/file analytics.
- 새 `DatabaseType` 추가는 기존 지원 DBMS 하나가 데스크톱 DB 클라이언트 수준의
  query/workbench parity 에 도달할 때까지 시작하지 않는다 (ADR 0060). 이미 active 인
  `DatabaseType` 의 capability 확장은 이 제약 밖이며, 깊이 우선 순서는 승격 후보
  목록이 권고한다. Full admin parity 는 여전히 scope 밖이다. Search index/settings
  admin execution 과 broader Search smoke 는 freeze 가 아니라 각자의 promotion gate
  때문에 deferred 다 — live `_delete_by_query` 실행은 #1076 으로 이미 승격됐다. MSSQL 은
  bounded catalog/query/cancel/tabular enterprise RDBMS slice 로 제한하고 Oracle 은
  bounded catalog/query/cancel/tabular/edit-row runtime slice 로 연다. SQL Server auth/TDS/T-SQL
  contract 와 Oracle service/SID/TNS/wallet/Oracle SQL contract 는 source-specific
  promotion evidence 없이 shared abstraction 으로 숨기지 않는다.
  edit/DDL/parser/completion/runtime smoke/admin claim 은 각 source 의
  matching evidence 가 landing 하기 전까지 만들지 않는다.
- Cassandra/Scylla, DynamoDB, graph DB, vector DB, stream source 는 workflow 와
  adapter contract 가 명확해질 때까지 candidate paradigm 으로만 둔다.
- SQL/mongosh completion/parser vocabulary 는 Rust/WASM 이 소유한다. TypeScript
  fallback mirror 는 compatibility 용도다.
- 위험한 write 는 preview, Safe Mode, 명시 confirmation 을 통과한다.
- 완료/비활성 planning 은 `docs/archives/` 로 이동한다. `docs/PLAN.md` 는
  roadmap/product 인덱스로만 유지한다.

## 지평 순서

| 지평 | 목표 | 이 순서인 이유 | 종료 신호 |
|---:|---|---|---|
| H1 | 현재 코드 -> data-source architecture 정렬 | RDBMS + DuckDB + Redis/Search/Graph/Vector 확장을 그냥 붙이면 switch sprawl 이 커진다. 추가 기능 전 기존 코드를 새 구조에 넣어야 한다. | 현재 `DatabaseType`/`Paradigm`/`ActiveAdapter`/workspace query/result path 가 profile, capability, query language, result envelope 로 감싸지고 사용자 회귀가 없다. |
| H2 | RDBMS parity | 현재 아키텍처가 가장 강한 영역이고, 사용자에게 보이는 gap 이 기존 DB 클라이언트 전환 blocker 다. | 지원 DBMS 하나가 query/workbench parity gate 를 통과한 뒤 새 `DatabaseType` 을 추가한다 (ADR 0060). 기존 엔진의 capability 확장은 이 gate 를 기다리지 않는다. |
| H3 | DuckDB + file analytics | Local-first file analytics 는 새 paradigm 없이 RDBMS 작업을 확장한다. | `.duckdb` raw SQL, registered local CSV/Parquet/JSON/NDJSON preview basics, source-scoped SELECT UI/API evidence, and documented file privacy/export boundary 가 green 이다. |
| H4 | RDBMS intelligence | ERD, migration preview, and read-only schema diff reuse the shared `SchemaGraph`/catalog input path. Duplicate catalog parsing 은 만들지 않는다. | Production ERD 는 schema/table/column cache 와 cached/fetched explicit index/constraint metadata 를 함께 쓰는 reusable `SchemaGraph` 를 사용한다. Read-only dependency view 는 selected table 의 FK/index/constraint/CHECK diagnostics 를 보여주며, DDL preview/confirm flow 는 table/column/constraint/index removal migration-impact summaries 를 같은 graph 에서 보여준다. Read-only schema diff compares cached RDBMS snapshots through the same graph path. Dense ERD desktop/narrow screenshot smoke is wired; data compare remains a future promotion gate. |
| H5 | First-class non-RDBMS | Redis/Valkey, Elasticsearch/OpenSearch, MongoDB 가 가장 명확한 non-RDBMS 사용자 workflow 를 덮는다. | MongoDB 는 whitelisted document workflow 로, Redis 는 bounded KV browser/value mutation + command/query/completion + representative smoke 로, Valkey 는 connection/key scan/value preview + selected stream read + bounded command query runtime slice + Redis 와 동일한 string/hash/list/set/zset KvMutationPanel write controls (#1075) + proven-row command completion + Runtime Happy Path smoke 로, Elasticsearch/OpenSearch 는 live connection/catalog/query + backend-bounded Search DSL validator + Runtime Happy Path smoke + fixture/live delete-by-query safety planning + bounded TypeScript editor completion 으로 support claim 이 정렬돼 있다. Live `_delete_by_query` 실행은 #1076 으로 승격돼 Safe Mode confirm gate 뒤에서 지원된다. Search index/settings admin execution, full language-core parser/completion ownership, observability, and broader Search smoke 는 각자의 promotion gate 를 통과할 때까지 deferred 다 (freeze 사유가 아니다 — ADR 0060). |
| H6 | 더 넓은 paradigm | Cassandra, DynamoDB, graph DB, vector DB, stream source 는 active work 전 명확한 workflow proof 가 필요하다. | MSSQL 은 bounded catalog/query/cancel/tabular/edit-row capability 와 representative smoke 로, Oracle 은 bounded catalog/query/cancel/tabular/edit-row capability, bounded Safe Mode/editor assistance, and representative smoke 로 허용한다. Wider source 는 candidate-only 계약으로 정렬된다. Profile target, connection kind, language, catalog model, result envelope, safety policy, fixture strategy 가 문서화되고 각 source 의 matching evidence 없이 DDL/admin/full parser-completion/future smoke widening claim 은 생기지 않는다. |
| H7 | 운영, 보안, 신뢰성 | 넓은 source support 는 관찰 가능하고 안전하며 반복 검증 가능해야 한다. | 현재 CI/hook/E2E/security/a11y/perf claim 과 future gate routing 이 실제 설정에 맞게 정렬된다. 새 routine gate 는 owner/runtime cost/actionability 가 잠긴 뒤에만 승격한다. |

## 완료 horizon

H1, H2, H5, H6 enterprise slice, H7 의 gate ledger 는 2026-07-26 live GitHub
audit 에서 참조 이슈가 전부 closed 라
[`docs/archives/plans/roadmap-closed-gates-2026-07-26.md`](archives/plans/roadmap-closed-gates-2026-07-26.md)
로 분리했다. 현재 지원 경계는 [`docs/product/README.md`](product/README.md) 와
[`docs/product/known-limitations.md`](product/known-limitations.md) 가 SOT 다.
아래 표는 라우팅 요약이며, gate/owner/boundary 원문은 archive snapshot 이 갖는다.

| 지평 | 닫힌 범위 | 남은 후속 라우팅 |
|---:|---|---|
| H1 | data-source profile/capability foundation, adapter contract normalization, query language ownership, result envelope boundary, product/support claim boundary | server-native result envelope wire format, `useQueryExecution` decomposition, DBMS별 live smoke 확대 → H3/H4 와 Open Follow-Up Queue |
| H2 | PostgreSQL query/workbench parity lane, MySQL/MariaDB runtime smoke baseline + bounded structure DDL, SQLite file-DBMS write/parity, 각 lane 의 docs/test recheck | Open Follow-Up Queue 의 `RDBMS parity`, `Query language widening`, `Query/result boundary` 행 |
| H5 | MongoDB whitelisted document workflow, Redis/Valkey bounded KV + command runtime, Elasticsearch/OpenSearch live connection/catalog/query + Safe Mode gate 뒤 `_delete_by_query` (#1076) | Search index/settings admin execution, broader Search smoke, Redis/Valkey 확장 → Open Follow-Up Queue 의 `Search`, `Redis/Valkey`, `MongoDB` 행 |
| H6 (enterprise slice) | MSSQL / Oracle bounded catalog/query/cancel/tabular/edit-row runtime + #907 representative smoke | MSSQL/Oracle DDL·admin·full parser/completion widening → Open Follow-Up Queue 의 `MSSQL/Oracle` 행. Wider candidate 계약은 아래 H6 섹션에 남아 있다. |
| H7 | PR/main CI gate 구성, local hook path routing, fixture/test topology, Runtime E2E smoke matrix, destructive/credential policy | a11y/perf/link-check/platform smoke 승격 → Open Follow-Up Queue 의 `Quality gates` 행 |

H3 (DuckDB/file analytics) 와 H4 (RDBMS intelligence) 는 열린 이슈가 남아 있어
아래에 유지한다.

## H3 진행 기준

H3 DuckDB/file analytics 는 **local-first file analytics 를 RDBMS + `file`
connection kind 안에서 닫는 정합성 gate**다. DuckDB 를 별도 file-SQL paradigm 으로
승격하지 않고, `.duckdb` raw SQL, registered local file preview,
source-scoped SELECT UI/API evidence, global editor SELECT smoke,
extension/external-file blocklist, privacy/export boundary 를 현재 지원 claim 에
맞춘다.

| Gate | Current owner | H3 boundary |
|---|---|---|
| DuckDB profile/modeling | `src/types/dataSource.ts`, `src/types/dataSource.test.ts` | DuckDB is `rdb` + `file`; profile presence does not imply full write/DDL/admin parity. |
| `.duckdb` raw SQL path | `src-tauri/src/db/duckdb.rs`, `src-tauri/src/db/duckdb/ddl.rs`, `src-tauri/tests/duckdb_browse_query_adapter.rs` | Statement-level raw SQL reads and DML are active. Native structural DDL (table create/drop/rename, column add/drop/type, index create/drop) is active as ADR 0051 Stage 2 (#1070); constraint add/drop and identity/auto-increment columns (Stage 2b rebuild-swap / sequence path) and dry-run/multi-statement transactions (Stage 3) are not yet implemented — the adapter rejects both with `Unsupported` and the matching UI controls are capability-hidden. |
| File analytics preview basics | `src/components/query/DuckdbFileAnalyticsDialog.test.tsx`, `src/lib/tauri/fileAnalytics.test.ts`, `src-tauri/tests/duckdb_file_analytics.rs` | CSV/Parquet/JSON/NDJSON registration and preview are active-session local-file flows that do not expose absolute paths. |
| Source metadata/workbench parity | `src/components/schema/SchemaTree.dbms-shape.test.tsx`, `src/lib/tauri/fileAnalytics.test.ts`, `src-tauri/tests/duckdb_file_analytics.rs`, #465 | Registered source aliases, columns, and preview SQL are exposed as active-session workbench metadata without absolute local paths. Workbench refresh clears active-session source state; disconnect still clears it through the connection lifecycle. |
| Registered-source SELECT paths | `src/components/query/DuckdbFileAnalyticsDialog.test.tsx`, `src/components/query/QueryTab/useQueryExecution.test.tsx`, `src/components/query/QueryHistoryPanel.per-tab.test.tsx`, `src/stores/queryHistoryStore.retire.test.ts`, `src/components/shared/QueryHistorySourceBadge.tsx`, `src/lib/tauri/fileAnalytics.test.ts`, `src-tauri/tests/duckdb_file_analytics.rs`, #468/#875/#877 | Dialog read-only SELECT evidence exists for a registered source alias; the QueryTab global editor keeps the normal result surface while DuckDB backend SELECT can reference active-session registered aliases without source-id plumbing; successful dialog and global-editor source queries use the distinct `FILE` / `file-analytics` history source label. Import and automatic export workflows are not claimed. |
| Extension/external-file gate | `src-tauri/src/db/duckdb.rs`, `docs/product/query-language-support.md` | Extension install/load, extension helper functions, `COPY`, `ATTACH`/`DETACH`, sensitive capability settings, replacement scans, and raw external-file functions are adapter-blocked. |
| Smoke/verification matrix | `scripts/e2e-smoke-ci.sh`, `scripts/hooks/test-e2e-smoke-workflow.sh`, `e2e/smoke/duckdb.spec.ts`, `e2e/smoke/duckdb-file-analytics.spec.ts`, `docs/contributor-guide/testing-and-quality.md` | DuckDB has separate deterministic desktop smokes: `.duckdb` open/catalog/table browse/raw SELECT/history/read-only evidence, and registered deterministic CSV source -> global editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute local path in visible UI. File analytics import/export smoke remains future promotion work before those claims widen; source-scoped dialog and global-editor file analytics history have focused evidence above. The ADR 0051 Stage 2 structural DDL write path (#1070) is covered by Rust round-trip evidence in `src-tauri/src/db/duckdb/ddl.rs` only; a DuckDB structured-DDL runtime smoke is a separate future promotion gate, matching how the MySQL/MariaDB bounded DDL smoke was promoted on its own. |
| DuckDB documentation recheck | `docs/product/README.md`, `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, `docs/contributor-guide/testing-and-quality.md`, #535 | Product docs separate runtime, parser/Safe Mode blocklists, autocomplete assistance, wired `.duckdb` smoke evidence, wired file analytics smoke evidence, active source-scoped and global-editor file analytics history evidence, and future file analytics automatic import/export gates. This gate does not close remaining implementation/test issues by itself. |
| DuckDB support-claim closure audit | `docs/product/README.md`, `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, `docs/contributor-guide/testing-and-quality.md`, #469/#875/#877/#879/#880 | Final support-claim audit confirms DuckDB docs and evidence docs agree on `.duckdb` Runtime Happy Path smoke, dedicated file analytics Runtime Happy Path smoke, registered-source preview/query/history/privacy/global-editor/global-query-backend evidence, parser/Safe Mode blocklists, completion-assistance boundaries, fixture-only boundaries, and future file analytics automatic import/export gates. No extension install/load, admin, or automatic import/export parity is promoted by this audit. |

H3 umbrella closure means DuckDB/file analytics support claims, runtime gates, and
verification routing are aligned. It does not mean DuckDB has full desktop-client
parity or extension semantics.

## H4 진행 기준

H4 RDBMS intelligence 는 ERD/schema graph claim 과 검증 라우팅을 현재 구현
상태에 맞추는 정합성 gate 다. Production ERD 는 schema-store cache 와
cached/fetched explicit index/constraint metadata 를 `SchemaGraph` input 으로
쓴다. Read-only dependency view, migration-impact summaries, and cached
read-only schema diff 는 이 shared graph/catalog path 를 재사용한다. Future
data compare 는 이 shared graph/catalog path 를 확장해야 하며 duplicate catalog
parsing 은 만들지 않는다.

| Gate | Current owner | H4 boundary |
|---|---|---|
| Schema metadata cache | `src/stores/schemaStore.ts`, `src/stores/schemaStore.tableMetadataCache.test.ts`, `src/stores/schemaStore.clearForConnection.test.ts` | schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers 가 current cache owner 범위다. |
| Production ERD graph input | `src/components/schema/SchemaErdPanel.tsx`, `src/lib/schemaGraphSnapshot.ts`, `src/components/schema/SchemaErdPanel.test.tsx`, `src/lib/schemaGraphSnapshot.test.ts` | Visible-table indexes/constraints are fetched when missing and passed into `SchemaGraph`; `ColumnInfo` PK/FK/CHECK metadata remains a synthetic fallback. |
| Reusable graph model | `src/lib/schemaGraph.ts`, `src/lib/schemaGraphRelationships.ts`, `src/components/schema/SchemaErdLayout.ts`, `src/components/schema/SchemaErdRenderer.test.tsx` | Graph extraction, relationship normalization, layout/search/selection, and renderer controls are reusable beyond one visual panel. |
| Read-only dependency view | `src/components/schema/SchemaErdRenderer.tsx`, `src/components/schema/SchemaErdRenderer.test.tsx`, `src/components/schema/SchemaErdPanel.test.tsx` | Selected ERD tables show incoming/outgoing FK tables/columns, related indexes/constraints, CHECK expressions, and visible metadata/SchemaGraph diagnostics without claiming FK row navigation. |
| Migration impact summaries | `src/lib/schemaGraphSelectors.ts`, `src/components/schema/SchemaGraphMigrationImpactSummary.tsx`, `src/hooks/useSchemaGraphIntelligence.ts`, `src/components/schema/DropTableDialog.tsx`, `src/components/schema/DropColumnDialog.tsx`, `src/components/structure/IndexesEditor.tsx`, `src/components/structure/ConstraintsEditor.tsx` | Table, column, constraint, and index removal previews show cached SchemaGraph impact summaries for dependent tables/columns/indexes/constraints/FKs and metadata diagnostics. This extends the existing DDL preview/confirm flow only; it does not change backend SQL generation/execution semantics. |
| Read-only schema diff | `src/lib/schemaGraphDiff.ts`, `src/components/schema/SchemaGraphDiffPanel.tsx`, `src/components/schema/SchemaErdPanel.tsx` | Cached same-source and cross-source RDBMS snapshots can be compared through SchemaGraph for table, column, index, constraint, and FK add/remove/change groups. The panel is read-only and does not add apply/migration execution, data compare, import/export, admin, or DuckDB registered-file-alias claims. |
| FK navigation boundary | `src/components/datagrid/DataGridTable.fk-navigation.test.tsx`, `docs/product/known-limitations.md` | Current FK row navigation is the DataGrid cell/icon path. ERD selection/search/zoom/focus/highlight are local diagram interactions, not row navigation claims. |
| Future intelligence surfaces | `memory/engineering/architecture/data-source/memory.md`, this roadmap | Data compare surfaces must extend `SchemaGraph`/catalog input before product claim promotion. |
| Smoke/verification matrix | `docs/contributor-guide/testing-and-quality.md`, `e2e/smoke/erd-dense.spec.ts` | Dense ERD desktop/narrow screenshot smoke is wired for seeded PostgreSQL graph render/search/selection/zoom/fit evidence. It does not claim FK row navigation through ERD, schema diff, migration impact, or data compare. |

H4 umbrella closure means ERD/SchemaGraph support claims, reusable graph ownership,
cached read-only schema diff, dense ERD smoke, and smoke routing are aligned. It
does not mean data compare or migration/apply execution has shipped.

### ERD 캔버스 v1 MVP 경계 (2026-07-24 오너 grill)

ERD 캔버스 설계는 ADR 0054–0057 로 이미 잠겨 있다 (React Flow+elkjs 렌더러,
가상 FK polymorphic, layout persist/reconcile/undo, facet 필터). 아래는 설계
재론이 아니라 v1 MVP 경계와 빌드 순서를 확정한 로드맵 스코핑이다 — 위 gate
테이블은 현재 shipped `SchemaErd*` panel 상태이고, 이 캔버스는 그 위에 얹는
React Flow+elkjs rebuild 다.

**v1 = 읽기전용 + 레이아웃 안정화.** layout persist 는 단순 편집 기능이 아니라
elkjs 매-열람 자동재배치의 세션 간 안정성 문제라 v1 에 포함한다. 가상 FK 편집은
v2 로 이월한다.

| Slice | 분류 | 추적 | 근거 |
|---|---|---|---|
| React Flow+elkjs 렌더러 + semantic zoom | v1 | ADR 0054 | 가시 기능 baseline. semantic zoom 기본은 v1. |
| facet 필터 | v1 | #1657, ADR 0057 | |
| schema diff 하이라이트 | v1 | #1662 | |
| layout persist/undo | v1 | #1660, ADR 0056 | 매-열람 elkjs 재배치의 세션 간 안정성을 닫는 것이 v1 목표. |
| 가상 FK 렌더/추론/referential action | v2 | #1659 / #1668 / #1665, ADR 0055 | 편집 계열은 v2 이월. |
| viewport 가상화 + worker 레이아웃 | 후속 | #1658 (성능 부분) | 실제 대형 스키마 성능 pain 신호 후 승격. 현재 수백 테이블 fixture 없음 (YAGNI). |
| 워크플로우 연결 | park | #1667 | 의도 불명확. v1 범위 밖, 별도 확인 후 재스코핑. |

**빌드 순서**: 가시 기능 우선 — React Flow 기본 캔버스 + semantic zoom 위에
persist/facet/diff 를 먼저 얹는다. #1658 성능 작업(viewport 가상화/worker
레이아웃)은 실제 대형 스키마 성능 pain 신호 후로 이월한다.

**a11y 내장 원칙**: #1663 (keyboard nav + color+shape 이중 인코딩)은 별도 후기
게이트가 아니라 각 v1 기능에 내장한다.

## H6 진행 기준 — wider source candidate

MSSQL/Oracle bounded runtime slice 는 닫혔다 (위 완료 horizon 표, archive
snapshot). 남은 H6 범위는 Cassandra/Scylla, DynamoDB, graph, vector, stream
candidate 계약이다. 아직 active `DatabaseType`/profile/runtime/parser/completion,
fixture/live evidence, 또는 E2E smoke claim 이 없다. Full admin parity,
import/export, profiler/activity, role/user/permission UI, broad scripting 은
source-specific evidence 전까지 out of scope 다.

| Gate | Current owner | H6 boundary |
|---|---|---|
| Wider candidate workflow proof | `docs/product/README.md`, `docs/product/known-limitations.md`, `docs/product/query-language-support.md`, `docs/contributor-guide/testing-and-quality.md`, `memory/engineering/architecture/data-source/memory.md`, `memory/engineering/architecture/data-source/adding/memory.md`, this roadmap | Cassandra/Scylla, DynamoDB, graph, vector, and stream remain candidate-only: no active `DatabaseType`/profile/runtime/parser/completion, fixture/live evidence, or E2E smoke claim. Promotion requires workflow value, profile target, connection kind, language, catalog model, result envelope, safety policy, fixture strategy, conformance scope, and docs/memory routing before implementation. |
| Candidate source contract inventory | this roadmap, `docs/product/README.md`, `docs/product/query-language-support.md` | Candidate targets are inventoried below. They are profile targets, not active profile entries. |
| Parser/completion/runtime non-claim | `docs/product/query-language-support.md`, `docs/product/known-limitations.md` | Deferred language ids, wider-source candidate inventory, MSSQL runtime/edit/smoke slice, and Oracle #905/#906/#907 runtime/edit/Safe Mode/editor-assistance/smoke slice do not create active structured DDL, admin, full parser/completion promotion, PLSQL, profile/runtime, fixture/live, E2E, or broader SQL Server/Oracle semantics claims by themselves. Future smoke/runtime widening must land in later source-specific PRs with matching evidence. |

Candidate target inventory:

| Candidate | Profile target | Connection kind | Language | Catalog model | Result envelope | Safety / fixture plan |
|---|---|---|---|---|---|---|
| Cassandra/Scylla | `wide-column` | `cluster` | `cql` with future Rust/WASM language-core owner | keyspace/table/partition/clustering | `tabular` | partition-key and expensive-read guardrails; future evidence path is a Cassandra testcontainer baseline plus a Scylla testcontainer compatibility delta before any Scylla claim |
| DynamoDB | `cloud-document` | `cloud-api` | native API-first; `partiql` deferred editor/query-language inventory | table/keySchema/GSI/LSI | `document`, `tabular` | access-pattern, cost, IAM, and credential guardrails; DynamoDB Local/emulator or bounded mock future-only; threat-model handoff before auth/KDF/ACL/secrets/provider decisions |
| Graph | `graph` | `server` | Cypher-first; GQL/Gremlin deferred split | labels/relationships/properties/indexes | `graph` envelope with path view, plus `tabular` projection | traversal/write guardrails; future Neo4j-compatible fixture graph/testcontainer for Cypher baseline; GQL/Gremlin fixtures deferred |
| Vector | `vector` | `server`; cloud providers need separate `cloud-api` profile decision | future `vector-query` or provider filter DSL | collection/vectorSchema/payloadIndex | `vectorNeighbors` | topK/filter/write/delete guardrails; embedded/mock or container fixture future-only; threat-model handoff before cloud credential/provider decisions |
| Stream | `stream` | `cluster` | `stream-command` or typed API decision; language-core parser deferred | topic/partition/consumerGroup/schema | `streamRecords`, `metrics` | offset/consumer lag/replay/commit guardrails; produce/admin/destructive deferred; Kafka baseline plus Redpanda compatibility fixture as future non-routine CI inventory |

Cassandra/Scylla remains one wide-column candidate contract until promotion
evidence proves product-specific deltas. The future Cassandra baseline must prove
cluster connection, keyspace/table/partition/clustering catalog, bounded CQL
reads/writes, tabular rendering, partition-key guardrails, and expensive-read
blocking. A Scylla compatibility testcontainer is a separate future delta before
any Scylla-specific support claim. This inventory does not add active runtime,
connection UI, parser/completion, fixture/live, or smoke support.

DynamoDB remains a candidate-only source contract. Its promotion target is a
cloud-backed `cloud-document` profile with `cloud-api` connection kind. The
query/workflow route is native API-first because DynamoDB access patterns,
capacity/cost, IAM, and credential boundaries are API-shaped; `partiql` stays a
deferred editor/query-language inventory item until a later source-specific PR
proves it. The catalog owns table, keySchema, GSI, and LSI metadata. Result
rendering uses `document` envelopes for item payloads and `tabular` projections
for table-like previews. Future evidence must define access-pattern, scan/cost,
IAM, and credential guardrails; DynamoDB Local/emulator or bounded mock fixtures
are future-only inventory, not routine Runtime Happy Path wiring. Auth, KDF,
ACL, secrets, and provider decisions require a threat-model handoff before any
implementation. This inventory does not add active runtime, connection UI,
parser/completion, fixture/live, or smoke support.

Graph remains a candidate-only source contract. Its promotion target is a
server-backed `graph` profile with Cypher first; GQL and Gremlin are explicit
deferred language splits. The graph-source catalog owns
labels/relationships/properties/indexes and stays separate from the RDBMS
`SchemaGraph` used for ERD/FK metadata. Result rendering uses the existing
`graph` envelope for node/edge and path-shaped views, plus `tabular` projections
for query tables. A new top-level path envelope requires an ADR or architecture
note before implementation. Future evidence must prove traversal/write
guardrails and a Neo4j-compatible fixture graph/testcontainer before any active
runtime, connection UI, parser/completion, fixture/live, or smoke claim.

Vector remains a candidate-only source contract. Its promotion target is a
server-backed `vector` profile; cloud providers require a separate `cloud-api`
profile decision before provider or credential choices. The language route is a
future `vector-query` or provider filter DSL only, so no parser/completion owner
is active. The vector-source catalog owns collection, vectorSchema, and
payloadIndex metadata. Result rendering uses `vectorNeighbors`. Future evidence
must prove topK limits, metadata filter guardrails, write/delete gating, and an
embedded/mock or container fixture strategy before any runtime path. Cloud
credentials, provider selection, ACL, secrets, and KDF decisions require a
threat-model handoff before implementation. This inventory does not add active
runtime, connection UI, parser/completion, fixture/live, or smoke support.

Stream remains a candidate-only source contract. Its promotion target is a
cluster-backed `stream` profile with a `stream-command` or typed API decision
before any language-core parser/completion ownership. The stream catalog owns
topic/partition/consumerGroup/schema inventory. Result rendering uses
`streamRecords` for bounded consume/read output and `metrics` for lag,
throughput, and broker/consumer evidence. Future evidence must prove bounded
consume/read behavior, offset/consumer lag/replay/commit guardrails, and
produce/admin/destructive gating. Produce/admin support is deferred. Kafka is the
future baseline fixture target and Redpanda is a compatibility delta; both remain
future non-routine CI inventory, not routine Runtime Happy Path wiring. This
inventory does not add active runtime, connection UI, parser/completion,
fixture/live, or smoke support.

Promotion order for wider candidates is decided by workflow value and contract
readiness: clear user workflow first, then adapter-family fit, language/core
ownership, fixture/live evidence, and safety risk. Candidate rows do not imply
implementation order.

## 트랙 맵

| 트랙 | 장기 방향 | 현재 기준 |
|---|---|---|
| Data-source architecture | 새 DBMS/support surface 는 profile, capability, adapter, language, catalog, result envelope, safety contract 를 통해 들어온다. | `memory/engineering/architecture/data-source/memory.md`, `memory/engineering/architecture/data-source/adding/memory.md`, ADR 0046 |
| RDBMS runtime | 불확실한 paradigm 을 넓히기 전에 PostgreSQL, MySQL, MariaDB, SQLite, DuckDB/file analytics support 를 강하게 만든다. | `docs/product/README.md`, historical phase notes in `docs/archives/phases/retired/phase-18.md` and `docs/archives/phases/retired/phase-19.md` |
| Non-RDBMS runtime | Redis 와 MongoDB 는 runtime slice 가 있다. Valkey 는 connection/key scan/value preview, bounded command query runtime slice, proven-row completion, Runtime Happy Path smoke 가 있다. Elasticsearch/OpenSearch 는 live connection/catalog/query/destructive-plan, bounded Search DSL autocomplete, separated fixture contracts, and Runtime Happy Path smoke evidence 가 있다. Cassandra/Scylla, DynamoDB, graph, vector, stream 은 gated candidate 다. 새 `DatabaseType` 추가는 freeze 대상이고, 기존 엔진의 capability 확장은 freeze 밖이다 (ADR 0060). | `memory/engineering/architecture/data-source/memory.md`, `docs/product/README.md`, `docs/product/known-limitations.md` |
| Language core | 가능한 범위에서 Rust/WASM 이 hot-path parse/completion vocabulary, context routing, capability gate 를 소유한다. | `memory/engineering/architecture/query-language/memory.md`, ADR 0045, `docs/product/query-language-support.md`, `docs/archives/phases/completed/phase-31.md` |
| Query editor | Query surface 는 legacy `queryMode` 가 아니라 `queryLanguage` 와 workbench paradigm 으로 고른다. | `memory/engineering/architecture/data-source/memory.md`, ADR 0045, `docs/product/query-language-support.md` |
| Data editing | Preview/commit/discard, bulk operation, paradigm 별 edit semantics. | `docs/product/README.md`, `docs/product/known-limitations.md` |
| Schema / DDL | RDB DDL parity 는 대부분 닫혔고, ERD/schema graph 가 다음 reusable intelligence layer 다. | completed Phases 24-27, `memory/engineering/architecture/data-source/memory.md` |
| Operations | Core parity 이후 Explain/activity/stats/server info/profiler surface 를 다룬다. | `docs/product/known-limitations.md`, `docs/contributor-guide/testing-and-quality.md` |
| Security | Credential/key handling, role/user management, auth mechanism expansion, destructive action policy. | `.agents/skills/grill-with-memory/SKILL.md`, `docs/contributor-guide/testing-and-quality.md` |
| App state | SQLite-backed durable app state, query history, settings, keyring, cross-window sync. | `memory/engineering/architecture/state-management/memory.md` |
| Quality | CI, E2E smoke, perf/a11y baseline, testing reliability, refactor backlog burn-down. | `docs/contributor-guide/testing-and-quality.md`, `docs/archives/audits/code-smell-audit-2026-05-15.md` |
| CLI surface (`tvw`) | 자동화 + 에이전트 표면. one-shot v0.1 (SQL 코어 4종: PostgreSQL/MySQL/MariaDB/SQLite) → REPL + completion → 앱 지원 DBMS 확장 (CLI claim ⊆ 앱 claim 원칙) → `tvw mcp` 서버 모드. TUI 는 영구 non-goal. 새 DBMS claim 을 만들지 않는 surface 트랙이라 runtime promotion freeze (순서 규칙 3) 와 독립. | ADR 0058, GitHub milestone 33.00 |

## Open Follow-Up Queue

Open risks are no longer tracked in a standalone active risk register. Route each
item to the document that owns the decision:

- Product-visible support boundaries and known limitations:
  [`docs/product/known-limitations.md`](product/known-limitations.md).
- Developer-facing verification gaps:
  [`docs/contributor-guide/testing-and-quality.md`](contributor-guide/testing-and-quality.md).
- Historical risk IDs and prior register snapshots:
  [`docs/archives/risks/active-risk-register-2026-05-27.md`](archives/risks/active-risk-register-2026-05-27.md).

Near-term follow-up groups:

| Group | Follow-up |
|---|---|
| RDBMS parity | Keep PostgreSQL as the strongest query/workbench parity lane until a focused implementation slice promotes the next PostgreSQL gap with matching tests and smoke routing. Keep MySQL/MariaDB runtime smoke baselines narrow to connect/browse/query/edit/cancel/history/result-envelope behavior; add broader MySQL/MariaDB operation-level UI/runtime consumers only with matching evidence. Keep SQLite file-DBMS work scoped to writable-file DML, PK row edits, bounded structured table creation, raw SQL DDL rejection, and the current deterministic file smoke baseline. SQLite adapter 가 전면 차단하던 DDL 중 **SQLite 가 네이티브로 지원하는 축**의 개방은 #1804 로 승격됐다. 12-step ALTER rebuild 는 미도입 결정이고 (2026-07-25 오너 grill), rebuild 가 필요한 변경 (타입/제약 변경) 은 Structure UI 에서 disable + 사유 tooltip 을 유지한다. 실행 후 에러 매핑은 네이티브로 지원되는 `ADD COLUMN`/`DROP COLUMN` 의 조건부 실패에만 적용된다. raw SQL DDL 거부와 extension semantics 는 그대로 자체 구현 근거를 요구한다. Keep DuckDB split between `.duckdb` file smoke and file analytics smoke; file analytics does not promote COPY/ATTACH/DETACH, extension install/load, raw external-file SQL functions, automatic import/export workflow, structured DDL/write UI, or admin parity. |
| Query language widening | Widen SQL/Mongo client semantic support by tested slices: future MySQL/MariaDB routine-expression support only after the explicit unsupported scripting boundary is re-scoped, SQLite extension/capability semantics, server-version/capability gates, Mongo version/deployment gates, and extension-aware completion packs. DuckDB extension install/load and external-file capability settings are currently blocked by adapter gates; future DuckDB extension support needs detected capability evidence before completion/runtime claims widen. PostgreSQL completion packs must consume installed extension inventory before enabling curated extension-specific candidates. |
| Query/result boundary | Keep typed envelopes as the UI-facing boundary. 2026-07-25 오너 grill 이 `native tabular envelope 전환` 항목을 YAGNI 로 걷어냈다. 근거: `src-tauri/src/models/query.rs` 의 `QueryResult` 가 이미 `#[serde(rename_all = "camelCase")]` 라 전환으로 사라지는 것은 `src/lib/wireCamelCase.ts` 의 snake/camel 이중 수용 (죽은 방어) 하나뿐이고, `src/lib/tauri/numericWrap.ts` 의 `wrapNumericCells` 는 JSON 에 BigInt 타입이 없어 무엇을 해도 남는다. 실제 유지 고통이 생기면 그때 다시 올린다. |
| ERD/schema graph | 현재 schemaStore cache owner 범위는 schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers 이다. Production ERD/`SchemaGraph` input 은 schema/table/column cache 와 cached/fetched explicit index/constraint metadata 를 함께 쓰며, column-level FK info 는 synthetic fallback 으로 남아 있다. FK navigation 은 현재 DataGrid cell/icon path 이며 ERD interaction claim 이 아니다. Read-only dependency view 는 selected table 의 incoming/outgoing FK, index, constraint, CHECK expression, metadata diagnostics 를 보여준다. Migration impact summaries and read-only cached schema diff reuse the shared `SchemaGraph`/catalog input path. Dense ERD desktop/narrow screenshot smoke is wired; follow-up 은 data compare (#1796) 다 — 2026-07-25 오너 grill 이 읽기전용 row diff 로 lock 했다 (쓰기/동기화 SQL 생성 없음, row cap 내에서만 비교하고 초과 시 잘림 배너). Duplicate catalog parsing 금지. |
| Redis/Valkey | Redis first slice is backend KV primitives, key browser/value preview/edit UI, selected-key bounded stream reader, bounded command query runtime/completion, current-DB/type-filtered key suggestions, and representative connect/scan/preview/GET/guarded-write/TTL/delete smoke. Valkey first slice is connection/key scan/value preview plus selected-key bounded stream reader, bounded command query, the shared Redis/Valkey string plus hash/list/set/zset KvMutationPanel write controls (#1075), Runtime Happy Path smoke, focused local testcontainer evidence, and proven-row command completion. 2026-07-25 오너 grill 이 잔여 축 전부 지원을 결정하고 5건으로 분해했다: parser/completion vocabulary 를 Rust/WASM 으로 **먼저** 이전하고 (#1805 — 지금 20개일 때 옮기는 게 ~200개로 불린 뒤 옮기는 것보다 싸다), 그 뒤 allowlist 대확장 (#1806 — 읽기 진단·원자 연산·키 관리·multi-key·consumer-group), scripting/admin 쓰기 (#1807 — `EVAL_RO`/`EVALSHA_RO`/`FCALL_RO` 는 읽기 tier, `EVAL`/`FCALL`/`SCRIPT LOAD`/`FUNCTION LOAD`/`CONFIG SET` 은 destructive tier), pub/sub (#1808), cluster (#1809). consumer-group 전용 UI (#1806 은 명령 allowlist 만 덮고 UI 는 범위 밖이다), full CLI/admin parity, modules, full Redis compatibility 는 소유 이슈 없이 계약·근거 미정으로 남는다. |
| MongoDB | Keep support to tested whitelisted document workflows (`src/lib/mongo/mongoshMethods.ts` 의 16개 메서드). 2026-07-25 오너 grill 실측에서 기존 서술 2개가 stale 로 판명됐다: `safe native document-first panels` 는 이미 `src/components/document/` 에 17개 존재하고 (`AddDocumentModal`, `BsonTypeEditor`, `DocumentTreePanel`, `NestedExpandPopover`, `ValidatorPanel`, `MongoIndexesPanel`, `CollectionDdlDialog` 등), 집계 파이프라인은 allowlist 가 아니라 denylist 라 `src/lib/mongo/mongoSafety.ts` 가 `$out`/`$merge` 만 destructive 로 잡고 나머지는 이미 열려 있다. 실제 남은 공백은 네 축이다: (1) `buildInfo`/`serverStatus` 로 수집만 하고 소비처가 0건인 server version/topology 를 capability 로 승격 (#1821 — 나머지 축의 선행), (2) change streams `watch()` (#1822 — replica set 이상 필요, #1808 이 놓는 스트리밍 인프라 위에 쌓는다), (3) 다중 문서 트랜잭션 (#1823 — 세션 수명 관리, Safe Mode confirm 지점 미결), (4) `db.runCommand` 직접 실행 (#1824 — 명령 tier 분류, 미분류는 destructive 기본값). `$function` 서버사이드 JS 를 포함한 arbitrary JavaScript/shell behavior 는 여전히 미지원이다. |
| Search | Keep actual Elasticsearch/OpenSearch index/settings admin execution deferred. Elasticsearch/OpenSearch live connection/catalog/query, backend-bounded Search DSL validation, delete-by-query safety planning, live `_delete_by_query` execution behind the Safe Mode confirm gate (#1076), bounded TypeScript Search DSL editor assistance, and representative Runtime Happy Path smoke are active; the smoke covers connect/auth/TLS contract, selected metadata, bounded render, delete-plan preview, live delete execution, and error surface. Promote broader live HTTP only after index/settings admin execution policy, broader observability/profile workflows, full language-core parser/completion ownership, and product-specific delta contracts are explicit. 2026-07-25 오너 grill 이 observability 축을 둘로 분해했다: 실행 시간 분해 profile (#1818 — `src-tauri/src/db/search_dsl.rs` top-level 허용 키에 `profile` 추가 + `ExplainViewer` search 브랜치. gate 선행조건은 이쪽이다) 과 문서별 스코어 계산 내역 `_explain` (#1819 — 결과 행 진입점, gate 를 당기지 않는다). |
| MSSQL/Oracle | Keep MSSQL at bounded catalog/query/cancel/tabular/edit-row enterprise RDBMS support with source-specific SQL-auth/TDS/encryption contract and #907 representative smoke, and keep Oracle at bounded service-name catalog/query/cancel/tabular/edit-row runtime support with bounded Safe Mode/editor assistance and #907 representative smoke. Future promotion must add matching DDL, full parser/completion, docs, and smoke evidence without hiding SQL Server and Oracle auth/dialect differences behind a shared abstraction. Keep full admin parity, import/export, profiler/activity, role/user/permission UI, broad scripting, MSSQL admin/full T-SQL semantics, and Oracle SID/TNS/wallet/advanced auth/structured DDL/raw DDL/admin/TLS/PLSQL semantics out of scope until separately proven. |
| Wider source candidates | Keep Cassandra/Scylla, DynamoDB, graph, vector, and stream as candidate-only. Do not add active `DatabaseType`, profile, runtime, parser/completion, fixture/live, or E2E support claims until workflow value and the full adding-data-source contract are locked. |
| Connection TLS/SSH/Oracle | 2026-07-17 오너 grill 이 연결 보안 lane 1차 범위를 lock 했다 (ADR 0053, `docs/explorations/{connection-tls-parity,ssh-tunnel,oracle-wallet-tns}-threat-model-2026-07-17.md` 결정 섹션). 1차 = core 2필드 TLS 어휘 통일 + pg/mysql sslmode enum + warning-first 기본값 (#1063), SSH 터널 잔여 축 (#1064, ADR 0052 위), Oracle A1 SID+Service (#1065). Advanced TLS depth-step — CA 파일·클라이언트 인증서·1단 엔진 sslmode 확장·`verify-ca`·TOFU 인증서 핀 검토 — 는 #1649 로 후속 승격한다. Oracle 1-way TLS (TCPS + CA cert) 는 #1650 으로 advanced TLS CA 지원(#1649)에 의존해 묶는다. |
| Security / ops policy | Keep destructive/admin/security claims source-specific until a threat-model handoff and source-specific implementation own preview/confirm/dry-run/auditability. Users/roles/auth mechanism UI waits until source order is clear. |
| Quality gates | Promote a11y, perf, E2E isolation, link checking, dependency security CI, and platform smoke gaps from `testing-and-quality.md` only when they block an active feature lane and have owner/runtime-cost/triage paths. |
| Refactor backlog | Promote code-smell audit candidates only when they intersect active feature work or remove current maintenance cost. 2026-07-25 검증에서 기존 near-term candidate 3종이 전부 완료/규범화로 판명돼 걷어냈다 (#1790): `src/lib/runtime/**` 이동은 완료됐고, legacy 직접 `setState` 는 0건이며 ESLint `tv-local/no-direct-zustand-setstate` 가 강제하고, dialog preset mandate 는 이미 retired 다. 현재 등록된 near-term candidate 는 없다. |

## 순서 규칙

1. 새 partial workflow 를 추가하기 전에 눈에 보이는 미완성 workflow 를 먼저 닫는다.
2. connect/browse/query 만 노출하는 runtime 을 하나 더 붙이는 것보다, 기존 runtime
   깊이를 우선한다.
3. Runtime promotion freeze 는 **새 `DatabaseType` 추가**에만 적용한다 (ADR 0060).
   현재 대상은 wider candidate 5종 (Cassandra/Scylla, DynamoDB, graph, vector,
   stream) 이고, 해제 조건은
   `memory/engineering/architecture/data-source/adding/memory.md` 의 Required
   Contract 10항목 lock 이다. 이미 active 인 `DatabaseType` 의 capability 확장 —
   MSSQL 구조적 DDL, Oracle 런타임 슬라이스 해제, DuckDB DDL/batch, Redis/Valkey
   잔여 축, Search index/settings admin 실행, 기존 엔진 admin/import-export/profiler —
   은 freeze 밖이고 실행 bucket 은 GitHub milestone 22.50 "DBMS Parity - 엔진별 결손"
   또는 22.80 "Admin Parity - 단계 승격" 이다. freeze 밖은 착수 가능을 뜻할 뿐
   support claim 승격을 뜻하지 않는다 — 각 gate 의 evidence 요구는 그대로다. 얕은
   partial workflow 확산 방지는 순서 규칙 1·2 와 승격 후보 순서가 소유한다.
4. Query/workbench parity 범위는 SQL/MQL execution, parser/Safe Mode, completion,
   edit semantics, fixtures, e2e, support claim, dry-run 근처의 lightweight
   EXPLAIN/plan inspection 이다. Full admin surface 는 별도 선택 전까지 scope 밖이다.
5. Extension/plugin/module completion 은 detected capability pack 을 쓴다. DB 에서
   설치된 extension/module/plugin 을 발견하고, 발견된 known capability 에만 curated
   completion pack 을 켠다. Unknown capability 는 suggestion 을 지어내지 않고
   detected-but-unpacked 로 표시한다.
6. Parser/Safe Mode/completion support 는 명시돼야 한다. 현재 product-facing
   unsupported boundary 는 `docs/product/query-language-support.md` 에 둔다.
7. 새 DBMS 는 구현 시작 전
   `memory/engineering/architecture/data-source/adding/memory.md` 를 만족해야 한다.
8. 새 long-lived state 는 다음을 정의해야 한다:
   - source of truth
   - durability
   - privacy/export behavior
   - reset-to-default affordance
   - cross-window sync behavior
9. Shared UI 를 바꾸는 feature work 는 그 surface 를 공유하는 모든 paradigm 에 대한
   regression scope 를 포함해야 한다.
10. 완료/비활성 planning 은 archive 로 이동한다. `docs/PLAN.md` 는
   roadmap/product 인덱스로만 유지한다.

## 결정 게이트

Roadmap item 을 active implementation 으로 승격하기 전 필요한 것:

| Gate | 필요 산출물 |
|---|---|
| 사용자 논의 | 구현 시작 전 scope, order, non-goal 합의. |
| SOT check | `docs/product/README.md`, `docs/product/known-limitations.md`, `memory/engineering/**`, contributor docs 를 업데이트하거나 변경 없음으로 선언. |
| Follow-up check | 현재 제한은 product, 미래 work item 은 roadmap, 구조 제약은 `memory/engineering/architecture`, 개발/운영 제약은 `memory/engineering` 또는 contributor docs, 과거 사건은 archives 로 라우팅한다. |
| Contract check | 코딩 전 acceptance criteria 와 verification command 를 확정. |
| Architecture check | 지속 결정 변경 또는 이전 방향 뒤집기일 때만 ADR 필요. |
| Archive check | 오래된 draft/spec docs 는 archive 로 이동하거나 historical context 로 link. |

## 열린 질문

| 영역 | 질문 | 결정 전 기본값 |
|---|---|---|
| MariaDB | MySQL adapter reuse 를 단순하게 유지할 수 있나? | Dialect flag 로 reuse. Evidence 있을 때만 split. |
| SQLite DBMS | Unsupported `ALTER TABLE` 을 disable 할지 auto-rebuild 할지? | ADR 이 rebuild 를 선택하기 전까지 disable + tooltip. |
| DuckDB | File analytics 를 RDBMS 로 볼지 separate file-sql paradigm 으로 볼지? | Evidence 가 split 을 요구하기 전까지 RDBMS + `file` connection kind. |
| Redis/Search | Redis full UI/editor parity 와 Search index/settings admin execution 을 언제 승격할 수 있나? | 둘 다 freeze 밖이라 lane 통과를 기다리지 않는다 (ADR 0060). Search 는 admin destructive 실행 정책과 observability/profile-explain 계약이 선행이다 — live `_delete_by_query` 는 #1076 으로 이미 shipped. Redis full parity, broader Search smoke, remaining MSSQL/Oracle widening 은 evidence/smoke 비용 기준으로 고른다. |
| 더 넓은 paradigm | Cassandra/DynamoDB/graph/vector/stream 중 무엇을 먼저 승격하나? | H6 기본값은 candidate-only. Workflow value, contract readiness, fixture/live evidence, smoke/E2E cost, safety risk 가 분명해질 때까지 승격 금지. |
| App state | State-management migration 은 언제 재개하나? | DB support 작업이 storage/schema surface 와 충돌하지 않을 때. |
| Security | Users/roles/auth mechanism UI 는 언제 추가하나? | RDBMS/DuckDB/non-RDBMS source order 가 명확해진 뒤. |
| CLI (`tvw`) | REPL/completion, CLI DBMS 확장, `tvw mcp` 는 언제 승격하나? | v0.1 배포 + SQL 코어 4종 evidence 뒤. CLI DBMS claim 은 항상 앱 claim 의 부분집합 (ADR 0058). |

## 승격 후보

다음 작업을 고를 때는 이 목록, 현재 product docs, live issue state 를 먼저 본다.
`docs/phases/phase-32.md` 는 historical context 로만 사용한다. 아래 순서는 새
`DatabaseType` 추가에만 강제이고 (ADR 0060), 기존 엔진 작업에는 깊이 우선순위
권고다 — lane 선택 없이 milestone 22.50 / 22.80 으로 진행한다.

다음 승격 후보 순서:

1. One-DBMS query/workbench parity ladder. 지원 DBMS lane 하나만 골라
   runtime/parser/completion/edit/fixture/e2e/support-claim gap 을 닫고 다음 lane 을
   고른다. 고정 lane 순서: PostgreSQL -> MySQL/MariaDB -> SQLite/DuckDB -> MongoDB.
2. PostgreSQL query/workbench parity hardening.
3. MySQL-family semantic widening + MariaDB engine evidence/delta hardening.
4. SQLite DBMS write/parity + DuckDB file analytics hardening.
5. MongoDB whitelist/full-support parity hardening.
6. RDBMS ERD / `SchemaGraph`.
7. Redis/Valkey parity hardening.
8. Search admin HTTP promotion and OpenSearch smoke expansion.
9. Remaining MSSQL + Oracle enterprise RDBMS widening.
10. `tvw` CLI v0.1 — one-shot surface (ADR 0058). `table-view-core` crate 분리
    선행. Surface 트랙이라 순서 규칙 3 의 runtime freeze 대상이 아니며 기존
    DBMS lane 과 병행 가능. 실행 bucket 은 GitHub milestone 33.00.

이 순서를 바꾸면 이 파일을 업데이트한다. 현재 제품 상태가 달라지는 변경이면
`docs/product/README.md` 도 함께 업데이트한다.
