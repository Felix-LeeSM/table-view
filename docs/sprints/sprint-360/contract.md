# Sprint Contract: sprint-360

## Summary

- Goal: Phase 2 self-window schemaCache invalidate — DDL 한 window 의 sidebar 가 100ms 안에 `foo` 표시 (eager refetch). Cross-window broadcast 는 sprint-365 (Phase 3) 로 분리.
- Audience: state-management-strategy Q23 self-window 부분 — same-window 즉시 갱신.
- Owner: Generator (sprint-360)
- Verification Profile: `frontend` + 일부 backend (cargo test + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src/stores/schemaStore.ts` — `clearForConnection(connectionId)` 액션 추가 (이미 있으면 invariant 확인). DDL 후 호출 → 그 conn 의 전체 cache drop.
- `src/components/query/QueryTab.tsx` (또는 DDL dispatch hook) — DDL 실행 IPC 응답 후 `schemaStore.clearForConnection(connId)` 호출 + sidebar 마운트 중이면 즉시 refetch.
- `src/components/layout/Sidebar.tsx` — mount 시 fetched=false 이면 refetch.
- 단위 / integration 테스트:
  - `src/stores/schemaStore.clearForConnection.test.ts` — store 액션.
  - `src/components/query/QueryTab.ddl-self-invalidate.test.tsx` — DDL 실행 + 100ms 안에 sidebar 갱신.

## Out of Scope

- Cross-window event broadcast (sprint-365).
- Schema cache narrow invalidation (전체 drop 만; narrow 는 future).
- DDL 실행 자체의 wire (기존 그대로).

## Invariants

- DDL 한 window 의 sidebar 가 100ms 안에 표시 변경 — eager refetch.
- 다른 window 에는 영향 0 (cross-window 는 sprint-365 에서).
- schemaStore wide drop — schemas/tables/views/functions/triggers/columns 모두.

## Acceptance Criteria

- `AC-360-01` `clearForConnection(connId)` 호출 후 `schemaStore.state.byConnection[connId]` 전체 빈 상태. Test: store 단위.
- `AC-360-02` DDL 실행 (`CREATE TABLE foo ...`) 후 `useDispatchDdl` hook 이 `clearForConnection(connId)` 호출. Test: RTL spy.
- `AC-360-03` Sidebar mount 시 빈 cache 면 `fetchSchemas(connId)` 호출 + 100ms 안에 `foo` 표시. Test: RTL `findByText("foo")` with `{ timeout: 100 }`.
- `AC-360-04` DDL → sidebar 갱신 timing 측정: e2e (또는 RTL integration) 으로 IPC 응답 ~ DOM 업데이트 < 100ms. Test: timing assert.
- `AC-360-05` Narrow drop 안 함 — `foo` table 만 추가했어도 schemaStore 전체 conn cache drop 후 refetch (wide). Test: 다른 schemaCache key (e.g. `views`) 도 빈 상태인지 확인.

## Design Bar / Quality Bar

- TDD: `findByText("foo", { timeout: 100 })` red → DDL hook 구현 → green.
- Eager refetch — `clearForConnection` 직후 sidebar mount 상태면 즉시 `fetchSchemas` invoke.
- 다른 conn 의 cache 미영향 — `byConnection[otherConnId]` 그대로.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/stores/schemaStore.clearForConnection.test.ts`
2. `pnpm vitest run src/components/query/QueryTab.ddl-self-invalidate.test.tsx`
3. `pnpm vitest run` (full)
4. `pnpm tsc --noEmit && pnpm lint`

### Required Evidence

- Timing log (DDL response → sidebar DOM update).
- `byConnection[connId]` 빈 상태 assert raw.
- 다른 conn cache 유지 assert.

## Test Requirements

- Vitest unit + RTL integration.
- Coverage: `schemaStore.ts` 의 `clearForConnection` 라인 + DDL hook 라인 70%.
- Scenario: (a) clear 액션, (b) DDL → invalidate → refetch, (c) 다른 conn 유지, (d) sidebar unmount 시 refetch skip.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/schemaStore.clearForConnection.test.ts`
2. `pnpm vitest run src/components/query/QueryTab.ddl-self-invalidate.test.tsx`
3. `pnpm vitest run` (full)
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. cancel/affinity (sprint-359) 변경 0.
- Merge order: 359 이후. Cross-window 부분은 sprint-365 의 책임.

## Exit Criteria

- Open P1/P2: 0
- AC 5/5 PASS
- DDL → sidebar < 100ms timing evidence
