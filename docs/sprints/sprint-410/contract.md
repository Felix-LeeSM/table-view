# sprint-410 — workspaceStore slice split

## Scope

Split `src/stores/workspaceStore.ts` into tab, query, sidebar, selector, and
shared helper modules without changing the public `@stores/workspaceStore`
export surface or ADR 0027 `(connId, db)` workspace keying.

## Acceptance Criteria

- AC-410-01: tab lifecycle actions live in
  `src/stores/workspaceStore/slices/tabSlice.ts`.
- AC-410-02: query tab actions live in
  `src/stores/workspaceStore/slices/querySlice.ts`.
- AC-410-03: sidebar actions live in
  `src/stores/workspaceStore/slices/sidebarSlice.ts`.
- AC-410-04: selector hooks live in
  `src/stores/workspaceStore/selectors.ts` and remain re-exported from
  `@stores/workspaceStore`.
- AC-410-05: the root store uses Zustand `combine` to keep one
  `WorkspaceStoreState` with the existing persistence and IPC bridge behavior.
- AC-410-06: every split module stays below 500 lines after formatting.
- AC-410-07: existing workspaceStore lifecycle, query, sidebar, persistence,
  counter seeding, and selector tests pass.

## Non-Goals

- Do not migrate component/test imports away from `@stores/workspaceStore` in
  this sprint.
- Do not change tab id generation, preview replacement, query state guards, or
  sidebar persistence semantics.
- Do not change persisted workspace schema or storage keys.
