# Sprint 464 Contract: SchemaGraph Integration Gate

## Goal

Verify `SchemaGraph` and ERD are stable enough to become the base for future
schema diff, FK navigation, and migration impact features.

## Dependencies

- Depends on: 463.
- Parallel lane: erd/join.
- Blocks: future schema intelligence work.

## Scope

- Review graph extraction, relationship normalization, renderer, navigation,
  and layout behavior together.
- Validate PostgreSQL/MySQL/MariaDB/SQLite/DuckDB assumptions where fixtures
  exist.
- Update roadmap/risk docs for remaining ERD gaps.

## Acceptance Criteria

- AC-464-01: ERD uses `SchemaGraph` as SOT.
- AC-464-02: RDBMS dialect gaps are known and documented.
- AC-464-03: Future schema intelligence features can reuse the graph.
- AC-464-04: Existing browse/query/edit workflows are unaffected.

## Out of Scope

- Schema diff.
- Migration generation.
- Export/share.

## Verification Plan

1. SchemaGraph test suite.
2. ERD UI smoke.
3. Typecheck/lint/hook gate.
