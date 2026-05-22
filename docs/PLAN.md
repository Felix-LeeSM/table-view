# Table View — Active Plan

## Purpose

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

판단 기준: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우
(연결 -> 탐색 -> 조회 -> 편집 -> 쿼리)가 끊기지 않아야 한다."

## Current Snapshot

2026-05-22 기준 current plan 은 완료 이력을 실행 계획에서 분리한다.

| 영역 | SOT |
|---|---|
| 현재 실행 순서 | `docs/PLAN.md` |
| 완료된 plan / sprint sequence | `docs/completed-plan.md` |
| 완료된 phase index | `docs/phases/completed.md` |
| Active/deferred risks | `docs/RISKS.md` |
| Resolved risks | `docs/RISKS.resolved.md` |
| 상세 sprint evidence | `docs/sprints/sprint-N/` |

## Sorting Rule

1. 사용자 visible DBMS support gap 먼저 닫는다.
2. 이미 열린 runtime/parser/completion surface 의 semantic correctness 를 넓힌다.
3. capability/version gating 은 vocabulary coverage 이후에 붙인다.
4. 큰 state-management migration 은 DB support 흐름과 충돌하지 않을 때 재개한다.
5. 완료 이력은 본 파일에 다시 누적하지 않고 completed 문서로 이동한다.

## Planning Protocol

- `Active Roadmap` 은 논의용 ordering 이다. 새 implementation phase 진입 전 사용자와
  범위/순서 합의가 필요하다.
- 완료된 항목은 `docs/completed-plan.md`, `docs/phases/completed.md`,
  `docs/RISKS.resolved.md` 로 이동한다.
- transient docs 는 sprint/phase SOT 로 흡수되면 삭제한다. Historical sprint
  artifacts (`docs/sprints/**`) 는 evidence 이므로 삭제하지 않는다.

## Support Snapshot

| DBMS | Runtime | Parser / safety | Completion | 현재 판단 |
|---|---|---|---|---|
| PostgreSQL | strong | strong | WASM-first | 기준선. 회귀 gate 유지 |
| MongoDB | partial/full-support backlog | whitelisted mongosh | Rust/WASM vocabulary | Phase 28 이 "100%" 본체 |
| MySQL | Phase 17 complete | widening in progress | Rust/WASM vocabulary | adapter 완료. semantic gap 계속 축소 |
| MariaDB | deferred adapter | MySQL-family profile 일부 | Rust/WASM vocabulary | runtime 재개 결정 필요 |
| SQLite | deferred adapter | parser/write parity gap | Rust/WASM vocabulary | DBMS adapter vs internal SQLite state 분리 필요 |

## Active Roadmap

| Order | Track | Status | Next move | SOT |
|---:|---|---|---|---|
| 1 | MongoDB full support | planned | 논의 필요: Phase 28 Slice A unified mongosh editor / parser routing 부터 시작할지 확정 | `docs/phases/phase-28.md` |
| 2 | MySQL-family semantic widening | active follow-up | broader `CALL` args, user variables, routine scripting, `DELIMITER`, `LOAD DATA` 순서로 parser/safety gap 축소 | `docs/query-language-support.md`, `docs/sprints/sprint-439/` |
| 3 | Capability-gated completion filtering | backlog | `serverVersion` / `capabilities` 기반 후보 filtering. vocabulary SOT 는 이미 Rust/WASM | `docs/phases/phase-31.md` |
| 4 | MariaDB adapter decision | deferred -> re-evaluate | MySQL adapter reuse vs dedicated adapter ADR 결정 | `docs/phases/phase-18.md` |
| 5 | SQLite DBMS adapter / write parity | deferred -> re-evaluate | Phase 19 adapter 재개 여부와 internal app SQLite state-management 를 분리해서 결정 | `docs/phases/phase-19.md`, `docs/state-management-strategy-2026-05-15.md` |
| 6 | RISK-038 refactor backlog | active | 12 후보를 current feature path 와 충돌 없는 slice 로 등록 | `docs/RISKS.md` |
| 7 | State-management migration | planned contracts | Sprint 353-376 contracts 는 보존. 실제 재개 전 current code와 재-audit 필요 | `docs/state-management-strategy-2026-05-15.md` |
| 8 | TablePlus DDL surface leftovers | planned/backlog | Phase 24-26(Index/Constraint/Trigger) 는 DB support 우선순위 뒤에서 재평가 | `docs/phases/phase-24.md`, `docs/phases/phase-25.md`, `docs/phases/phase-26.md` |
| 9 | Oracle / non-current DBMS | deferred | Phase 20 은 현 priority 아님 | `docs/phases/phase-20.md` |

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
| 24 | Index Write UI | planned/backlog | `docs/phases/phase-24.md` |
| 25 | Constraint Write UI | planned/backlog | `docs/phases/phase-25.md` |
| 26 | Trigger management | planned/backlog | `docs/phases/phase-26.md` |
| 28 | MongoDB Full Support | planned/current candidate | `docs/phases/phase-28.md` |
| 31 follow-up | semantic widening / capability gating | active follow-up | `docs/phases/phase-31.md` |

Completed/closed phases live in `docs/phases/completed.md`.

## Delivery Policy

- TDD strict: sprint 진입 시 red -> green evidence 보존.
- Skip-zero gate: touched scope 에 `it.skip` / `it.todo` / `describe.skip` 0.
- Verification: focused tests + `tsc` + lint/hook gate. Rust/WASM 변경 시 cargo/wasm size gate.
- ADR 동결: 결정 변경은 새 ADR + supersede chain.
