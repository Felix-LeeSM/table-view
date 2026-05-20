# Sprint Handoff: sprint-406

## Delivered

- Added a shared exact-barrel Tauri mock helper:
  `src/test-utils/tauriMock.ts`.
- Registered global default mocks for `@lib/tauri` and `@/lib/tauri` in
  `src/test-setup.ts`.
- Migrated exact-barrel Tauri mocks in test files to `setupTauriMock(...)`.
- Preserved intentional subpath mocks for modules imported through Tauri
  subpaths.

## Evidence

- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test src/components/rdb/DataGrid.editing.test.tsx`
- `pnpm test src/__tests__/cross-window-store-sync.test.tsx`
- `pnpm test src/stores/schemaStore.test.ts src/stores/connectionStore.test.ts src/components/connection/ImportExportDialog.test.tsx`
- `pnpm test src/components/query src/components/rdb src/components/datagrid`
- `pnpm test src/components/document src/components/schema src/components/structure src/components/connection src/components/workspace src/stores src/hooks src/router src/__tests__`
- `pnpm test`

## Follow-Up

- sprint-407 can now use `setupTauriMock(...)` for `useQueryExecution`
  scaffold tests.
