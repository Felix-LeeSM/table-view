# Table View — Active Plan

## Purpose

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

판단 기준: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우
(연결 -> 탐색 -> 조회 -> 편집 -> 쿼리)가 끊기지 않아야 한다."

## Current Snapshot

2026-05-25 기준 current plan 은 완료 이력을 실행 계획에서 분리한다.
Implementation sprint 번호는 실행 직전 또는 사용자가 sprint sequencing 을 명시
요청할 때 새 번호를 배정한다. Active phase 문서의 과거 sprint 번호는 history 가
아니면 쓰지 않는다.

| 영역 | SOT |
|---|---|
| 현재 실행 순서 | `docs/PLAN.md` |
| 장기 product / architecture roadmap | `docs/ROADMAP.md` |
| data-source extension architecture | `docs/data-source-architecture.md`, ADR 0046 |
| data-source contributor guide | `docs/adding-a-data-source.md` |
| 완료된 plan / sprint sequence | `docs/archives/plans/completed-roadmap.md` |
| 완료된 phase index | `docs/archives/phases/README.md` |
| Active/deferred risks | `docs/RISKS.md` |
| Resolved risks | `docs/archives/risks/resolved-risks.md` |
| Archived inactive references | `docs/archives/README.md` |
| 상세 sprint evidence | `docs/sprints/sprint-N/` |

## Sorting Rule

1. 현재 코드를 `docs/data-source-architecture.md` 의 profile/capability 구조에
   먼저 끼운다.
2. RDBMS support gap 먼저 닫는다.
3. 새 DBMS 는 `docs/adding-a-data-source.md` 의 contributor checklist 로
   profile/capability contract 를 먼저 정의한다.
4. 이미 열린 runtime/parser/completion surface 의 semantic correctness 를 넓힌다.
5. capability/version gating 은 vocabulary coverage 이후에 붙인다.
6. 큰 state-management migration 은 DB support 흐름과 충돌하지 않을 때 재개한다.
7. 완료 이력은 본 파일에 다시 누적하지 않고 completed 문서로 이동한다.

## Planning Protocol

- `Active Roadmap` 은 논의용 ordering 이다. 새 implementation phase 진입 전 사용자와
  범위/순서 합의가 필요하다.
- 장기 방향과 horizon 은 `docs/ROADMAP.md` 에 둔다. 본 파일은 active ordering
  만 유지한다.
- 완료된 항목은 `docs/archives/plans/completed-roadmap.md`, `docs/archives/phases/README.md`,
  `docs/archives/risks/resolved-risks.md` 로 이동한다.
- transient docs 는 sprint/phase SOT 로 흡수되면 삭제한다. Historical sprint
  artifacts (`docs/sprints/**`) 는 evidence 이므로 삭제하지 않는다.

## Support Snapshot

| DBMS | Runtime | Parser / safety | Completion | 현재 판단 |
|---|---|---|---|---|
| PostgreSQL | strong | strong | WASM-first | 기준선. 회귀 gate 유지 |
| MongoDB | partial/full-support backlog | whitelisted mongosh | Rust/WASM vocabulary | RDBMS-first 이후 재개 |
| MySQL | adapter complete | widening in progress | Rust/WASM vocabulary | adapter 완료. semantic gap 계속 축소 |
| MariaDB | MySQL-adapter reuse | MySQL-family profile + MariaDB delta | Rust/WASM vocabulary | runtime path 존재. MariaDB-engine fixture gap은 active risk |
| SQLite | file adapter complete | parser/write parity guardrails | Rust/WASM vocabulary | user DBMS adapter는 internal SQLite state와 분리됨. DDL UI는 unsupported |
| DuckDB | file adapter + local analytics preview | DuckDB SQL/file analytics guardrails | Rust/WASM vocabulary | local `.duckdb`/CSV/Parquet/JSON/NDJSON preview/query 지원. DDL/write는 unsupported |
| Redis | Redis first slice live | key/type/TTL/stream guardrails | redis-command profile | Redis key browser, value reads, TTL mutation, guarded string writes, and bounded stream reads are covered by adapter tests plus a Redis testcontainer smoke. Valkey parity/support is unverified follow-up. Cluster/pubsub/modules/consumer-group management deferred |
| Elasticsearch/OpenSearch | fixture-backed Search slice only | index/mapping/search envelope guardrails | bounded fixture DSL only | Search identities/catalog, bounded fixture DSL execution, and typed result rendering are fixture-verified. Live connection UI, HTTP catalog/query execution, admin, and observability stay disabled/deferred |
| MSSQL/Oracle | unsupported/deferred | declared SQL identity only | deferred | Known planned RDBMS identities. They remain in profile/docs/URL parsing but are not runtime-supported and are not emitted as active dev/e2e fixture connections |

Sprint 481 release-gate decision: do not promote Cassandra/DynamoDB/graph/vector/
stream yet. The next promotion requires a profile/capability/fixture decision
under `docs/adding-a-data-source.md`. No additional DBMS/runtime promotion starts
while one existing supported DBMS is being lifted through a TablePlus-style
query/workbench parity lane. This is not full admin parity: role/user/permission
UI, extension management UI, schema diff/migration preview, DB-level backup/
restore/import/export, and deep activity/profiler dashboards stay out of scope.
Each lane must close runtime, parser/safety, completion, edit, fixture, e2e,
support-claim, and lightweight EXPLAIN/plan-inspection gaps before the next lane
starts. Locked parity order: PostgreSQL first, then MySQL/MariaDB, then
SQLite/DuckDB, then MongoDB whitelist/full-support. After those lanes clear
enough capacity, promotion order is Elasticsearch/OpenSearch live HTTP first,
then the MSSQL+Oracle enterprise RDBMS lane.

Fixture evidence boundary: CI integration services cover PostgreSQL and MongoDB;
Redis has a Rust testcontainer smoke in CI. MySQL/MariaDB/Redis are available in
local `docker compose` fixture stack, but MariaDB-engine CI evidence remains an
active risk.

## Active Roadmap

| Order | Track | Status | Next move | SOT |
|---:|---|---|---|---|
| 1 | Current code -> data-source architecture alignment | planned/current candidate | 현재 `DatabaseType`/`Paradigm`/`ActiveAdapter`/workspace query/result 코드를 profile, capability, queryLanguage, result envelope 의 thin compatibility layer 로 감싼다. 기능 확장 금지 | `docs/data-source-architecture.md`, ADR 0046 |
| 2 | Data-source profile/capability foundation | planned | 기존 PostgreSQL/MySQL/MariaDB/SQLite/MongoDB 프로필을 먼저 선언하고 UI feature gating 을 `dbType` switch 에서 capability 조회로 이동 | `docs/data-source-architecture.md`, ADR 0046 |
| 3 | Query language / result envelope migration | planned | legacy `queryMode` 는 호환 필드로 낮추고 `queryLanguage` + typed result envelope 를 query/editor/result boundary 에 도입 | `docs/data-source-architecture.md`, ADR 0046 |
| 4 | Adapter contract normalization | active follow-up | `RdbAdapter` 는 현 기능을 profile 로 노출하고, Redis `KvAdapter` 와 Search contract slice 는 live 상태에 맞춰 follow-up capability gaps 만 추적 | `docs/data-source-architecture.md`, ADR 0046 |
| 5 | MySQL-family semantic widening | active follow-up | broader `CALL` args, user variables, routine scripting. `DELIMITER`/`LOAD DATA` 는 현재 explicit unsupported boundary 이며, future work 는 procedure body parser 또는 import UX 를 별도 결정 | `docs/query-language-support.md`, `docs/sprints/sprint-449/contract.md` |
| 6 | MariaDB adapter evidence | active follow-up | MySQL adapter reuse + MariaDB identity/dialect flag 는 default. MariaDB-engine fixture/CI evidence 는 별도 risk 로 추적 | `docs/query-language-support.md`, `docs/RISKS.md` |
| 7 | SQLite DBMS adapter / write parity | active follow-up | user DBMS adapter 범위는 internal app SQLite state-management 와 분리됨. 남은 DDL UI/runtime family 는 unsupported boundary 유지 | `docs/query-language-support.md`, `docs/state-management-strategy-2026-05-15.md` |
| 8 | DuckDB + file analytics hardening | active follow-up | `.duckdb`, CSV, Parquet, JSON, NDJSON preview/query 는 local-first runtime path 존재. analytics import/history/favorites 확대는 별도 결정 | `docs/data-source-architecture.md`, `docs/ROADMAP.md`, `docs/sprints/sprint-457/contract.md` |
| 9 | RDBMS ERD / SchemaGraph | planned | FK/constraint catalog 를 재사용 가능한 `SchemaGraph` 로 승격. ERD는 첫 renderer | `docs/data-source-architecture.md` |
| 10 | Redis | active Redis first slice | Redis adapter, KV sidebar, key scan, value read, guarded string write, TTL mutation, and bounded stream read paths are live and covered by a Redis testcontainer smoke. Valkey parity/support is unverified follow-up. Cluster/pubsub/modules/consumer-group management remain follow-up | `docs/data-source-architecture.md`, `docs/sprints/sprint-468/handoff.md` |
| 11 | One-DBMS query/workbench parity lane | active PostgreSQL lane | 새 DBMS 승격 중단. PostgreSQL → MySQL/MariaDB → SQLite/DuckDB → MongoDB 순서로 하나씩 runtime/parser/safety/completion/edit/fixture/e2e/support-claim/Explain gap을 닫음. Sprint 482-483이 PostgreSQL parser/Safe Mode function-call surface를 넓힘 | `docs/phases/phase-32.md`, `docs/RISKS.md`, `docs/query-language-support.md` |
| 12 | Elasticsearch/OpenSearch live HTTP | deferred until active parity lane clears | Search adapter fixture slice는 유지. live connection UI, HTTP catalog/query execution, cluster administration, and observability는 one-DBMS parity lane 뒤 첫 promotion | `docs/data-source-architecture.md`, `docs/sprints/sprint-472/handoff.md`, `docs/RISKS.md` |
| 13 | MSSQL + Oracle enterprise RDBMS lane | deferred after Search live HTTP | Known planned RDBMS identities 유지. runtime adapter, driver/license, dialect depth, CI fixture 전략은 Search live HTTP 뒤 별도 lane으로 lock | `docs/phases/phase-20.md`, `docs/query-language-support.md` |
| 14 | MongoDB full support | deferred/current whitelist hardening only | Phase 28 Slice A 는 보존. 현재는 whitelist workflow 품질을 먼저 끌어올리고 arbitrary JS shell/full-support는 후속 결정 | `docs/phases/phase-28.md` |
| 15 | Broader paradigms | gated backlog | Cassandra/DynamoDB/graph/vector/stream 은 workflow value + profile contract lock 전 active 승격 금지 | `docs/data-source-architecture.md`, `docs/adding-a-data-source.md` |
| 16 | RISK-038 refactor backlog | active | 12 후보를 current feature path 와 충돌 없는 slice 로 등록 | `docs/RISKS.md` |
| 17 | State-management migration | planned contracts | Sprint 353-376 contracts 는 보존. 실제 재개 전 current code와 재-audit 필요 | `docs/state-management-strategy-2026-05-15.md` |

## Active Sprint Sequence

본 순서는 병렬 실행을 위한 contract queue 다. 440-447 은 architecture alignment
root 이고, 448-459 는 RDBMS-first 실행 구간이다. 460 이후는 worktree/subagent 로
병렬 준비 가능하지만, 사용자 승인 전 RDBMS 순서를 앞지르지 않는다.

Sprint 482부터 Phase 32 PostgreSQL lane implementation 을 시작한다. 이후 작업
선택은 `docs/ROADMAP.md` 와 `docs/phases/phase-32.md` 를 먼저 보고 결정한다.

| Sprint | Track | Parallel lane | Depends on |
|---:|---|---|---|
| 440 | Data source alignment core | root | none |
| 441 | Existing data source profiles | profile | 440 |
| 442 | Capability gating compatibility | frontend capability | 441 |
| 443 | Query language compatibility layer | query boundary | 440 |
| 444 | Result envelope compatibility layer | result boundary | 440 |
| 445 | Backend adapter contract normalization | backend adapter | 440 |
| 446 | Connection kind compatibility | connection UI/profile | 441 |
| 447 | Data source alignment integration gate | join | 442-446 |
| 448 | MySQL-family routine/user-variable semantics | rdbms/mysql | 447 |
| 449 | MySQL-family scripting boundary | rdbms/mysql | 448 |
| 450 | MariaDB adapter identity slice | rdbms/mariadb | 447 |
| 451 | MariaDB semantic delta slice | rdbms/mariadb | 450 |
| 452 | SQLite DBMS connection contract | rdbms/sqlite | 447 |
| 453 | SQLite browse/query adapter | rdbms/sqlite | 452 |
| 454 | SQLite write-parity guardrails | rdbms/sqlite | 453 |
| 455 | DuckDB connection/file contract | rdbms/duckdb | 452 |
| 456 | DuckDB catalog/query basics | rdbms/duckdb | 455 |
| 457 | DuckDB file analytics import/preview | rdbms/duckdb | 456 |
| 458 | RDBMS version capability gates | rdbms/shared | 441, 450, 452, 455 |
| 459 | RDBMS integration gate | rdbms/join | 449, 451, 454, 457, 458 |
| 460 | SchemaGraph catalog extraction | erd/schema | 459 |
| 461 | SchemaGraph relationship normalizer | erd/schema | 460 |
| 462 | ERD renderer foundation | erd/ui | 461 |
| 463 | ERD navigation and layout polish | erd/ui | 462 |
| 464 | SchemaGraph integration gate | erd/join | 463 |
| 465 | KV adapter contract | kv/foundation | 447 |
| 466 | Redis connection/catalog/key browser; Valkey follow-up | kv/redis | 465 |
| 467 | Redis values, TTL, streams; Valkey follow-up | kv/redis | 466 |
| 468 | Redis integration gate; Valkey follow-up | kv/join | 467 |
| 469 | Search adapter contract | search/foundation | 447 |
| 470 | Elasticsearch/OpenSearch connection/catalog | search/elastic | 469 |
| 471 | Search DSL execution/result envelopes | search/elastic | 470 |
| 472 | Elasticsearch/OpenSearch integration gate | search/join | 471 |
| 473 | MongoDB profile/capability normalization | document/mongo | 447 |
| 474 | MongoDB catalog/result envelope | document/mongo | 473 |
| 475 | MongoDB edit/safety semantics | document/mongo | 474 |
| 476 | MongoDB integration gate | document/join | 475 |
| 477 | Cross-paradigm fixture harness | quality/foundation | 447 |
| 478 | Adapter conformance test matrix | quality/conformance | 477 |
| 479 | Language registry and completion ownership matrix | language/shared | 443, 477 |
| 480 | Capability documentation/developer guide | docs/shared | 442, 477 |
| 481 | Cross-paradigm release gate | release/join | 459, 464, 468, 472, 476, 478-480 |
| 482 | PostgreSQL parser/Safe Mode kickoff | rdbms/postgresql | 481 |
| 483 | PostgreSQL function-call expression widening | rdbms/postgresql | 482 |
| 484 | PostgreSQL MERGE parser/Safe Mode first slice | rdbms/postgresql | 483 |

## Recently Closed

| Sprint | Outcome |
|---|---|
| 432 | MySQL-family `LIMIT offset,count` parser semantics |
| 434 | MySQL/MariaDB `ON DUPLICATE KEY UPDATE` parser semantics |
| 436 | RISK-041/L3 `schemaStore.clearSchema` alias removed |
| 437 | RISK-041/L6/L7/L8 workspace query boundaries + stale guard |
| 438 | RISK-041/L10 `EMPTY_ENTRY` hardened |
| 439 | Narrow common `CALL` parser semantics |
| 465 | KV adapter contract |
| 466 | Redis connection, catalog, and key browser; Valkey support unverified |
| 467 | Redis values, TTL, and bounded streams; Valkey support unverified |
| 468 | Redis integration gate docs/status alignment; Valkey parity follow-up |
| 469 | Search adapter contract |
| 470 | Elasticsearch/OpenSearch connection/catalog fixtures; live HTTP unsupported |
| 471 | Bounded Search DSL fixture execution and `searchHits` result envelopes |
| 472 | Elasticsearch/OpenSearch integration gate docs/status alignment; live HTTP/admin/observability follow-up |
| 473 | MongoDB profile/capability normalization |
| 474 | MongoDB catalog/result envelope |
| 475 | MongoDB edit/safety semantics |
| 476 | MongoDB integration gate |
| 477 | Cross-paradigm fixture harness |
| 478 | Adapter conformance test matrix |
| 479 | Language registry and completion ownership matrix |
| 480 | Capability documentation/developer guide |
| 482 | PostgreSQL parser/Safe Mode kickoff: no-FROM SELECT and SELECT-list function calls |
| 483 | PostgreSQL parser/Safe Mode widening: predicate/HAVING function calls and SELECT-list function aliases |
| 484 | PostgreSQL MERGE parser/Safe Mode first slice: table-source MERGE with UPDATE, INSERT, and DO NOTHING actions |

## Phase Index

| Phase | 내용 | 상태 | 상세 |
|---:|---|---|---|
| 18 | MariaDB adapter | deferred | `docs/phases/phase-18.md` |
| 19 | SQLite adapter | deferred | `docs/phases/phase-19.md` |
| 20 | Oracle adapter | deferred | `docs/phases/phase-20.md` |
| 28 | MongoDB Full Support | deferred/current subagent audit only | `docs/phases/phase-28.md` |
| 32 | Query/Workbench parity ladder | active PostgreSQL lane | `docs/phases/phase-32.md` |
| 31 follow-up | semantic widening / capability gating | active follow-up | `docs/archives/phases/completed/phase-31.md` |

Completed/closed phases live in `docs/archives/phases/README.md`.

## Delivery Policy

- TDD strict: sprint 진입 시 red -> green evidence 보존.
- Skip-zero gate: touched scope 에 `it.skip` / `it.todo` / `describe.skip` 0.
- Verification: focused tests + `tsc` + lint/hook gate. Rust/WASM 변경 시 cargo/wasm size gate.
- ADR 동결: 결정 변경은 새 ADR + supersede chain.
