# sprint-413 handoff

## Summary

Split document state into catalog and query Zustand stores while preserving the
existing reset helper and observable Mongo read behavior.

## Changed Files

- `src/stores/documentCatalogStore.ts`
  - Owns databases, collections, field cache, catalog loading/error, and catalog
    request counters.
- `src/stores/documentQueryStore.ts`
  - Owns find/aggregate result caches and query request counters.
- `src/stores/documentStoreMaps.ts`
  - Shares immutable nested-map helpers.
- `src/stores/documentStore.ts`
  - Removed; production call sites now import the focused stores directly.
- `src/test-utils/documentStore.ts`
  - Provides a combined test-only state/reset helper for existing regression
    tests.
- Document/query/tree/switcher/lifecycle call sites
  - Import the focused catalog or query store directly.
- `src/stores/documentStore.test.ts`
  - Adds regression coverage for catalog reload not invalidating an in-flight
    find result.

## Guardrails

- Query results stay transient and request-id guarded independently of catalog
  reloads.
- Catalog and query caches are both cleared on connection lifecycle changes and
  document DB switches.
- Mongo payload normalization remains in the query store boundary.

## Validation

- `pnpm exec tsc --noEmit`
- `pnpm exec vitest run src/stores/documentStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/components/query/QueryTab.dialect.test.tsx src/components/document/AddDocumentModal.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/schema/DocumentDatabaseTree.test.tsx src/components/workspace/DbSwitcher.test.tsx`
- `pnpm run lint` (0 errors, existing max-lines warnings only)
- `pnpm exec prettier --check src/stores/documentCatalogStore.ts src/stores/documentQueryStore.ts src/stores/documentStoreMaps.ts src/test-utils/documentStore.ts src/stores/documentStore.test.ts src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts src/components/workspace/DbSwitcher.tsx src/components/workspace/DbSwitcher.test.tsx src/components/document/AddDocumentModal.tsx src/components/document/AddDocumentModal.test.tsx src/components/document/DocumentDataGrid.tsx src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid/useDocumentGridData.ts src/components/query/QueryTab.tsx src/components/query/QueryTab.dialect.test.tsx src/components/query/__tests__/queryTabTestHelpers.ts src/components/schema/DocumentDatabaseTree.test.tsx src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts src/components/schema/DocumentDatabaseTree/useDocumentDatabaseTreeData.ts docs/sprints/sprint-413/contract.md docs/sprints/sprint-413/handoff.md`
- `git diff --check`
