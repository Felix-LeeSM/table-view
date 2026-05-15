# Sprint Execution Brief: sprint-350

## Objective

Add Records/Structure sub-tab to Mongo collection tabs. Inside Structure, expose two sub-sub-tabs: Indexes (read-only list of MongoDB indexes via existing `list_mongo_indexes` IPC) and Validator (mount the existing `ValidatorPanel` component verbatim). This is the tracer slice — frontend-only, no backend changes.

## Task Why

Mongo collection tabs currently render `DocumentDataGrid` directly with no sub-tabs, so the existing read-only `ValidatorPanel` (Sprint 333) and the existing `list_mongo_indexes` IPC are not reachable from the UI. Adding the sub-tab shell unblocks Sprints 351 (index CRUD) and 352 (validator level/action) — both add interactions inside this Structure pane, so we need the shell to land first.

## Scope Boundary

- ✅ Touch: `MainArea.tsx` document branch; new files `MongoStructurePanel.tsx`, `MongoIndexesPanel.tsx`; corresponding new test files.
- ❌ Do NOT touch: `ValidatorPanel.tsx` body (mount move only), `DocumentDataGrid.tsx` body, any RDB-paradigm files, any Rust files, any other Tauri command.
- ❌ Do NOT add: backend wire, index create/drop UI, validator level/action selects, Inferred Fields panel.

## Invariants

- RDB Records/Structure sub-tab UI byte-identical pre/post.
- `DocumentDataGrid` behavior unchanged when Records sub-tab is active.
- `list_mongo_indexes` Tauri command signature unchanged.
- No new Tauri command registered.
- `pnpm tsc --noEmit`, `pnpm lint`, full `pnpm vitest run` all green at end-of-sprint.

## Done Criteria

1. Mongo collection tab paints a `role="tablist"` bar with `Records` (default) and `Structure` tabs (testid `mongo-table-subtab-bar`).
2. Structure mounts `MongoStructurePanel` with a nested `role="tablist"` bar (`Indexes` default, `Validator`; testid `mongo-structure-subsubtab-bar`); keyboard arrow keys toggle within each tab bar; inner selection survives a Structure tab re-activation.
3. `MongoIndexesPanel` fires exactly one `list_mongo_indexes` on mount per `(connectionId, database, collection)`; renders one row per `IndexInfo`; paints empty-state when list is empty; paints `role="alert"` on IPC failure; loading state uses `useDelayedFlag(loading, 1000)`.
4. Validator sub-sub-tab mounts the existing `ValidatorPanel` (testid `validator-panel`) verbatim; Read/Save/Clear flows behave identical to its prior placement.
5. RDB regression: an RTL test renders an RDB table tab and asserts (a) existing Records/Structure sub-tab bar intact, (b) `mongo-*` testids absent.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `pnpm tsc --noEmit` → exit 0.
  2. `pnpm lint` → exit 0.
  3. `pnpm vitest run` → no new failures vs baseline.
  4. Focused: `pnpm vitest run src/components/document/__tests__/MongoStructurePanel.test.tsx src/components/document/__tests__/MongoIndexesPanel.test.tsx src/components/layout/MainArea.test.tsx` → all green.
  5. RDB regression: `pnpm vitest run src/components/schema/StructurePanel.columns.test.tsx src/components/schema/StructurePanel.constraints.test.tsx` → no new failures.
- Required evidence:
  - Per-AC testid / test name proving the AC.
  - Full check output (pass/fail counts).
  - Baseline-vs-after vitest fail-count delta (must be ≤ 0 net new failures from this sprint's scope; the pre-existing autocompleteTheme failures stay flat).

## Evidence To Return

- Changed files and purpose (one line each).
- Checks run and outcomes (paste raw last lines).
- Done criteria coverage with evidence (AC-N → testid / test path / line range).
- Assumptions made during implementation.
- Residual risk or verification gaps.

## References

- Contract: `docs/sprints/sprint-350/contract.md`
- Spec (master, all 3 sprints): `docs/sprints/sprint-350/spec.md`
- Relevant files:
  - `src/components/layout/MainArea.tsx` (RDB branch is the template for the new Mongo branch — Records/Structure tab bar pattern)
  - `src/components/document/DocumentDataGrid.tsx` (mounted from Records sub-tab — do NOT edit body)
  - `src/components/document/ValidatorPanel.tsx` (mounted from Validator sub-sub-tab — do NOT edit body)
  - `src/lib/tauri/document.ts` (existing `listMongoIndexes` binding)
  - `src/components/schema/StructurePanel.tsx` (RDB sub-sub-tab pattern reference; do NOT edit)
  - `src/stores/workspaceStore.ts` (existing `subView` persistence — confirm document tabs read/write it; minimal change only if needed)
  - `src/types/document.ts` (existing `IndexInfo` shape returned by `list_mongo_indexes`)
