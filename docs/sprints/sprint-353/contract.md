# Sprint Contract: sprint-353

## Summary

- Goal: Phase 0 dehydration pipeline — `persistWorkspaces` 가 idle strip / Q16–Q18 strip / Q19 cap 25 를 보장해 LS blob 이 1000 row 결과 시뮬 후에도 < 50KB 가 되도록 한다.
- Audience: state-management-strategy-2026-05-15 Phase 0 — Phase 1 (SQLite) 전 단계의 LS 안전성 확보.
- Owner: Generator (sprint-353)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src/stores/workspaceStore/persistence.ts` (또는 dehydration helper 파일): `dehydrate(state) → PersistedWorkspaceState` 단일 함수 도입.
  - `tabs[].queryState.status` 를 `"idle"` 로 강제 (result rows 폐기). sql 본문은 보존 (codex 6차 #1).
  - `closedTabHistory[].queryState` 도 동일 strip.
  - `dirtyTabIds` → `[]` (Q16).
  - `sidebar.selectedNode` → `null` (Q17).
  - `sidebar.scrollTop` → `0` (Q18).
  - `closedTabHistory` length 25 초과 시 oldest drop (Q19).
- `src/stores/workspaceStore.ts:251` 의 `.slice(0, 20)` → `.slice(0, 25)` 변경.
- 단위 테스트 신규 파일 `src/stores/workspaceStore/persistence.dehydrate.test.ts` (2026-05-16).

## Out of Scope

- SQLite 이주 (Phase 1, sprint-355).
- IPC 신설 (Phase 1 이후).
- Counter seed (sprint-354).
- `schemaStore` 메서드 retire (sprint-354).

## Invariants

- 기존 workspace round-trip 회귀 0 — boot → write → boot 후 visible tab order/active tab 동일.
- `sql` 텍스트는 strip 대상 아님. result rows 만 폐기.
- LS blob 크기 < 50KB 보장 (1000 row * 평균 row width 200 byte 시뮬).
- 다른 store (connections/favorites/mru/settings) 미수정.
- `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` green.

## Acceptance Criteria

- `AC-353-01` `dehydrate()` 가 `tabs[].queryState.status === "idle"` 로 만들고 `rows`/`columns` 폐기. `closedTabHistory[].queryState` 도 동일. Test: `persistence.dehydrate.test.ts` — happy path + closedTabHistory cycle.
- `AC-353-02` `dirtyTabIds` 가 dehydration 후 `[]`. Test: store 에 dirty tab 3개 추가 후 `dehydrate()` 호출 → 결과의 `dirtyTabIds.length === 0`.
- `AC-353-03` `sidebar.selectedNode` → `null`, `sidebar.scrollTop` → `0`. Test: selectedNode/scrollTop 설정 후 dehydrate → 두 값 default.
- `AC-353-04` `closedTabHistory` 30개 push → length 25 (oldest 5개 drop). Test: 30개 시퀀스 push 후 `history.length === 25` + 첫 entry 가 6번째 push 결과.
- `AC-353-05` `workspaceStore.ts:251` `.slice(0, 25)` 적용. 빈 array push test + 26번째 push 시 oldest drop 확인.
- `AC-353-06` LS blob 크기 < 50KB — 1000 row 결과를 가진 query tab 5개 + closedTabHistory 25개 시뮬 후 `JSON.stringify(persisted).length < 50_000`. Test: byte size assert.
- `AC-353-07` DataGrid dirty cycle 회귀 방지: tab 셀 수정 → dehydrate → restore → marker 0개. Test: store 시나리오 — dirty 후 dehydrate→hydrate round-trip → `dirtyTabIds` empty.
- `AC-353-08` Sub-workspace round-trip (Q17/Q18): dbA 의 selectedNode + scrollTop 설정 → dbB 전환 → dbA 복귀 → 둘 다 in-memory 복원, dehydrate 후엔 둘 다 default. Test: 메모리 round-trip + dehydration round-trip.

## Design Bar / Quality Bar

- TDD: 각 AC 의 failing test 를 먼저 commit (red), 그 다음 구현 (green), 그 다음 refactor. `git log --oneline` 에 red commit → green commit 식별 가능.
- Dehydration 은 순수 함수 — `WorkspaceState → PersistedWorkspaceState`. 부수 효과 0.
- 기존 hydrate 경로는 PersistedWorkspaceState 를 직접 받음 — sprint-355 이전이라 LS 가 SOT.
- 테스트 상단에 작성 날짜 (2026-05-16) + 사유 코멘트 (feedback_test_documentation.md).
- 신규 코드 line 70% 이상 커버.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit`
2. `pnpm lint`
3. `pnpm vitest run src/stores/workspaceStore`
4. `pnpm vitest run` (full) — net new failures = 0 vs baseline.

### Required Evidence

- Generator 는 8 AC 각각의 test name + 호출 결과 인용.
- Red→green commit 시퀀스 확인 (git log).
- LS byte size 시뮬 raw 결과 (수치) handoff 에 포함.

## Test Requirements

- Unit tests: AC-353-01 ~ AC-353-08 각각 1 케이스 이상.
- Coverage: `src/stores/workspaceStore/persistence.ts` 라인 70% 이상.
- Scenario tests: (a) happy path, (b) 빈 state dehydrate, (c) closedTabHistory boundary (24/25/26 길이), (d) sub-workspace 두 db 전환.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/workspaceStore/persistence.dehydrate.test.ts`
2. `pnpm vitest run src/stores/workspaceStore.test.ts`
3. `pnpm vitest run` (full)
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope 파일만.
- Merge order: 353 → 354 병렬 가능.

## Exit Criteria

- Open P1/P2: 0
- AC 8/8 PASS
- LS blob < 50KB 시뮬 통과
