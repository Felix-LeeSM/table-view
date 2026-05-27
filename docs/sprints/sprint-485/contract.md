---
review-profile: code
---

# Sprint 485 Contract: PostgreSQL DO Block Safety Boundary

## Goal

Continue Phase 32's PostgreSQL parser/Safe Mode lane by making anonymous
`DO $$ ... $$` procedural blocks a known unsupported parser boundary and a
WARN-tier Safe Mode surface.

## Dependencies

- Depends on: Sprint 484 PostgreSQL MERGE parser/Safe Mode first slice.
- Phase: 32 PostgreSQL lane.
- Blocks: later PL/pgSQL policy, PostgreSQL extension tolerance, and deeper
  routine/body handling.

## Scope

- Add top-level `DO` to the known SQL verb set, but not to supported parser
  grammar.
- Return `UnsupportedStatement` for `DO $$ ... $$` before the lexer reaches the
  dollar-quoted body.
- Classify top-level `DO ...` in Safe Mode as
  `kind="routine-call"`, `severity="warn"`.
- Pin the Safe Mode reason string to `DO — procedural block execution`.
- Update PostgreSQL support docs with the parser/Safe Mode boundary.
- Regenerate SQL parser WASM and verify size budget.

## Acceptance Criteria

- AC-485-01: `parse("DO $$ BEGIN RAISE NOTICE 'hi'; END $$")` returns
  `error_kind="unsupported-statement"` and mentions `DO`.
- AC-485-02: Safe Mode classifies `DO $$ BEGIN RAISE NOTICE 'hi'; END $$` as
  `kind="routine-call"`, `severity="warn"`, with reason
  `DO — procedural block execution`.
- AC-485-03: Comment/whitespace-prefixed `DO` keeps the same Safe Mode
  classification.
- AC-485-04: `DO` remains outside the supported parser grammar; this sprint
  does not parse PL/pgSQL or dollar-quoted bodies.

## Out of Scope

- Parsing PL/pgSQL bodies.
- Generic dollar-quoted string grammar.
- Inspecting procedural block internals for nested DML/DDL.
- Runtime execution changes.
- Multi-statement transaction/control-flow scripting.

## Verification Plan

1. RED parser and Safe Mode tests for `DO $$ ... $$`.
2. Rust parser-core tests.
3. Regenerate SQL WASM.
4. Frontend SQL facade/Safe Mode tests.
5. Frontend typecheck.
6. WASM size check.
7. Documentation drift check.

### Required Checks

1. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_485 --quiet`
2. `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
3. `pnpm build:sql-wasm`
4. `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
5. `pnpm exec tsc -b --pretty false`
6. `bash scripts/check-wasm-size.sh`
7. `git diff --check origin/main...HEAD`
