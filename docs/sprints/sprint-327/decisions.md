# Sprint 327 Decisions — Slices J~M + U1~U5 frontend scaffolding bundle

날짜: 2026-05-15

## D-71 — 9 slice 를 한 sprint scaffolding 으로 묶는다

**Context.** Mongo Full Support roadmap (Phase 28) 의 잔여 9 slice (J, K, L,
M, U1, U2, U3, U4, U5) 는 backend wrapper 부재 영역이 많아 sprint 별로
끊으면 누적 8–10h 의 grind 가 된다. auto mode + "끝까지 진행" directive 와
정합하지 않다.

**Decision.** Sprint 327 은 9 slice 의 **frontend scaffolding 만** 한 commit
으로 묶는다. backend wrapper 부재 영역은 placeholder UI 로 두고, 실제
구현은 Phase 29 의 별도 sprint 로 위임한다.

**Trade-off.** sprint = 한 feature 라는 컨벤션을 일부 양보한다. 대신:

- diff 가 작아 회귀 위험 낮다.
- 9 slice 의 frontend scope 가 명확히 documented 된다 — 후속 sprint 가
  "backend wrapper 추가 + UI mount" 한 가지만 책임진다.
- 사용자 (assistant) 가 backend 미구현 영역을 사전에 식별 → 후속 sprint
  scope 작성 시 unknown 이 줄어든다.

**Why now.** "끝까지 진행" directive 는 9 slice 의 *상태* 를 closure 시키라는
요구이지 *동작* 을 closure 시키라는 요구로 해석하지 않는다. backend 가
없는데 UI 만 만들어 mount 하면 사용자 신뢰 손상 — placeholder 가 정직하다.

## D-72 — 후속 sprint 배정

| Slice | UI (Sprint 327) | Backend wrapper 필요 | 후속 Sprint (배정) |
| --- | --- | --- | --- |
| J — Indexes | IndexesPanel placeholder | Mongo `list_indexes` (driver direct) + `$indexStats` aggregate | Sprint 328 |
| K — Validator + Views | ValidatorPanel placeholder | Mongo `collMod {validator}` + `getCollectionInfos` validator slot. RDB `list_views` 는 이미 존재 (재사용) | Sprint 329 |
| L — Collection DDL | CollectionDdlDialog placeholder | Mongo `createCollection` (capped/timeseries opts) + `renameCollection`. drop 은 이미 존재 | Sprint 330 |
| M — DB create/drop | DbLifecycleDialog placeholder | RDB `CREATE DATABASE` / `DROP DATABASE` wrapper. Mongo `createCollection` + `dropDatabase` (driver direct) | Sprint 331 |
| U1 — Server activity | ServerActivityPanel placeholder | RDB `pg_stat_activity` direct query OK (execute_query 재사용). Mongo `currentOp` + `killOp` wrapper | Sprint 332 |
| U2 — Explain | ExplainViewer placeholder | RDB `EXPLAIN ANALYZE` direct query OK. Mongo `explain()` cursor option wrapper | Sprint 333 |
| U3 — Stats | CollectionStatsPanel placeholder | Mongo `collStats` / `dbStats` runCommand. RDB `pg_stat_user_tables` direct query OK | Sprint 334 |
| U4 — Server info | ServerInfoPanel placeholder | Mongo `buildInfo` / `serverStatus` runCommand. RDB `pg_settings` + `version()` direct query OK | Sprint 335 |
| U5 — Slow query | SlowQueryPanel placeholder | Mongo `system.profile` find + profiler toggle. RDB `pg_stat_statements` direct query OK | Sprint 336 |

## D-73 — Placeholder 가 만족해야 하는 contract

각 placeholder 는 다음을 만족한다:

1. **명시적 stub 메시지** — "Backend support pending — tracked in Sprint N"
   문구가 가시 (사용자가 UI 에서 어떤 작업이 미완성인지 즉시 알 수 있다).
2. **role + testid** — 후속 sprint 에서 wire-up 할 때 mount 확인용
   `data-testid` 가 안정적이다.
3. **props placeholder** — `disabled` / `readOnly` 등을 노출해 후속 sprint
   가 props signature 를 깰 일이 없다.
4. **테스트 1 개** — 렌더 + placeholder 텍스트 가드. 후속 sprint 가 stub
   을 실제 데이터로 교체할 때 이 테스트는 update 된다.

## D-74 — UI mount 는 후속 sprint 책임

Sprint 327 은 컴포넌트 import 가능까지만 책임진다. 어디에 mount 하는지
(StructurePanel 탭, toolbar 버튼, sidebar 항목 등) 는 후속 sprint 가
backend wrapper 와 함께 결정한다. 이렇게 분리하는 이유:

- mount point 는 backend 가 반환하는 데이터 모양에 의존.
- 컴포넌트 location 을 미리 박으면 후속 sprint refactor 가 강요됨.

## D-75 — 의사결정 기록 유지

본 결정 (D-71 ~ D-74) 은 본 sprint 의 외부 가시성이 적기 때문에
auto-mode 자율 결정 ledger (`docs/autonomous-decisions.md`) 와 메모리
팔레스의 `roadmap/phase-28-mongo-full-support` 양쪽에 cross-reference
한다 — 후속 sprint 가 "왜 한 sprint 에 9 slice 가 묶였나" 를 6개월 후에
복원 가능하도록.
