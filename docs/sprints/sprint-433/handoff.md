# Sprint 433 Handoff: RDB Pending Edit Database Key

## Status

Complete. RISK-039 is resolved by keying pending edit entries with database
identity.

## What Changed

- `dataGridEditStore.entryKey` now composes
  `(connectionId, database, schema, table)`.
- `useDataGridEditPendingState` requires database identity for a shared store
  key and keeps the existing per-instance fallback when any required segment is
  missing.
- RDB and document data grid edit callers pass their known database into
  `useDataGridEdit`.
- RDB grid edit commits pass that database as `expectedDatabase` to
  `executeQueryBatch`, matching the row-fetch db-mismatch guard.
- The shared edit hook type now requires `database`, so future callers cannot
  compile with the old three-part identity shape.
- `workspaceStore.removeTab` computes a database-aware pending edit key and
  only treats same-database table tabs as consumers of that key.
- RISK-039 regression tests cover store isolation, hook remount isolation, and
  tab-close purge behavior.

## Red Evidence

Before the implementation, the focused regression run failed:

```text
pnpm exec vitest run src/stores/dataGridEditStore.test.ts src/components/datagrid/useDataGridEdit.persist.test.ts src/stores/workspaceStore.lifecycle.test.ts
```

Failures included:

- `entryKey("conn1", "db1", "public", "users")` returned
  `conn1::db1::public` instead of `conn1::db1::public::users`.
- Mounting `db2.public.users` saw the pending edit created for
  `db1.public.users`.
- Closing the `dbA.public.users` tab did not purge the database-aware dbA key.

## Verification

- `pnpm exec vitest run src/stores/dataGridEditStore.test.ts src/components/datagrid/useDataGridEdit.persist.test.ts src/stores/workspaceStore.lifecycle.test.ts`
  - Pass: 3 files, 24 tests.
- `pnpm exec vitest run src/lib/datagrid/paradigmEditAdapter.test.ts src/components/datagrid/useDataGridEdit.commit-error.test.ts src/components/datagrid/useDataGridEdit.mixed-batch.test.ts src/components/datagrid/useDataGridEdit.safe-mode.test.ts`
  - Pass: RDB commit path forwards `expectedDatabase`.
- `pnpm exec tsc --noEmit`
  - Pass.

## Notes

- `purgeForConnection(connectionId)` intentionally remains prefix-based on
  `${connectionId}::`, so it removes all database-scoped keys for the
  connection.
- `DocumentDataGrid.tsx` is already over the god-file threshold; this sprint
  touched it only to pass the existing `database` prop into the shared edit
  hook. No decomposition was attempted because it is outside this bug fix.
