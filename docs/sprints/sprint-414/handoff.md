# sprint-414 handoff

## Summary

Reduced `useDataGridEdit.ts` from 945 lines to 467 lines by extracting pure edit
FSM helpers, hook surface types, and store-backed pending/undo state. Added RDB
and Document hook entries and moved production grids to those entries.

## Changed Files

- `src/components/datagrid/dataGridEditFsm.ts`
  - Pure edit key, row key, input type, editor seed, cell string/value, pending
    edit application, commit error, snapshot, and undo cap helpers.
- `src/components/datagrid/dataGridEditTypes.ts`
  - Shared hook params and return-state interfaces.
- `src/components/datagrid/useDataGridEditPendingState.ts`
  - Store-backed pending edits/new rows/deleted rows/undo state.
- `src/components/datagrid/useRdbDataGridEdit.ts`
  - RDB-specific hook entry.
- `src/components/datagrid/useDocumentDataGridEdit.ts`
  - Document-specific hook entry.
- `src/components/rdb/DataGrid.tsx`
  - Uses `useRdbDataGridEdit`.
- `src/components/document/DocumentDataGrid.tsx`
  - Uses `useDocumentDataGridEdit`.

## Guardrails

- `useDataGridEdit.ts` remains as a compatibility export while production grids
  use the paradigm-specific hooks.
- `useDataGridPreviewCommit` still owns preview/execute/Safe Mode behavior.
- Pending edit persistence key shape remains `(connectionId, schema, table)`.

## Validation

- `pnpm exec tsc --noEmit`
- `pnpm exec vitest run src/components/datagrid/useDataGridEdit.*.test.ts src/components/rdb/DataGrid.editing.test.tsx src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.nested.test.tsx src/components/query/EditableQueryResultGrid.test.tsx src/components/query/useRawQueryGridEdit.test.ts`
- `pnpm run lint` (0 errors, existing max-lines warnings only; `useDataGridEdit.ts`
  no longer warns)
- `pnpm exec prettier --check src/components/datagrid/dataGridEditFsm.ts src/components/datagrid/dataGridEditTypes.ts src/components/datagrid/useDataGridEditPendingState.ts src/components/datagrid/useDocumentDataGridEdit.ts src/components/datagrid/useRdbDataGridEdit.ts src/components/datagrid/useDataGridEdit.ts src/components/datagrid/useDataGridEdit.document.test.ts src/components/datagrid/useDataGridEdit.paradigm.test.ts src/components/datagrid/DataGridTable/DataRow.tsx src/components/datagrid/DataGridTable/contextMenu.tsx src/components/datagrid/DataGridTable/useCellNavigation.ts src/components/document/DocumentDataGrid.tsx src/components/document/DocumentDataGrid/cellRenderers/DocumentGridRows.tsx src/components/query/EditableQueryResultGrid.tsx src/components/query/PendingChangesTray.tsx src/components/query/useRawQueryGridEdit.ts src/components/rdb/DataGrid.tsx src/components/shared/QuickLookPanel/FieldRow.tsx src/hooks/useDataGridPreviewCommit.ts docs/sprints/sprint-414/contract.md docs/sprints/sprint-414/handoff.md`
- `git diff --check`
