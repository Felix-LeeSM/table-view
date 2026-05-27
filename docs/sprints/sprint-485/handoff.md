# Sprint 485 Handoff: PostgreSQL DO Block Safety Boundary

## Result

- Added `DO` to parser known SQL verbs, while keeping it outside supported
  grammar.
- `DO $$ BEGIN RAISE NOTICE 'hi'; END $$` now returns
  `UnsupportedStatement` before the lexer reaches the dollar-quoted body.
- Safe Mode classifies top-level `DO` procedural blocks as
  `kind="routine-call"` / `severity="warn"`.
- Pinned Safe Mode reason:
  `DO — procedural block execution`.
- Updated PostgreSQL query-language docs.
- Regenerated SQL parser WASM.

## RED Evidence

- RED test patch: `docs/sprints/sprint-485/red-test.patch`.
- RED output: `docs/sprints/sprint-485/red-state.log`.
- Initial parser failure: `DO $$ ... $$` returned `LexError`.
- Initial Safe Mode failure: `DO $$ ... $$` returned `other` / `info`.

## Verification

- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml ac_485 --quiet`
  - 1 passed.
- `pnpm vitest run src/lib/sql/sqlSafety.test.ts -t "Sprint 485"`
  - 2 passed.
- `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --quiet`
  - 540 passed.
- `pnpm vitest run src/lib/sql/sqlAst.test.ts src/lib/sql/sqlSafety.test.ts`
  - 2 files passed, 197 tests passed.
- `pnpm exec tsc -b --pretty false`
  - passed.
- `pnpm build:sql-wasm`
  - passed.
- `bash scripts/check-wasm-size.sh`
  - SQL wasm: raw 232,596 bytes, gzip 83,292 bytes, budget 204,800 bytes.
  - Mongo wasm: raw 104,916 bytes, gzip 52,169 bytes, budget 54,272 bytes.
- `git diff --check origin/main...HEAD`
  - passed.

## Boundaries

- Still unsupported: parsing PL/pgSQL bodies, generic dollar-quoted strings,
  inspecting DO body internals for nested DML/DDL, and runtime execution
  changes.
