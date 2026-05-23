# Sprint 462 Handoff: ERD Renderer Foundation

## Gate Result

Sprint 462 adds the first relational ERD surface. The UI now renders a
`SchemaGraph` as selectable table nodes with FK relationship edges, plus empty
and isolated-table states.

## Closed By This Sprint

- Added `SchemaErdRenderer` for table cards, PK/FK column markers, FK edge
  labels, selection state, zoom controls, and fit reset.
- Added `SchemaErdPanel` to adapt cached `schemaStore` metadata into a
  `SchemaGraphCatalogSnapshot`, then delegate extraction to `extractSchemaGraph`.
- Added an `ERD` sub-view on RDB table tabs beside Records and Structure.
- Added component tests for non-empty graphs, relationship labels, selection,
  empty graph state, and isolated-table state.
- Updated MainArea routing tests for the new ERD sub-view.

## Remaining ERD Gaps

- The layout is deterministic but intentionally basic. Sprint 463 owns
  navigation/layout polish.
- The panel uses currently cached schemas, tables, and columns. Index and
  constraint caches are not part of the panel yet, so relationship coverage
  depends on column FK metadata unless the graph source is widened later.
- Full screenshot/playwright visual regression is deferred because this sprint
  only adds the renderer foundation and component coverage.

## Verification

- `pnpm exec vitest run src/components/layout/MainArea.test.tsx src/components/schema/SchemaErdRenderer.test.tsx`
- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm exec prettier --check src/components/layout/MainArea.tsx src/components/layout/MainArea.test.tsx src/components/schema/SchemaErdPanel.tsx src/components/schema/SchemaErdRenderer.tsx src/components/schema/SchemaErdRenderer.test.tsx src/lib/schemaGraphSnapshot.ts src/stores/workspaceStore/types.ts`
- `pnpm exec eslint src/components/layout/MainArea.tsx src/components/layout/MainArea.test.tsx src/components/schema/SchemaErdPanel.tsx src/components/schema/SchemaErdRenderer.tsx src/components/schema/SchemaErdRenderer.test.tsx src/lib/schemaGraphSnapshot.ts src/stores/workspaceStore/types.ts` (passes with pre-existing `MainArea.test.tsx` max-lines warning)
- `git diff --check`
