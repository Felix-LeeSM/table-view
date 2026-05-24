# Sprint 464 Handoff: SchemaGraph Integration Gate

## Gate Result

Sprint 464 keeps ERD on `SchemaGraph` as the source of truth. The UI continues
to receive only a `SchemaGraph` in `SchemaErdRenderer`, while `SchemaErdPanel`
builds a catalog snapshot and calls `extractSchemaGraph`.

## Closed By This Sprint

- Preserved the Sprint 462 architecture: `SchemaErdPanel` adapts schema-store
  caches into `SchemaGraphCatalogSnapshot`; the renderer does not inspect raw
  `TableInfo`/`ColumnInfo` caches.
- Added navigation/layout behavior on top of graph nodes and
  `foreign-key-table` edges only.
- Verified existing graph tests cover PostgreSQL, MySQL/MariaDB, SQLite, and
  DuckDB assumptions already represented by fixtures.
- Documented deferred ERD visual-smoke risk in `docs/RISKS.md`.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-464-01 | Renderer prop remains `graph: SchemaGraph`; relationship UI consumes `SchemaGraphEdge.foreignKey`. |
| AC-464-02 | Existing `schemaGraph.test.ts` covers runtime RDBMS matrix, MySQL/MariaDB alignment, SQLite synthetic PK/FK, and DuckDB missing-relationship metadata. |
| AC-464-03 | `SchemaErdLayout.ts` exposes graph-layout helpers reusable by future FK navigation/schema intelligence features. |
| AC-464-04 | ERD changes are scoped to schema components/docs; no browse/query/edit command or store behavior changed. |

## Verification

- `pnpm exec vitest run src/components/schema/SchemaErdRenderer.test.tsx`

## Deferred

- No schema diff, migration generation, export/share.
- Full Playwright screenshot pass deferred to the risk register.
