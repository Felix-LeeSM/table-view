# Sprint Contract: Sprint 12

## Summary

- Goal: Fix `act()` warnings in tests + fix P1 fetchData race condition in DataGrid
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `command`

## In Scope

1. Fix all `act()` warnings in SchemaTree.test.tsx (7+ warnings from unawaited async state updates)
2. Fix P1 fetchData race condition in DataGrid.tsx (stale response overwrites)
3. Add DataGrid race condition regression test
4. Audit all other test files for `act()` warning patterns

## Out of Scope

- ConnectionDialog tests (deferred to Sprint 13)
- StructurePanel tests
- Coverage threshold changes
- New UI features

## Invariants

- All 321 existing tests must continue to pass
- No changes to SchemaTree component behavior
- Coverage thresholds in vite.config.ts must not be lowered
- ESLint must pass with 0 errors

## Acceptance Criteria

- `AC-01`: `pnpm vitest run 2>&1 | grep -c "not wrapped in act"` returns 0
- `AC-02`: DataGrid fetchData uses request counter to prevent stale response overwrites
- `AC-03`: DataGrid race condition test demonstrates stale response is ignored
- `AC-04`: All existing tests pass (`pnpm vitest run` exits 0)
- `AC-05`: `pnpm lint` passes with 0 errors, 0 warnings
- `AC-06`: `pnpm tsc --noEmit` passes

## Design Bar / Quality Bar

- Race condition fix must not add unnecessary complexity
- Test fixes must preserve original test intent
- No `as any` casts

## Verification Plan

### Required Checks

1. `pnpm vitest run 2>&1 | grep "not wrapped in act"` — must return empty
2. `pnpm vitest run` — all tests pass
3. `pnpm lint` — 0 errors, 0 warnings
4. `pnpm tsc --noEmit` — passes
5. `pnpm vitest run --coverage` — coverage thresholds met

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목에 대응하는 최소 1개 테스트 작성
- 에러/예외 케이스 최소 1개 테스트 작성

### Coverage Target
- 신규/수정 코드: 라인 70% 이상 권장

### Scenario Tests (필수)
- [x] Happy path: DataGrid fetches and displays data
- [x] 에러/예외: Stale response ignored
- [x] 경계 조건: Rapid consecutive fetches
- [x] 기존 기능 회귀 없음

## Test Script / Repro Script

1. `pnpm vitest run 2>&1 | grep "not wrapped in act"` — verify 0 warnings
2. `pnpm vitest run` — all tests pass
3. `pnpm lint && pnpm tsc --noEmit` — lint + type check pass

## Ownership

- Generator: Sprint 12 Generator Agent
- Write scope: `src/components/DataGrid.tsx`, `src/components/DataGrid.test.tsx`, `src/components/SchemaTree.test.tsx`, other test files as needed
- Merge order: direct to main

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
