---
review-profile: code
---

# Sprint 484 Contract: PostgreSQL MERGE Parser/Safe Mode First Slice

## Goal

Continue Phase 32's PostgreSQL query/workbench parity lane by promoting a narrow,
auditable `MERGE` subset from unsupported statement to parsed write surface.

## Dependencies

- Depends on: Sprint 483 PostgreSQL function-call expression widening.
- Phase: 32 PostgreSQL lane.
- Blocks: later PostgreSQL `DO $$` policy, extension operator/type tolerance,
  and EXPLAIN parity slices.

## Scope

- Support table-source PostgreSQL `MERGE INTO <target> [AS alias] USING
  <source> [AS alias] ON <predicate>`.
- Support `WHEN MATCHED THEN UPDATE SET ...`.
- Support `WHEN NOT MATCHED THEN INSERT (...) VALUES (...)`.
- Support `WHEN ... THEN DO NOTHING`.
- Allow MERGE action RHS values to be literals, placeholders, `DEFAULT`, or
  simple column references such as `source.id`.
- Classify parsed MERGE as `kind="dml-merge"`, `severity="warn"`.
- Keep unsupported MERGE forms as write-surface WARN fallback, not INFO.
- Update PostgreSQL support docs to match the exact first-slice boundary.

## Acceptance Criteria

- AC-484-01: `parse("MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN UPDATE SET name = incoming.name")`
  returns a `merge` AST with target/source refs, ON expression, and one update
  clause.
- AC-484-02: `parse("MERGE INTO users AS u USING incoming AS i ON u.id = i.id WHEN NOT MATCHED THEN INSERT (id, name) VALUES (i.id, 'new')")`
  returns a `merge` AST with aliases and one insert clause whose first value is
  a column reference.
- AC-484-03: `parse("MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DO NOTHING")`
  returns a `merge` AST with a do-nothing action.
- AC-484-04: `MERGE ... WHEN MATCHED THEN DELETE` remains rejected by the parser.
- AC-484-05: Safe Mode classifies parsed MERGE as
  `kind="dml-merge"`, `severity="warn"`, `reasons=[]`.
- AC-484-06: Safe Mode classifies unsupported/opaque MERGE as
  `kind="dml-merge"`, `severity="warn"` instead of falling through to INFO.

## Out of Scope

- `WHEN NOT MATCHED BY SOURCE`.
- `WHEN ... AND <condition>` clause filters.
- `DELETE` MERGE actions.
- Source subqueries in `USING`.
- `RETURNING`, `OVERRIDING`, `ONLY`, partition modifiers, or arbitrary
  PostgreSQL expression grammar inside action values.
- Runtime execution changes.

## Verification Plan

1. RED parser test for the target MERGE AST.
2. Rust parser-core tests.
3. Frontend SQL facade/Safe Mode tests.
4. Regenerate SQL WASM and check size budget.
5. Frontend typecheck.
6. Documentation drift check.

### Required Checks

1. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml`
2. `pnpm build:sql-wasm`
3. `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
4. `pnpm exec tsc -b --pretty false`
5. `bash scripts/check-wasm-size.sh`
6. `git diff --check origin/main...HEAD`
