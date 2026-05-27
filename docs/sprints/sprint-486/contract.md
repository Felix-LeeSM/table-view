---
review-profile: code
---

# Sprint 486 Contract: PostgreSQL Extension Operator/Type Tolerance

## Goal

Continue Phase 32's PostgreSQL parser/Safe Mode lane by tolerating common
extension-backed operators and column types without claiming full extension
semantics.

## Dependencies

- Depends on: Sprint 485 PostgreSQL `DO $$ ... $$` safety boundary.
- Phase: 32 PostgreSQL lane.
- Blocks: later capability-detected completion packs and catalog-backed
  function/type/operator candidates.

## Scope

- Parse representative PostgreSQL symbolic operator predicates in SELECT
  expressions, starting with `pg_trgm` `%`.
- Preserve the symbolic operator string in the AST so downstream code can
  distinguish extension/operator-tolerated predicates from normal comparison
  operators.
- Parse known extension column types in DDL type positions:
  `citext`, `hstore`, `vector(...)`, `halfvec(...)`, `sparsevec(...)`,
  `geometry(...)`, and `geography(...)`.
- Keep the parser boundary explicit: this is tolerance for known extension
  surface, not semantic validation of installed extensions.
- Safe Mode classification remains unchanged:
  - SELECT with extension predicates stays `select` / `info`.
  - CREATE TABLE with extension types stays `ddl-create` / `info`.
- Update PostgreSQL support docs and regenerate SQL parser WASM.

## Acceptance Criteria

- AC-486-01: `SELECT id FROM docs WHERE title % 'table'` parses as a SELECT.
- AC-486-02: The `%` predicate is represented as an extension-operator
  predicate in the Rust AST.
- AC-486-03: `CREATE TABLE docs (title citext, attrs hstore, embedding vector(3), geom geometry(Point, 4326))`
  parses as `CreateTable`.
- AC-486-04: Extension column types are represented as `kind="extension"`
  with type name and modifiers, rather than being collapsed to `text`.
- AC-486-05: Safe Mode keeps extension SELECTs and extension CREATE TABLEs in
  their existing non-danger tiers.

## Out of Scope

- Detecting whether an extension is installed.
- Enabling completion packs.
- Full PostgreSQL operator precedence.
- `ORDER BY embedding <-> '[...]'` expression ordering.
- Parsing PostGIS function internals or nested extension function arguments.
- Runtime execution changes.

## Verification Plan

1. RED parser tests for extension operator/type tolerance.
2. Rust parser-core tests.
3. Frontend SQL facade/Safe Mode tests for the new serialized shapes.
4. Regenerate SQL WASM and check size budget.
5. Frontend typecheck.
6. Documentation drift check.

### Required Checks

1. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_486 --quiet`
2. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
3. `pnpm build:sql-wasm`
4. `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
5. `pnpm exec tsc -b --pretty false`
6. `bash scripts/check-wasm-size.sh`
7. `git diff --check origin/main...HEAD`
