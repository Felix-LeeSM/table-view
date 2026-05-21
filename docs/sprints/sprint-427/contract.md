# Sprint 427 Contract: Shadow Cleanup And Support Matrix

## Goal

Remove the obsolete shadow-only SQL completion helper and update the long-term
completion plan so the next sprint starts from the WASM-first architecture.

## Acceptance Criteria

- AC-427-01: `sqlCompletionShadowSource` and editor shadow callback props are
  removed.
- AC-427-02: `SqlQueryEditor` registers a single SQL hybrid completion source.
- AC-427-03: Phase 31 and query-language support docs describe the
  WASM-first/fallback state.
- AC-427-04: Generated SQL WASM artifacts are refreshed after Rust core
  changes.

## Validation

```bash
pnpm build:sql-wasm
pnpm vitest run src/lib/sql/sqlHybridCompletionSource.test.ts \
  src/lib/sql/sqlCompletionWasm.test.ts src/lib/mongo/mongoAutocomplete.test.ts
```
