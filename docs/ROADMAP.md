# Table View 장기 로드맵

## 목적

본 문서는 미래 목표와 다음 승격 후보를 관리하는 전략 문서다. 현재 제품 상태는
`docs/product/README.md` 가 SOT 이고, `docs/PLAN.md` 는 이 파일을 가리키는
호환 인덱스다.

본 문서는 sprint 번호를 배정하지 않는다.

## 북극성

기존 데스크톱 DB 클라이언트를 쓰던 사용자가 핵심 워크플로우를 잃지 않고
Table View 로 전환할 수 있어야 한다.

핵심 워크플로우는 다음과 같다.

1. 연결
2. 탐색
3. 조회/쿼리
4. 편집
5. 안전한 검토/커밋
6. 문제가 생겼을 때 서버 상태 확인

전략 제약은 다음과 같다.

- Local-first desktop app. Credentials, history, settings, app state 는 사용자가
  명시적으로 export 하지 않는 한 로컬에 남긴다.
- RDBMS parity 를 먼저 닫는다. 그 순서는 PostgreSQL, MySQL, MariaDB, SQLite 이고
  그 다음이 DuckDB/file analytics 다.
- 새 `DatabaseType` 추가는 기존 지원 DBMS 하나가 데스크톱 DB 클라이언트 수준의
  query/workbench parity 에 도달할 때까지 시작하지 않는다 (ADR 0060). 이미 active 인
  `DatabaseType` 의 capability 확장은 이 제약 밖에 있고, 깊이 우선 순서는 승격 후보
  목록이 권고한다. Full admin parity 는 여전히 scope 밖이다. Search index/settings
  admin execution 과 broader Search smoke 는 freeze 때문이 아니라 각자의 promotion
  gate 때문에 deferred 다. 반면 live `_delete_by_query` 실행은 #1076 으로 이미
  승격됐다. MSSQL 은 bounded catalog/query/cancel/tabular enterprise RDBMS slice 로
  제한하고 Oracle 은 bounded catalog/query/cancel/tabular/edit-row runtime slice 로
  연다. SQL Server auth/TDS/T-SQL contract 와 Oracle service/SID/TNS/wallet/Oracle
  SQL contract 는 source-specific promotion evidence 없이 shared abstraction 으로
  숨기지 않는다. edit/DDL/parser/completion/runtime smoke/admin claim 은 각 source 의
  matching evidence 가 landing 하기 전까지 만들지 않는다.
- Cassandra/Scylla, DynamoDB, graph DB, vector DB, stream source 는 workflow 와
  adapter contract 가 명확해질 때까지 candidate paradigm 으로만 둔다.
- SQL/mongosh completion/parser vocabulary 는 Rust/WASM 이 소유한다. TypeScript
  fallback mirror 는 compatibility 를 위해 둔다.
- 위험한 write 는 preview 와 Safe Mode, 명시적인 confirmation 을 통과한다.
- 완료/비활성 planning 은 `docs/archives/` 로 이동한다. `docs/PLAN.md` 는
  roadmap/product 인덱스로만 유지한다.

## 지평 순서

| 지평 | 목표 | 이 순서인 이유 | 종료 신호 |
|---:|---|---|---|
| H1 | 현재 코드 -> data-source architecture 정렬 | RDBMS + DuckDB + Redis/Search/Graph/Vector 확장을 그냥 붙이면 switch sprawl 이 커진다. 추가 기능 전 기존 코드를 새 구조에 넣어야 한다. | 현재 `DatabaseType`/`Paradigm`/`ActiveAdapter`/workspace query/result path 가 profile, capability, query language, result envelope 로 감싸지고 사용자 회귀가 없다. |
| H2 | RDBMS parity | 현재 아키텍처가 가장 강한 영역이고, 사용자에게 보이는 gap 이 기존 DB 클라이언트 전환 blocker 다. | 지원 DBMS 하나가 query/workbench parity gate 를 통과한 뒤 새 `DatabaseType` 을 추가한다 (ADR 0060). 기존 엔진의 capability 확장은 이 gate 를 기다리지 않는다. |
| H3 | DuckDB + file analytics | Local-first file analytics 는 새 paradigm 없이 RDBMS 작업을 확장한다. | `.duckdb` raw SQL, registered local CSV/Parquet/JSON/NDJSON preview basics, source-scoped SELECT UI/API evidence, and documented file privacy/export boundary 가 green 이다. |
| H4 | RDBMS intelligence | ERD, migration preview, and read-only schema diff reuse the shared `SchemaGraph`/catalog input path. Duplicate catalog parsing 은 만들지 않는다. | Production ERD 는 schema/table/column cache 와 cached/fetched explicit index/constraint metadata 를 함께 쓰는 reusable `SchemaGraph` 를 사용한다. Read-only dependency view 는 selected table 의 FK/index/constraint/CHECK diagnostics 를 보여주며, DDL preview/confirm flow 는 table/column/constraint/index removal migration-impact summaries 를 같은 graph 에서 보여준다. Read-only schema diff compares cached RDBMS snapshots through the same graph path. Dense ERD desktop/narrow screenshot smoke is wired; data compare remains a future promotion gate. |
| H5 | First-class non-RDBMS | Redis/Valkey, Elasticsearch/OpenSearch, MongoDB 가 가장 명확한 non-RDBMS 사용자 workflow 를 덮는다. | MongoDB 는 whitelisted document workflow 로, Redis 는 bounded KV browser/value mutation + command/query/completion + representative smoke 로, Valkey 는 connection/key scan/value preview + selected stream read + bounded command query runtime slice + Redis 와 동일한 string/hash/list/set/zset KvMutationPanel write controls (#1075) + proven-row command completion + Runtime Happy Path smoke 로, Elasticsearch/OpenSearch 는 live connection/catalog/query + backend-bounded Search DSL validator + Runtime Happy Path smoke + fixture/live delete-by-query safety planning + bounded TypeScript editor completion 으로 support claim 이 정렬돼 있다. Live `_delete_by_query` 실행은 #1076 으로 승격돼 Safe Mode confirm gate 뒤에서 지원된다. Search index/settings admin execution, full language-core parser/completion ownership, observability, and broader Search smoke 는 각자의 promotion gate 를 통과할 때까지 deferred 다 (freeze 사유가 아니라고 ADR 0060 이 정한다). |
| H6 | 더 넓은 paradigm | Cassandra, DynamoDB, graph DB, vector DB, stream source 는 active work 전 명확한 workflow proof 가 필요하다. | MSSQL 은 bounded catalog/query/cancel/tabular/edit-row capability 와 representative smoke 로, Oracle 은 bounded catalog/query/cancel/tabular/edit-row capability, bounded Safe Mode/editor assistance, and representative smoke 로 허용한다. Wider source 는 candidate-only 계약으로 정렬된다. Profile target, connection kind, language, catalog model, result envelope, safety policy, fixture strategy 가 문서화되고 각 source 의 matching evidence 없이 DDL/admin/full parser-completion/future smoke widening claim 은 생기지 않는다. |
| H7 | 운영, 보안, 신뢰성 | 넓은 source support 는 관찰 가능하고 안전하며 반복 검증 가능해야 한다. | 현재 CI/E2E/security/a11y/perf claim 과 future gate routing 이 실제 설정에 맞게 정렬된다. 새 routine gate 는 owner/runtime cost/actionability 가 잠긴 뒤에만 승격한다. |

## 지평별 진행 기준

지평 순서는 위 `## 지평 순서` 가 소유한다. 각 지평 본문은 아래 child 페이지에 있고,
파일명이 곧 순서다.

1. [`H1 완료 기준`](roadmap/h1.md)
2. [`H2 진행 기준`](roadmap/h2.md)
3. [`H3 진행 기준`](roadmap/h3.md)
4. [`H4 진행 기준`](roadmap/h4.md)
5. [`H5 진행 기준`](roadmap/h5.md)
6. [`H6 진행 기준`](roadmap/h6.md)
7. [`H7 진행 기준`](roadmap/h7.md)

실행 대기열은 [`Open Follow-Up Queue`](roadmap/follow-up-queue.md) 에 있다.

## Refactor milestone routing audit

Last checked against live GitHub milestones/issues on 2026-06-12.

These rows are GitHub execution buckets, not `docs/PLAN.md` backlog rows.
`docs/ROADMAP.md` keeps sequencing and boundary summaries; GitHub milestones and
parent issues own child closure state. The compatibility-row classification rule
(`migration-only` / `permanent-wire-compatibility` / `removable-debt`) lives in
`memory/engineering/conventions/refactoring/memory.md` and, for the frontend
surface, in `memory/engineering/conventions/frontend/memory.md`, which adds a
clause the other does not: after Refactor 02 no new compatibility path is added
without removal evidence. The rows it classified are split across two frozen
audits: `docs/archives/audits/refactor-05-compatibility-ledger-2026-06-12.md`
holds the cross-surface table and accepts the frontend ledger in
`docs/archives/audits/refactor-02-frontend-compat-inventory-2026-06-10.md` by
reference instead of duplicating it (#758). Product support-claim wording lives
in `docs/product/**` (the `README.md`, `known-limitations.md`, and
`query-language-support.md` indexes plus their child pages), and the frozen
audit is `docs/archives/audits/refactor-05-support-claims-ledger-2026-06-12.md`
(#759).

| Bucket | Parent | Live GitHub state | Routing boundary |
|---|---|---|---|
| 09.10 Refactor 01 - Directory Topology | #572 | closed; 0 open / 6 closed issues | Repository topology inventory, generated/cache/tmp/worktree fences, source-root migration constraints, and docs/memory SOT. No frontend/backend domain moves. |
| 09.20 Refactor 02 - Frontend Domain Strangler | #573 | closed; 0 open / 17 closed issues | IPC boundary, frontend compatibility inventory, typed wrapper routing, connection/completion/query/catalog/result/workspace splits, import-boundary enforcement, and docs/memory SOT. |
| 09.30 Refactor 03 - Backend Adapter Contracts | #574 | closed; 0 open / 12 closed issues | TS/Rust profile parity, typed error envelopes, contract-test matrix, query/result/catalog/explain/completion/safety capability contracts, representative adapter topology, and docs/memory SOT. |
| 09.40 Refactor 04 - Fixtures And Test Topology | #575 | closed; 0 open / 13 closed issues | Fixture/test inventory, representative fixture/test slices, SQL and Document/KV/Search fixture topology, loader shim, SQL-core/UI test splits, smoke routing, unsupported-boundary fixtures, and docs/memory SOT. Fixture existence alone is not support evidence. |
| 09.50 Refactor 05 - Docs/Memory SOT Alignment | #576 | closed; 0 open / 7 closed issues | Memory-only SOT is closed by #756/PR #845; #757 audited docs/routing; #758 reconciled the compatibility ledger; #759 audited the product support-claim ledger; #760 closed the final link/format/index readiness gate and handoff to milestones 10.00, 10.10, and 11.00. #809 already closed the PR body contract gate. Parent #576 and milestone #41 are closed. |

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
| Security | Credential/key handling, role/user management, auth mechanism expansion, destructive action policy. | `docs/contributor-guide/testing-and-quality.md` |
| App state | SQLite-backed durable app state, query history, settings, keyring, cross-window sync. | `memory/engineering/architecture/state-management/memory.md` |
| Quality | CI, E2E smoke, perf/a11y baseline, testing reliability, refactor backlog burn-down. | `docs/contributor-guide/testing-and-quality.md`, `docs/archives/audits/code-smell-audit-2026-05-15.md` |
| CLI surface (`tvw`) | 자동화 + 에이전트 표면. one-shot v0.1 (SQL 코어 4종: PostgreSQL/MySQL/MariaDB/SQLite) → REPL + completion → 앱 지원 DBMS 확장 (CLI claim ⊆ 앱 claim 원칙) → `tvw mcp` 서버 모드. TUI 는 영구 non-goal. 새 DBMS claim 을 만들지 않는 surface 트랙이라 runtime promotion freeze (순서 규칙 3) 와 독립. | ADR 0061, GitHub milestone 33.00 |

## 순서 규칙

1. 새 partial workflow 를 추가하기 전에 눈에 보이는 미완성 workflow 를 먼저 닫는다.
2. connect/browse/query 만 노출하는 runtime 을 하나 더 붙이는 것보다, 기존 runtime
   깊이를 우선한다.
3. Runtime promotion freeze 는 **새 `DatabaseType` 추가**에만 적용한다 (ADR 0060).
   현재 대상은 wider candidate 5종 (Cassandra/Scylla, DynamoDB, graph, vector,
   stream) 이고, 해제 조건은
   `memory/engineering/architecture/data-source/adding/memory.md` 의 Required
   Contract 10항목 lock 이다. 이미 active 인 `DatabaseType` 의 capability 확장
   (MSSQL 구조적 DDL, Oracle 런타임 슬라이스 해제, DuckDB DDL/batch, Redis/Valkey
   잔여 축, Search index/settings admin 실행, 기존 엔진 admin/import-export/profiler)
   은 freeze 밖에 있고 실행 bucket 은 GitHub milestone 22.50 "DBMS Parity - 엔진별 결손"
   또는 22.80 "Admin Parity - 단계 승격" 이다. freeze 밖에 있다는 것은 착수할 수
   있다는 뜻일 뿐이고 support claim 승격을 뜻하지 않는다. 각 gate 의 evidence 요구는
   그대로다. 얕은 partial workflow 가 퍼지는 것을 막는 일은 순서 규칙 1·2 와 승격
   후보 순서가 소유한다.
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

Roadmap item 을 active implementation 으로 승격하기 전에 필요한 것은 다음과 같다.

| Gate | 필요 산출물 |
|---|---|
| 사용자 논의 | 구현 시작 전 scope, order, non-goal 합의. |
| SOT check | `docs/product/**` (index + child page), `memory/engineering/**`, contributor docs 를 업데이트하거나 변경 없음으로 선언. |
| Follow-up check | 현재 제한은 `docs/product/**`, 미래 work item 은 `roadmap/follow-up-queue.md`, 구조 제약은 `memory/engineering/architecture`, 개발/운영 제약은 `memory/engineering` 또는 contributor docs, 과거 사건은 archives 로 라우팅한다. |
| Contract check | 코딩 전 acceptance criteria 와 verification command 를 확정. |
| Architecture check | 지속 결정 변경 또는 이전 방향 뒤집기일 때만 ADR 필요. |
| Archive check | 오래된 draft/spec docs 는 archive 로 이동하거나 historical context 로 link. |

## 열린 질문

| 영역 | 질문 | 결정 전 기본값 |
|---|---|---|
| MariaDB | MySQL adapter reuse 를 단순하게 유지할 수 있나? | Dialect flag 로 reuse. Evidence 있을 때만 split. |
| DuckDB | File analytics 를 RDBMS 로 볼지 separate file-sql paradigm 으로 볼지? | Evidence 가 split 을 요구하기 전까지 RDBMS + `file` connection kind. |
| Redis/Search | Redis full UI/editor parity 와 Search index/settings admin execution 을 언제 승격할 수 있나? | 둘 다 freeze 밖이라 lane 통과를 기다리지 않는다 (ADR 0060). Search 는 admin destructive 실행 정책과 observability/profile-explain 계약이 선행이다 (ADR 0060 문면). 그중 profile-explain 계약은 `_search` `profile` 계획 뷰어를 #2153 이 실었고 `_explain` 이 남았다. observability 와 admin destructive 실행 정책은 아직 선행 조건이다: live `_delete_by_query` 실행은 #1076 으로 승격됐지만 index/settings admin 실행은 그 범위 밖이라 deferred 로 남았다 (ADR 0060 문면). Redis full parity, broader Search smoke, remaining MSSQL/Oracle widening 은 evidence/smoke 비용 기준으로 고른다. |
| 더 넓은 paradigm | Cassandra/DynamoDB/graph/vector/stream 중 무엇을 먼저 승격하나? | H6 기본값은 candidate-only. Workflow value, contract readiness, fixture/live evidence, smoke/E2E cost, safety risk 가 분명해질 때까지 승격 금지. |
| App state | State-management migration 은 언제 재개하나? | DB support 작업이 storage/schema surface 와 충돌하지 않을 때. |
| Security | Users/roles/auth mechanism UI 는 언제 추가하나? | RDBMS/DuckDB/non-RDBMS source order 가 명확해진 뒤. |
| CLI (`tvw`) | REPL/completion, CLI DBMS 확장, `tvw mcp` 는 언제 승격하나? | v0.1 배포 + SQL 코어 4종 evidence 뒤. CLI DBMS claim 은 항상 앱 claim 의 부분집합 (ADR 0061). |

## 승격 후보

다음 작업을 고를 때는 이 목록과 현재 product docs, live issue state 를 먼저 본다.
`docs/phases/phase-32.md` 는 historical context 로만 사용한다. 아래 순서는 새
`DatabaseType` 추가에만 강제이고 (ADR 0060), 기존 엔진 작업에는 깊이 우선순위
권고다. 그래서 lane 을 고르지 않고 milestone 22.50 / 22.80 으로 진행한다.

다음 승격 후보 순서는 아래와 같다.

1. One-DBMS query/workbench parity ladder. 지원 DBMS lane 하나만 골라
   runtime/parser/completion/edit/fixture/e2e/support-claim gap 을 닫고 다음 lane 을
   고른다. 고정 lane 순서는 PostgreSQL -> MySQL/MariaDB -> SQLite/DuckDB -> MongoDB 다.
2. PostgreSQL query/workbench parity hardening.
3. MySQL-family semantic widening + MariaDB engine evidence/delta hardening.
4. SQLite DBMS write/parity + DuckDB file analytics hardening.
5. MongoDB whitelist/full-support parity hardening.
6. RDBMS ERD / `SchemaGraph`.
7. Redis/Valkey parity hardening.
8. Search admin HTTP promotion and OpenSearch smoke expansion.
9. Remaining MSSQL + Oracle enterprise RDBMS widening.
10. `tvw` CLI v0.1: one-shot surface (ADR 0061). `table-view-core` crate 분리가
    선행한다. Surface 트랙이라 순서 규칙 3 의 runtime freeze 대상이 아니고 기존
    DBMS lane 과 병행할 수 있다. 실행 bucket 은 GitHub milestone 33.00 이다.

이 순서를 바꾸면 이 파일을 업데이트한다. 현재 제품 상태가 달라지는 변경이면
`docs/product/**` 의 해당 index/child page 도 함께 업데이트한다.
