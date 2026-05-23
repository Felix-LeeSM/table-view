# Sprint 461 Handoff: SchemaGraph Relationship Normalizer

## Gate Result

Sprint 461 adds a pure relationship-normalization layer for `SchemaGraph`
foreign keys. ERD consumers now get one source-to-target FK contract instead of
reading dialect-shaped constraint fields directly.

## Closed By This Sprint

- Added normalized FK metadata on constraint nodes and FK edges:
  `direction: "source-to-target"`, source endpoint, target endpoint, and raw
  metadata.
- Kept table FK edges stable from child/source table to referenced/target table.
- Normalized unnamed constraint IDs into deterministic synthetic names.
- Filled partial FK metadata from column-level `fk_reference` when constraint
  metadata lacks `reference_columns`.
- Added diagnostics for FK column-count mismatches and conflicting constraint vs
  column reference metadata.
- Added fixture tests for composite FK, single-column FK, partial metadata,
  invalid metadata, and unnamed constraints.

## Remaining Relationship Gaps

- Backend `ConstraintInfo` still has no separate referenced schema field, delete
  rule, update rule, deferrability, or match type. The graph preserves available
  raw metadata but cannot expose fields the adapters do not return.
- SQLite and DuckDB adapter constraint lists remain empty in current runtime
  paths, so graph FK coverage depends on column-level flags until backend
  introspection is widened.
- Composite FK ordering is trusted from adapter payload order. The normalizer
  detects source/reference count mismatch, but it cannot prove semantic pairing
  if a backend returns both vectors in the wrong order.

## Verification

- `pnpm vitest run src/lib/schemaGraph.test.ts src/lib/schemaGraphRelationships.test.ts`
- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
