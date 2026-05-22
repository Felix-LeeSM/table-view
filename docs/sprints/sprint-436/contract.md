# Sprint 436 Contract: Schema Store Clear Alias

## Goal

Resolve RISK-041/L3 by removing the dead `schemaStore.clearSchema` public API.
`clearForConnection(connId)` is the single schema-store action for
connection-scoped cache eviction.

## Scope

- Remove `clearSchema` from `schemaStore` state and implementation.
- Keep `clearForConnection` behavior byte-equivalent for all schema cache
  slices.
- Migrate schema-store tests to call `clearForConnection`.
- Delete coverage that only proved the old alias existed.
- Rename local variables only where they preserve the same behavior and reduce
  `clearSchema` ambiguity.

## Acceptance Criteria

- AC-436-01: `useSchemaStore.getState().clearSchema` is not defined.
- AC-436-02: Tests call `clearForConnection` for connection-scoped eviction.
- AC-436-03: `clearForConnection` still removes every cached schema-store
  slice for the target connection: schemas, tables, view/function lists,
  table-column cache, and trigger cache. Index and constraint getters remain
  uncached and do not gain stale state.
- AC-436-04: Sibling connection cache entries are preserved.
- AC-436-05: No unrelated store, workspace, risk-register, or plan changes.

## Out Of Scope

- Workspace-store or data-grid edit-store cleanup naming.
- Shared `docs/RISKS.md` or `docs/PLAN.md` updates.
- New cache eviction behavior beyond the alias removal.

## Verification Plan

1. `pnpm exec vitest run src/stores/schemaStore.test.ts src/stores/schemaStore.scope.test.ts src/stores/schemaStore.db-aware.test.ts src/stores/schemaStore.clearForConnection.test.ts`
2. `pnpm exec tsc -b --pretty false`
3. `git diff --check`
4. `pnpm exec lefthook validate`
