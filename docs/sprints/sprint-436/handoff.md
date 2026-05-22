# Sprint 436 Handoff: Schema Store Clear Alias

## Status

Complete.

## Implemented Invariant

`schemaStore.clearForConnection(connId)` is the only public schema-store action
for connection-scoped cache eviction. The retired `clearSchema` alias is absent
from the store state.

## Behavior Notes

- `clearForConnection` keeps the existing wide eviction shape: every cached
  slot under the target connection is removed across DBs.
- Index and constraint getters remain uncached, matching the pre-sprint store
  behavior.
- Sibling connection cache entries are preserved.
- Production callers continue to use `clearForConnection`; connect-time local
  naming was clarified without changing call order or behavior.

## Verification

- `pnpm exec vitest run src/stores/schemaStore.test.ts src/stores/schemaStore.scope.test.ts src/stores/schemaStore.db-aware.test.ts src/stores/schemaStore.clearForConnection.test.ts`
  - Pass: 4 files, 41 cases.
- `pnpm exec vitest run src/stores/schemaStore.test.ts src/stores/schemaStore.scope.test.ts src/stores/schemaStore.db-aware.test.ts src/stores/schemaStore.clearForConnection.test.ts src/hooks/useConnectionLifecycle.test.ts`
  - Pass: 5 files, 45 cases.
- `pnpm exec tsc -b --pretty false`
  - Pass.
- `git diff --check`
  - Pass.
- `pnpm exec lefthook validate`
  - Pass.

## Residual Risk

No known residual risk for RISK-041/L3. Broader cleanup naming in other stores
remains out of scope.
