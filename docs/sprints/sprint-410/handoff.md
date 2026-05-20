# sprint-410 handoff

## Summary

Split `workspaceStore.ts` into domain slices while preserving the existing root
store module, public exports, persistence subscription, IPC bridge, and ADR 0027
workspace keying.

## Changed Files

- `src/stores/workspaceStore.ts`
  - Now composes slices with Zustand `combine`.
  - Keeps all public type/action/helper/selector re-exports.
- `src/stores/workspaceStore/shared.ts`
  - Owns workspace patch helpers, id counters, active DB resolution, and
    paradigm resolution.
- `src/stores/workspaceStore/slices/tabSlice.ts`
  - Owns table tab lifecycle, dirty state, reorder, reopen, and connection
    cleanup actions.
- `src/stores/workspaceStore/slices/querySlice.ts`
  - Owns query tab creation, SQL/state updates, completion guards, dry-run, and
    saved-query loading.
- `src/stores/workspaceStore/slices/sidebarSlice.ts`
  - Owns expanded node, scroll position, and selected node actions.
- `src/stores/workspaceStore/selectors.ts`
  - Owns current workspace key, workspace lookup, active tab, tabs, dirty ids,
    and closed history hooks.

## Guardrails

- `@stores/workspaceStore` remains the public import path for existing callers.
- The store still persists only the `workspaces` top-level state key.
- `removeTab` and `clearForConnection` still purge `dataGridEditStore` at the
  same lifecycle seams.
- Legacy localStorage hydration still seeds tab/query counters before new tab
  creation.

## Validation

- `pnpm exec tsc --noEmit`
- `pnpm exec eslint src/stores/workspaceStore.ts src/stores/workspaceStore/shared.ts src/stores/workspaceStore/selectors.ts src/stores/workspaceStore/slices/tabSlice.ts src/stores/workspaceStore/slices/querySlice.ts src/stores/workspaceStore/slices/sidebarSlice.ts`
- `pnpm exec prettier --check src/stores/workspaceStore.ts src/stores/workspaceStore/shared.ts src/stores/workspaceStore/selectors.ts src/stores/workspaceStore/slices/tabSlice.ts src/stores/workspaceStore/slices/querySlice.ts src/stores/workspaceStore/slices/sidebarSlice.ts`
- `pnpm exec vitest run src/stores/workspaceStore.lifecycle.test.ts src/stores/workspaceStore.queryMode.test.ts src/stores/workspaceStore.sidebar.test.ts src/stores/workspaceStore.selectors.test.ts src/stores/workspaceStore.counterSeed.test.ts src/stores/workspaceStore.persistence.test.ts src/stores/workspaceStore.addQueryTab.paradigm.test.ts src/stores/workspaceStore/persistence.dehydrate.test.ts src/stores/workspaceStore/persistence.no-ls-write.test.ts`
- `git diff --check`
