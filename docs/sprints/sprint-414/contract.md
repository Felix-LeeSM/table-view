# sprint-414 — data grid edit split

## Scope

Split the dual-paradigm data-grid edit hook into focused boundaries without
changing user-visible edit behavior:

- pure edit helpers/types
- store-backed pending/undo state
- RDB hook entry
- Document hook entry

## Acceptance Criteria

- AC-414-01: common pure edit helpers live outside `useDataGridEdit.ts`.
- AC-414-02: store-backed pending/undo state lives outside
  `useDataGridEdit.ts`.
- AC-414-03: RDB grids call `useRdbDataGridEdit`.
- AC-414-04: Document grids call `useDocumentDataGridEdit`.
- AC-414-05: existing RDB and Document edit tests keep passing.
- AC-414-06: `useDataGridEdit.ts` is below the 500-line god-file threshold.

## Non-Goals

- Do not change SQL/MQL preview generation or execution behavior.
- Do not change pending edit persistence keys.
- Do not remove the legacy `useDataGridEdit` export in this sprint; tests and
  helper imports can continue migrating incrementally.
