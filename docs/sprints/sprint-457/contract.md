---
review-profile: code
---

# Sprint 457 Contract: DuckDB File Analytics Import And Preview

## Goal

Add the first DuckDB file-analytics workflow for local CSV/Parquet/JSON preview
and query without weakening privacy boundaries.

## Dependencies

- Depends on: 456.
- Parallel lane: rdbms/duckdb.
- Blocks: 459.

## Scope

- Select the first supported analytics file types and size limits.
- Provide preview/query behavior through DuckDB SQL.
- Keep file paths local and avoid silent history persistence of sensitive paths.
- Add fixtures for supported file types.

## Acceptance Criteria

- AC-457-01: Supported local files can be previewed/queryable through DuckDB.
- AC-457-02: Unsupported file types and oversized files fail clearly.
- AC-457-03: Query history/privacy policy covers file paths.
- AC-457-04: Import/preview UI does not imply cloud sync.

## Out of Scope

- Object store/S3 connectors.
- Persistent import project management.
- Full data-cleaning UI.

## Verification Plan

1. File analytics fixture tests.
2. Privacy/history regression tests.
3. Focused UI smoke.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
