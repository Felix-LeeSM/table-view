# Table View — Active Plan

## Purpose

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

판단 기준: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우
(연결 -> 탐색 -> 조회 -> 편집 -> 쿼리)가 끊기지 않아야 한다."

## Current Snapshot

2026-05-22 기준 current plan 은 완료 이력을 실행 계획에서 분리한다.
Implementation sprint 번호는 실행 직전 또는 사용자가 sprint sequencing 을 명시
요청할 때 새 번호를 배정한다. Active phase 문서의 과거 sprint 번호는 history 가
아니면 쓰지 않는다.

| 영역 | SOT |
|---|---|
| 현재 실행 순서 | `docs/PLAN.md` |
| 장기 product / architecture roadmap | `docs/ROADMAP.md` |
| data-source extension architecture | `docs/data-source-architecture.md`, ADR 0046 |
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
3. 새 DBMS 는 `docs/data-source-architecture.md` 의 profile/capability contract 를
   먼저 정의한다.
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
| Redis/Valkey | not started | `KvAdapter` contract 필요 | redis-command 필요 | non-RDBMS 1차 후보 |
| Elasticsearch/OpenSearch | not started | `SearchAdapter` contract 필요 | search DSL 필요 | non-RDBMS 1차 후보 |

## Active Roadmap

| Order | Track | Status | Next move | SOT |
|---:|---|---|---|---|
| 1 | Current code -> data-source architecture alignment | planned/current candidate | 현재 `DatabaseType`/`Paradigm`/`ActiveAdapter`/workspace query/result 코드를 profile, capability, queryLanguage, result envelope 의 thin compatibility layer 로 감싼다. 기능 확장 금지 | `docs/data-source-architecture.md`, ADR 0046 |
| 2 | Data-source profile/capability foundation | planned | 기존 PostgreSQL/MySQL/MariaDB/SQLite/MongoDB 프로필을 먼저 선언하고 UI feature gating 을 `dbType` switch 에서 capability 조회로 이동 | `docs/data-source-architecture.md`, ADR 0046 |
| 3 | Query language / result envelope migration | planned | legacy `queryMode` 는 호환 필드로 낮추고 `queryLanguage` + typed result envelope 를 query/editor/result boundary 에 도입 | `docs/data-source-architecture.md`, ADR 0046 |
| 4 | Adapter contract normalization | planned | `RdbAdapter` 는 현 기능을 profile 로 노출하고, `KvAdapter`/`SearchAdapter` marker trait 승격 전 필요한 contract shape 를 고정 | `docs/data-source-architecture.md`, ADR 0046 |
| 5 | MySQL-family semantic widening | active follow-up | broader `CALL` args, user variables, routine scripting. `DELIMITER`/`LOAD DATA` 는 현재 explicit unsupported boundary 이며, future work 는 procedure body parser 또는 import UX 를 별도 결정 | `docs/query-language-support.md`, `docs/sprints/sprint-449/contract.md` |
| 6 | MariaDB adapter evidence | active follow-up | MySQL adapter reuse + MariaDB identity/dialect flag 는 default. MariaDB-engine fixture/CI evidence 는 별도 risk 로 추적 | `docs/query-language-support.md`, `docs/RISKS.md` |
| 7 | SQLite DBMS adapter / write parity | active follow-up | user DBMS adapter 범위는 internal app SQLite state-management 와 분리됨. 남은 DDL UI/runtime family 는 unsupported boundary 유지 | `docs/query-language-support.md`, `docs/state-management-strategy-2026-05-15.md` |
| 8 | DuckDB + file analytics hardening | active follow-up | `.duckdb`, CSV, Parquet, JSON, NDJSON preview/query 는 local-first runtime path 존재. analytics import/history/favorites 확대는 별도 결정 | `docs/data-source-architecture.md`, `docs/ROADMAP.md`, `docs/sprints/sprint-457/contract.md` |
| 9 | RDBMS ERD / SchemaGraph | planned | FK/constraint catalog 를 재사용 가능한 `SchemaGraph` 로 승격. ERD는 첫 renderer | `docs/data-source-architecture.md` |
| 10 | Redis/Valkey | deferred candidate | `KvAdapter` 를 marker 에서 key/type/TTL/stream contract 로 승격 후 phase 작성 | `docs/data-source-architecture.md` |
| 11 | Elasticsearch/OpenSearch | deferred candidate | `SearchAdapter` 를 marker 에서 index/mapping/search/aggregation contract 로 승격 후 phase 작성 | `docs/data-source-architecture.md` |
| 12 | MongoDB full support | deferred/current subagent audit only | Phase 28 Slice A 는 보존하되 RDBMS-first 후 재개. `queryMode` 는 execution SOT 로 되살리지 않음 | `docs/phases/phase-28.md` |
| 13 | Broader paradigms | gated backlog | Cassandra/DynamoDB/graph/vector/stream 은 workflow value + profile contract lock 전 active 승격 금지 | `docs/data-source-architecture.md` |
| 14 | RISK-038 refactor backlog | active | 12 후보를 current feature path 와 충돌 없는 slice 로 등록 | `docs/RISKS.md` |
| 15 | State-management migration | planned contracts | Sprint 353-376 contracts 는 보존. 실제 재개 전 current code와 재-audit 필요 | `docs/state-management-strategy-2026-05-15.md` |

## Active Sprint Sequence

본 순서는 병렬 실행을 위한 contract queue 다. 440-447 은 architecture alignment
root 이고, 448-459 는 RDBMS-first 실행 구간이다. 460 이후는 worktree/subagent 로
병렬 준비 가능하지만, 사용자 승인 전 RDBMS 순서를 앞지르지 않는다.

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
| 466 | Redis/Valkey connection/catalog/key browser | kv/redis | 465 |
| 467 | Redis/Valkey values, TTL, streams | kv/redis | 466 |
| 468 | Redis/Valkey integration gate | kv/join | 467 |
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

## Recently Closed

| Sprint | Outcome |
|---|---|
| 432 | MySQL-family `LIMIT offset,count` parser semantics |
| 434 | MySQL/MariaDB `ON DUPLICATE KEY UPDATE` parser semantics |
| 436 | RISK-041/L3 `schemaStore.clearSchema` alias removed |
| 437 | RISK-041/L6/L7/L8 workspace query boundaries + stale guard |
| 438 | RISK-041/L10 `EMPTY_ENTRY` hardened |
| 439 | Narrow common `CALL` parser semantics |

## Phase Index

| Phase | 내용 | 상태 | 상세 |
|---:|---|---|---|
| 18 | MariaDB adapter | deferred | `docs/phases/phase-18.md` |
| 19 | SQLite adapter | deferred | `docs/phases/phase-19.md` |
| 20 | Oracle adapter | deferred | `docs/phases/phase-20.md` |
| 28 | MongoDB Full Support | deferred/current subagent audit only | `docs/phases/phase-28.md` |
| 31 follow-up | semantic widening / capability gating | active follow-up | `docs/archives/phases/completed/phase-31.md` |

Completed/closed phases live in `docs/archives/phases/README.md`.

## Delivery Policy

- TDD strict: sprint 진입 시 red -> green evidence 보존.
- Skip-zero gate: touched scope 에 `it.skip` / `it.todo` / `describe.skip` 0.
- Verification: focused tests + `tsc` + lint/hook gate. Rust/WASM 변경 시 cargo/wasm size gate.
- ADR 동결: 결정 변경은 새 ADR + supersede chain.
