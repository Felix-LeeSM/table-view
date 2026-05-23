# Sprint 460 Handoff: SchemaGraph Catalog Extraction

## Gate Result

Sprint 460 introduces a reusable TypeScript `SchemaGraph` model and pure
catalog-snapshot extractor. Renderer, store wiring, Tauri commands, and backend
adapter queries remain unchanged.

## Closed By This Sprint

- Added `SchemaGraph` node/edge/diagnostic types for schemas, tables, columns,
  indexes, constraints, primary-key edges, and foreign-key table/column edges.
- Added deterministic extraction from existing RDBMS catalog payloads:
  `SchemaInfo`, `TableInfo`, `ColumnInfo`, `IndexInfo`, and `ConstraintInfo`.
- Added fallback synthesis for column-flag-only PK/FK metadata, covering SQLite
  style catalogs where `get_table_constraints` may be empty.
- Added fallback synthesis for `ColumnInfo.check_clauses` so CHECK expressions
  remain visible to graph consumers even when named constraint metadata lacks
  expression text.
- Added diagnostics for inferred reference schema, missing reference tables,
  missing reference columns, and missing source/index/constraint columns.
- Kept output sorted by stable IDs so ERD, FK navigation, schema diff, and
  migration-impact work can reuse one graph boundary.
- Encoded graph ID path segments so dotted SQL identifiers cannot collide with
  graph ID delimiters.

## Non-Goals Kept

- No ERD renderer.
- No schema diff implementation.
- No Zustand store coupling.
- No Rust IPC or adapter behavior change.
- No non-RDBMS graph extraction.

## Verification

- `vitest run src/lib/schemaGraph.test.ts`
- `tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
