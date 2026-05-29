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
- 기존 지원 DBMS 하나를 데스크톱 DB 클라이언트 수준의 query/workbench parity 까지 끌어올리는
  동안 추가 DBMS/runtime 승격은 시작하지 않는다. Full admin parity 는 scope 밖이고,
  작업은 DBMS lane 하나씩 진행한다. Active parity lane 이 끝날 때까지 Search 는
  fixture-backed 로 유지하고, MSSQL/Oracle 은 planned identity 로만 유지한다.
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
| H2 | RDBMS parity | 현재 아키텍처가 가장 강한 영역이고, 사용자에게 보이는 gap 이 기존 DB 클라이언트 전환 blocker 다. | DBMS 하나씩 query/workbench parity gate 를 통과한 뒤 다음 DBMS/runtime 승격을 시작한다. |
| H3 | DuckDB + file analytics | Local-first file analytics 는 새 paradigm 없이 RDBMS 작업을 확장한다. | `.duckdb` raw SQL, registered local CSV/Parquet/JSON/NDJSON preview basics, source-scoped SELECT evidence, and documented file privacy/export boundary 가 green 이다. |
| H4 | RDBMS intelligence | ERD 와 향후 schema diff/data compare/migration preview 는 shared `SchemaGraph`/catalog input path 를 확장해 재사용한다. Duplicate catalog parsing 은 만들지 않는다. | Production ERD 는 현재 schema/table/column cache 와 `ColumnInfo` PK/FK/CHECK metadata 로 만든 `SchemaGraph` 를 사용한다. H4 종료 신호는 explicit constraint/index graph input owner 와 graph wiring(#189), parent tracking(#200), dependency view, migration impact analysis, dense-view screenshot smoke(#247) 를 별도 follow-up 으로 연결하는 것이다. |
| H5 | First-class non-RDBMS | Redis/Valkey, Elasticsearch/OpenSearch, MongoDB 가 가장 명확한 non-RDBMS 사용자 workflow 를 덮는다. | KV/Document runtime contract 가 같은 one-lane parity ladder 에 들어간다. Search 는 active parity lane 을 약화시키지 않고 HTTP support 를 넣을 수 있을 때까지 fixture-backed 로 유지한다. |
| H6 | 더 넓은 paradigm | Cassandra, DynamoDB, graph DB, vector DB, stream source 는 active work 전 명확한 workflow proof 가 필요하다. | 각 candidate 가 profile, connection kind, language, catalog model, result envelope, safety policy, fixture strategy 를 가진다. |
| H7 | 운영, 보안, 신뢰성 | 넓은 source support 는 관찰 가능하고 안전하며 반복 검증 가능해야 한다. | 핵심 ops/security/a11y/perf smoke path 가 routine gate 가 된다. |

## 트랙 맵

| 트랙 | 장기 방향 | 현재 기준 |
|---|---|---|
| Data-source architecture | 새 DBMS/support surface 는 profile, capability, adapter, language, catalog, result envelope, safety contract 를 통해 들어온다. | `memory/engineering/architecture/data-source/memory.md`, `memory/engineering/architecture/data-source/adding/memory.md`, ADR 0046 |
| RDBMS runtime | 불확실한 paradigm 을 넓히기 전에 PostgreSQL, MySQL, MariaDB, SQLite, DuckDB/file analytics support 를 강하게 만든다. | `docs/product/README.md`, historical phase notes in `docs/archives/phases/retired/phase-18.md` and `docs/archives/phases/retired/phase-19.md` |
| Non-RDBMS runtime | Redis/Valkey 와 MongoDB 는 runtime slice 가 있다. Elasticsearch/OpenSearch 는 live HTTP 전까지 fixture-backed 다. Cassandra/DynamoDB/graph/vector 는 gated candidate 다. 새 runtime promotion 은 active one-DBMS parity lane 뒤로 둔다. | `memory/engineering/architecture/data-source/memory.md`, `docs/phases/phase-28.md` |
| Language core | 가능한 범위에서 Rust/WASM 이 hot-path parse/completion vocabulary, context routing, capability gate 를 소유한다. | `memory/engineering/architecture/query-language/memory.md`, ADR 0045, `docs/product/query-language-support.md`, `docs/archives/phases/completed/phase-31.md` |
| Query editor | Query surface 는 legacy `queryMode` 가 아니라 `queryLanguage` 와 workbench paradigm 으로 고른다. | `memory/engineering/architecture/data-source/memory.md`, `docs/phases/phase-28.md` Slice A |
| Data editing | Preview/commit/discard, bulk operation, paradigm 별 edit semantics. | completed Phases 22-23, Phase 28 |
| Schema / DDL | RDB DDL parity 는 대부분 닫혔고, ERD/schema graph 가 다음 reusable intelligence layer 다. | completed Phases 24-27, `memory/engineering/architecture/data-source/memory.md` |
| Operations | Core parity 이후 Explain/activity/stats/server info/profiler surface 를 다룬다. | `docs/product/known-limitations.md`, `docs/contributor-guide/testing-and-quality.md` |
| Security | Credential/key handling, role/user management, auth mechanism expansion, destructive action policy. | `.agents/skills/grill-with-memory/SKILL.md`, `docs/contributor-guide/testing-and-quality.md` |
| App state | SQLite-backed durable app state, query history, settings, keyring, cross-window sync. | `memory/engineering/architecture/state-management/memory.md` |
| Quality | CI, E2E smoke, perf/a11y baseline, testing reliability, refactor backlog burn-down. | `docs/contributor-guide/testing-and-quality.md`, `docs/archives/audits/code-smell-audit-2026-05-15.md` |

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
| RDBMS parity | Route MySQL/MariaDB version-aware feature gates through server-version-aware profile context. Add MariaDB engine fixture evidence or keep support claims narrowed. |
| Query language widening | Widen SQL/Mongo client semantic support by tested slices: broader MySQL/MariaDB routine expressions, SQLite/DuckDB extension semantics, server-version/capability gates, Mongo version/deployment gates, and extension-aware completion packs. PostgreSQL completion packs must consume installed extension inventory before enabling curated extension-specific candidates. |
| Query/result boundary | Move RDBMS query IPC from legacy `QueryResult` compatibility toward typed result envelopes. |
| ERD/schema graph | 현재 schemaStore cache owner 범위는 schemas/tables/views/functions/postgresExtensions/tableColumnsCache/triggers 이고, indexes/constraints 는 cache 가 아니라 StructurePanel/migration export live IPC delegate 로 소비한다. Production ERD/`SchemaGraph` input 은 schema/table/column cache 와 column-level FK info 다. FK navigation 은 현재 DataGrid cell/icon path 이며 ERD interaction claim 이 아니다. Follow-up 은 shared `SchemaGraph`/catalog input path 를 확장해 explicit constraint/index input owner 와 graph wiring 을 정하고(#189, #200), dependency view, migration impact analysis, dense-view screenshot smoke(#247) 를 연결하는 것이다. Duplicate catalog parsing 금지. |
| Redis/Valkey | Define follow-up contracts for value edit, TTL/write, stream UI, Valkey parity, cluster, pub/sub, modules, and consumer-group management before broader support claims. |
| MongoDB | Keep support to whitelisted document workflows until version/deployment gates, safe native panels, and arbitrary shell policy are resolved. |
| Search | Promote Elasticsearch/OpenSearch live HTTP only after connection UI, auth/TLS, catalog/search execution, admin scope, and observability contracts are explicit. |
| Quality gates | Promote a11y, perf, E2E isolation, link checking, and platform smoke gaps from `testing-and-quality.md` when they block an active feature lane. |
| Refactor backlog | Promote code-smell audit candidates only when they intersect active feature work or remove current maintenance cost. Near-term candidates: move runtime-like lib/hook store orchestration into `src/lib/runtime/**`, replace legacy direct `setState` with store actions, and clean up dialog layout/preset drift without reintroducing the retired preset mandate. |

## 순서 규칙

1. 새 partial workflow 를 추가하기 전에 눈에 보이는 미완성 workflow 를 먼저 닫는다.
2. connect/browse/query 만 노출하는 runtime 을 하나 더 붙이는 것보다, 기존 runtime
   깊이를 우선한다.
3. Runtime promotion freeze: Search live HTTP, MSSQL, Oracle, 기타 새 DBMS lane 은
   현재 지원 DBMS 하나가 query/workbench parity lane 을 통과할 때까지 기다린다.
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
| MongoDB | Standalone server 에서 transaction toggle 은 어떻게 동작해야 하나? | Friendly failure + documented fallback. Silent partial commit 금지. |
| MongoDB | Query Editor 가 arbitrary shell behavior 를 얼마나 받아야 하나? | Whitelist only. Arbitrary JavaScript execution 금지. |
| MariaDB | MySQL adapter reuse 를 단순하게 유지할 수 있나? | Dialect flag 로 reuse. Evidence 있을 때만 split. |
| SQLite DBMS | Unsupported `ALTER TABLE` 을 disable 할지 auto-rebuild 할지? | ADR 이 rebuild 를 선택하기 전까지 disable + tooltip. |
| DuckDB | File analytics 를 RDBMS 로 볼지 separate file-sql paradigm 으로 볼지? | Evidence 가 split 을 요구하기 전까지 RDBMS + `file` connection kind. |
| Redis/Search | Marker trait 를 언제 active adapter 로 승격할 수 있나? | Active one-DBMS parity lane 이후만. 그 뒤 Search live HTTP 가 MSSQL/Oracle 보다 먼저 온다. |
| 더 넓은 paradigm | Cassandra/DynamoDB/graph/vector/stream 중 무엇을 먼저 승격하나? | Workflow value 와 profile contract 가 명확해질 때까지 승격 금지. |
| App state | State-management migration 은 언제 재개하나? | DB support 작업이 storage/schema surface 와 충돌하지 않을 때. |
| Security | Users/roles/auth mechanism UI 는 언제 추가하나? | RDBMS/DuckDB/non-RDBMS source order 가 명확해진 뒤. |

## 승격 후보

다음 작업을 고를 때 이 목록과 `docs/phases/phase-32.md` 부터 본다. Active lane 이
선택되기 전까지 sprint sequence 를 새로 만들지 않는다.

다음 승격 후보 순서:

1. 현재 코드 -> data-source architecture 정렬.
2. Data-source profile/capability foundation.
3. Query language / result envelope migration.
4. Adapter contract normalization.
5. One-DBMS query/workbench parity ladder. 지원 DBMS lane 하나만 골라
   runtime/parser/completion/edit/fixture/e2e/Explain gap 을 닫고 다음 lane 을
   고른다. 고정 lane 순서: PostgreSQL -> MySQL/MariaDB -> SQLite/DuckDB -> MongoDB.
6. PostgreSQL query/workbench parity hardening.
7. MySQL-family semantic widening + MariaDB engine evidence/delta hardening.
8. SQLite DBMS write/parity + DuckDB file analytics hardening.
9. MongoDB whitelist/full-support parity hardening.
10. RDBMS ERD / `SchemaGraph`.
11. Redis/Valkey parity hardening.
12. Elasticsearch/OpenSearch live HTTP promotion.
13. MSSQL + Oracle enterprise RDBMS lane.

이 순서를 바꾸면 이 파일을 업데이트한다. 현재 제품 상태가 달라지는 변경이면
`docs/product/README.md` 도 함께 업데이트한다.
