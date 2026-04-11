# Sprint Contract: Sprint 13

## Summary

- Goal: Add tests for ConnectionDialog and StructurePanel (both 0% coverage)
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `command`

## In Scope

1. ConnectionDialog.test.tsx — form rendering, validation, save/edit flow, URL parse mode, test connection, Escape close
2. StructurePanel.test.tsx — tab switching, columns/indexes/constraints rendering, loading/error states, refresh event

## Out of Scope

- Rust backend tests (next sprint)
- Coverage threshold changes
- Changes to production code (unless fixing bugs discovered in testing)
- tauri.ts tests (thin IPC wrapper, not worth unit testing)

## Invariants

- All 322 existing tests pass
- No change to ConnectionDialog or StructurePanel component behavior
- ESLint 0 errors, 0 warnings
- Coverage thresholds (68% lines, 64% functions, 60% branches) must be met

## Acceptance Criteria

- `AC-01`: ConnectionDialog renders "New Connection" header in create mode
- `AC-02`: ConnectionDialog renders "Edit Connection" header with pre-filled form when connection prop provided
- `AC-03`: ConnectionDialog validates required fields (name, host) on save
- `AC-04`: ConnectionDialog calls addConnection on save for new connection
- `AC-05`: ConnectionDialog calls updateConnection on save for editing
- `AC-06`: ConnectionDialog Test Connection button triggers testConnection and shows result
- `AC-07`: ConnectionDialog URL mode parses URL and populates form
- `AC-08`: ConnectionDialog closes on Escape key
- `AC-09`: StructurePanel renders columns tab by default and fetches column data
- `AC-10`: StructurePanel switches between columns/indexes/constraints tabs
- `AC-11`: StructurePanel shows error state when fetch fails
- `AC-12`: StructurePanel shows "No columns/indexes/constraints found" for empty data
- `AC-13`: All tests pass, lint clean, types clean

## Design Bar / Quality Bar

- Mock `useConnectionStore` actions for ConnectionDialog tests
- Mock `useSchemaStore` actions for StructurePanel tests
- No `as any` casts — use proper type-safe mocking
- Use `act()` wrapping for renders that trigger async state updates

## Verification Plan

### Required Checks

1. `pnpm vitest run` — all tests pass
2. `pnpm lint` — 0 errors, 0 warnings
3. `pnpm tsc --noEmit` — pass
4. `pnpm vitest run --coverage` — coverage thresholds met

### Required Evidence

- Generator must provide changed files with purpose
- Command outputs showing clean runs

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목에 대응하는 최소 1개 테스트 작성
- 에러/예외 케이스 최소 1개 테스트 작성

### Coverage Target
- ConnectionDialog: 라인 60%+ 이상
- StructurePanel: 라인 60%+ 이상

### Scenario Tests (필수)
- [ ] Happy path: create connection, edit connection
- [ ] 에러/예외: validation failure, test connection failure, fetch failure
- [ ] 경계 조건: empty data, Escape key close
- [ ] 기존 기능 회귀 없음

## Test Script / Repro Script

1. `pnpm vitest run` — all tests pass
2. `pnpm lint && pnpm tsc --noEmit` — lint + type check pass

## Ownership

- Generator: Sprint 13 Generator Agent
- Write scope: `src/components/ConnectionDialog.test.tsx` (new), `src/components/StructurePanel.test.tsx` (new)
- Merge order: direct to main

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
