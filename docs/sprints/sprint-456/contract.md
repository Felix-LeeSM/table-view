# Sprint 456 Contract: DuckDB Catalog And Query Basics

## Goal

Implement the first DuckDB runtime slice: open a `.duckdb` file, browse catalog,
and execute SQL returning tabular results.

## Dependencies

- Depends on: 455.
- Parallel lane: rdbms/duckdb.
- Blocks: 457 and 459.

## Scope

- Wire DuckDB adapter/runtime using the selected library or backend integration.
- Browse schemas/tables/views/columns where DuckDB exposes them.
- Execute basic SQL and return tabular envelopes.
- Add fixture-backed tests.

## Acceptance Criteria

- AC-456-01: `.duckdb` files can be opened and queried.
- AC-456-02: Catalog browse covers common objects.
- AC-456-03: SQL results flow through the shared RDBMS result envelope.
- AC-456-04: Unsupported DuckDB features fail clearly.

## Out of Scope

- CSV/Parquet/JSON analytics shortcuts.
- Extension install UX.
- Remote DuckDB/cloud integrations.

## Verification Plan

1. DuckDB adapter fixture tests.
2. Focused frontend catalog/query tests.
3. Typecheck and backend tests for touched crates.
