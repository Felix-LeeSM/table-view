# Sprint 487 Handoff: PostgreSQL Installed Extension Inventory

## Result

- Added `PostgresExtensionInfo` as the backend/TypeScript wire model for
  installed extension rows.
- Added `RdbAdapter::list_extensions`, with PostgreSQL dispatch wired through
  the existing RDB command path.
- Implemented PostgreSQL extension inventory from `pg_catalog.pg_extension`
  joined to `pg_catalog.pg_namespace`.
- Added `list_postgres_extensions(connectionId, expectedDatabase?)` Tauri IPC
  and frontend `listPostgresExtensions` wrapper.
- Preserved the existing `expectedDatabase` mismatch guard before trait
  dispatch.
- Documented that extension completion packs remain disabled until a later
  sprint consumes this inventory.

## Evidence

- RED log: `docs/sprints/sprint-487/red-state.log`
- RED patch: `docs/sprints/sprint-487/red-test.patch`
- RED commit: `14f061dd test: RED postgres extension inventory`

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml --lib list_postgres_extensions --quiet`
  - passed: 3 focused tests
- `cargo test --manifest-path src-tauri/Cargo.toml --lib list_extensions_sql_matches_canonical_fixture --quiet`
  - passed: 1 focused test
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet`
  - passed: 1347 tests, 2 ignored
- `pnpm exec tsc -b --pretty false`
  - passed
- `git diff --check origin/main...HEAD`
  - passed

## Boundaries

- No extension completion-pack activation.
- No UI surface for installed extensions.
- No runtime operator/function/type behavior change.
- No catalog-backed candidates from extension contents.
