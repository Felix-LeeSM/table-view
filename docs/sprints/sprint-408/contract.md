# sprint-408 — DocumentDataGrid split phase 1

## Scope

Split the highest-churn UI sections out of
`src/components/document/DocumentDataGrid.tsx` without changing document grid
behavior.

This sprint is a phase-1 extraction only. Data loading, edit state, projection,
quick look, add-document, column sizing, and expanded-row state remain owned by
the parent component.

## Acceptance Criteria

- AC-408-01: bulk operations are rendered from a dedicated
  `DocumentDataGrid/DocumentBulkOps.tsx` component.
- AC-408-02: document grid row and nested-cell rendering move under
  `DocumentDataGrid/cellRenderers/`.
- AC-408-03: `DocumentDataGrid.tsx` is under 700 lines after formatting.
- AC-408-04: document grid regression tests pass for row rendering, nested
  cells, aria-grid semantics, schema labels, hidden columns, column resizing,
  and tree panel behavior.
- AC-408-05: typecheck, lint, build, and the full test suite pass.

## Dependencies

- sprint-406 global `setupTauriMock` test helper.

## Out Of Scope

- Further decomposition of data fetching, edit state, column sizing, or quick
  look wiring.
- Behavioral changes to Mongo insert, update, delete, or bulk-write flows.
