# Sprint 422 Contract: PostgreSQL WASM Completion Core v0

## Goal

Add the first Rust/WASM SQL completion core for PostgreSQL while keeping the
production CodeMirror popup on the current TypeScript sources.

## Scope

1. Rust core
   - Accept the Sprint 420 `SqlCompletionRequest` shape.
   - Return the generic `CompletionResult` shape with `engine: "wasm"`.
   - Provide PostgreSQL keyword, table, view, column, and function candidates.

2. Context handling
   - Preserve UTF-16 and UTF-8 replace ranges.
   - Support bare-prefix candidates.
   - Support simple qualified column candidates such as `users.` and
     `u.` after `FROM users u`.

3. WASM bridge and frontend facade
   - Export `complete_sql` from `sql-parser-core`.
   - Add a TypeScript facade for async and preloaded completion calls.

## Acceptance Criteria

- AC-422-01: PostgreSQL requests return keyword candidates from dialect
  vocabulary.
- AC-422-02: PostgreSQL requests return table/view candidates from catalog
  objects.
- AC-422-03: PostgreSQL requests return column candidates from catalog columns,
  including simple alias-qualified columns.
- AC-422-04: PostgreSQL requests return function candidates from dialect and
  catalog functions.
- AC-422-05: Replace range preserves both UTF-16 and UTF-8 offsets.
- AC-422-06: Non-PostgreSQL dialects return an empty v0 result rather than
  pretending to support a provider.

## Out Of Scope

- Switching the live popup to WASM-first.
- PostgreSQL parity gate against TypeScript sources.
- Deep SQL grammar context classification.
- MySQL/MariaDB/SQLite provider behavior.

## Validation

```bash
cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml completion
pnpm build:sql-wasm
pnpm exec vitest run src/lib/sql/sqlCompletionWasm.test.ts \
  src/lib/sql/sqlCompletionRequest.test.ts
pnpm exec eslint src/lib/sql/sqlCompletionWasm.ts \
  src/lib/sql/sqlCompletionWasm.test.ts
pnpm exec prettier --check docs/PLAN.md docs/sprints/sprint-422/contract.md \
  src/lib/sql/sqlCompletionWasm.ts src/lib/sql/sqlCompletionWasm.test.ts
pnpm exec tsc --noEmit
pnpm wasm:size
```
