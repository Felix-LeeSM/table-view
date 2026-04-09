# Sprint Execution Brief: Sprint 1 — Bug Fixes (B1-B4)

## Objective

Fix four usability bugs identified in the Phase 2 P1 review (docs/REVIEW-P2P1.md) to ensure clean user experience.

## Task Why

These bugs cause visible UX issues: empty state flashing, stale pagination, redundant state updates, and filter state inconsistency. They should be fixed before adding new features in later sprints.

## Scope Boundary

- Only modify: `StructurePanel.tsx`, `DataGrid.tsx`, `SchemaTree.tsx`, `FilterBar.tsx`
- Do NOT add new features (no sorting changes, no new columns, no keyboard shortcuts)
- Do NOT modify Rust backend files
- Do NOT modify PLAN.md (that is Sprint 2)

## Invariants

1. `cargo test` passes (src-tauri/)
2. `cargo clippy --all-targets --all-features -- -D warnings` passes (src-tauri/)
3. `pnpm build` succeeds
4. `pnpm test` passes
5. StructurePanel must still show "No X found" after a successful fetch returns empty data
6. DataGrid must still reset page to 1 when sort changes (existing handleSort behavior)
7. FilterBar must still clear `filters` state via `onFiltersChange([])`
8. No `any` types introduced
9. No `console.log` debugging statements

## Done Criteria

1. **AC-01 (B1)**: StructurePanel does NOT render "No columns/indexes/constraints found" before the first fetchData() completes. After first fetch with empty data, it DOES show the empty state message.
2. **AC-02 (B2)**: DataGrid resets `page` to 1 whenever `connectionId`, `table`, or `schema` props change.
3. **AC-03 (B3)**: SchemaTree `handleTableClick` returns early (no state updates) when a data tab already exists for the same connectionId + tableName.
4. **AC-04 (B4)**: FilterBar "Clear All" resets both `filters` and `appliedFilters` in DataGrid, and also resets page to 1.

## Verification Plan

- Profile: mixed (command + static)
- Required checks:
  1. `pnpm build` — must succeed
  2. `cargo clippy --all-targets --all-features -- -D warnings` (from src-tauri/) — no warnings
  3. `cargo test` (from src-tauri/) — all tests pass
  4. `pnpm test` — all tests pass
  5. Static: StructurePanel.tsx contains `hasFetched` state or equivalent mechanism
  6. Static: DataGrid.tsx contains useEffect that resets page on prop changes
  7. Static: SchemaTree.tsx handleTableClick has early return guard
  8. Static: FilterBar.tsx accepts onClearAll prop, DataGrid passes it
- Required evidence:
  - Changed files with purpose
  - All command outputs showing pass/fail
  - Brief explanation of each fix

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `.claude/skills/harness/sprint-1/contract.md`
- Review doc: `docs/REVIEW-P2P1.md`
- Relevant files: `StructurePanel.tsx`, `DataGrid.tsx`, `SchemaTree.tsx`, `FilterBar.tsx`
