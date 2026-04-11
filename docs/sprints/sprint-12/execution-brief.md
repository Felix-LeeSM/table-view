# Sprint Execution Brief: Sprint 12

## Objective

Fix `act()` warnings in existing tests and resolve P1 fetchData race condition in DataGrid.

## Task Why

User reported `act()` warnings appearing in test output (7+ instances in SchemaTree tests). Additionally, residual risk analysis identified a P1 fetchData race condition where stale API responses can overwrite newer data during rapid user interactions.

## Scope Boundary

- Only modify test files for `act()` fixes
- Only modify DataGrid.tsx for race condition fix
- Do NOT change component behavior
- Do NOT add new tests for unrelated components

## Invariants

- All 321 existing tests pass
- No change to SchemaTree production behavior
- Coverage thresholds (68% lines, 64% functions, 60% branches) must be met

## Done Criteria

1. `pnpm vitest run 2>&1 | grep "not wrapped in act"` returns empty output
2. DataGrid fetchData prevents stale responses via request counter
3. DataGrid test demonstrates stale response is ignored
4. All tests pass, lint clean, types clean

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run 2>&1 | grep "not wrapped in act"` — must be empty
  2. `pnpm vitest run` — exit 0
  3. `pnpm lint` — 0 errors, 0 warnings
  4. `pnpm tsc --noEmit` — pass
  5. `pnpm vitest run --coverage` — thresholds met
- Required evidence:
  - Changed files list with purpose
  - Command outputs showing clean runs
  - grep output showing 0 act() warnings

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-12/contract.md`
- Relevant files:
  - `src/components/DataGrid.tsx` (lines 148-181: fetchData race condition)
  - `src/components/DataGrid.test.tsx` (existing tests)
  - `src/components/SchemaTree.test.tsx` (act() warnings)
  - All other `*.test.tsx` files (audit for act() warnings)
