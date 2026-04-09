# Sprint Contract: sprint-1-bugfix

## Summary

- **Goal**: Fix four usability bugs (B1-B4) identified in Phase 2 P1 review to ensure clean user experience in StructurePanel, DataGrid, SchemaTree, and FilterBar components.
- **Audience**: Generator (implements fixes), Evaluator (verifies fixes)
- **Owner**: Generator
- **Verification Profile**: `mixed` (command + static)

## In Scope

- **B1**: StructurePanel empty state flash -- add `hasFetched` tracking per sub-tab so "No X found" only renders after the first fetch completes, not during initial mount before data arrives.
- **B2**: DataGrid page not reset on prop change -- add `useEffect` to reset `page` to 1 when `connectionId`, `table`, or `schema` props change.
- **B3**: SchemaTree unnecessary state updates -- add early return in `handleTableClick` if a data tab for the same connection+table already exists, preventing redundant `addTab`/`setActiveTab` calls.
- **B4**: FilterBar Clear All doesn't clear appliedFilters -- add `onClearAll` callback prop to FilterBar; DataGrid wires it to also reset `appliedFilters` (and `page` to 1).

## Out of Scope

- New features (query editor, multi-tab, Phase 3 work)
- Visual/UX redesign of any component
- Backend (Rust) changes
- E2E (Playwright) tests
- Performance optimization beyond B3's targeted fix

## Invariants

1. All existing tests must pass: `cargo test` (from `src-tauri/`) and `pnpm test` (from root)
2. `cargo clippy --all-targets --all-features -- -D warnings` passes (from `src-tauri/`)
3. `pnpm build` succeeds (from root)
4. StructurePanel must still show "No X found" after a successful fetch returns empty data (not suppressed)
5. DataGrid must still reset page to 1 when sort column changes (existing `handleSort` behavior unchanged)
6. FilterBar must still clear `filters` state via `onFiltersChange([])` in its `clearAll` function
7. No new npm dependencies
8. No `any` types introduced
9. All changed files must compile with strict TypeScript

## Acceptance Criteria

### AC-01: StructurePanel no empty-state flash (B1)

- **Given** StructurePanel mounts for a table
- **When** the component renders before `fetchData()` completes for the first time
- **Then** the "No columns/indexes/constraints found" message MUST NOT appear
- **And** after `fetchData()` completes successfully with empty data, "No X found" MUST appear
- **Implementation**: `hasFetched` state (or per-sub-tab tracking) gates the empty-state rendering block at lines 284-292 of `StructurePanel.tsx`
- **File**: `src/components/StructurePanel.tsx`

### AC-02: DataGrid page resets on prop change (B2)

- **Given** DataGrid is on page N (N > 1)
- **When** `connectionId`, `table`, or `schema` prop changes (e.g., user switches to different table tab)
- **Then** `page` MUST reset to 1
- **And** `fetchData` MUST be called with page=1 for the new table
- **Implementation**: `useEffect` watching `[connectionId, table, schema]` that calls `setPage(1)`
- **File**: `src/components/DataGrid.tsx`

### AC-03: SchemaTree no unnecessary state updates on re-click (B3)

- **Given** a data tab for connection X and table Y already exists in tabStore
- **When** user clicks the same table Y in SchemaTree
- **Then** `handleTableClick` MUST return early without calling `addTab` or `setActiveTab`
- **And** the existing tab MUST become active (single `setActiveTab` call is acceptable)
- **Implementation**: Check if matching data tab exists before calling `addTab`
- **File**: `src/components/SchemaTree.tsx`

### AC-04: FilterBar Clear All clears both filters and appliedFilters (B4)

- **Given** filters are applied (e.g., column "name" = "test") and visible in DataGrid
- **When** user clicks "Clear All" in FilterBar
- **Then** `filters` state in DataGrid MUST be set to `[]`
- **And** `appliedFilters` state in DataGrid MUST be set to `[]`
- **And** `page` MUST reset to 1
- **Implementation**: Add `onClearAll` callback prop to `FilterBarProps`; DataGrid passes a handler that clears both `filters` and `appliedFilters` and resets page; FilterBar's `clearAll` calls `onClearAll` (in addition to existing `onFiltersChange([])`)
- **Files**: `src/components/FilterBar.tsx`, `src/components/DataGrid.tsx`

## Design Bar / Quality Bar

- Each bug fix must be minimal and targeted -- no scope creep
- No regressions in existing behavior (verified by invariants)
- Code follows existing project patterns (Zustand hooks, Tailwind classes, component file structure)
- Each fix is independently verifiable
- TypeScript strict mode: no `any`, no unchecked `unknown`

## Verification Plan

### Required Checks

1. **Build check**: `pnpm build` succeeds from project root
2. **Lint check**: `cargo clippy --all-targets --all-features -- -D warnings` passes from `src-tauri/`
3. **Existing tests**: `pnpm test` passes (from root) and `cargo test` passes (from `src-tauri/`)
4. **Static analysis -- B1**: `StructurePanel.tsx` must contain a `hasFetched` (or equivalent) state variable that gates the empty-state block at lines 284-292. The condition must require fetch completion, not just `!loading && columns.length === 0`.
5. **Static analysis -- B2**: `DataGrid.tsx` must contain a `useEffect` with dependency array `[connectionId, table, schema]` that calls `setPage(1)`.
6. **Static analysis -- B3**: `SchemaTree.tsx` `handleTableClick` must contain an early-return path (before any `addTab` call) when a matching data tab already exists.
7. **Static analysis -- B4**: `FilterBar.tsx` must expose an `onClearAll` prop (or equivalent). `DataGrid.tsx` must pass a handler that resets both `appliedFilters` and `page`. FilterBar's `clearAll` must invoke this callback.
8. **Unit test -- B1**: New test in a test file for StructurePanel confirming "No columns found" does NOT render on initial mount before fetch completes, and DOES render after fetch returns empty data.
9. **Unit test -- B2**: New test confirming DataGrid resets page to 1 when `table` prop changes from "table_a" to "table_b".
10. **Unit test -- B3**: New test confirming `addTab` is called at most once per `handleTableClick` invocation when tab already exists (early return).
11. **Unit test -- B4**: New test confirming Clear All resets both `filters` and `appliedFilters`, and triggers re-fetch with empty filters.

### Required Evidence

- Generator must provide:
  - Changed files with purpose (per bug fix)
  - `pnpm build` output (success)
  - `pnpm test` output (all tests pass, including new tests)
  - `cargo clippy` output (no warnings)
  - `cargo test` output (all tests pass)
  - Acceptance criteria coverage with concrete evidence (line numbers, test names)
- Evaluator must cite:
  - Concrete evidence for each pass/fail decision on AC-01 through AC-04
  - Any missing or weak evidence as a finding
  - Whether each invariant still holds after changes

## Test Script / Repro Script

### B1: StructurePanel empty state flash

```
1. Read src/components/StructurePanel.tsx
2. Verify: empty-state rendering block (lines ~284-292) is gated by hasFetched-like state
3. Run: pnpm test (includes new StructurePanel test)
4. Expected: test asserts "No columns found" absent before fetch, present after empty fetch
```

### B2: DataGrid page reset

```
1. Read src/components/DataGrid.tsx
2. Verify: useEffect([connectionId, table, schema]) calls setPage(1)
3. Run: pnpm test (includes new DataGrid test)
4. Expected: test asserts page resets to 1 on table prop change
```

### B3: SchemaTree unnecessary updates

```
1. Read src/components/SchemaTree.tsx
2. Verify: handleTableClick has early return when data tab exists
3. Run: pnpm test (includes new SchemaTree test)
4. Expected: test asserts addTab called 0 times (or at most setActiveTab called once) for existing tab
```

### B4: FilterBar Clear All

```
1. Read src/components/FilterBar.tsx -- verify onClearAll prop exists and is called from clearAll
2. Read src/components/DataGrid.tsx -- verify FilterBar receives onClearAll handler that resets appliedFilters + page
3. Run: pnpm test (includes new FilterBar/DataGrid test)
4. Expected: test asserts appliedFilters is [] and page is 1 after Clear All
```

### Full regression

```bash
cd /Users/felix/Desktop/study/view-table && pnpm build
cd /Users/felix/Desktop/study/view-table/src-tauri && cargo clippy --all-targets --all-features -- -D warnings
cd /Users/felix/Desktop/study/view-table/src-tauri && cargo test
cd /Users/felix/Desktop/study/view-table && pnpm test
```

## Ownership

- **Generator**: Implements B1-B4 fixes and tests, provides evidence
- **Write scope**: `src/components/StructurePanel.tsx`, `src/components/DataGrid.tsx`, `src/components/SchemaTree.tsx`, `src/components/FilterBar.tsx`, and new test files adjacent to those components or in `__tests__/`
- **Merge order**: Single commit or one commit per bug (generator's choice), all must pass all checks before merge

## Exit Criteria

- Open P1/P2 findings: `0`
- Required checks passing: `yes`
- All 4 acceptance criteria verified with concrete evidence
- All invariants confirmed unbroken
- Acceptance criteria evidence linked in `handoff.md`
