# H4 RDBMS Intelligence Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the H4 ERD/SchemaGraph gate. It separates current unit/component
and dense screenshot smoke evidence so reusable graph claims do not imply
data compare or migration/apply execution.

## Schema metadata cache owner

Current evidence:

- `src/stores/schemaStore.ts`
- `src/stores/schemaStore.tableMetadataCache.test.ts`
- `src/stores/schemaStore.clearForConnection.test.ts`

Current gap / routing:

Current cache owner range is
schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers.
New catalog metadata must define cache ownership before UI claim promotion.

## Production ERD graph input

Current evidence:

- `src/components/schema/SchemaErdPanel.tsx`
- `src/components/schema/SchemaErdPanel.test.tsx`
- `src/lib/schemaGraphSnapshot.ts`
- `src/lib/schemaGraphSnapshot.test.ts`

Current gap / routing:

ERD uses schema/table/column cache plus cached/fetched explicit index/constraint
metadata for visible tables. `ColumnInfo` PK/FK/CHECK metadata remains a
synthetic fallback when explicit metadata is absent.

## Reusable SchemaGraph extraction and FK semantics

Current evidence:

- `src/lib/schemaGraph.ts`
- `src/lib/schemaGraph.test.ts`
- `src/lib/schemaGraphRelationships.ts`
- `src/lib/schemaGraphRelationships.test.ts`

Current gap / routing:

RDB catalog/FK semantics are current scope. Other paradigms may expose catalog
graphs later, but must not pretend to be RDB schemas.

## ERD renderer local interactions

Current evidence:

- `src/components/schema/SchemaErdRenderer.test.tsx`
- `src/components/schema/SchemaErdLayout.ts`
- `e2e/smoke/erd-dense.spec.ts`

Current gap / routing:

Table cards, FK edges, search, select, zoom, fit, focus, and highlight are local
diagram interactions. The dense ERD smoke opens a seeded PostgreSQL graph on
desktop and narrow viewports, asserts nodes/FK edges/search/selection/zoom/fit,
and captures non-empty screenshot artifacts.

## Read-only dependency view

Current evidence:

- `src/components/schema/SchemaErdRenderer.test.tsx`
- `src/components/schema/SchemaErdPanel.test.tsx`

Current gap / routing:

Selected ERD tables show incoming/outgoing FK tables/columns, related
indexes/constraints, CHECK expressions, and visible metadata/SchemaGraph
diagnostics. Empty, diagnostic, and non-RDB unsupported states have focused
component evidence.

## Migration impact summaries

Current evidence:

- `src/lib/schemaGraphSelectors.test.ts`
- `src/components/structure/SqlPreviewDialog.test.tsx`
- `src/components/schema/DropTableDialog.test.tsx`
- `src/components/schema/DropColumnDialog.test.tsx`
- `src/components/structure/IndexesEditor.test.tsx`
- `src/components/structure/ConstraintsEditor.test.tsx`

Current gap / routing:

Table, column, constraint, and index removal previews show cached SchemaGraph
impact summaries for dependent tables/columns/indexes/constraints/FKs and
metadata diagnostics. Current evidence is pure selector plus affected
dialog/editor component coverage; no desktop smoke claim is made.

## Read-only schema diff

Current evidence:

- `src/lib/schemaGraphDiff.test.ts`
- `src/components/schema/SchemaGraphDiffPanel.test.tsx`
- `src/components/schema/SchemaErdPanel.test.tsx`

Current gap / routing:

Same-source and cross-source cached RDBMS snapshots compare through SchemaGraph
for table, column, index, constraint, and FK add/remove/change groups with
stable ordering. The panel is read-only and does not claim migration/apply
execution, data compare, import/export, admin, or DuckDB registered-file-alias
support.

## FK row navigation boundary

Current evidence:

- `src/components/datagrid/DataGridTable.fk-navigation.test.tsx`
- `src/components/datagrid/DataGridTable.parseFkReference.test.ts`

Current gap / routing:

FK row navigation remains the DataGrid foreign-key cell/icon path. ERD
interactions are not FK row navigation claims.

## Future data compare surfaces

Current evidence:

- `docs/ROADMAP.md`
- `memory/engineering/architecture/data-source/memory.md`

Current gap / routing:

Future data compare surfaces must reuse `SchemaGraph`/catalog input and avoid
duplicate catalog parsing before support claims widen.

## Runtime E2E smoke inventory

Current evidence:

This matrix, `.github/workflows/e2e-smoke.yml`,
`e2e/fixtures/postgresql/query/seed.sql`, and `e2e/smoke/erd-dense.spec.ts`

Current gap / routing:

The wired dense ERD smoke opens a seeded PostgreSQL schema, verifies table
nodes, FK edges, search, selection, zoom, fit, desktop and narrow viewport
behavior, metadata fetch stability, and non-empty screenshot artifacts. It does
not claim FK row navigation through ERD, schema diff, migration impact, or data
compare.
