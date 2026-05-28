---
review-profile: code
---

# Sprint 487 Contract: PostgreSQL Installed Extension Inventory

## Goal

Create the catalog inventory surface required before PostgreSQL extension
completion packs can be enabled. This sprint detects installed extensions; it
does not yet enable completion candidates.

## Dependencies

- Depends on: Sprint 486 extension parser/type tolerance.
- Phase: 32 PostgreSQL lane.
- Blocks: detected extension completion packs for `pgcrypto`, `uuid-ossp`,
  `postgis`, `pgvector`, `citext`, `hstore`, and `pg_trgm`.

## Scope

- Add a backend `PostgresExtensionInfo` wire model.
- Add `RdbAdapter::list_extensions` with a default unsupported implementation.
- Implement PostgreSQL `list_extensions` using `pg_catalog.pg_extension` joined
  to `pg_catalog.pg_namespace`.
- Add Tauri command `list_postgres_extensions(connectionId, expectedDatabase?)`.
- Keep the same dispatch shape as `list_postgres_types`, including
  `expected_database` mismatch guard.
- Add TypeScript type and invoke wrapper.
- Document that extension pack completion still remains disabled until a later
  sprint consumes this inventory.

## Acceptance Criteria

- AC-487-01: PostgreSQL adapter exposes installed extension rows with extension
  name, schema, version, and comment.
- AC-487-02: The runtime SQL is locked by a byte-for-byte unit fixture.
- AC-487-03: `list_postgres_extensions` routes through `RdbAdapter` and returns
  the adapter result.
- AC-487-04: `expectedDatabase` mismatch returns `AppError::DbMismatch` before
  calling the trait method.
- AC-487-05: Document/non-RDB paths continue to fail via the existing adapter
  paradigm gate/default unsupported path.
- AC-487-06: TypeScript callers can invoke `listPostgresExtensions` with the
  camelCase payload and typed response.

## Out of Scope

- Enabling extension completion packs.
- Adding UI badges or panels for extensions.
- Detecting unknown extension capabilities beyond raw inventory rows.
- Catalog-backed operators/functions/types from installed extensions.
- Runtime execution behavior changes.

### Required Checks

1. `cargo test --manifest-path src-tauri/Cargo.toml --lib list_postgres_extensions --quiet`
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib list_extensions_sql_matches_canonical_fixture --quiet`
3. `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet`
4. `pnpm exec tsc -b --pretty false`
5. `git diff --check origin/main...HEAD`
