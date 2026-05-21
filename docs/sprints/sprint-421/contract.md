# Sprint 421 Contract: CodeMirror Completion Shadow Path

## Goal

Connect the live SQL CodeMirror autocomplete surface to the Sprint 420
completion request contract without changing visible completion behavior.

## Scope

1. CodeMirror adapter
   - Convert `CompletionContext.state.doc` and `CompletionContext.pos` into a
     `SqlCompletionRequest`.
   - Preserve UTF-16 and UTF-8 cursor offsets through the generic completion
     contract.

2. Shadow source
   - Register a SQL `CompletionSource` that emits the normalized request to an
     optional observer.
   - Always return `null` so CodeMirror candidates still come from the current
     TypeScript sources.

3. Live editor wiring
   - Thread a `SqlCompletionContext` from the schema store into `SqlQueryEditor`.
   - Keep the source scoped to SQL language data only.

## Acceptance Criteria

- AC-421-01: A CodeMirror `CompletionContext` can produce a
  `SqlCompletionRequest` with stable text, cursor, dialect, shell, catalog, and
  cache state.
- AC-421-02: The shadow source does not add, remove, or rank any visible
  completion candidate.
- AC-421-03: `QueryTab` supplies catalog-backed completion context for RDB tabs.
- AC-421-04: Document and Mongo query editors do not receive the SQL shadow
  source.

## Out Of Scope

- Rust/WASM completion engine.
- PostgreSQL parity comparison.
- Replacing current TypeScript completion sources.
- MySQL/MariaDB/SQLite dialect-specific provider behavior beyond the existing
  request contract.

## Validation

```bash
pnpm exec vitest run src/lib/sql/sqlCodeMirrorCompletionAdapter.test.ts \
  src/lib/sql/sqlCompletionRequest.test.ts \
  src/lib/sql/sqlCompletionContext.test.ts
pnpm exec eslint src/lib/sql/sqlCodeMirrorCompletionAdapter.ts \
  src/lib/sql/sqlCodeMirrorCompletionAdapter.test.ts \
  src/components/query/SqlQueryEditor.tsx src/components/query/QueryTab.tsx
pnpm exec tsc --noEmit
```
