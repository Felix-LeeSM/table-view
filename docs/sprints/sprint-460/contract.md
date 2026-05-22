# Sprint 460 Contract: SchemaGraph Catalog Extraction

## Goal

Start ERD work by extracting a reusable `SchemaGraph` model from RDBMS catalog
data instead of building an ERD-only data structure.

## Dependencies

- Depends on: 459.
- Parallel lane: erd/schema.
- Blocks: 461-464.

## Scope

- Define the minimal `SchemaGraph` node/edge model for schemas, tables, columns,
  primary keys, foreign keys, indexes, and constraints.
- Build extraction from existing RDBMS catalog data.
- Keep renderer work out of this sprint.
- Add fixture tests for PostgreSQL-like and MySQL/SQLite-like catalogs.

## Acceptance Criteria

- AC-460-01: `SchemaGraph` is reusable by ERD, FK navigation, schema diff, and
  migration impact analysis.
- AC-460-02: Graph extraction is deterministic.
- AC-460-03: Missing relationship metadata degrades without crashing.
- AC-460-04: Existing catalog browse behavior is unchanged.

## Out of Scope

- Canvas/renderer work.
- Schema diff implementation.
- Non-RDBMS catalog graphs.

## Verification Plan

1. Graph extraction unit tests.
2. Catalog fixture tests.
3. Typecheck.
