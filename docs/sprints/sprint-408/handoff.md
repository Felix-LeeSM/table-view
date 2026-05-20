# sprint-408 handoff

## Summary

Split `DocumentDataGrid.tsx` phase 1 into dedicated chrome, bulk-operation, and
row-rendering components while preserving the existing Mongo document grid
behavior.

## Changed Files

- `src/components/document/DocumentDataGrid.tsx`
  - Parent now keeps orchestration state and wires extracted components.
  - Formatted length: 686 lines.
- `src/components/document/DocumentDataGrid/DocumentGridControls.tsx`
  - Owns toolbar slots, hidden-column badge, filter bar, error banner, and
    initial loading spinner.
- `src/components/document/DocumentDataGrid/DocumentBulkOps.tsx`
  - Owns `useMongoBulkOps` and the delete-many/update-many dialogs.
- `src/components/document/DocumentDataGrid/cellRenderers/DocumentGridRows.tsx`
  - Owns row, cell, sentinel toggle, nested detail row, and BSON pending-edit
    serialization helpers.
- `src/components/schema/CreateTableDialog.test.tsx`
  - Hardens the target-schema preview test against the live preview's initial
    debounce flush.
- `src/lib/sql/updateColumnCompletion.ts`
  - Ensures CodeMirror parses through the cursor before inspecting the SQL
    syntax tree for UPDATE/INSERT/DELETE column completion.

## Guardrails

- Parent `expandedNested` keeps the same row/column/id snapshot shape.
- Sentinel cells remain read-only and keep the existing `{ ... }`, `[N items]`,
  and open `✕` rendering.
- Nested pending edit keys keep the existing `row-col:path` shape.
- Bulk delete/update dialogs keep the same safe-mode gate and refetch callback.

## Validation

- `pnpm exec tsc --noEmit`
- `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.nested.test.tsx src/components/document/DocumentDataGrid.aria-grid.test.tsx src/components/document/DocumentDataGrid.schema.test.tsx src/components/document/DocumentDataGrid.hide.test.tsx src/components/document/DocumentDataGrid.column-resize.test.tsx src/components/document/DocumentTreePanel.test.tsx`
- `pnpm vitest run src/components/schema/CreateTableDialog.test.tsx`
- `pnpm vitest run src/lib/sql/updateColumnCompletion.test.ts`
- Schema dropdown flake loop: 30/30 then 10/10
- INSERT column completion flake loop: 30/30
